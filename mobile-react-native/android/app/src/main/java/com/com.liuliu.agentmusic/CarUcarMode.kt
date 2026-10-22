package com.liuliu.agentmusic

/** QQ carwith.h + CarWith 3.6 CardMusicView/MediaPlayFragment: 0 random, 1 single, 2 list. */
internal object CarUcarMode {
  fun wire(mode: String?): Long = when (mode) {
    "shuffle" -> 0L
    "repeat-one" -> 1L
    "sequence" -> 2L
    else -> -1L
  }
  // UCAR's PLAY_MODE custom action is a toggle in QQ. Its supplied bundle is not a set target.
  // QQ MusicUtil.f0 cycles internal modes 103 (list), 101 (single), 105 (random).
  fun next(mode: String?): String = when (mode) {
    "sequence" -> "repeat-one"
    "repeat-one" -> "shuffle"
    else -> "sequence"
  }
}
