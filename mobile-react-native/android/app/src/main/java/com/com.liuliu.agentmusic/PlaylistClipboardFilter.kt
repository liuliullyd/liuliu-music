package com.liuliu.agentmusic

internal fun shouldReadPlaylistClipboardContent(mimeTypes: Iterable<String>, requiresLinkEvidence: Boolean = false,
  urlClassified: Boolean = false, label: String? = null): Boolean {
  if (mimeTypes.any { it.equals("text/uri-list", ignoreCase = true) }) return true
  if (mimeTypes.none { it.equals("text/plain", ignoreCase = true) }) return false
  // getPrimaryClip already triggers Android's access notification. Reject plain
  // text using description metadata before that call, never by reading its body.
  return !requiresLinkEvidence || urlClassified || (label != null && playlistClipboardHasLink(label))
}

private val clipboardWebLink = Regex("https?://[^\\s<>\"“”，。；！？（）]+", RegexOption.IGNORE_CASE)

internal fun playlistClipboardHasLink(text: String): Boolean =
  if (text.length > 250000) false
  else if (text.trimStart().startsWith("六六歌单分享 v1\n") || text.trimStart().startsWith("六六歌单分享 v1\r\n")) true
  else if (Regex("liuliu://playlist/v[234]/[a-f0-9]{32}/[A-Za-z0-9_-]+", RegexOption.IGNORE_CASE).containsMatchIn(text)) true
  else text.length <= 8192 && clipboardWebLink.findAll(text).any { playlistClipboardWebLink(it.value) }

private fun playlistClipboardWebLink(value: String): Boolean = try {
  val uri = java.net.URI(value.trimEnd(')', ']', ',', '.', ';', '!', '，', '。', '；', '！', '）'))
  val host = uri.host?.lowercase().orEmpty()
  val path = uri.path.orEmpty()
  val query = "?" + uri.rawQuery.orEmpty()
  val fragment = uri.rawFragment.orEmpty()
  val location = path + query + "#" + fragment
  fun hostIs(root: String) = host == root || host.endsWith(".$root")
  fun matches(pattern: String) = Regex(pattern, RegexOption.IGNORE_CASE).containsMatchIn(location)
  fun id(vararg keys: String) = keys.any { key -> matches("[?&#]$key=0*[1-9][0-9]*(?:[&#]|$)") }
  if (uri.userInfo != null || uri.port != -1 || host.isEmpty()) false
  else if (Regex("^llp-[a-f0-9]{32}$", RegexOption.IGNORE_CASE).matches(fragment)) {
    uri.scheme.equals("https", true) && Regex(
      "^(?:api\\.s1f\\.top/e/[a-z0-9_-]{1,64}|(?:www\\.)?51qu\\.cn/[a-z0-9_-]{1,64}|tinyurl\\.com/[a-z0-9_-]{1,64}|(?:suo\\.run|80v\\.me|298\\.run)/[a-z0-9_-]{1,64}|[a-z0-9]{4,16}\\.(?:80v\\.me|298\\.run)/?|paste\\.rs/[a-z0-9_-]{1,64}|paste\\.c-net\\.org/[a-z0-9_-]{1,64})$",
      RegexOption.IGNORE_CASE).matches(host + path) && uri.rawQuery == null
  } else when {
    hostIs("163cn.tv") -> path.length > 1
    hostIs("163.com") -> matches("(?:playlist|songlist)") &&
      (id("id") || matches("playlist/0*[1-9][0-9]*(?:[/?#]|$)"))
    hostIs("qq.com") -> (id("disstid", "dissid") ||
      matches("(?:playlist|playsquare)/0*[1-9][0-9]*(?:[/?#]|$)") ||
      (matches("taoge|playlist|playsquare") && id("id")) ||
      (Regex("^c[0-9]*\\.y\\.qq\\.com$", RegexOption.IGNORE_CASE).matches(host) && path == "/base/fcgi-bin/u")) &&
      !matches("/song(?:Detail|/|\\.html)")
    hostIs("kugou.com") -> matches("songlist/gcid_[a-z0-9_]{1,128}(?:[/?#]|$)|[?&#]global_(?:collection_id|specialid)=[a-z0-9_]{1,128}(?:[&#]|$)") ||
      id("specialid") || matches("special/single/0*[1-9][0-9]*(?:[/?#]|$)") ||
      (Regex("^t[0-9]+\\.kugou\\.com$", RegexOption.IGNORE_CASE).matches(host) && path == "/song.html" && uri.rawQuery != null)
    hostIs("kuwo.cn") -> matches("playlist(?:_detail)?/0*[1-9][0-9]*(?:[/?#]|$)") || id("pid")
    hostIs("migu.cn") -> id("playlistId") || matches("playlist/0*[1-9][0-9]*(?:[/?#]|$)") || (matches("playlist") && id("id"))
    hostIs("qishui.com") || hostIs("qishui.douyin.com") || hostIs("music.douyin.com") ->
      !matches("[?&]track_id=|/(?:track|song|video)(?:/|[?#]|$)") &&
        (id("playlist_id") || matches("playlist/0*[1-9][0-9]*(?:[/?#]|$)"))
    else -> false
  }
} catch (_: Exception) { false }

/** Process-only copy identity, independent of explicit system clipboard clearing. */
internal class PlaylistClipboardIdentity {
  private var sequence = 0L
  fun nextToken(): String = "playlist-clipboard-${++sequence}"
}

internal fun clearSystemPlaylistClipboard(sdk: Int, clearPrimary: () -> Unit, replaceWithEmpty: () -> Unit) {
  if (sdk >= 28) clearPrimary() else replaceWithEmpty()
}
