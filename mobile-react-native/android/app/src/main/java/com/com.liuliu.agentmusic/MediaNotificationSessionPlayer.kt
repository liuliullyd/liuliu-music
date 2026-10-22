package com.liuliu.agentmusic

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.Looper
import android.os.Bundle
import androidx.core.content.ContextCompat
import androidx.media3.common.ForwardingSimpleBasePlayer
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi

/** Session metadata and logical queue capabilities; transport still reaches the same player. */
@UnstableApi
internal class MediaNotificationSessionPlayer(private val context: Context, private val actual: Player, delegate: Player) : ForwardingSimpleBasePlayer(delegate) {
  private val main = Handler(Looper.getMainLooper())
  private var closed = false
  private val stopCarChanges = CarConnectionState.observe { refresh() }
  private val ticker = object : Runnable {
    override fun run() { if (!closed) { invalidateState(); updateTicker() } }
  }
  private val listener = object : Player.Listener {
    override fun onEvents(player: Player, events: Player.Events) { refresh() }
  }
  private val screenReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) { refresh() }
  }
  private fun bluetoothDisplay(): CarLyricPresentation.Display {
    val bt = CarConnections.bluetooth
    val metadata = actual.mediaMetadata
    return CarLyricPresentation.project(MediaNotificationState.lyrics, actual.currentMediaItem?.mediaId,
      metadata.title?.toString().orEmpty(), metadata.artist?.toString().orEmpty(), bt?.lyricEnabled == true,
      bt?.connected == true, actual.isPlaying, actual.currentPosition, bt?.offsetMs ?: 0, actual.playbackParameters.speed)
  }
  init {
    actual.addListener(listener)
    ContextCompat.registerReceiver(context, screenReceiver,
      IntentFilter().apply { addAction(Intent.ACTION_SCREEN_ON); addAction(Intent.ACTION_SCREEN_OFF) }, ContextCompat.RECEIVER_NOT_EXPORTED)
    updateTicker()
  }
  private fun updateTicker() {
    main.removeCallbacks(ticker)
    val bt = CarConnections.bluetooth
    if (!closed && actual.isPlaying && bt?.lyricEnabled == true && bt.connected) {
      bluetoothDisplay().delayMs?.let { main.postDelayed(ticker, it) }
    } else if (!closed && actual.isPlaying) {
      val next = MediaNotificationState.lyrics.nextTime(actual.currentMediaItem?.mediaId, actual.currentPosition)
      val speed = actual.playbackParameters.speed.takeIf { it.isFinite() && it > 0 } ?: 1f
      next?.let { main.postDelayed(ticker, ((it - actual.currentPosition) / speed).toLong().coerceIn(50, 60_000)) }
    }
  }
  fun refresh() { if (!closed) { invalidateState(); updateTicker() } }
  override fun getState(): State {
    val base = super.getState()
    // invalidateState emits capability changes even when the native one-song
    // timeline stays unchanged, so standard notification/remote buttons refresh.
    val original = base.buildUpon().setAvailableCommands(
      MediaTransportPlayer.navigationCommands(base.availableCommands, actual.currentMediaItem?.mediaId)).build()
    if (!actual.isCommandAvailable(Player.COMMAND_GET_TIMELINE) || !actual.isCommandAvailable(Player.COMMAND_GET_METADATA)) return original
    val metadata = actual.mediaMetadata
    val id = actual.currentMediaItem?.mediaId
    val s = CarConnectionState.snapshot.takeIf { !id.isNullOrBlank() && it.optString("mediaId") == id }
    val extras = Bundle(metadata.extras ?: Bundle.EMPTY).apply {
      putString("com.liuliu.music.opensource.car.LYRICS_WHOLE", MediaNotificationState.lyrics.whole(id))
      CarAppMetadata.apply(this, s)
      putString("com.liuliu.music.opensource.car.PLAY_MODE", s?.optString("mode") ?: "unknown")
    }
    val projection = bluetoothDisplay()
    val line = MediaNotificationState.lyrics.textAt(id, actual.currentPosition)
    if (projection.line.isNotBlank()) return original.buildUpon().setPlaylist(actual.currentTimeline, actual.currentTracks,
      metadata.buildUpon().setTitle(projection.title).setArtist(projection.artist)
        .setSubtitle(projection.line).setDescription(projection.line).setExtras(extras).build()).build()
    // The notification may show a subtitle. ARTIST stays a song fact outside explicit A2DP mode.
    return original.buildUpon().setPlaylist(actual.currentTimeline, actual.currentTracks,
      metadata.buildUpon().setSubtitle(line.takeIf { it.isNotBlank() }).setDescription(line.takeIf { it.isNotBlank() }).setExtras(extras).build()).build()
  }
  fun close() {
    stopCarChanges()
    closed = true; main.removeCallbacks(ticker); actual.removeListener(listener)
    context.unregisterReceiver(screenReceiver)
  }
}
