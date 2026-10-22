package com.liuliu.agentmusic

import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi

/** Standard Bluetooth/legacy transport uses the same logical navigation as the app. */
@UnstableApi
internal class MediaTransportPlayer(private val actual: Player, delegate: Player) : ForwardingPlayer(delegate) {
  var onTransportInterruption: (() -> Unit)? = null
  var resumptionPaused = false
  companion object {
    fun navigationCommands(base: Player.Commands, mediaId: String?): Player.Commands {
      val state = MediaNotificationState.navigation.takeIf { it.mediaId == mediaId }
      return base.buildUpon().apply {
        remove(Player.COMMAND_SEEK_TO_NEXT); remove(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
        remove(Player.COMMAND_SEEK_TO_PREVIOUS); remove(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
        if (state?.next == true) { add(Player.COMMAND_SEEK_TO_NEXT); add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM) }
        if (state?.previous == true) { add(Player.COMMAND_SEEK_TO_PREVIOUS); add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM) }
      }.build()
    }
  }
  private fun select(items: List<MediaItem>, index: Int): Boolean {
    if (items.none { it.mediaId.startsWith("car:") }) { CarLibraryState.pendingSelection = null; return false }
    val selected = items.getOrNull(index.coerceAtLeast(0)) ?: return true
    if (CarLibraryState.select(selected)) actual.stop()
    return true
  }
  override fun setMediaItem(item: MediaItem) { if (!select(listOf(item), 0)) super.setMediaItem(item) }
  override fun setMediaItem(item: MediaItem, positionMs: Long) { if (!select(listOf(item), 0)) super.setMediaItem(item, positionMs) }
  override fun setMediaItem(item: MediaItem, resetPosition: Boolean) { if (!select(listOf(item), 0)) super.setMediaItem(item, resetPosition) }
  override fun setMediaItems(items: List<MediaItem>) { if (!select(items, 0)) super.setMediaItems(items) }
  override fun setMediaItems(items: List<MediaItem>, resetPosition: Boolean) { if (!select(items, 0)) super.setMediaItems(items, resetPosition) }
  override fun setMediaItems(items: List<MediaItem>, startIndex: Int, startPositionMs: Long) {
    if (!select(items, startIndex)) super.setMediaItems(items, startIndex, startPositionMs)
  }
  override fun prepare() { if (CarLibraryState.pendingSelection == null) super.prepare() }
  override fun play() { if (!resumptionPaused && CarLibraryState.pendingSelection == null) super.play() }
  override fun pause() { onTransportInterruption?.invoke(); super.pause() }
  override fun stop() { onTransportInterruption?.invoke(); super.stop() }
  override fun setPlayWhenReady(value: Boolean) {
    if (!value) onTransportInterruption?.invoke()
    if (!value || (!resumptionPaused && CarLibraryState.pendingSelection == null)) super.setPlayWhenReady(value)
  }
  private fun state() = MediaNotificationState.navigation.takeIf { it.mediaId == actual.currentMediaItem?.mediaId }
  override fun getAvailableCommands(): Player.Commands = navigationCommands(super.getAvailableCommands(), actual.currentMediaItem?.mediaId)
  override fun isCommandAvailable(command: Int): Boolean = availableCommands.contains(command)
  override fun hasNextMediaItem(): Boolean = state()?.next == true
  override fun hasPreviousMediaItem(): Boolean = state()?.previous == true
  override fun seekToNext() { navigate("next") }
  override fun seekToNextMediaItem() { navigate("next") }
  override fun seekToPrevious() { navigate("previous") }
  override fun seekToPreviousMediaItem() { navigate("previous") }
  private fun navigate(action: String) {
    MediaNotificationState.dispatchNavigation(action, actual.currentMediaItem?.mediaId)
  }
}
