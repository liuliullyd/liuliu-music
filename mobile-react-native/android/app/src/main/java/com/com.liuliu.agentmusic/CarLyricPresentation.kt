package com.liuliu.agentmusic

/** Bluetooth title compatibility is separate from UCAR whole lyrics and the original song facts. */
internal object CarLyricPresentation {
  data class Display(val title: String, val artist: String, val line: String, val delayMs: Long?)
  fun project(lyrics: MediaNotificationLyricsState, mediaId: String?, title: String, artist: String,
    enabled: Boolean, connected: Boolean, playing: Boolean, positionMs: Long, offsetMs: Long, speed: Float): Display {
    if (!enabled || !connected || !playing) return Display(title, artist, "", null)
    val position = (positionMs + offsetMs).coerceAtLeast(0)
    val line = lyrics.textAt(mediaId, position).takeUnless { it == "暂无歌词" }.orEmpty()
    val next = lyrics.nextTime(mediaId, position)
    val safeSpeed = speed.takeIf { it.isFinite() && it > 0 } ?: 1f
    val delay = next?.let { ((it - position) / safeSpeed.coerceAtLeast(.1f)).toLong().coerceIn(50, 60_000) }
    return if (line.isBlank()) Display(title, artist, "", delay) else Display(line, "$title-$artist", line, delay)
  }
}
