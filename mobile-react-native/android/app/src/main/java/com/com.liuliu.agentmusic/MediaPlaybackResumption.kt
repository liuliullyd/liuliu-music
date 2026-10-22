package com.liuliu.agentmusic

import androidx.media3.common.MediaItem
import com.google.common.util.concurrent.FutureCallback
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import org.json.JSONObject
import java.util.concurrent.Executor

/** A user play request waits for the original phone startup, then uses its shared controller. */
internal class MediaPlaybackResumption(
  private val ready: () -> Boolean,
  private val current: () -> Snapshot?,
  private val launch: () -> Unit,
  private val restore: () -> ListenableFuture<JSONObject>,
  private val observe: (() -> Unit) -> (() -> Unit),
  private val schedule: (Long, () -> Unit) -> (() -> Unit),
  private val interrupt: () -> Unit,
  private val executor: Executor,
) : AutoCloseable {
  data class Snapshot(val item: MediaItem, val positionMs: Long)
  private class Pending {
    val result = SettableFuture.create<Snapshot>()
    var removeObserver: () -> Unit = {}
    var cancelTimeout: () -> Unit = {}
    var work: ListenableFuture<JSONObject>? = null
    var restoring = false
  }
  private var pending: Pending? = null
  private var closed = false

  fun request(): ListenableFuture<Snapshot> {
    if (closed) return Futures.immediateFailedFuture(IllegalStateException("播放服务已关闭"))
    pending?.let { return it.result }
    val task = Pending()
    pending = task
    task.result.addListener({ if (task.result.isCancelled && pending === task) cancel() }, executor)
    val remove = observe { advance(task) }
    if (pending === task) task.removeObserver = remove else remove()
    val cancelTimer = schedule(90_000) { fail(task, IllegalStateException("播放恢复超时，请在手机检查启动状态")) }
    if (pending === task) task.cancelTimeout = cancelTimer else cancelTimer()
    try {
      if (pending === task && !ready()) launch()
      advance(task)
    } catch (error: Exception) { fail(task, error) }
    return task.result
  }

  private fun advance(task: Pending) {
    if (pending !== task || !ready() || task.restoring) return
    // Startup or an explicit phone selection may already have supplied the song.
    current()?.let { finish(task, it); return }
    task.restoring = true
    try {
      val work = restore()
      task.work = work
      Futures.addCallback(work, object : FutureCallback<JSONObject> {
        override fun onSuccess(result: JSONObject?) {
          if (pending !== task) return
          val snapshot = current()
          val expected = result?.optJSONObject("result")?.optString("mediaId").orEmpty()
          if (!ready() || result?.optBoolean("ok") != true || expected.isBlank() || snapshot?.item?.mediaId != expected) {
            fail(task, IllegalStateException(result?.optString("error")?.takeIf { it.isNotBlank() } ?: "恢复歌曲未提交到播放器"))
          } else finish(task, snapshot)
        }
        override fun onFailure(error: Throwable) { fail(task, error) }
      }, executor)
    } catch (error: Exception) { fail(task, error) }
  }

  private fun detach(task: Pending): Boolean {
    if (pending !== task) return false
    pending = null
    task.removeObserver()
    task.cancelTimeout()
    return true
  }
  private fun finish(task: Pending, snapshot: Snapshot) {
    if (detach(task)) task.result.set(snapshot)
  }
  private fun fail(task: Pending, error: Throwable) {
    if (!detach(task)) return
    interrupt()
    task.work?.cancel(false)
    task.result.setException(error)
  }
  fun cancel() {
    val task = pending ?: return
    if (!detach(task)) return
    interrupt()
    task.work?.cancel(false)
    task.result.cancel(false)
  }
  override fun close() { closed = true; cancel() }
}
