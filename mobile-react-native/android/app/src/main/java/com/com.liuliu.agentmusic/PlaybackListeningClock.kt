package com.liuliu.agentmusic

import java.util.concurrent.atomic.AtomicLong

/** Listening time is monotonic time while the native player is actually playing, never the playhead. */
internal class PlaybackListeningClock(private val now: () -> Long) {
  data class QualifiedPlay(val sequence: Long, val mediaId: String, val listenedMs: Long)
  data class Snapshot(val sequence: Long, val mediaId: String?, val listenedMs: Long, val qualified: List<QualifiedPlay>)
  companion object {
    const val MINIMUM_MS = 30_000L
    private val sequence = AtomicLong()
  }
  private var currentId: String? = null
  private var currentSequence = 0L
  private var listenedMs = 0L
  private var playingSince: Long? = null
  private var qualifiedCurrent = false
  private val qualified = ArrayDeque<QualifiedPlay>()

  private fun settle(at: Long) {
    playingSince?.let { listenedMs += (at - it).coerceAtLeast(0) }
    if (playingSince != null) playingSince = at
    if (!qualifiedCurrent && currentId != null && listenedMs >= MINIMUM_MS) {
      qualifiedCurrent = true
      qualified.addLast(QualifiedPlay(currentSequence, currentId!!, listenedMs))
      while (qualified.size > 100) qualified.removeFirst()
    }
  }

  fun observe(mediaId: String?, playing: Boolean, restart: Boolean = false) {
    val at = now()
    settle(at)
    if (restart || mediaId != currentId) {
      currentId = mediaId
      currentSequence = if (mediaId != null) sequence.incrementAndGet() else 0
      listenedMs = 0
      qualifiedCurrent = false
    }
    playingSince = if (playing && mediaId != null) at else null
  }

  fun snapshot(): Snapshot {
    settle(now())
    return Snapshot(currentSequence, currentId, listenedMs, qualified.toList())
  }

  fun untilQualification(): Long? {
    settle(now())
    return if (playingSince != null && !qualifiedCurrent) (MINIMUM_MS - listenedMs).coerceAtLeast(1) else null
  }
}
