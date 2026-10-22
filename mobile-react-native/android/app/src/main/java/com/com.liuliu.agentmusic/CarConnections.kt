package com.liuliu.agentmusic

import android.content.Context
import androidx.media3.common.MediaItem
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Callable
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

/** App-owned control API. Android owns audio routing and the media session. */
internal object CarConnections {
  const val PROTOCOL = "liuliu-car-v1"
  private var app: Context? = null
  var bluetooth: CarBluetoothManager? = null; private set
  var peripheral: PeripheralChannel? = null; private set
  fun initialize(context: Context) {
    if (app != null) return
    app = context.applicationContext
    bluetooth = CarBluetoothManager(context.applicationContext)
    peripheral = PeripheralChannel(context.applicationContext)
  }
  fun close() {
    bluetooth?.close(); bluetooth = null
    peripheral?.close(); peripheral = null
    app = null
  }
  fun <T> main(block: () -> T): T {
    if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) return block()
    val task = FutureTask(Callable(block)); CarConnectionState.main.post(task)
    return try { task.get(12, TimeUnit.SECONDS) } catch (error: Exception) { task.cancel(false); throw error }
  }
  fun state(): JSONObject = main {
    val value = JSONObject(CarConnectionState.snapshot.toString())
    val player = CarConnectionState.player
    val actualId = player?.currentMediaItem?.mediaId.orEmpty()
    if (actualId != value.optString("mediaId")) {
      val metadata = player?.mediaMetadata
      value.put("mediaId", actualId).put("title", metadata?.title?.toString().orEmpty())
        .put("artist", metadata?.artist?.toString().orEmpty()).put("album", metadata?.albumTitle?.toString().orEmpty())
        .put("cover", metadata?.artworkUri?.toString().orEmpty()).put("favorite", JSONObject.NULL).put("mode", "unknown")
      value.remove("catalogDurationMs"); value.remove("vipSource")
    }
    value.put("applicationId", app?.packageName).put("protocol", PROTOCOL)
      .put("positionMs", player?.currentPosition ?: 0).put("durationMs", player?.duration?.coerceAtLeast(0) ?: 0)
      .put("playing", player?.isPlaying == true).put("playbackState", player?.playbackState ?: 1)
      .put("playerError", player?.playerError?.errorCode)
  }
  private fun active(args: JSONObject) = !args.has("__peripheralGeneration") ||
    args.optLong("__peripheralGeneration") == peripheral?.connectionGeneration()
  private fun rows(items: List<MediaItem>) = JSONArray().apply { items.forEach { item ->
    val m = item.mediaMetadata
    put(JSONObject().put("id", item.mediaId).put("parent", m.extras?.getString("carParent"))
      .put("title", m.title?.toString().orEmpty()).put("artist", m.artist?.toString().orEmpty())
      .put("album", m.albumTitle?.toString().orEmpty()).put("durationMs", m.durationMs)
      .put("browsable", m.isBrowsable == true).put("playable", m.isPlayable == true))
  } }
  /** Invoked on the bounded peripheral worker, never the Android main thread. */
  fun command(name: String, args: JSONObject): JSONObject {
    if (!active(args)) return CarConnectionState.error("外设连接已失效")
    require(name in PeripheralCommands.COMMANDS) { "未知六六车载命令" }
    return when (name) {
      "state" -> JSONObject().put("ok", true).put("state", state())
      "library" -> {
        val parent = args.optString("parent", CarLibraryState.ROOT)
        val page = args.optInt("page", 0)
        require(parent.startsWith("car:") && page in 0..100000) { "无效曲库分页" }
        val items = main { CarLibraryState.request(parent, page, 20, strict = true) }.get(16, TimeUnit.SECONDS)
        check(active(args)) { "外设连接已失效" }
        JSONObject().put("ok", true).put("page", page).put("items", rows(items))
      }
      "select" -> {
        val selection = main {
          val item = CarLibraryState.item(args.getString("id")) ?: error("歌曲未由当前曲库签发")
          CarLibraryState.selectResult(item) { active(args) }
        }.get(16, TimeUnit.SECONDS)
        JSONObject().put("ok", selection.ok).put("error", selection.message)
      }
      "search" -> {
        val input = JSONObject(args.toString()).put("session", "peripheral:" + peripheral?.connectionGeneration())
        val response = CarConnectionState.request("search", input).get(16, TimeUnit.SECONDS)
        check(active(args)) { "外设连接已失效" }
        if (response.optBoolean("ok")) {
          val values = response.optJSONArray("result") ?: JSONArray()
          val items = (0 until values.length()).map { index ->
            val row = values.getJSONObject(index)
            MediaItem.Builder().setMediaId(row.getString("id")).setMediaMetadata(
              androidx.media3.common.MediaMetadata.Builder().setTitle(row.getString("title"))
                .setArtist(row.optString("artist")).setAlbumTitle(row.optString("album"))
                .setIsBrowsable(false).setIsPlayable(row.optBoolean("playable"))
                .setExtras(android.os.Bundle().apply { putString("carParent", row.getString("parent")) }).build()).build()
          }
          main { CarLibraryState.remember(items) }
        }
        response
      }
      else -> CarConnectionState.request(name, args).get(16, TimeUnit.SECONDS)
    }
  }
}
