package com.liuliu.agentmusic

import android.os.Bundle
import org.json.JSONObject

/** UCAR uses key presence for capability. Unknown facts remain internal, never invented standard values. */
internal object CarUcarMetadata {
  fun apply(extras: Bundle, snapshot: JSONObject?) {
    extras.remove("ucar.media.metadata.VIP")
    snapshot?.optString("vip")?.takeIf { it == "1" || it == "0" }?.let { extras.putString("ucar.media.metadata.VIP", it) }
    extras.remove("ucar.media.metadata.COLLECT_STATE")
    if (snapshot != null && snapshot.has("favorite") && !snapshot.isNull("favorite"))
      extras.putString("ucar.media.metadata.COLLECT_STATE", if (snapshot.optBoolean("favorite")) "1" else "0")
    extras.remove("ucar.media.metadata.PLAY_MODE")
    CarUcarMode.wire(snapshot?.optString("mode")).takeIf { it >= 0 }?.let { extras.putLong("ucar.media.metadata.PLAY_MODE", it) }
  }
}
