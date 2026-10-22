package com.liuliu.agentmusic

import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/** Process-only bridge. No URL, persisted duplicate library, second Player or headless startup. */
internal object CarLibraryState {
  const val ROOT = "car:root"
  @Volatile var ready = false
    private set
  @Volatile private var changeSink: ((Boolean) -> Unit)? = null
  @Volatile var pendingSelection: String? = null
  data class SelectionResult(val ok: Boolean, val message: String = "")
  private data class Selection(val mediaId: String, val result: SettableFuture<SelectionResult>, val timeout: Runnable, val valid: () -> Boolean)
  private val selections = ConcurrentHashMap<String, Selection>()
  @Volatile var eventSink: ((String, WritableMap) -> Boolean)? = null
  private val sequence = AtomicLong()
  private val pending = ConcurrentHashMap<String, SettableFuture<List<MediaItem>>>()
  private val strictRequests = ConcurrentHashMap.newKeySet<String>()
  private val issued = object : LinkedHashMap<String, MediaItem>(128, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, MediaItem>?): Boolean = size > 2000
  }
  private val main by lazy { Handler(Looper.getMainLooper()) }
  fun root(): MediaItem = MediaItem.Builder().setMediaId(ROOT).setMediaMetadata(
    MediaMetadata.Builder().setTitle("六六音乐").setIsBrowsable(true).setIsPlayable(false).build()).build()
  /** One shared library session; closing an old session must not detach its replacement. */
  fun observeChanges(listener: (Boolean) -> Unit): () -> Unit {
    changeSink = listener
    return { if (changeSink === listener) changeSink = null }
  }
  @Synchronized fun updateReady(value: Boolean) {
    if (!value) { reset(); return }
    if (!ready) { ready = true; changeSink?.invoke(true) }
  }
  fun notifyLibraryChanged() { if (ready) changeSink?.invoke(false) }
  fun request(parent: String, page: Int, pageSize: Int, strict: Boolean = false): ListenableFuture<List<MediaItem>> {
    if (!ready || page < 0 || pageSize < 1 || !parent.startsWith("car:")) return if (strict)
      Futures.immediateFailedFuture(IllegalStateException("手机曲库未就绪或分页参数无效")) else Futures.immediateFuture(emptyList())
    val id = sequence.incrementAndGet().toString()
    val future = SettableFuture.create<List<MediaItem>>()
    pending[id] = future
    if (strict) strictRequests.add(id)
    val accepted = eventSink?.invoke("carLibraryRequest", Arguments.createMap().apply {
      putString("requestId", id); putString("parent", parent); putInt("page", page); putInt("pageSize", minOf(pageSize, 100))
    }) == true
    if (!accepted) fail(id, "手机曲库控制器未连接")
    else main.postDelayed({ fail(id, "车机曲库请求超时") }, 10_000)
    return future
  }
  fun complete(id: String, items: List<MediaItem>) {
    val future = pending.remove(id) ?: return
    val strict = strictRequests.remove(id)
    if (!ready && strict) { future.setException(IllegalStateException("手机曲库已关闭")); return }
    val accepted = if (ready) items else emptyList()
    synchronized(issued) { accepted.forEach { issued[it.mediaId] = it } }
    future.set(accepted)
  }
  fun fail(id: String, message: String) {
    val future = pending.remove(id) ?: return
    if (strictRequests.remove(id)) future.setException(IllegalStateException(message)) else future.set(emptyList())
  }
  fun remember(items: List<MediaItem>) { if (ready) synchronized(issued) { items.forEach { issued[it.mediaId] = it } } }
  fun item(id: String): MediaItem? = if (id == ROOT) root() else if (ready) synchronized(issued) { issued[id] } else null
  fun trackKey(id: String): String? = if (id.startsWith("car:track:")) runCatching {
    java.net.URLDecoder.decode(id.substringAfterLast(':'), "UTF-8").takeIf { it.contains(':') }
  }.getOrNull() else null
  fun itemByTrackKey(key: String): MediaItem? = if (ready) synchronized(issued) {
    issued.values.lastOrNull { it.mediaMetadata.isPlayable == true && trackKey(it.mediaId) == key }
  } else null
  fun select(item: MediaItem): Boolean = dispatchSelection(item).first
  fun selectResult(item: MediaItem, valid: () -> Boolean = { true }): ListenableFuture<SelectionResult> = dispatchSelection(item, valid).second
  private fun dispatchSelection(item: MediaItem, valid: () -> Boolean = { true }): Pair<Boolean, ListenableFuture<SelectionResult>> {
    val result = SettableFuture.create<SelectionResult>()
    val parent = item.mediaMetadata.extras?.getString("carParent")
    if (!ready || !valid() || !item.mediaId.startsWith("car:track:") || item.mediaMetadata.isPlayable != true || parent == null) {
      result.set(SelectionResult(false, "歌曲当前不可播放")); return false to result
    }
    selections.keys.toList().forEach { finishSelection(it, false, "点歌请求已被替换") }
    val id = sequence.incrementAndGet().toString()
    val timeout = Runnable { finishSelection(id, false, "点歌请求超时") }
    selections[id] = Selection(item.mediaId, result, timeout, valid)
    pendingSelection = item.mediaId
    val accepted = eventSink?.invoke("carLibraryPlay", Arguments.createMap().apply {
      putString("requestId", id); putString("mediaId", item.mediaId); putString("parent", parent)
    }) == true
    if (!accepted) finishSelection(id, false, "手机曲库控制器未连接") else main.postDelayed(timeout, 15_000)
    return accepted to result
  }
  fun selectionActive(id: String): Boolean = ready && selections[id]?.valid?.invoke() == true
  fun cancelInvalidSelections() { selections.filterValues { !it.valid() }.keys.toList().forEach { finishSelection(it, false, "连接已断开") } }
  fun finishSelection(id: String, ok: Boolean, message: String) {
    val selected = selections.remove(id) ?: return
    main.removeCallbacks(selected.timeout)
    if (selections.isEmpty()) pendingSelection = null
    selected.result.set(SelectionResult(ok, message))
  }
  @Synchronized fun reset() {
    val changed = ready
    ready = false; pendingSelection = null
    selections.keys.toList().forEach { finishSelection(it, false, "手机曲库已关闭") }
    pending.keys.toList().forEach { fail(it, "手机曲库已关闭") }; strictRequests.clear(); synchronized(issued) { issued.clear() }
    if (changed) changeSink?.invoke(true)
  }
}
