package com.liuliu.agentmusic

/** Presentation state only; never owns the player, audio or a queue. */
internal class DesktopLyricsPolicy {
  var enabled = false
    private set
  var appVisible = true
  var locked = false
  var closePending = false
    private set

  fun configure(show: Boolean) {
    if (!show) {
      enabled = false
    } else if (!closePending) {
      enabled = true
    }
  }

  fun acknowledgeClose() { closePending = false }
  fun stop() { enabled = false }

  fun closeByUser() {
    enabled = false
    closePending = true
  }

  fun canShowWindow(permission: Boolean, lockedScreen: Boolean, mediaId: String?, songId: String): Boolean =
    enabled && !appVisible && permission && !lockedScreen && matches(mediaId, songId)

  fun canDrag(): Boolean = enabled && !locked && !closePending

  fun matches(mediaId: String?, songId: String): Boolean = songId.isNotBlank() && mediaId == songId

  fun lineIndex(positionMs: Long, lines: List<Pair<Long, String>>): Int =
    lines.indexOfLast { it.first <= positionMs.coerceAtLeast(0) }
}
