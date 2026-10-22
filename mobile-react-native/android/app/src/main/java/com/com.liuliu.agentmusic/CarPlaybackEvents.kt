package com.liuliu.agentmusic

import androidx.media3.common.Player

/** Own one observation of the actual player. Commands and display snapshots never synthesize events. */
internal class CarPlaybackEvents(private val changed: () -> Unit) : AutoCloseable {
  private var player: Player? = null
  private var listener: Player.Listener? = null
  var sample: ((Player?, Player.Events?) -> Unit)? = null
  fun attach(value: Player?) {
    if (player === value) return
    listener?.let { player?.removeListener(it) }
    player = value
    listener = value?.let { active -> object : Player.Listener {
      override fun onEvents(player: Player, events: Player.Events) {
        if (this@CarPlaybackEvents.player === active) {
          sample?.invoke(active, events)
          changed()
        }
      }
    }.also { active.addListener(it) } }
    sample?.invoke(value, null)
    changed()
  }
  override fun close() { attach(null) }
}
