package com.liuliu.agentmusic

import android.Manifest
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.*
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Explicit device profiles; no borrowed vendor UUID, key, or inferred authentication. */
@Suppress("DEPRECATION", "MissingPermission")
internal class PeripheralChannel(private val context: Context) : AutoCloseable {
  data class Profile(val service: UUID, val write: UUID, val notify: UUID, val read: UUID, val spp: UUID,
    val secure: Boolean, val protocol: String, val writeType: Int) {
    companion object {
      fun parse(json: String): Profile { val v = JSONObject(json)
        val protocol = v.optString("protocol", "liuliu-json-v1"); require(protocol in listOf("liuliu-json-v1", "raw")) { "未知外设协议" }
        return Profile(UUID.fromString(v.getString("service")), UUID.fromString(v.getString("write")),
          UUID.fromString(v.getString("notify")), UUID.fromString(v.optString("read", v.getString("notify"))),
          UUID.fromString(v.getString("spp")), v.optBoolean("secure", true), protocol,
          if (v.optString("writeType", "withResponse") == "withoutResponse") BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE else BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
      }
    }
  }
  private val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter
  val devices = linkedMapOf<String, BluetoothDevice>()
  var status = "外设未连接"; private set
  var received = ""; private set
  private var scanner: BluetoothLeScanner? = null
  private var scanGeneration = 0L
  private var scanCallback: ScanCallback? = null
  private var classicRegistered = false
  private var gatt: BluetoothGatt? = null
  @Volatile private var socket: BluetoothSocket? = null
  private var profile: Profile? = null
  @Volatile private var generation = 0L
  private var ready = false
  private var mtu = 23
  private var writing = false
  private data class GattOperation(val bytes: ByteArray?) // null denotes a profile read.
  private val writes = ArrayDeque<GattOperation>()
  private val worker = ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS, ArrayBlockingQueue(16), { r -> Thread(r, "LiuliuPeripheral").apply { isDaemon = true } })
  private val frames = PeripheralFrames()
  @Volatile private var router = PeripheralCommands(CarConnections::command)
  private val writeTimeouts = linkedSetOf<Runnable>()
  private var lastConnection: Triple<String, Profile, Boolean>? = null
  private val main = CarConnectionState.main
  private var operation: Runnable? = null
  private var scanTimeout: Runnable? = null
  private fun report(text: String) { status = text; CarConnectionState.changed() }
  private fun checkPermission(scan: Boolean = false) {
    require(adapter != null) { "本机无蓝牙" }
    val permission = if (Build.VERSION.SDK_INT >= 31) { if (scan) Manifest.permission.BLUETOOTH_SCAN else Manifest.permission.BLUETOOTH_CONNECT }
      else if (scan) Manifest.permission.ACCESS_FINE_LOCATION else null
    require(permission == null || ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED) { "缺少蓝牙权限" }
    require(adapter.isEnabled) { "请先开启系统蓝牙" }
  }
  private val discovery = object : BroadcastReceiver() {
    override fun onReceive(c: Context?, intent: Intent?) {
      val device = intent?.getParcelableExtra<BluetoothDevice>(BluetoothDevice.EXTRA_DEVICE)
      if (classicRegistered && device != null && (devices.size < 128 || devices.containsKey(device.address))) { devices[device.address] = device; report("发现 ${devices.size} 个设备") }
    }
  }
  fun scan(profile: Profile, ble: Boolean) {
    stopScan(); checkPermission(true); checkPermission(); devices.clear(); devices.putAll(adapter!!.bondedDevices.associateBy { it.address })
    if (ble) {
      scanner = adapter.bluetoothLeScanner ?: error("BLE 不可用")
      val token = scanGeneration
      val callback = object : ScanCallback() {
        override fun onScanResult(type: Int, result: ScanResult) { main.post { if (token == scanGeneration && scanner != null) {
          runCatching { if (devices.size < 128 || devices.containsKey(result.device.address)) devices[result.device.address] = result.device }
            .onFailure { stopScan(); report("蓝牙扫描权限已撤回") }
            .onSuccess { report("发现 ${devices.size} 个设备") }
        } } }
        override fun onScanFailed(errorCode: Int) { main.post { if (token == scanGeneration) { stopScan(); report("BLE 扫描失败：$errorCode") } } }
      }
      scanCallback = callback
      scanner!!.startScan(listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(profile.service)).build()),
        ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_BALANCED).build(), callback)
    } else {
      ContextCompat.registerReceiver(context, discovery, IntentFilter(BluetoothDevice.ACTION_FOUND), ContextCompat.RECEIVER_EXPORTED)
      classicRegistered = true; check(adapter.startDiscovery()) { "无法开始经典蓝牙扫描" }
    }
    report("扫描中，15秒后停止；BLE 按 profile service 过滤")
    scanTimeout = Runnable { stopScan(); report("扫描结束，共 ${devices.size} 个设备") }.also { main.postDelayed(it, 15_000) }
  }
  fun stopScan() {
    scanGeneration++
    scanTimeout?.let { main.removeCallbacks(it) }; scanTimeout = null
    runCatching { scanCallback?.let { scanner?.stopScan(it) }; if (classicRegistered) adapter?.cancelDiscovery() }; scanner = null; scanCallback = null
    if (classicRegistered) runCatching { context.unregisterReceiver(discovery) }; classicRegistered = false
  }
  private fun deadline(message: String) {
    operation?.let { main.removeCallbacks(it) }
    val token = generation
    operation = Runnable { if (generation == token) { disconnect(); report(message) } }.also { main.postDelayed(it, 10_000) }
  }
  private fun finished() { operation?.let { main.removeCallbacks(it) }; operation = null }
  fun connect(address: String, selected: Profile, ble: Boolean) {
    disconnect(); checkPermission(); stopScan(); profile = selected
    lastConnection = Triple(address, selected, ble)
    val device = devices[address] ?: adapter!!.getRemoteDevice(address)
    val token = generation
    report("连接中 ${device.name ?: address}"); deadline("连接超时")
    if (ble) {
      gatt = device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE) ?: error("GATT 建连失败")
    } else {
      val connection = if (selected.secure) device.createRfcommSocketToServiceRecord(selected.spp) else device.createInsecureRfcommSocketToServiceRecord(selected.spp)
      socket = connection
      Thread({
        try {
          connection.connect()
          main.post { if (token == generation) { finished(); ready = true; report("SPP 已连接：${selected.protocol}") } }
          val buffer = ByteArray(4096)
          while (token == generation) {
            val count = connection.inputStream.read(buffer); if (count < 0) break
            val bytes = buffer.copyOf(count); main.post { if (token == generation) accept(bytes) }
          }
          main.post { if (token == generation) { disconnect(); report("SPP 对端已断开") } }
        } catch (error: Exception) { main.post { if (token == generation) { disconnect(); report("SPP 错误：${error.message}") } } }
        finally { runCatching { connection.close() } }
      }, "LiuliuRFCOMMRead").apply { isDaemon = true; start() }
    }
  }
  private val callback = object : BluetoothGattCallback() {
    private fun on(g: BluetoothGatt, action: () -> Unit) { main.post { if (gatt === g) runCatching(action).onFailure { disconnect(); report("GATT 错误：${it.message}") } } }
    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, state: Int) = on(g) {
      if (status != BluetoothGatt.GATT_SUCCESS || state == BluetoothProfile.STATE_DISCONNECTED) { disconnect(); report("GATT 已断开：$status") }
      else if (state == BluetoothProfile.STATE_CONNECTED) { deadline("服务发现超时"); check(g.discoverServices()) { "服务发现启动失败" } }
    }
    override fun onServicesDiscovered(g: BluetoothGatt, status: Int) = on(g) {
      try {
        check(status == BluetoothGatt.GATT_SUCCESS) { "服务发现失败 $status" }
        val p = requireNotNull(profile); val service = g.getService(p.service) ?: error("Profile service 不存在")
        requireNotNull(service.getCharacteristic(p.write)) { "写特征不存在" }
        val notify = requireNotNull(service.getCharacteristic(p.notify)) { "通知特征不存在" }
        check(g.setCharacteristicNotification(notify, true)) { "无法启用通知" }
        val descriptor = notify.getDescriptor(CCCD) ?: error("通知缺少 CCCD")
        require(notify.properties and (BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0) { "特征不支持通知/指示" }
        val value = if (notify.properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0)
          BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE else BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
        deadline("CCCD 写入超时")
        if (Build.VERSION.SDK_INT >= 33) check(g.writeDescriptor(descriptor, value) == BluetoothStatusCodes.SUCCESS) { "CCCD 写入失败" }
        else { descriptor.value = value; check(g.writeDescriptor(descriptor)) { "CCCD 写入失败" } }
      } catch (error: Exception) { disconnect(); report("GATT 配置错误：${error.message}") }
    }
    override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) = on(g) {
      if (descriptor.uuid != CCCD || !matches(descriptor.characteristic, profile?.notify)) return@on
      if (status != BluetoothGatt.GATT_SUCCESS) { disconnect(); report("CCCD 失败：$status") }
      else { finished(); deadline("MTU 协商超时"); if (!g.requestMtu(185)) { finished(); ready = true; report("BLE 已连接，MTU 23"); pump() } }
    }
    override fun onMtuChanged(g: BluetoothGatt, value: Int, status: Int) = on(g) {
      mtu = if (status == BluetoothGatt.GATT_SUCCESS) value.coerceIn(23, 517) else 23
      if (!ready) { finished(); ready = true }
      report("BLE 已连接，MTU $mtu：${profile?.protocol}"); pump()
    }
    override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) { val bytes = characteristic.value?.clone() ?: return; on(g) { if (ready && matches(characteristic, profile?.notify)) accept(bytes) } }
    override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) { val bytes = value.clone(); on(g) { if (ready && matches(characteristic, profile?.notify)) accept(bytes) } }
    override fun onCharacteristicRead(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray, status: Int) {
      val bytes = value.clone(); on(g) { readResult(characteristic, bytes, status) }
    }
    override fun onCharacteristicRead(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) { val bytes = characteristic.value?.clone(); on(g) {
      readResult(characteristic, bytes, status)
    } }
    override fun onCharacteristicWrite(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) = on(g) {
      if (!writing || writes.firstOrNull()?.bytes == null || !matches(characteristic, profile?.write)) return@on
      finished(); writing = false
      if (status != BluetoothGatt.GATT_SUCCESS) { disconnect(); report("特征写入失败：$status") } else { writes.removeFirstOrNull(); pump() }
    }
  }
  private fun matches(characteristic: BluetoothGattCharacteristic, uuid: UUID?) =
    uuid != null && characteristic.uuid == uuid && characteristic.service?.uuid == profile?.service
  private fun readResult(characteristic: BluetoothGattCharacteristic, bytes: ByteArray?, status: Int) {
    if (!writing || writes.firstOrNull()?.bytes != null || !matches(characteristic, profile?.read)) return
    finished(); writing = false; writes.removeFirstOrNull()
    if (status == BluetoothGatt.GATT_SUCCESS && bytes != null) accept(bytes) else report("特征读取失败：$status")
    pump()
  }
  fun read() {
    require(ready) { "外设尚未完成连接配置" }
    requireNotNull(gatt) { "BLE 未连接" }; require(writes.size < 64) { "外设操作队列已满" }
    writes.addLast(GattOperation(null)); pump()
  }
  fun send(bytes: ByteArray) {
    require(ready) { "外设尚未完成连接配置" }
    require(bytes.size in 1..8192) { "每帧限8192字节" }
    socket?.let { connection ->
      val token = generation
      val timeout = Runnable { if (socket === connection && token == generation) { disconnect(); report("SPP 写入超时") } }
      writeTimeouts.add(timeout); main.postDelayed(timeout, 10_000)
      try { worker.execute {
        try { if (socket === connection && token == generation) { connection.outputStream.write(bytes); connection.outputStream.flush() } }
        catch (error: Exception) { main.post { if (token == generation) { disconnect(); report("SPP 写入失败：${error.message}") } } }
        finally { main.post { main.removeCallbacks(timeout); writeTimeouts.remove(timeout) } }
      } } catch (error: Exception) { main.removeCallbacks(timeout); writeTimeouts.remove(timeout); throw error }
      return
    }
    requireNotNull(gatt) { "外设未连接" }; val size = mtu - 3
    require(writes.size + (bytes.size + size - 1) / size <= 64) { "外设写入队列已满" }
    bytes.asList().chunked(size).forEach { writes.addLast(GattOperation(it.toByteArray())) }; pump()
  }
  private fun pump() {
    if (!ready || writing || writes.isEmpty()) return
    val g = gatt ?: return; val p = profile ?: return
    val data = writes.first().bytes
    val target = g.getService(p.service)?.getCharacteristic(if (data == null) p.read else p.write)
    if (target == null) { disconnect(); report("Profile 目标特征不存在"); return }
    if (data == null) {
      if (target.properties and BluetoothGattCharacteristic.PROPERTY_READ == 0) { disconnect(); report("Profile 特征不支持读取"); return }
      writing = true; deadline("特征读取超时")
      if (!g.readCharacteristic(target)) { disconnect(); report("特征读取未启动") }
      return
    }
    val required = if (p.writeType == BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE) BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE else BluetoothGattCharacteristic.PROPERTY_WRITE
    if (target.properties and required == 0) { disconnect(); report("写特征不支持 profile 的写模式"); return }
    writing = true; deadline("特征写入超时")
    val submitted = if (Build.VERSION.SDK_INT >= 33) g.writeCharacteristic(target, data, p.writeType) == BluetoothStatusCodes.SUCCESS
      else { target.writeType = p.writeType; target.value = data; g.writeCharacteristic(target) }
    if (!submitted) { disconnect(); report("特征写入未启动") }
  }
  private fun accept(bytes: ByteArray) {
    received = bytes.take(128).joinToString("") { "%02x".format(it.toInt() and 255) }
    CarConnectionState.changed()
    if (profile?.protocol != "liuliu-json-v1") return
    try { frames.accept(bytes) { text ->
        val token = generation
        val commands = router
        try { worker.execute {
          if (token != generation) return@execute
          val response = commands.execute(text) { it.put("__peripheralGeneration", token) }
          main.post { if (token == generation) runCatching { send(response) }.onFailure { report("响应写入失败：${it.message}") } }
        } } catch (_: Exception) { report("外设业务队列已满") }
    } } catch (error: Exception) { disconnect(); report(error.message ?: "外设组帧失败") }
  }
  fun reconnect() { val selected = lastConnection ?: error("没有上次设备"); connect(selected.first, selected.second, selected.third) }
  fun connectionGeneration() = generation
  fun disconnect() {
    generation++; ready = false; CarConnectionState.cancelPeripheral(); CarLibraryState.cancelInvalidSelections(); finished(); stopScan(); runCatching { socket?.close() }; socket = null
    val connection = gatt; gatt = null
    try { runCatching { connection?.disconnect() } } finally { runCatching { connection?.close() } }
    writeTimeouts.forEach { main.removeCallbacks(it) }; writeTimeouts.clear()
    writing = false; writes.clear(); frames.clear(); router = PeripheralCommands(CarConnections::command); mtu = 23; report("外设已断开")
  }
  override fun close() { disconnect(); worker.shutdownNow() }
  companion object { private val CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb") }
}
