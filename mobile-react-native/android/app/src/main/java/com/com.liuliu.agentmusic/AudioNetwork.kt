package com.liuliu.agentmusic

import okhttp3.OkHttpClient
import okhttp3.Call
import okhttp3.Request
import okhttp3.Response
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.net.Proxy
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Shared direct audio transport for startup probing and native playback validation. */
internal object AudioNetwork {
  // HTTP header values must be ISO-8859-1/ASCII-safe for OkHttp.
  const val USER_AGENT = "Mozilla/5.0 (Linux; Android 13) LiuliuMusic/1.0"

  private fun buildClient(proxy: Proxy? = null): OkHttpClient =
    OkHttpClient.Builder()
      .followRedirects(true)
      .followSslRedirects(true)
      .addNetworkInterceptor(NetworkProtection.redirectGuard)
      .apply { if (proxy != null) proxy(proxy) }
      .build()

  /**
   * The primary client keeps Android's configured ProxySelector, matching the
   * desktop runtime's first network attempt.  A direct client is kept as a
   * bounded fallback for networks where the system proxy is stale or only
   * applies to browser traffic.  Both clients share the same connection and
   * redirect policy; callers decide when to retry so the request body/range
   * semantics stay unchanged.
   */
  val client: OkHttpClient = buildClient()
  val directClient: OkHttpClient = buildClient(Proxy.NO_PROXY)

  // Match DefaultHttpDataSource's original 8 s connect/read timeouts. No whole
  // call deadline: a playing stream may last longer than one read timeout.
  val playbackClient: OkHttpClient = client.newBuilder()
    .connectTimeout(8_000L, TimeUnit.MILLISECONDS)
    .readTimeout(8_000L, TimeUnit.MILLISECONDS)
    .callTimeout(0L, TimeUnit.MILLISECONDS)
    .build()

  // MediaHTTPConnection used a 30 s connect timeout, with no added read/whole-
  // extraction deadline. Keep that selected-song contract separate from the
  // existing bounded background probe; only its transport/redirect policy changes.
  val extractionClient: OkHttpClient = client.newBuilder()
    .connectTimeout(30_000L, TimeUnit.MILLISECONDS)
    .readTimeout(0L, TimeUnit.MILLISECONDS)
    .callTimeout(0L, TimeUnit.MILLISECONDS)
    .build()

  fun checkRange(response: Response, start: Long) {
    if (!response.isSuccessful) throw IOException("播放链路 HTTP ${response.code}")
    if (start > 0 && response.code != 206) throw IOException("音频地址不支持范围读取")
    val actualStart = response.header("Content-Range")?.substringAfter("bytes ")?.substringBefore('-')?.toLongOrNull()
    if (actualStart != null && actualStart != start) throw IOException("音频范围响应不匹配")
  }

  /** Selected-song extraction has no background probe's 256 KiB total cap. */
  fun readRange(url: String, start: Long, limit: Int): ByteArray {
    val call = extractionClient.newCall(audioRequest(url, "bytes=$start-${start + limit - 1}"))
    try {
      return call.execute().use { response ->
        checkRange(response, start)
        val body = response.body ?: throw IOException("播放链路未返回音频数据")
        val input = body.byteStream()
        val buffer = ByteArray(limit)
        var count = 0
        while (count < limit) {
          val read = input.read(buffer, count, limit - count)
          if (read < 0) break
          if (read > 0) count += read
        }
        if (count < minOf(limit.toLong(), body.contentLength().takeIf { it >= 0 } ?: count.toLong()))
          throw IOException("音频范围响应不完整")
        // Cancel before response.close(), so an ignored Range is never drained.
        call.cancel()
        buffer.copyOf(count)
      }
    } finally { call.cancel() }
  }

  fun execute(url: String, range: String?, timeoutMs: Long): Response =
    newCall(url, range, timeoutMs).execute()

  fun newCall(url: String, range: String?, timeoutMs: Long): Call {
    return client.newBuilder()
      .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
      .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
      .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
      .callTimeout(timeoutMs, TimeUnit.MILLISECONDS)
      .build()
      .newCall(audioRequest(url, range))
  }

  private fun audioRequest(url: String, range: String?): Request {
    val parsed = url.toHttpUrlOrNull()
      ?: throw IllegalArgumentException("无效音频地址")
    if (parsed.scheme != "http" && parsed.scheme != "https")
      throw IllegalArgumentException("无效音频地址")
    return Request.Builder()
      .url(parsed)
      .header("User-Agent", USER_AGENT)
      .header("Accept", "*/*")
      .apply { if (!range.isNullOrBlank()) header("Range", range) }
      .build()
  }
}
