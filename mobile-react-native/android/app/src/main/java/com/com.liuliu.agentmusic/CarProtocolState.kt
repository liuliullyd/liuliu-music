package com.liuliu.agentmusic

/**
 * QPlay wire states observed in the reference APK's controller.x: playing=0, paused=1,
 * all other states=2, second buffering=3. These inputs are Media3 states, not QQ enums.
 * A READY observation in the same media generation is required before reporting rebuffering.
 */
internal class CarProtocolState {
  private var mediaId = ""
  private var readyObserved = false
  var value: Int = 2
    private set

  fun update(
    mediaId: String,
    playbackState: Int,
    playing: Boolean,
    playWhenReady: Boolean,
    hasError: Boolean,
    mediaTransition: Boolean = false,
  ): Int {
    if (mediaTransition || this.mediaId != mediaId) readyObserved = false
    this.mediaId = mediaId
    // Media3 Player.STATE_IDLE=1, BUFFERING=2, READY=3, ENDED=4.
    if (mediaId.isBlank() || hasError || playbackState == 1 || playbackState == 4) {
      readyObserved = false
      value = 2
      return value
    }
    if (playbackState == 3) readyObserved = true
    value = when {
      playbackState == 3 && playing -> 0
      playbackState == 3 -> 1
      playbackState == 2 && playWhenReady && readyObserved -> 3
      else -> 2
    }
    return value
  }

  fun reset() {
    mediaId = ""
    readyObserved = false
    value = 2
  }
}
