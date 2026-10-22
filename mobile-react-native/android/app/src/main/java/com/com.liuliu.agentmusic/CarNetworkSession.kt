package com.liuliu.agentmusic

import org.json.JSONObject
import java.io.Closeable
import java.net.*
import java.util.concurrent.*
import java.util.concurrent.atomic.AtomicLong

/** Explicitly enabled LAN-only UDP control + TCP data. No Internet security policy changes. */
internal class CarNetworkSession(private val business: (String, JSONObject) -> JSONObject,
  private val binary: (String, JSONObject) -> CarProtocol.Binary?, private val report: (String) -> Unit) : Closeable {
  data class Device(val id: String, val name: String, val address: InetAddress, val command: Int, val result: Int, val data: Int, val seen: Long)
  val devices = ConcurrentHashMap<String, Device>()
  @Volatile var status = "已关闭"; private set
  @Volatile private var running = false
  @Volatile private var peer: Device? = null
  @Volatile private var tcp: Socket? = null
  private var discovery: DatagramSocket? = null
  private var commands: DatagramSocket? = null
  private var results: DatagramSocket? = null
  private var timer: ScheduledExecutorService? = null
  private var worker: ThreadPoolExecutor? = null
  @Volatile private var lastSeen = 0L
  private val ids = AtomicLong()
  private val generation = AtomicLong()
  fun connectionGeneration() = generation.get()
  private data class Pending(val key: String, val future: CompletableFuture<JSONObject>)
  private val pending = ConcurrentHashMap<Long, Pending>()
  @Volatile var pcmBlock = 1_048_576; private set
  @Volatile var picBlock = 1_048_576; private set
  @Volatile var lyricBlock = 51_200; private set
  var onDisconnected: ((Long) -> Unit)? = null
  private data class CachedReply(val fingerprint: String, val envelope: JSONObject, val epoch: Long?)
  private val replies = object : LinkedHashMap<Long, CachedReply>() {
    override fun removeEldestEntry(entry: MutableMap.MutableEntry<Long, CachedReply>?) = size > 64
  }
  private fun state(text: String) { status = text; report(text) }
  @Synchronized fun start() {
    if (running) return
    try {
      discovery = DatagramSocket(null).apply { reuseAddress = true; bind(InetSocketAddress(43921)) }
      commands = DatagramSocket(0); results = DatagramSocket(0)
      worker = ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS, ArrayBlockingQueue(32), { r -> Thread(r, "LiuliuCarCommand").apply { isDaemon = true } })
      running = true
      receive(requireNotNull(discovery), true); receive(requireNotNull(commands), false); receive(requireNotNull(results), false)
      timer = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "LiuliuCarHeartbeat").apply { isDaemon = true } }.apply {
        scheduleAtFixedRate({
          val now = System.nanoTime()
          if (devices.entries.removeIf { now - it.value.seen > TimeUnit.SECONDS.toNanos(30) }) report(status)
          val target = peer
          if (target != null) {
            if (now - lastSeen > TimeUnit.SECONDS.toNanos(11)) disconnect("设备心跳超时")
            else runCatching { send(commands, target, target.command, CarProtocol.request("Heartbeat", 0)) }
          }
        }, 1, 3, TimeUnit.SECONDS)
      }
      state("监听发现 UDP 43921；请选择设备连接")
    } catch (error: Exception) { close(); state("启动失败：${error.message}") }
  }
  private fun receive(socket: DatagramSocket, discover: Boolean) {
    Thread({
      val buffer = ByteArray(16_385)
      while (running && !socket.isClosed) try {
        val packet = DatagramPacket(buffer, buffer.size); socket.receive(packet)
        if (if (discover) discovery !== socket else commands !== socket && results !== socket) continue
        if (packet.length > 16_384 || !local(packet.address)) continue
        val json = JSONObject(String(packet.data, packet.offset, packet.length, Charsets.UTF_8))
        if (discover) { discover(json, packet.address); continue }
        val target = peer ?: continue
        if (packet.address != target.address || packet.port !in listOf(target.command, target.result)) continue
        lastSeen = System.nanoTime()
        if (!json.has("Request")) {
          val id = json.optLong("RequestID"); val expected = pending[id]
          if (expected != null && json.has(expected.key)) { pending.remove(id)?.future?.complete(json) }
          continue
        }
        val token = generation.get()
        try { worker?.execute { if (generation.get() == token) handle(json, target, token) } } catch (_: RejectedExecutionException) { state("命令积压，已拒绝") }
      } catch (error: Exception) { if (!socket.isClosed) state("报文错误：${error.message?.take(100)}") }
    }, if (discover) "LiuliuCarDiscover" else "LiuliuCarUDP").apply { isDaemon = true; start() }
  }
  private fun discover(json: JSONObject, sender: InetAddress) {
    val info = json.optJSONObject("Discover") ?: return
    val id = info.optString("DeviceID").takeIf { it.isNotBlank() && it.length <= 128 } ?: return
    fun port(name: String): Int = info.getInt(name).also { require(it in 1..65535) }
    val declared = info.optString("DeviceIP", sender.hostAddress ?: "")
    require(declared == sender.hostAddress) { "发现地址与发送者不符" }
    require(info.optInt("ConnectType", 1) == 1) { "未实现该蓝牙/USB代理传输" }
    if (devices.size >= 64 && !devices.containsKey(id)) return
    devices[id] = Device(id, info.optString("DeviceName", id).take(128), sender, port("CommandPort"), port("ResultPort"), port("DataPort"), System.nanoTime())
    report(status)
  }
  fun connect(id: String) {
    if (!running) return state("请先启动局域网发现")
    val target = devices[id] ?: return state("设备已失效")
    disconnect("正在连接")
    val token = generation.get()
    worker?.execute {
      if (!running || generation.get() != token) return@execute
      val socket = Socket()
      try {
        tcp = socket // close() can interrupt connect.
        socket.connect(InetSocketAddress(target.address, target.data), 4000)
        socket.tcpNoDelay = true
        if (!running || generation.get() != token) { socket.close(); return@execute }
        peer = target; lastSeen = System.nanoTime()
        send(commands, target, target.command, CarProtocol.request("CommInfos", ids.incrementAndGet(), JSONObject()
          .put("CommandPort", commands!!.localPort).put("ResultPort", results!!.localPort)))
        val info = request("DeviceInfos", JSONObject()).get(4, TimeUnit.SECONDS).getJSONObject("DeviceInfos")
        if (!running || generation.get() != token) { socket.close(); return@execute }
        fun buffer(name: String, fallback: Int) = (info.optInt(name, fallback).takeIf { it > 0 } ?: fallback)
          .also { require(it <= 1_048_576) { "设备缓冲字段${name}超过1MiB" } }
        pcmBlock = buffer("PCMBuf", 1_048_576)
        picBlock = buffer("PICBuf", 1_048_576); lyricBlock = buffer("LRCBuf", 51_200)
        CarPcmBuffer.packageSize(pcmBlock)
        state("已连接 ${target.name}；设备缓冲已协商")
        send(commands, target, target.command, CarProtocol.request("Heartbeat", 0))
        Thread({ try { val received = socket.getInputStream().read(); if (received >= 0) state("收到未支持的反向二进制数据") }
          catch (_: Exception) { } finally { if (tcp === socket) disconnect("TCP 数据通道已断开") } }, "LiuliuCarTCPMonitor").apply { isDaemon = true; start() }
      } catch (error: Exception) { socket.close(); if (generation.get() == token) disconnect("连接失败：${error.message}") }
    }
  }
  private fun handle(json: JSONObject, target: Device, token: Long) {
    if (peer !== target || generation.get() != token) return
    val name = json.optString("Request"); val id = json.optLong("RequestID", 0)
    if (id < 0 || name.isBlank()) return
    val fingerprint = json.toString()
    val key = id
    val binaryRequest = name in listOf("PCMData", "LiuliuLivePCMData", "LyricData", "PICData")
    if (id != 0L) synchronized(replies) { replies[key] }?.let { cached ->
      if (cached.fingerprint != fingerprint) {
        send(results, target, target.result, CarProtocol.response(CarProtocol.responseKey(name), id, JSONObject().put("Error", 107).put("ErrorMessage", "RequestID reused")))
        return
      }
      val oldData = cached.envelope.optJSONObject(name)
      if (cached.epoch != null && cached.epoch != CarPcmBuffer.epoch) {
        send(results, target, target.result, CarProtocol.response(name, id, JSONObject().put("Error", 108).put("ErrorMessage", "数据代次已失效")))
        return
      }
      val retryMetadata = name in listOf("MediaInfo", "LiuliuLiveMediaInfo") && oldData?.has("Error") == true
      if (!binaryRequest && !retryMetadata) { if (cached.envelope.length() > 0) send(results, target, target.result, cached.envelope); return }
      // A repeated binary request needs its bytes again, not merely the earlier UDP success.
    }
    val args = json.optJSONObject("Arguments") ?: JSONObject()
    args.put("__connectionGeneration", token)
    val requestEpoch = if (binaryRequest) CarPcmBuffer.epoch else null
    val response = try {
      if (name in listOf("PCMData", "LiuliuLivePCMData", "LyricData", "PICData")) {
        val data = binary(name, args) ?: error("数据尚不可用，或请求身份/分块已经失效")
        if (data.epoch != null) check(data.epoch == CarPcmBuffer.epoch) { "数据代次已失效" }
        val header = JSONObject().put("SongID", args.optString("SongID")).put("PackageIndex", args.optLong("PackageIndex"))
          .put("Length", data.bytes.size).put("TotalLength", data.total)
        data.lyricType?.let { header.put("LyricType", it) }; data.epoch?.let { header.put("LiuliuEpoch", it) }
        data.lengthKind?.let { header.put("LiuliuLengthKind", it) }
        data.measuredLength?.let { header.put("LiuliuMeasuredPCMDataLength", it) }
        check(generation.get() == token) { "连接已失效" }
        val stream = requireNotNull(tcp)
        val deadline = timer?.schedule({ if (tcp === stream && generation.get() == token) disconnect("TCP 数据发送超时") }, 5, TimeUnit.SECONDS)
        try { CarProtocol.write(stream.getOutputStream(), CarProtocol.response(name, id, header), data.bytes) }
        finally { deadline?.cancel(false) }
        check(generation.get() == token && peer === target) { "连接已失效" }
        data.onSent?.invoke()
        if (name in listOf("PCMData", "LiuliuLivePCMData")) JSONObject().put("Error", 0).apply {
          if (name == "PCMData") put("ErrorMessage", "SONG_ID:${args.optString("SongID")} INDEX:${args.optLong("PackageIndex")}")
          data.epoch?.let { put("LiuliuEpoch", it) }
        } else JSONObject().put("__noResponse", true)
      } else when (name) {
        "Heartbeat" -> JSONObject().put("__noResponse", true)
        "Disconnect" -> business(name, args)
        else -> business(name, args)
      }
    } catch (error: Exception) { JSONObject().put("Error", if (error is CarPcmFailure) error.code else if (error is IllegalArgumentException || error is org.json.JSONException) 107 else 106)
      .put("ErrorMessage", error.message?.take(200) ?: "操作失败").apply { requestEpoch?.let { put("LiuliuEpoch", it) } } }
    if (peer !== target || generation.get() != token) return
    val envelope = if (response.optBoolean("__noResponse") || (!response.has("Error") && !CarProtocol.hasSuccessResponse(name))) JSONObject()
      else CarProtocol.response(CarProtocol.responseKey(name), id, response)
    val replyEpoch = if (binaryRequest || name in listOf("MediaInfo", "LiuliuLiveMediaInfo"))
      if (response.has("Error") && response.optInt("Error") != 0 && !binaryRequest) null else CarPcmBuffer.epoch else null
    if (id != 0L) synchronized(replies) { replies[key] = CachedReply(fingerprint, envelope, replyEpoch) }
    if (envelope.length() > 0) runCatching { send(results, target, target.result, envelope) }.onFailure { disconnect("UDP 发送失败") }
    if (name == "Disconnect") disconnect("对端已断开")
  }
  fun request(name: String, args: JSONObject, timeoutMs: Long = 3000): CompletableFuture<JSONObject> {
    val future = CompletableFuture<JSONObject>(); val target = peer
    if (target == null) { future.completeExceptionally(IllegalStateException("未连接")); return future }
    val id = ids.incrementAndGet(); pending[id] = Pending(CarProtocol.responseKey(name), future)
    try { send(commands, target, target.command, CarProtocol.request(name, id, args)) }
    catch (error: Exception) { pending.remove(id); future.completeExceptionally(error) }
    timer?.schedule({ pending.remove(id)?.future?.completeExceptionally(TimeoutException(name)) }, timeoutMs, TimeUnit.MILLISECONDS)
    return future
  }
  fun notify(name: String, value: JSONObject) {
    val target = peer ?: return
    val token = generation.get()
    runCatching { worker?.execute { if (peer === target && generation.get() == token) runCatching { send(commands, target, target.command, CarProtocol.request(name, ids.incrementAndGet(), value)) } } }
  }
  @Synchronized fun disconnect(reason: String = "已断开") {
    generation.incrementAndGet(); peer = null
    // Revoke ownership before close wakes the monitor, so it cannot replace an explicit timeout reason.
    val previous = tcp; tcp = null; runCatching { previous?.close() }
    pending.values.forEach { it.future.completeExceptionally(IllegalStateException(reason)) }; pending.clear()
    synchronized(replies) { replies.clear() }; CarPcmBuffer.enabled = false; CarPcmBuffer.remoteOnly = false; CarPcmBuffer.origin(-1); CarPcmBuffer.reset(); state(reason)
    onDisconnected?.invoke(generation.get())
  }
  @Synchronized override fun close() {
    running = false; disconnect("已关闭"); timer?.shutdownNow(); timer = null
    discovery?.close(); commands?.close(); results?.close(); worker?.shutdownNow(); worker = null; devices.clear()
    discovery = null; commands = null; results = null
  }
  companion object {
    fun local(address: InetAddress) = address is Inet4Address && (address.isLoopbackAddress || address.isSiteLocalAddress || address.isLinkLocalAddress)
    private fun send(socket: DatagramSocket?, device: Device, port: Int, json: JSONObject) {
      val bytes = json.toString().toByteArray(Charsets.UTF_8); require(bytes.size <= 16_384)
      requireNotNull(socket).send(DatagramPacket(bytes, bytes.size, device.address, port))
    }
  }
}
