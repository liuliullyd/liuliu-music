package com.liuliu.agentmusic

import com.facebook.react.bridge.*
import java.util.concurrent.Executors
import android.net.Uri
import android.os.Bundle
import android.os.PersistableBundle
import android.content.Context
import android.content.ClipboardManager
import android.content.ClipData
import android.content.ClipDescription
import android.os.Build
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener

class LiuliuMediaLibraryModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val executor = Executors.newFixedThreadPool(2)
  private val shares = PlaylistShareResolver()
  private var listeners = 0
  private val carTasks = mutableMapOf<String, Int>()
  private val carTaskListener = object : HeadlessJsTaskEventListener {
    override fun onHeadlessJsTaskStart(taskId: Int) = Unit
    override fun onHeadlessJsTaskFinish(taskId: Int) {
      val requestId = carTasks.entries.firstOrNull { it.value == taskId }?.key
      if (requestId != null) {
        carTasks.remove(requestId)
        android.util.Log.i("LiuliuCarLibrary", "task-finish id=$taskId remaining=${carTasks.size}")
      }
    }
  }
  private val clipboardIdentity = PlaylistClipboardIdentity()
  private val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
  private val clipboardReadCache = PlaylistClipboardReadCache()
  private val clipboardOwner = java.util.UUID.randomUUID().toString()
  private val clipboardChanged = ClipboardManager.OnPrimaryClipChangedListener {
    clipboardReadCache.invalidate()
    try {
      val owner = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N)
        clipboard.primaryClipDescription?.extras?.getString(playlistClipboardOwnerExtra) else null
      if (shouldNotifyPlaylistClipboardChange(owner, clipboardOwner))
        sink("playlistClipboardChanged", Arguments.createMap())
    } catch (_: Exception) { /* Foreground/focus checks remain available when metadata is unavailable. */ }
  }
  private val sink: (String, WritableMap) -> Boolean = { name, payload ->
    if (context.hasActiveReactInstance() && listeners > 0) {
      if (name == "carLibraryRequest" || name == "carLibraryPlay") {
        // A paused ReactActivity stops RN timers, including fetch promise delivery.
        // Reuse the already-ready context; never create a runtime or start the app.
        context.runOnUiQueueThread {
          val requestId = payload.getString("requestId").orEmpty()
          try {
            check(context.hasActiveReactInstance() && listeners > 0 && CarLibraryState.ready) { "手机曲库控制器已关闭" }
            val taskId = HeadlessJsTaskContext.getInstance(context).startTask(HeadlessJsTaskConfig(
              "LiuliuCarLibrary", Arguments.createMap().apply { putString("event", name); putMap("payload", payload) },
              if (name == "carLibraryPlay") 16_000L else 11_000L, true))
            carTasks[requestId] = taskId
            android.util.Log.i("LiuliuCarLibrary", "task-start id=$taskId event=$name")
          } catch (error: Exception) {
            if (name == "carLibraryPlay") CarLibraryState.finishSelection(requestId, false, error.message.orEmpty())
            else CarLibraryState.fail(requestId, error.message.orEmpty())
          }
        }
      } else context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, payload)
      true
    } else false
  }
  init {
    CarLibraryState.eventSink = sink
    context.runOnUiQueueThread {
      clipboard.addPrimaryClipChangedListener(clipboardChanged)
      HeadlessJsTaskContext.getInstance(context).addTaskEventListener(carTaskListener)
    }
  }
  override fun getName() = "LiuliuMediaLibrary"
  private fun finishCarTask(requestId: String) {
    val taskId = carTasks[requestId] ?: return
    val tasks = HeadlessJsTaskContext.getInstance(reactApplicationContext)
    if (tasks.isTaskRunning(taskId)) tasks.finishTask(taskId)
  }
  @ReactMethod fun addListener(name: String) { listeners++ }
  @ReactMethod fun removeListeners(count: Double) { listeners = (listeners - count.toInt()).coerceAtLeast(0) }
  @ReactMethod fun setLibraryReady(ready: Boolean) { CarLibraryState.updateReady(ready) }
  @ReactMethod fun notifyLibraryChanged() { CarLibraryState.notifyLibraryChanged() }
  @ReactMethod fun beginQueuePageTask(requestId: String, promise: Promise) {
    reactApplicationContext.runOnUiQueueThread {
      try {
        check(requestId.startsWith("queue-page:") && !carTasks.containsKey(requestId) && carTasks.size < 32 &&
          reactApplicationContext.hasActiveReactInstance()) { "播放列表控制器未就绪" }
        val payload = Arguments.createMap().apply { putString("requestId", requestId) }
        // The shared directory budget is 20s; keep its callbacks/timer alive until settlement.
        val taskId = HeadlessJsTaskContext.getInstance(reactApplicationContext).startTask(HeadlessJsTaskConfig(
          "LiuliuCarLibrary", Arguments.createMap().apply {
            putString("event", "queuePageTask"); putMap("payload", payload)
          }, 22_000L, true))
        carTasks[requestId] = taskId
        android.util.Log.i("LiuliuCarLibrary", "task-start id=$taskId event=queuePageTask")
        promise.resolve(null)
      } catch (error: Exception) { promise.reject("QUEUE_PAGE_TASK", error.message.orEmpty()) }
    }
  }
  @ReactMethod fun completeQueuePageTask(requestId: String) {
    if (requestId.startsWith("queue-page:")) reactApplicationContext.runOnUiQueueThread { finishCarTask(requestId) }
  }
  @ReactMethod fun isLibrarySelectionActive(requestId: String, promise: Promise) {
    promise.resolve(CarLibraryState.selectionActive(requestId))
  }
  @ReactMethod fun completeLibrarySelection(requestId: String, ok: Boolean, message: String) {
    reactApplicationContext.runOnUiQueueThread {
      CarLibraryState.finishSelection(requestId, ok, message)
      finishCarTask(requestId)
    }
  }
  @ReactMethod fun failLibraryRequest(requestId: String, message: String) {
    reactApplicationContext.runOnUiQueueThread {
      CarLibraryState.fail(requestId, message)
      finishCarTask(requestId)
    }
  }
  @ReactMethod fun completeLibraryRequest(requestId: String, rows: ReadableArray) {
    val items = (0 until minOf(rows.size(), 100)).mapNotNull { index ->
      val row = rows.getMap(index) ?: return@mapNotNull null
      val id = row.getString("id") ?: return@mapNotNull null
      if (!id.startsWith("car:")) return@mapNotNull null
      val extras = Bundle().apply { putString("carParent", row.getString("parent")) }
      val metadata = MediaMetadata.Builder().setTitle(row.getString("title")).setArtist(if (row.hasKey("artist")) row.getString("artist") else null)
        .setIsBrowsable(row.getBoolean("browsable")).setIsPlayable(row.getBoolean("playable")).setExtras(extras)
      if (row.hasKey("album") && !row.isNull("album")) metadata.setAlbumTitle(row.getString("album"))
      if (row.hasKey("durationMs") && !row.isNull("durationMs")) row.getDouble("durationMs")
        .takeIf { it.isFinite() && it > 0 && it < 9_007_199_254_740_992.0 }?.let { metadata.setDurationMs(it.toLong()) }
      (if (row.hasKey("cover")) row.getString("cover") else null)?.takeIf { it.startsWith("https://") || it.startsWith("http://") || it.startsWith("content://") }?.let { metadata.setArtworkUri(Uri.parse(it)) }
      MediaItem.Builder().setMediaId(id).setMediaMetadata(metadata.build()).build()
    }
    reactApplicationContext.runOnUiQueueThread {
      CarLibraryState.complete(requestId, items)
      finishCarTask(requestId)
    }
  }
  @ReactMethod fun resolvePlaylistShare(url: String, requestId: String, promise: Promise) {
    shares.register(requestId)
    executor.execute {
      try {
        val (finalUrl, html) = shares.resolve(url, requestId)
        promise.resolve(Arguments.createMap().apply { putString("url", finalUrl); putString("html", html) })
      } catch (_: Throwable) { promise.reject("PLAYLIST_SHARE", "分享链接无法读取，请重试或使用完整歌单链接") }
    }
  }
  @ReactMethod fun cancelPlaylistShare(requestId: String) { shares.cancel(requestId) }
  @ReactMethod fun compressPlaylistShare(text: String, promise: Promise) {
    executor.execute {
      try {
        val bytes = PersonalPlaylistShareCodec.compress(text)
        promise.resolve(android.util.Base64.encodeToString(bytes,
          android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING))
      } catch (_: Exception) { promise.reject("PLAYLIST_SHARE_COMPRESS", "歌单内容过大或无法生成分享链接") }
    }
  }
  @ReactMethod fun expandPlaylistShare(encoded: String, promise: Promise) {
    if (encoded.length > 250000 || !encoded.matches(Regex("[A-Za-z0-9_-]+"))) {
      promise.reject("PLAYLIST_SHARE_EXPAND", "歌单分享链接无效或过大")
      return
    }
    executor.execute {
      try {
        val bytes = android.util.Base64.decode(encoded, android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP)
        promise.resolve(PersonalPlaylistShareCodec.expand(bytes))
      } catch (_: Exception) { promise.reject("PLAYLIST_SHARE_EXPAND", "歌单分享链接损坏或不完整，请重新复制") }
    }
  }
  @ReactMethod fun copyPlaylistShare(text: String, promise: Promise) {
    if (text.isBlank() || text.length > 250000) {
      promise.reject("PLAYLIST_CLIPBOARD_COPY", "歌单分享内容无效或过大")
      return
    }
    reactApplicationContext.runOnUiQueueThread {
      try {
        clipboardReadCache.invalidate()
        val clip = ClipData.newPlainText("六六歌单", text)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) clip.description.extras = PersistableBundle().apply {
          putString(playlistClipboardOwnerExtra, clipboardOwner)
        }
        clipboard.setPrimaryClip(clip)
        promise.resolve(true)
      } catch (_: Exception) { promise.reject("PLAYLIST_CLIPBOARD_COPY", "复制失败，请重试") }
    }
  }
  @ReactMethod fun readUriPlaylistClipboard(promise: Promise) {
    reactApplicationContext.runOnUiQueueThread {
      try {
        val description = clipboard.primaryClipDescription
        if (description == null || reactApplicationContext.currentActivity == null) {
          promise.resolve(null)
          return@runOnUiQueueThread
        }
        val value = clipboardReadCache.read(clipboardDescription(description)) {
          val clip = clipboard.primaryClip ?: return@read null
          val item = clip.takeIf { it.itemCount > 0 }?.getItemAt(0)
          val text = item?.text?.toString() ?: item?.uri?.toString().orEmpty()
          val candidate = if (playlistClipboardHasLink(text))
            PlaylistClipboardValue(text.trim(), clipboardIdentity.nextToken()) else null
          // A negative result retains no ordinary clipboard text.
          PlaylistClipboardObservation(clipboardDescription(clip.description), candidate)
        }
        promise.resolve(value?.let { result -> Arguments.createMap().apply {
          putString("text", result.text); putString("token", result.token)
          putBoolean("owned", Build.VERSION.SDK_INT >= Build.VERSION_CODES.N &&
            description.extras?.getString(playlistClipboardOwnerExtra) == clipboardOwner)
        } })
      } catch (_: Exception) { promise.resolve(null) }
    }
  }
  @ReactMethod fun clearPlaylistClipboard(promise: Promise) {
    reactApplicationContext.runOnUiQueueThread {
      try {
        clipboardReadCache.invalidate()
        clearSystemPlaylistClipboard(Build.VERSION.SDK_INT,
          { clipboard.clearPrimaryClip() }, { clipboard.setPrimaryClip(ClipData.newPlainText("", "")) })
        promise.resolve(true)
      } catch (_: Exception) { promise.reject("PLAYLIST_CLIPBOARD_CLEAR", "系统剪贴板未清空") }
    }
  }
  private fun clipboardDescription(description: ClipDescription) = PlaylistClipboardDescription(
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) description.timestamp else null,
    (0 until description.mimeTypeCount).map(description::getMimeType), description.label?.toString(),
    requiresLinkEvidence = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S,
    urlClassified = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      description.classificationStatus == ClipDescription.CLASSIFICATION_COMPLETE &&
      description.getConfidenceScore("url") > 0f)
  override fun invalidate() {
    reactApplicationContext.runOnUiQueueThread {
      clipboard.removePrimaryClipChangedListener(clipboardChanged)
      clipboardReadCache.invalidate()
      val tasks = HeadlessJsTaskContext.getInstance(reactApplicationContext)
      carTasks.values.toList().forEach(tasks::finishTask)
      carTasks.clear()
      tasks.removeTaskEventListener(carTaskListener)
    }
    if (CarLibraryState.eventSink === sink) { CarLibraryState.eventSink = null; CarLibraryState.reset() }
    shares.close(); executor.shutdownNow(); super.invalidate()
  }
}
