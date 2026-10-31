package com.liuliu.agentmusic

import com.google.common.util.concurrent.ListenableFuture
import java.util.concurrent.Executor
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.Timeline

/** All state and Media3 operations are confined to the controller's application executor. */
internal class RecoverablePlayerConnection<T>(
  private val executor: Executor,
  private val connect: () -> ListenableFuture<T>,
  private val isConnected: (T) -> Boolean,
  private val release: (ListenableFuture<T>) -> Unit,
  private val onConnected: (T) -> Unit,
) {
  private class Request<T>(val action: (T) -> Unit, val failed: (Throwable) -> Unit)
  private class Attempt<T>(val future: ListenableFuture<T>) {
    var controller: T? = null
    val waiting = mutableListOf<Request<T>>()
  }
  private var attempt: Attempt<T>? = null
  @Volatile private var closed = false

  fun execute(action: (T) -> Unit, failed: (Throwable) -> Unit) = executor.execute {
    if (closed) { failed(IllegalStateException("播放连接已关闭")); return@execute }
    var current = attempt
    val controller = current?.controller
    if (controller != null) {
      if (isConnected(controller)) {
        dispatch(Request(action, failed), controller)
        return@execute
      }
      discard(current, IllegalStateException("播放连接已断开"))
      current = null
    }
    if (current != null) { current.waiting.add(Request(action, failed)); return@execute }
    val next = try { Attempt(connect()) } catch (error: Throwable) {
      failed(error); return@execute
    }
    attempt = next
    next.waiting.add(Request(action, failed))
    next.future.addListener({ connected(next) }, executor)
  }

  private fun connected(current: Attempt<T>) {
    if (closed || attempt !== current) return
    val controller = try {
      current.future.get().also {
        check(isConnected(it)) { "播放连接不可用" }
        current.controller = it
        onConnected(it)
      }
    } catch (error: Throwable) { discard(current, error); return }
    val waiting = current.waiting.toList()
    current.waiting.clear()
    for (request in waiting) {
      if (closed || attempt !== current || !isConnected(controller))
        request.failed(IllegalStateException("播放连接已断开"))
      else dispatch(request, controller)
    }
  }

  private fun dispatch(request: Request<T>, controller: T) {
    // A command may already have changed playback before throwing. Never replay it.
    try { request.action(controller) } catch (error: Throwable) { request.failed(error) }
  }

  private fun discard(current: Attempt<T>, error: Throwable) {
    if (attempt === current) attempt = null
    val waiting = current.waiting.toList()
    current.waiting.clear()
    release(current.future)
    waiting.forEach { it.failed(error) }
  }

  fun disconnected(controller: T) = executor.execute {
    val current = attempt ?: return@execute
    if (current.controller === controller)
      discard(current, IllegalStateException("播放连接已断开"))
  }

  fun close() {
    closed = true
    executor.execute { attempt?.let { discard(it, IllegalStateException("播放连接已关闭")) } }
  }
}

/** Process-local copy of already admitted items; reconnecting never starts playback by itself. */
internal data class PlayerReconnectSnapshot(
  private val timeline: Timeline,
  val items: List<MediaItem>,
  val index: Int,
  val positionMs: Long,
  val volume: Float,
  val shuffle: Boolean,
  val repeat: Int,
) {
  fun restoreIfEmpty(player: Player) {
    if (player.mediaItemCount != 0 || items.isEmpty()) return
    player.setMediaItems(items, index.coerceIn(items.indices), positionMs)
    player.volume = volume
    player.shuffleModeEnabled = shuffle
    player.repeatMode = repeat
  }

  companion object {
    fun capture(player: Player, previous: PlayerReconnectSnapshot?): PlayerReconnectSnapshot {
      val timeline = player.currentTimeline
      val items = if (previous?.timeline === timeline) previous.items
        else (0 until player.mediaItemCount).map(player::getMediaItemAt)
      return PlayerReconnectSnapshot(timeline, items, player.currentMediaItemIndex.coerceAtLeast(0),
        player.currentPosition.coerceAtLeast(0), player.volume, player.shuffleModeEnabled, player.repeatMode)
    }
  }
}
