package com.liuliu.agentmusic

import android.os.Bundle
import org.json.JSONObject

/** Optional app-owned facts; standard title/artist/duration stay in MediaMetadata. */
internal object CarAppMetadata {
  private const val PREFIX = "com.liuliu.music.opensource.car."
  fun apply(extras: Bundle, snapshot: JSONObject?) {
    extras.remove(PREFIX + "FAVORITE")
    if (snapshot != null && snapshot.has("favorite") && !snapshot.isNull("favorite"))
      extras.putBoolean(PREFIX + "FAVORITE", snapshot.optBoolean("favorite"))
    snapshot?.optString("mode")?.takeIf { it in setOf("sequence", "shuffle", "repeat-one") }
      ?.let { extras.putString(PREFIX + "PLAY_MODE", it) }
  }
}
