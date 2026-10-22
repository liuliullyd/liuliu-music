package com.liuliu.agentmusic

import android.content.Context
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import java.net.HttpURLConnection
import java.net.ProtocolException
import java.net.URL
import javax.net.ssl.SSLException

/** A transport refusal, never an audio/fragment classification. */
internal class HttpsDowngradeException : ProtocolException("HTTPS_DOWNGRADE_BLOCKED")

internal object NetworkProtection {
  private val redirects = setOf(300, 301, 302, 303, 307, 308)

  // A network interceptor sees EACH response before OkHttp follows its Location.
  // Leave platform certificate/hostname verification intact; no custom trust manager.
  val redirectGuard = Interceptor { chain ->
    val response = chain.proceed(chain.request())
    val target = response.header("Location")?.let { response.request.url.resolve(it) }
    if (response.code in redirects && response.request.url.isHttps && target?.scheme == "http") {
      response.close()
      throw HttpsDowngradeException()
    }
    response
  }

  fun protect(builder: OkHttpClient.Builder): OkHttpClient.Builder = builder
    .followRedirects(true)
    .followSslRedirects(true)
    .addNetworkInterceptor(redirectGuard)

  fun install(context: Context) {
    // Keep RN cookies/cache and let catalog requests and native cover lookups use
    // the same guarded RN client. This does not replace the audio connection pools.
    val client by lazy { protect(OkHttpClientProvider.createClientBuilder(context)).build() }
    OkHttpClientProvider.setOkHttpClientFactory { client }
  }

  /** GET-only adapter for the two existing URLConnection consumers. */
  fun openGet(url: String, connectMs: Int, readMs: Int,
    headers: Map<String, String> = emptyMap(), cache: Boolean = true): HttpURLConnection {
    var current = URL(url)
    var currentHeaders = headers
    repeat(21) { hop ->
      if (current.protocol !in setOf("http", "https")) throw ProtocolException("HTTP_SCHEME_REJECTED")
      val connection = (current.openConnection() as HttpURLConnection).apply {
        connectTimeout = connectMs
        readTimeout = readMs
        instanceFollowRedirects = false
        useCaches = cache
        currentHeaders.forEach { (name, value) -> setRequestProperty(name, value) }
      }
      try {
        val code = connection.responseCode
        val location = connection.getHeaderField("Location")
        if (code !in redirects || location.isNullOrBlank()) return connection
        if (hop == 20) throw ProtocolException("HTTP_REDIRECT_LIMIT")
        val target = URL(current, location)
        if (current.protocol == "https" && target.protocol == "http") throw HttpsDowngradeException()
        if (target.protocol !in setOf("http", "https")) throw ProtocolException("HTTP_SCHEME_REJECTED")
        if (current.host != target.host || current.port != target.port || current.protocol != target.protocol) {
          currentHeaders = currentHeaders.filterKeys { !it.equals("Authorization", true) && !it.equals("Cookie", true) }
        }
        current = target
      } catch (error: Exception) {
        connection.disconnect()
        throw error
      }
      connection.disconnect()
    }
    throw ProtocolException("HTTP_REDIRECT_LIMIT")
  }

  fun failureCode(error: Throwable): String {
    var cause: Throwable? = error
    repeat(8) {
      when (cause) {
        is HttpsDowngradeException -> return "HTTPS_DOWNGRADE_BLOCKED"
        is SSLException -> return "TLS_REJECTED"
      }
      cause = cause?.cause
    }
    return error.javaClass.simpleName.replace(Regex("[^A-Za-z0-9_]"), "").take(64)
  }

  fun logLabel(value: String): String = if (value.matches(Regex("[\\p{L}\\p{N}_. -]{0,40}"))) value
    else "labelHash=" + value.hashCode().toUInt().toString(16)

  fun httpError(error: Throwable): String = when (failureCode(error)) {
    "HTTPS_DOWNGRADE_BLOCKED" -> "安全策略拒绝 HTTPS 降级（HTTPS_DOWNGRADE_BLOCKED）"
    "TLS_REJECTED" -> "HTTPS 证书或主机名校验失败（TLS_REJECTED）"
    // Imported scripts may use original transport errors for their own bounded
    // retries. Redact diagnostics at the logging boundary, not this callback.
    else -> error.message ?: "音源网络请求失败"
  }
}
