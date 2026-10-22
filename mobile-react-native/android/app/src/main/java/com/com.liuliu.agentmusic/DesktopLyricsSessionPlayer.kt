package com.liuliu.agentmusic

import androidx.media3.common.ForwardingSimpleBasePlayer
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi

/** Projects lyric text to the system media card, forwarding every playback command unchanged. */
@UnstableApi
internal class DesktopLyricsSessionPlayer(player: Player) : ForwardingSimpleBasePlayer(player) {
  private var lyricMediaId: String? = null
  private var lyricText = ""

  fun setLyric(mediaId: String?, text: String) {
    if (lyricMediaId == mediaId && lyricText == text) return
    lyricMediaId = mediaId
    lyricText = text
    invalidateState()
  }

  override fun getState(): State {
    val original = super.getState()
    val media = player
    if (lyricText.isBlank() || media.currentMediaItem?.mediaId != lyricMediaId ||
      !media.isCommandAvailable(Player.COMMAND_GET_TIMELINE) ||
      !media.isCommandAvailable(Player.COMMAND_GET_METADATA)) return original
    val metadata = media.mediaMetadata
    val text = listOfNotNull(lyricText, metadata.artist?.toString()?.takeIf { it.isNotBlank() }).joinToString(" · ")
    // Keep the original timeline, media IDs, URLs, position suppliers and playback state.
    // Only the session's current display metadata changes; ExoPlayer is never mutated here.
    return original.buildUpon().setPlaylist(media.currentTimeline, media.currentTracks,
      metadata.buildUpon().setArtist(text).setSubtitle(lyricText).setDescription(lyricText).build()).build()
  }
}
