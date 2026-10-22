package com.liuliu.agentmusic

import java.util.concurrent.atomic.AtomicLong
import android.view.KeyEvent

internal data class MediaNotificationNavigation(val mediaId: String?, val previous: Boolean, val next: Boolean) {
  fun permits(actualMediaId: String?, action: String): Boolean = mediaId != null && mediaId == actualMediaId &&
    when (action) { "previous" -> previous; "next" -> next; else -> false }
}

internal data class MediaNotificationLyricLine(val timeMs: Long, val text: String)

/** Process-only display snapshot. It has no Player, queue, URL or persistent preference. */
internal class MediaNotificationLyricsState {
  private data class Snapshot(val mediaId: String?, val generation: String, val loaded: Boolean,
    val lines: List<MediaNotificationLyricLine>)
  @Volatile private var snapshot = Snapshot(null, "", false, emptyList())
  fun begin(mediaId: String?, generation: String) { snapshot = Snapshot(mediaId, generation, false, emptyList()) }
  fun complete(mediaId: String, generation: String, lines: List<MediaNotificationLyricLine>): Boolean {
    val current = snapshot
    if (current.mediaId != mediaId || current.generation != generation) return false
    val normalized = lines.map { it.copy(text = it.text.replace(Regex("[\\r\\n\\u2028\\u2029]+"), " ").trim()) }
      .filter { it.timeMs >= 0 && it.text.isNotBlank() }.sortedBy { it.timeMs }
    snapshot = current.copy(loaded = true, lines = normalized)
    return true
  }
  fun textAt(mediaId: String?, positionMs: Long): String {
    val current = snapshot
    if (mediaId == null || mediaId != current.mediaId || !current.loaded) return ""
    if (current.lines.isEmpty()) return "暂无歌词"
    var low = 0; var high = current.lines.size - 1; var found = -1
    val position = positionMs.coerceAtLeast(0)
    while (low <= high) {
      val middle = (low + high) ushr 1
      if (current.lines[middle].timeMs <= position) { found = middle; low = middle + 1 } else high = middle - 1
    }
    return if (found >= 0) current.lines[found].text else ""
  }
  fun clear() { begin(null, "") }
  fun whole(mediaId: String?): String = snapshot.takeIf { it.mediaId == mediaId && it.loaded }?.lines?.joinToString("\n") {
    val minutes = it.timeMs / 60_000; val seconds = (it.timeMs % 60_000) / 1000; val fraction = (it.timeMs % 1000) / 10
    "[%02d:%02d.%02d]%s".format(minutes, seconds, fraction, it.text)
  } ?: ""
  fun nextTime(mediaId: String?, positionMs: Long): Long? = snapshot.takeIf { it.mediaId == mediaId && it.loaded }
    ?.lines?.firstOrNull { it.timeMs > positionMs }?.timeMs
}

internal object MediaNotificationState {
  @Volatile var navigation = MediaNotificationNavigation(null, false, false)
  @Volatile var actionSink: ((String, String) -> Boolean)? = null
  val sequence = AtomicLong()
  val lyrics = MediaNotificationLyricsState()
  fun dispatchNavigation(action: String, actualMediaId: String?): Boolean = actualMediaId != null &&
    navigation.permits(actualMediaId, action) && actionSink?.invoke(action, actualMediaId) == true
  /** Bluetooth/system keys can be attributed to the notification controller, whose
   * visual buttons deliberately use custom commands. Consume only navigation keys. */
  fun handleNavigationKey(action: Int, keyCode: Int, repeatCount: Int, actualMediaId: String?): Boolean {
    val direction = when (keyCode) {
      KeyEvent.KEYCODE_MEDIA_NEXT -> "next"
      KeyEvent.KEYCODE_MEDIA_PREVIOUS -> "previous"
      else -> return false
    }
    if (action == KeyEvent.ACTION_DOWN && repeatCount == 0) dispatchNavigation(direction, actualMediaId)
    return true
  }
  fun clear() { navigation = MediaNotificationNavigation(null, false, false); lyrics.clear() }
}
