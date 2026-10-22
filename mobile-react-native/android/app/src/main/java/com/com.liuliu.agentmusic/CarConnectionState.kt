package com.liuliu.agentmusic

import android.os.Handler
import android.os.Looper
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import com.google.common.util.concurrent.MoreExecutors
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicLong

/** Metadata and async commands only. The phone owns queue/source/storage. */
internal object CarConnectionState {
  val main by lazy { Handler(Looper.getMainLooper()) }
  @Volatile private var published: JSONObject? = null
  val snapshot: JSONObject get() = published ?: JSONObject()
  val hasSnapshot: Boolean get() = published != null
  var sink: ((String) -> Boolean)? = null
  private val sequence = AtomicLong()
  private val pending = mutableMapOf<String, SettableFuture<JSONObject>>()
  private val timeouts = mutableMapOf<String, Runnable>()
  private val networkRequests = mutableMapOf<String, Long>()
  private val peripheralRequests = mutableMapOf<String, Long>()
  private val listeners = linkedSetOf<() -> Unit>()
  private val protocolState = CarProtocolState()
  val qplayState: Int get() = sampleProtocolState(player, false)
  private fun sampleProtocolState(active: androidx.media3.common.Player?, mediaTransition: Boolean): Int {
    if (active == null) { protocolState.reset(); return protocolState.value }
    return protocolState.update(
      active.currentMediaItem?.mediaId.orEmpty(), active.playbackState, active.isPlaying,
      active.playWhenReady, active.playerError != null, mediaTransition,
    )
  }
  private val playbackEvents by lazy { CarPlaybackEvents(::changed).apply {
    sample = { active, events ->
      sampleProtocolState(
        active,
        mediaTransition = events == null || events.contains(androidx.media3.common.Player.EVENT_MEDIA_ITEM_TRANSITION),
      )
    }
  } }
  var player: androidx.media3.common.Player? = null
    set(value) { field = value; playbackEvents.attach(value) }
  fun observe(listener: () -> Unit): () -> Unit { listeners.add(listener); return { listeners.remove(listener) } }
  fun changed() { listeners.toList().forEach { it() } }
  fun publish(value: JSONObject) { published = value; changed() }
  fun request(action: String, args: JSONObject = JSONObject()): ListenableFuture<JSONObject> {
    val future = SettableFuture.create<JSONObject>()
    main.post {
      if (future.isCancelled) return@post
      if (args.has("__connectionGeneration") && args.optLong("__connectionGeneration") != CarConnections.network.connectionGeneration()) {
        future.set(error("网络会话已失效")); return@post
      }
      if (args.has("__peripheralGeneration") && args.optLong("__peripheralGeneration") != CarConnections.peripheral?.connectionGeneration()) {
        future.set(error("外设会话已失效")); return@post
      }
      if (!snapshot.optBoolean("ready") || pending.size >= 32) { future.set(error("手机未就绪或操作过多")); return@post }
      val id = sequence.incrementAndGet().toString()
      pending[id] = future
      future.addListener({ if (future.isCancelled) main.post { complete(id, error("操作已取消")) } }, MoreExecutors.directExecutor())
      if (args.has("__connectionGeneration")) networkRequests[id] = args.getLong("__connectionGeneration")
      if (args.has("__peripheralGeneration")) peripheralRequests[id] = args.getLong("__peripheralGeneration")
      val accepted = sink?.invoke(JSONObject().put("id", id).put("action", action).put("args", args).toString()) == true
      if (!accepted) complete(id, error("手机控制器未连接"))
      else if (pending.containsKey(id)) {
        val timeout = Runnable { complete(id, error("操作超时")) }; timeouts[id] = timeout; main.postDelayed(timeout, 15_000)
      }
    }
    return future
  }
  fun complete(id: String, result: JSONObject) { timeouts.remove(id)?.let { main.removeCallbacks(it) }; networkRequests.remove(id); peripheralRequests.remove(id); pending.remove(id)?.set(result) }
  fun activeRequest(id: String) = pending.containsKey(id) &&
    (networkRequests[id]?.let { it == CarConnections.network.connectionGeneration() } != false) &&
    (peripheralRequests[id]?.let { it == CarConnections.peripheral?.connectionGeneration() } != false)
  fun cancelNetwork() { networkRequests.filterValues { it != CarConnections.network.connectionGeneration() }.keys.toList().forEach { complete(it, error("网络会话已断开")) } }
  fun cancelPeripheral() { peripheralRequests.filterValues { it != CarConnections.peripheral?.connectionGeneration() }.keys.toList().forEach { complete(it, error("外设会话已断开")) } }
  fun error(message: String): JSONObject = JSONObject().put("ok", false).put("error", message)
  fun closeBridge() { sink = null; pending.keys.toList().forEach { complete(it, error("控制器已关闭")) }; publish(JSONObject()) }
}
