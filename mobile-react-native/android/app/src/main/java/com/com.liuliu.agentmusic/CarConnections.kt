package com.liuliu.agentmusic

import android.content.Context
import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Callable
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

internal object CarConnections {
  private var app: Context? = null
  var bluetooth: CarBluetoothManager? = null; private set
  var peripheral: PeripheralChannel? = null; private set
  var subscribed = false
  private var intervalMs = 0L
  private var subscriptionGeneration = -1L
  private var searchKey = ""
  private var searchPage = 0
  private val visitedDirectories = linkedSetOf("-1")
  fun notifyLibraryChanged() {
    val parents = synchronized(visitedDirectories) { visitedDirectories.toList() }
    parents.forEach { network.notify("PlayListChange", JSONObject().put("ParentID", it)) }
  }
  private val stateTick = object : Runnable { override fun run() {
    if (subscribed && subscriptionGeneration == network.connectionGeneration() && intervalMs > 0) { network.notify("PlayState", playState()); CarConnectionState.main.postDelayed(this, intervalMs) }
  } }
  private fun unsubscribe() { subscribed = false; intervalMs = 0; subscriptionGeneration = -1; CarConnectionState.main.removeCallbacks(stateTick) }
  private var stopObserve: (() -> Unit)? = null
  private var networkCallback: android.net.ConnectivityManager.NetworkCallback? = null
  fun startNetwork() {
    val manager = app?.getSystemService(android.net.ConnectivityManager::class.java) ?: return
    if (networkCallback == null) {
      val callback = object : android.net.ConnectivityManager.NetworkCallback() {
        private var current: android.net.Network? = manager.activeNetwork
        override fun onLost(network: android.net.Network) { if (networkCallback === this && current == network) { current = null; this@CarConnections.network.disconnect("网络已断开，请重新选择设备") } }
        override fun onAvailable(network: android.net.Network) {
          if (networkCallback !== this) return
          val previous = current; current = network
          if (previous != null && previous != network) this@CarConnections.network.disconnect("网络已切换，请重新选择设备")
        }
      }
      networkCallback = callback; manager.registerDefaultNetworkCallback(callback)
    }
    network.start()
  }
  fun stopNetwork() {
    network.close()
    val callback = networkCallback; networkCallback = null
    callback?.let { runCatching { app?.getSystemService(android.net.ConnectivityManager::class.java)?.unregisterNetworkCallback(it) } }
    unsubscribe()
  }
  val network: CarNetworkSession = CarNetworkSession(::command, ::binary) { CarConnectionState.main.post { CarConnectionState.changed() } }.apply {
    onDisconnected = { token -> CarConnectionState.main.post {
      CarConnectionState.cancelNetwork(); CarLibraryState.cancelInvalidSelections()
      if (subscriptionGeneration != network.connectionGeneration()) unsubscribe()
      if (token == network.connectionGeneration()) {
        searchKey = ""; searchPage = 0; assets.clear(); assetKey = ""
        synchronized(visitedDirectories) { visitedDirectories.clear(); visitedDirectories.add("-1") }
      }
    } }
  }
  fun initialize(context: Context) {
    if (app != null) return
    app = context.applicationContext
    bluetooth = CarBluetoothManager(context.applicationContext)
    peripheral = PeripheralChannel(context.applicationContext)
    stopObserve = CarConnectionState.observe { if (subscribed && subscriptionGeneration == network.connectionGeneration() && intervalMs == 0L) network.notify("PlayState", playState()) }
  }
  fun close() {
    unsubscribe()
    stopNetwork(); bluetooth?.close(); bluetooth = null; peripheral?.close(); peripheral = null
    stopObserve?.invoke(); stopObserve = null; app = null; subscribed = false
  }
  private fun playState(): JSONObject {
    val s = state()
    return JSONObject().put("SongID", s.optString("mediaId")).put("State", s.optInt("QPlayState", 2)).put("Times", s.optLong("Position"))
      .put("Duration", s.optLong("Duration"))
  }
  private fun networkState(): Int {
    val manager = app?.getSystemService(android.net.ConnectivityManager::class.java) ?: return 0
    val capabilities = manager.getNetworkCapabilities(manager.activeNetwork) ?: return 0
    return when { capabilities.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) -> 1
      capabilities.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR) -> 2; else -> 0 }
  }
  private fun failure(code: Int, message: String) = JSONObject().put("Error", code).put("ErrorMessage", message)
  fun <T> main(block: () -> T): T {
    if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) return block()
    val task = FutureTask(Callable(block)); CarConnectionState.main.post(task)
    return try { task.get(12, TimeUnit.SECONDS) } catch (error: Exception) { task.cancel(false); throw error }
  }
  fun state(): JSONObject = main {
    val snapshot = JSONObject(CarConnectionState.snapshot.toString())
    val player = CarConnectionState.player
    val actualId = player?.currentMediaItem?.mediaId.orEmpty()
    if (actualId != snapshot.optString("mediaId")) {
      val metadata = player?.mediaMetadata
      snapshot.put("mediaId", actualId).put("title", metadata?.title?.toString().orEmpty())
        .put("artist", metadata?.artist?.toString().orEmpty()).put("album", metadata?.albumTitle?.toString().orEmpty())
        .put("cover", metadata?.artworkUri?.toString().orEmpty()).put("favorite", JSONObject.NULL).put("mode", "unknown")
        .put("vip", "unknown").put("trial", "unknown")
      snapshot.remove("catalogDurationMs"); snapshot.remove("vipSource")
    }
    snapshot.put("Position", player?.currentPosition ?: 0).put("Duration", player?.duration?.coerceAtLeast(0) ?: 0)
      .put("Playing", player?.isPlaying == true).put("Ready", CarConnectionState.snapshot.optBoolean("ready"))
      .put("PlaybackState", player?.playbackState ?: 1).put("PlayWhenReady", player?.playWhenReady == true)
      .put("PlayerError", player?.playerError?.errorCode).put("QPlayState", CarConnectionState.qplayState)
  }
  private fun rows(items: List<MediaItem>) = CarProtocol.libraryRows(items)
  fun command(name: String, args: JSONObject): JSONObject {
    if (!sourceActive(args)) return failure(108, "连接请求已失效")
    val action = when (name) {
      "DevicePlayPlay" -> "play"; "DevicePlayPause" -> "pause"; "DevicePlayStop" -> "stop"
      "DevicePlayNext" -> "next"; "DevicePlayPre" -> "previous"; "LiuliuSeek" -> "seek"
      "LiuliuCollect" -> "favorite"; "LiuliuPlayMode" -> "mode"; else -> null
    }
    if (action != null) {
      if (args.has("SongID")) {
        val currentId = state().optString("mediaId")
        if (!matchesSong(args.getString("SongID"), currentId)) return failure(105, "当前歌曲身份不符")
        args.put("mediaId", currentId)
      }
      val result = CarConnectionState.request(action, args).get(16, TimeUnit.SECONDS)
      return if (result.optBoolean("ok")) result else failure(108, result.optString("error", "播放控制失败"))
    }
    return when (name) {
      "MobileDeviceInfos" -> main { JSONObject().put("Brand", android.os.Build.BRAND).put("Models", android.os.Build.MODEL)
        .put("OS", "Android").put("OSVer", android.os.Build.VERSION.RELEASE).put("AppVer", app?.let { it.packageManager.getPackageInfo(it.packageName, 0).versionName } ?: "unknown")
        .put("Mac", "").put("Ver", "1.3").put("Network", networkState()) }
      "NetworkState" -> main { JSONObject().put("State", networkState()) }
      "Items" -> {
        val wireParent = args.getString("ParentID")
        val parent = when (wireParent) { "-1" -> CarLibraryState.ROOT; "0" -> "car:queue"; "LOCAL_MUSIC" -> "car:local"; "LAST_PLAYLIST" -> "car:history"; "MUSIC_LIKE" -> "car:favorites"; "MY_FOLDER" -> "car:playlists"; else -> wireParent }
        require(parent.startsWith("car:")) { "未知目录" }
        val page = CarProtocol.libraryPage(args.optInt("PageIndex", 0), args.optInt("PagePerCount", 50))
        // Shared local directories group at 100; linked nodes contain 20 songs plus a next-folder.
        // Read that bounded node once, then apply QQ's requested page size to its real child count.
        val request = main { check(CarLibraryState.ready) { "请先在手机完成启动" }; CarLibraryState.request(parent, 0, 100, strict = true) }
        val directory = request.get(11, TimeUnit.SECONDS)
        synchronized(visitedDirectories) {
          visitedDirectories.remove(wireParent); visitedDirectories.add(wireParent)
          if (visitedDirectories.size > 32) visitedDirectories.remove(visitedDirectories.first())
        }
        CarProtocol.libraryResult(wireParent, page, directory)
      }
      "Search", "LiuliuSearch" -> {
        val key = args.getString("Key"); val flag = args.optInt("PageFlag", 0)
        if (flag == 0 || searchKey != key) { searchKey = key; searchPage = 0 }
        val session = when {
          args.has("__peripheralGeneration") -> "peripheral:${args.getLong("__peripheralGeneration")}"
          args.has("__connectionGeneration") -> "network:${args.getLong("__connectionGeneration")}"
          else -> "local"
        }
        val requestedPage = if (name == "LiuliuSearch") args.optInt("LiuliuPageIndex", searchPage) else searchPage
        require(requestedPage in 0..99) { "搜索页已达上限，请缩小搜索范围" }
        val searchArgs = JSONObject(args.toString()).put("query", key).put("page", requestedPage)
          .put("session", session).put("reset", flag == 0)
        val result = CarConnectionState.request("search", searchArgs).get(16, TimeUnit.SECONDS)
        if (!result.optBoolean("ok")) return failure(108, result.optString("error", "搜索失败，请重试"))
        if (!sourceActive(args)) return failure(108, "搜索连接已失效")
        val entries = result.optJSONArray("result") ?: return result
        val items = (0 until entries.length()).map { index -> val row = entries.getJSONObject(index)
          MediaItem.Builder().setMediaId(row.getString("id")).setMediaMetadata(MediaMetadata.Builder().setTitle(row.getString("title"))
            .setArtist(row.optString("artist")).setAlbumTitle(row.optString("album"))
            .setDurationMs(row.optDouble("durationMs", -1.0).takeIf { it.isFinite() && it > 0 && it < 9_007_199_254_740_992.0 }?.toLong())
            .setIsBrowsable(false).setIsPlayable(row.optBoolean("playable"))
            .setExtras(Bundle().apply { putString("carParent", row.getString("parent")) }).build()).build() }
        main { CarLibraryState.remember(items) }; searchPage = requestedPage + 1
        // QQ PageFlag denotes first/continuation response, not whether another page exists.
        CarProtocol.searchResult(key, flag != 0, rows(items)).apply {
          if (name == "LiuliuSearch") put("LiuliuHasMore", result.optBoolean("hasMore")).put("LiuliuScope", result.optString("scope", "online"))
        }
      }
      "PlaySong" -> {
        val selection = main {
        val id = args.getString("SongID")
        val item = CarLibraryState.item(id) ?: CarLibraryState.itemByTrackKey(id) ?: error("歌曲未由曲库签发，请先浏览")
        CarLibraryState.selectResult(item) { sourceActive(args) }
        }
        val result = selection.get(16, TimeUnit.SECONDS)
        if (result.ok) JSONObject().put("Accepted", true) else failure(108, result.message)
      }
      "PlayInfos" -> state().let { s ->
        if (s.optString("mediaId").isBlank() || s.optInt("QPlayState", 2) !in listOf(0, 1, 3) || s.has("PlayerError")) failure(106, "当前歌曲尚未就绪或已停止") else JSONObject().put("SongID", s.optString("mediaId"))
          .put("ParentID", "0").put("Type", 1).put("Name", s.optString("title")).put("Artist", s.optString("artist")).put("Album", s.optString("album"))
      }
      "PlayState" -> { network.notify("PlayState", playState()); JSONObject() }
      "LiuliuState" -> state()
      "RegisterPlayState" -> main {
        unsubscribe(); val seconds = args.optInt("AutoTimes", 0); require(seconds <= 3600)
        intervalMs = seconds.coerceAtLeast(0) * 1000L; subscribed = true; subscriptionGeneration = network.connectionGeneration()
        if (intervalMs > 0) CarConnectionState.main.post(stateTick) else network.notify("PlayState", playState())
        JSONObject().put("State", 0)
      }
      "UnRegisterPlayState" -> { main { unsubscribe() }; JSONObject() }
      "MediaInfo", "LiuliuLiveMediaInfo" -> {
        var current = state()
        if (!matchesSong(args.getString("SongID"), current.optString("mediaId"))) {
          if (name != "MediaInfo") return failure(105, "仅支持当前已验证歌曲")
          val selection = main {
            val item = CarLibraryState.item(args.getString("SongID")) ?: CarLibraryState.itemByTrackKey(args.getString("SongID"))
              ?: throw CarPcmFailure(105, "MediaInfo歌曲未由曲库签发")
            CarLibraryState.selectResult(item) { sourceActive(args) }
          }.get(16, TimeUnit.SECONDS)
          if (!selection.ok) return failure(108, selection.message)
          current = state()
        }
        if (!matchesSong(args.getString("SongID"), current.optString("mediaId"))) return failure(105, "当前歌曲身份不符")
        if (name == "LiuliuLiveMediaInfo") {
          if (CarPcmBuffer.rate <= 0) return failure(106, "解码格式尚未就绪")
          if (!CarPcmBuffer.enabled) { CarPcmBuffer.origin(-1); CarPcmBuffer.reset(); CarPcmBuffer.enabled = true }
          CarPcmBuffer.info().put("SongID", args.getString("SongID")).put("LocalOutput", !CarPcmBuffer.remoteOnly)
        } else try {
          if (!CarPcmBuffer.awaitingHeadFlush && (!CarPcmBuffer.enabled || !CarPcmBuffer.startsFromBeginning)) main {
            check(sourceActive(args)) { "连接请求已失效" }
            val player = CarConnectionState.player ?: throw CarPcmFailure(106, "播放器未就绪")
            if (!matchesSong(args.getString("SongID"), player.currentMediaItem?.mediaId.orEmpty())) throw CarPcmFailure(105, "当前歌曲身份已变化")
            // QQ MediaInfo prepares/starts the selected song; use the same Player and an observed head flush.
            CarPcmBuffer.armHeadCapture(); player.seekTo(0)
          }
          main {
            check(sourceActive(args)) { "连接请求已失效" }
            val player = CarConnectionState.player ?: throw CarPcmFailure(106, "播放器未就绪")
            if (player.playbackState == androidx.media3.common.Player.STATE_IDLE) player.prepare()
            player.play()
          }
          current = state()
          val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3)
          while (current.optInt("PlaybackState") != 3 && System.nanoTime() < deadline && sourceActive(args)) {
            Thread.sleep(10); current = state()
          }
          if (CarPcmBuffer.rate <= 0 || current.optInt("PlaybackState") != 3) throw CarPcmFailure(106, "实际解码尚未就绪，请重试")
          CarPcmBuffer.awaitHeadCapture { sourceActive(args) }
          if (!matchesSong(args.getString("SongID"), state().optString("mediaId"))) throw CarPcmFailure(105, "当前歌曲身份已变化")
          CarPcmBuffer.qqReferenceInfo(current.optLong("Duration")).put("SongID", args.getString("SongID"))
        } catch (error: CarPcmFailure) { failure(error.code, error.message ?: "PCM尚未就绪") }
      }
      "StopSendData" -> {
        require(matchesSong(args.getString("SongID"), state().optString("mediaId")))
        CarPcmBuffer.enabled = false; CarPcmBuffer.remoteOnly = false; CarPcmBuffer.origin(-1); CarPcmBuffer.reset()
        val result = CarConnectionState.request("stop", args).get(16, TimeUnit.SECONDS)
        if (result.optBoolean("ok")) JSONObject() else failure(108, result.optString("error", "停止播放失败"))
      }
      "Disconnect" -> {
        val result = CarConnectionState.request("stop", args).get(16, TimeUnit.SECONDS)
        if (result.optBoolean("ok")) JSONObject() else failure(108, result.optString("error", "停止播放失败"))
      }
      else -> failure(107, "Unsupported command: $name")
    }
  }
  @Volatile private var assetKey = ""
  private fun sourceActive(args: JSONObject) = (!args.has("__connectionGeneration") || args.optLong("__connectionGeneration") == network.connectionGeneration()) &&
    (!args.has("__peripheralGeneration") || args.optLong("__peripheralGeneration") == peripheral?.connectionGeneration())
  private fun matchesSong(requested: String, actual: String): Boolean = actual.isNotBlank() && (requested == actual ||
    CarLibraryState.item(requested)?.let { it.mediaMetadata.isPlayable == true && CarLibraryState.trackKey(it.mediaId) == actual } == true)
  private val assets = java.util.concurrent.ConcurrentHashMap<String, ByteArray>()
  private fun binary(name: String, args: JSONObject): CarProtocol.Binary? {
    val current = state(); if (!matchesSong(args.optString("SongID"), current.optString("mediaId"))) return null
    val id = current.optString("mediaId"); val index = args.getLong("PackageIndex"); require(index >= 0)
    if (name in listOf("PCMData", "LiuliuLivePCMData")) {
      if (!CarPcmBuffer.enabled) return null
      if (name == "PCMData") {
        val token = if (args.has("Epoch")) args.getLong("Epoch") else if (args.has("LiuliuEpoch")) args.getLong("LiuliuEpoch") else null
        val data = CarPcmBuffer.awaitQqReference(index, token) { sourceActive(args) }
        return CarProtocol.Binary(data.bytes, data.total, epoch = data.epoch,
          onSent = { CarPcmBuffer.sentQqReference(data.epoch, data.index) })
      }
      if (!args.has("Epoch") || args.getLong("Epoch") != CarPcmBuffer.epoch) return null
      return CarPcmBuffer.get(index)?.let { CarProtocol.Binary(it.bytes, -1, epoch = it.epoch) }
    }
    val token = CarPcmBuffer.epoch
    if (assetKey != id) { assets.clear(); assetKey = id }
    val all = assets[name] ?: when (name) {
      "LyricData" -> main { MediaNotificationState.lyrics.whole(current.optString("mediaId")) }.takeIf { it.isNotBlank() }?.toByteArray(Charsets.UTF_8)
      // Images use existing HTTPS client and protections, never arbitrary peer-provided URLs.
      "PICData" -> current.optString("cover").takeIf { it.startsWith("https://") }?.let { url ->
        AudioNetwork.playbackClient.newCall(okhttp3.Request.Builder().url(url).build()).execute().use { response ->
          check(response.isSuccessful); val input = response.body?.byteStream() ?: return null
          val bytes = input.readBytesBounded(CarProtocol.MAX_PAYLOAD)
          val options = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
          android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
          require(options.outWidth in 1..4096 && options.outHeight in 1..4096 && options.outWidth.toLong() * options.outHeight <= 16_777_216)
          val bitmap = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
          try { java.io.ByteArrayOutputStream().also { check(bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 90, it)) }.toByteArray() }
          finally { bitmap.recycle() }
        }
      }
      else -> null
    } ?: return null
    if (state().optString("mediaId") != id || CarPcmBuffer.epoch != token) return null
    require(all.size <= CarProtocol.MAX_PAYLOAD); assets[name] = all
    val block = if (name == "PICData") network.picBlock else network.lyricBlock
    if (index > Int.MAX_VALUE || index * block >= all.size) return null
    val start = (index * block).toInt()
    return CarProtocol.Binary(all.copyOfRange(start, minOf(start + block, all.size)), all.size.toLong(), if (name == "LyricData") 1 else null, token)
  }
  private fun java.io.InputStream.readBytesBounded(limit: Int): ByteArray {
    val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
    while (true) { val count = read(buffer); if (count < 0) break; require(output.size() + count <= limit); output.write(buffer, 0, count) }
    return output.toByteArray()
  }
}
