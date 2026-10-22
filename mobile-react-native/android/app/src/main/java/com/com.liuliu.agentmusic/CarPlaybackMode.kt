package com.liuliu.agentmusic

/** Cycle the music application's own public playback modes. */
internal object CarPlaybackMode {
  fun next(mode: String?): String = when (mode) {
    "sequence" -> "shuffle"
    "shuffle" -> "repeat-one"
    else -> "sequence"
  }
}
