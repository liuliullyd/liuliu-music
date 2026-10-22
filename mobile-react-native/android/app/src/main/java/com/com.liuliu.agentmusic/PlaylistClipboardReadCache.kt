package com.liuliu.agentmusic

internal data class PlaylistClipboardDescription(val timestamp: Long?, val mimeTypes: List<String>, val label: String?,
  val requiresLinkEvidence: Boolean = true, val urlClassified: Boolean = false)
internal data class PlaylistClipboardValue(val text: String, val token: String)
internal data class PlaylistClipboardObservation(val description: PlaylistClipboardDescription, val value: PlaylistClipboardValue?)
internal const val playlistClipboardOwnerExtra = "com.liuliu.agentmusic.PLAYLIST_COPY"
internal fun shouldNotifyPlaylistClipboardChange(owner: String?, currentOwner: String): Boolean = owner != currentOwner

/** UI-thread, process-only cache of one clipboard check; never polls or reads by itself. */
internal class PlaylistClipboardReadCache {
  private var cached: PlaylistClipboardObservation? = null

  fun invalidate() { cached = null }

  fun read(description: PlaylistClipboardDescription,
    readContent: () -> PlaylistClipboardObservation?): PlaylistClipboardValue? {
    if (!shouldReadPlaylistClipboardContent(description.mimeTypes, description.requiresLinkEvidence,
        description.urlClassified, description.label)) {
      invalidate()
      return null
    }
    // Without a system timestamp we cannot safely infer that a background copy is unchanged.
    val reliable = description.timestamp != null && description.timestamp > 0L
    val previous = cached
    if (reliable && previous?.description == description) return previous.value
    cached = null
    val observed = readContent() ?: return null // Denied/not focused/temporarily empty: retry remains possible.
    cached = if (reliable && observed.description == description) observed else null
    return observed.value
  }
}
