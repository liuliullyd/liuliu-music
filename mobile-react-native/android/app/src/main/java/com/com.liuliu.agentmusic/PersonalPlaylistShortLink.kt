package com.liuliu.agentmusic

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl

/** Only tagged links created by our Copy action, and the same canonical directory identity. */
internal object PersonalPlaylistShortLink {
  data class Reference(val url: HttpUrl, val code: String, val fingerprint: String)
  private val code = "[A-Za-z0-9_-]{1,64}"
  private val short = Regex("https://((?:tinyurl\\.com/$code|api\\.s1f\\.top/e/$code|(?:www\\.)?51qu\\.cn/$code|(?:suo\\.run|80v\\.me|298\\.run)/$code|[A-Za-z0-9]{4,16}\\.(?:80v\\.me|298\\.run)/?|paste\\.rs/$code|paste\\.c-net\\.org/$code))#llp-([a-f0-9]{32})", RegexOption.IGNORE_CASE)
  private val directory = Regex("liuliu://playlist/v[234]/([a-f0-9]{32})/[A-Za-z0-9_-]+", RegexOption.IGNORE_CASE)
  fun reference(value: String): Reference? {
    val match = short.matchEntire(value) ?: return null
    val url = value.substringBefore('#').toHttpUrl()
    return Reference(url, url.pathSegments.last(), match.groupValues[2].lowercase())
  }
  fun sameService(url: HttpUrl, reference: Reference): Boolean = url.isHttps && url.host == reference.url.host &&
    url.port == 443 && url.username.isEmpty() && url.password.isEmpty() &&
    url.query == null && url.encodedPath in (if (url.host == "tinyurl.com")
      listOf("/${reference.code}", "/preview/${reference.code}") else listOf(reference.url.encodedPath))
  fun destination(value: String, reference: Reference, html: Boolean = false): String? {
    if (value.length > 250000) return null
    val match = if (html) directory.find(value) else directory.matchEntire(value)
    return match?.takeIf { it.groupValues[1].equals(reference.fingerprint, ignoreCase = true) }?.value
  }
}
