package com.liuliu.agentmusic

import androidx.media3.common.Player
import org.junit.Assert.*
import org.junit.Test

class PlaybackInterruptionTest {
  private val song = "qq:1"
  private val uri = "https://audio.test/1"
  private fun playing(owner: PlaybackInterruption) = owner.playWhenReadyChanged(true,
    Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST, song, uri, 206710)
  private fun interrupted(owner: PlaybackInterruption) = owner.playWhenReadyChanged(false,
    Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS, song, uri, 206710)

  @Test fun focusLossRetainsIntentAndExactPositionUntilConsumed() {
    val owner = PlaybackInterruption()
    playing(owner)
    interrupted(owner)
    assertEquals(PlaybackInterruption.Snapshot(song, uri, 206710), owner.take(song, uri))
    assertNull(owner.take(song, uri))
  }
  @Test fun anAlreadyPausedSongDoesNotAcquireResumeIntent() {
    val owner = PlaybackInterruption()
    interrupted(owner)
    assertNull(owner.take(song, uri))
  }
  @Test fun repeatedFocusLossKeepsTheOriginalPosition() {
    val owner = PlaybackInterruption()
    playing(owner)
    interrupted(owner)
    owner.playWhenReadyChanged(false, Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS, song, uri, 0)
    assertEquals(206710L, owner.take(song, uri)?.positionMs)
  }
  @Test fun transientSuppressionAlsoRequestsNeighbourRefreshAfterAutomaticGain() {
    val owner = PlaybackInterruption()
    playing(owner)
    owner.suppressed(Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS, song, uri, 1250)
    owner.suppressed(Player.PLAYBACK_SUPPRESSION_REASON_NONE, song, uri, 4000)
    assertEquals(1250L, owner.take(song, uri)?.positionMs)
  }
  @Test fun prolongedSuppressionKeepsTheOriginalTransientPosition() {
    val owner = PlaybackInterruption()
    playing(owner)
    owner.suppressed(Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS, song, uri, 1500)
    owner.playWhenReadyChanged(false, Player.PLAY_WHEN_READY_CHANGE_REASON_SUPPRESSED_TOO_LONG, song, uri, 1600)
    assertEquals(1500L, owner.take(song, uri)?.positionMs)
  }
  @Test fun explicitPauseStopOrSeekCancelsEvenWhenPlayWhenReadyIsAlreadyFalse() {
    val owner = PlaybackInterruption()
    playing(owner)
    interrupted(owner)
    owner.cancel()
    assertNull(owner.take(song, uri))
  }
  @Test fun userPauseAndNoisyRouteLossClearInterruption() {
    for (reason in listOf(Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST,
      Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY,
      Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM)) {
      val owner = PlaybackInterruption()
      playing(owner)
      interrupted(owner)
      owner.playWhenReadyChanged(false, reason, song, uri, 206710)
      assertNull("reason=$reason", owner.take(song, uri))
    }
  }
  @Test fun changedSongOrUrlCannotConsumeOldIntent() {
    for ((newSong, newUri) in listOf("qq:2" to uri, song to "$uri?new")) {
      val owner = PlaybackInterruption()
      playing(owner)
      interrupted(owner)
      assertNull(owner.take(newSong, newUri))
      assertNull(owner.take(song, uri))
    }
  }
  @Test fun timelineReplacementCancelsOldIntent() {
    val owner = PlaybackInterruption()
    playing(owner)
    interrupted(owner)
    owner.mediaChanged(song, "$uri?new")
    assertNull(owner.take(song, uri))
  }
  @Test fun ordinaryPlayingAndBufferingHaveNoInterruption() {
    val owner = PlaybackInterruption()
    playing(owner)
    owner.suppressed(Player.PLAYBACK_SUPPRESSION_REASON_NONE, song, uri, 206710)
    assertNull(owner.take(song, uri))
  }
}
