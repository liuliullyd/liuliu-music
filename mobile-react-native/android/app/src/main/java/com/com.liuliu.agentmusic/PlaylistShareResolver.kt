package com.liuliu.agentmusic

import okhttp3.Call
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/** Public share pages only; no cookies, credentials, player or media downloads. */
internal class PlaylistShareResolver {
  private val calls = ConcurrentHashMap<String, Call>()
  private val cancelled = ConcurrentHashMap.newKeySet<String>()
  private val pending = ConcurrentHashMap.newKeySet<String>()
  private val client = AudioNetwork.client.newBuilder().followRedirects(false).followSslRedirects(false)
    .callTimeout(12, TimeUnit.SECONDS).readTimeout(12, TimeUnit.SECONDS).build()
  companion object {
    private val domains = listOf("163.com", "163cn.tv", "qq.com", "kugou.com", "kuwo.cn", "migu.cn", "qishui.com", "qishui.douyin.com", "music.douyin.com")
    fun allowed(url: HttpUrl): Boolean = url.username.isEmpty() && url.password.isEmpty() &&
      url.port == (if (url.isHttps) 443 else 80) && domains.any { url.host == it || url.host.endsWith(".$it") }
  }
  fun register(id: String) { pending.add(id) }
  fun cancel(id: String) { if (pending.contains(id)) { cancelled.add(id); calls.remove(id)?.cancel() } }
  fun resolve(value: String, id: String): Pair<String, String> {
    PersonalPlaylistShortLink.reference(value)?.let { return resolvePersonal(it, id) }
    var url = value.toHttpUrlOrNull() ?: throw IOException("分享链接无效")
    try {
      repeat(6) {
        if (cancelled.contains(id)) throw IOException("导入已取消")
        if (!allowed(url)) throw IOException("分享链接不属于支持的音乐平台")
        val call = client.newCall(Request.Builder().url(url).header("User-Agent", AudioNetwork.USER_AGENT).build())
        calls[id] = call
        try {
          call.execute().use { response ->
            if (response.code in listOf(300, 301, 302, 303, 307, 308)) {
              val next = response.header("Location")?.let(url::resolve) ?: throw IOException("分享链接跳转无效")
              if (url.isHttps && !next.isHttps) throw IOException("不允许HTTPS降级")
              if (!allowed(next)) throw IOException("分享链接跳转到了不支持的地址")
              url = next
            } else {
              if (!response.isSuccessful) throw IOException("分享链接读取失败 HTTP ${response.code}")
              val body = response.body ?: throw IOException("分享链接没有返回内容")
              val source = body.source()
              source.request(65537)
              val bytes = source.buffer.readByteArray(minOf(source.buffer.size, 65536))
              if (cancelled.contains(id)) throw IOException("导入已取消")
              call.cancel()
              return url.toString() to bytes.toString(Charsets.UTF_8)
            }
          }
        } finally { call.cancel(); calls.remove(id, call) }
      }
      throw IOException("分享链接跳转次数过多")
    } finally { cancelled.remove(id); pending.remove(id) }
  }
  private fun resolvePersonal(reference: PersonalPlaylistShortLink.Reference, id: String): Pair<String, String> {
    var url = reference.url
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(12)
    try {
      repeat(3) {
        if (cancelled.contains(id) || System.nanoTime() >= deadline) throw IOException("导入已取消或超时")
        if (!PersonalPlaylistShortLink.sameService(url, reference)) throw IOException("短链接跳转无效")
        val call = client.newCall(Request.Builder().url(url).header("User-Agent", AudioNetwork.USER_AGENT).build())
        call.timeout().timeout(maxOf(1L, deadline - System.nanoTime()), TimeUnit.NANOSECONDS)
        calls[id] = call
        try {
          call.execute().use { response ->
            if (cancelled.contains(id)) throw IOException("导入已取消")
            val location = response.header("Location")
            if (response.code in listOf(300, 301, 302, 303, 307, 308)) {
              PersonalPlaylistShortLink.destination(location.orEmpty(), reference)?.let { return it to "" }
              val next = location?.let(url::resolve) ?: throw IOException("短链接跳转无效")
              if (!PersonalPlaylistShortLink.sameService(next, reference)) throw IOException("短链接目标不属于本歌单")
              url = next
            } else {
              if (!response.isSuccessful) throw IOException("短链接读取失败")
              val source = response.body?.source() ?: throw IOException("短链接没有返回内容")
              source.request(250001)
              if (source.buffer.size > 250000) throw IOException("短链接返回内容过大")
              val html = source.buffer.readByteArray().toString(Charsets.UTF_8)
              if (cancelled.contains(id)) throw IOException("导入已取消")
              val target = PersonalPlaylistShortLink.destination(html, reference, html = true)
                ?: throw IOException("短链接未包含完整歌单")
              return target to ""
            }
          }
        } finally { call.cancel(); calls.remove(id, call) }
      }
      throw IOException("短链接跳转次数过多")
    } finally { cancelled.remove(id); pending.remove(id) }
  }
  fun close() { pending.forEach(::cancel); calls.clear(); cancelled.clear(); pending.clear() }
}
