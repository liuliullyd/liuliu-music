package com.liuliu.agentmusic

import android.app.Activity
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebChromeClient
import android.webkit.ConsoleMessage
import android.util.Base64
import android.util.Log
import android.os.SystemClock
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import java.io.ByteArrayOutputStream
import java.io.ByteArrayInputStream
import java.net.URLEncoder
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction
import java.security.KeyFactory
import java.security.MessageDigest
import java.util.ArrayDeque
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.DeflaterOutputStream
import java.util.zip.InflaterInputStream
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject

/** Incremental native UTF-8 decoding preserves the original String(bytes, UTF_8) contract. */
internal class HttpResponseTextDecoder(chunkBytes: Int) {
  private val input = ByteBuffer.allocate(chunkBytes + 4)
  private val characters = CharBuffer.allocate(chunkBytes + 4)
  private val decoder = Charsets.UTF_8.newDecoder()
    .onMalformedInput(CodingErrorAction.REPLACE)
    .onUnmappableCharacter(CodingErrorAction.REPLACE)

  fun append(bytes: ByteArray, count: Int, last: Boolean = false): String {
    input.put(bytes, 0, count)
    input.flip()
    check(!decoder.decode(input, characters, last).isOverflow)
    if (last) check(!decoder.flush(characters).isOverflow)
    characters.flip()
    val text = characters.toString()
    characters.clear()
    input.compact()
    return text
  }
}

internal class SourceScriptRuntime(
  private val activity: Activity,
  private val script: String,
  private val promise: Promise,
  private val resolveSource: String? = null,
  private val musicInfoJson: String = "{}",
  private val quality: String = "128k",
  private val poolKey: String? = null,
  private val addressRequestId: String? = null,
) {
  private data class ResolveRequest(
    val promise: Promise,
    val source: String,
    val musicInfoJson: String,
    val quality: String,
    val addressRequestId: String? = null,
  ) {
    // Private source scripts can cache by song only. Never reuse that state
    // across request tiers or backend bindings while looking for real audio.
    val contextKey: String = JSONObject(musicInfoJson).let { info ->
      JSONArray().put(source).put(quality)
        .put(info.optString("__lxPinnedBackend"))
        .put(info.optString("__lxPreferredBackend"))
        .put(info.optJSONArray("__lxPinnedBackendRoutes") ?: JSONArray())
        .put(info.optJSONArray("__lxRejectedBackends") ?: JSONArray())
        .put(info.optJSONArray("__lxRejectedBackendRoutes") ?: JSONArray()).toString()
    }
  }

  @Volatile private var settled = false
  private var initialized = false
  @Volatile private var destroyed = false
  private var requestSequence = 0L
  private var activeToken = ""
  private var declaredSources: JSONObject? = null
  private var active = resolveSource?.let {
    ResolveRequest(promise, it, musicInfoJson, quality, addressRequestId)
  }
  private val resolutionContext = active?.contextKey
  private var requestStartedAt = 0L
  internal var idle = false
    private set
  private val webView = WebView(activity)
  private var timeout: Runnable? = null
  private class HttpTransfer(val deadline: Long) {
    @Volatile var call: Call? = null
    @Volatile var acknowledgement: CountDownLatch? = null
    fun cancel() {
      call?.cancel()
      acknowledgement?.countDown()
    }
  }
  private val httpTransfers = ConcurrentHashMap<String, HttpTransfer>()
  private val httpTimeouts = ConcurrentHashMap<String, Runnable>()

  fun start() {
    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
    webView.webChromeClient = object : WebChromeClient() {
      override fun onConsoleMessage(message: ConsoleMessage): Boolean =
        !BuildConfig.DEBUG || super.onConsoleMessage(message)
    }
    webView.visibility = android.view.View.GONE
    webView.settings.javaScriptEnabled = true
    webView.settings.allowFileAccess = false
    webView.settings.allowContentAccess = false
    webView.settings.domStorageEnabled = false
    webView.settings.blockNetworkLoads = true
    webView.addJavascriptInterface(RuntimeBridge(), "LiuliuSource")
    webView.webViewClient = object : WebViewClient() {
      override fun onPageFinished(view: WebView, url: String) {
        view.evaluateJavascript(bootstrap(), null)
      }
    }
    activity.addContentView(webView, ViewGroup.LayoutParams(1, 1))
    scheduleTimeout(INIT_TIMEOUT_MS)
    webView.loadDataWithBaseURL(
      "https://localhost/",
      "<!doctype html><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-eval'\">",
      "text/html",
      "UTF-8",
      null,
    )
  }

  private fun initialized(payload: String) = webView.post {
    if (settled) return@post
    try {
      val sources = JSONObject(payload).optJSONObject("sources")
        ?: throw IllegalArgumentException("音源未声明 sources")
      if (!sources.keys().hasNext()) throw IllegalArgumentException("音源未声明任何平台")
      declaredSources = sources
      cancelTimeout()
      if (resolveSource == null) {
        val names = Arguments.createArray()
        sources.keys().forEach { names.pushString(it) }
        settled = true
        cleanup()
        promise.resolve(Arguments.createMap().apply {
          putBoolean("ok", true)
          putArray("sources", names)
          putString("capabilitiesJson", sources.toString())
          putString("message", "脚本初始化通过")
        })
      } else {
        initialized = true
        issueRequest(sources)
      }
    } catch (error: Exception) {
      fail(error.message ?: "音源初始化信息无效", terminal = true)
    }
  }

  private fun issueRequest(sources: JSONObject? = null) {
    val request = active ?: return
    if (sources != null && !sources.has(request.source)) {
      fail("音源未声明支持 ${request.source}")
      return
    }
    val token = (++requestSequence).toString()
    activeToken = token
    requestStartedAt = System.currentTimeMillis()
    Log.i(TAG, "request source=${request.source} quality=${request.quality} reuseCount=$requestSequence scriptSha=${scriptDigest(script)}")
    val expression = """
          (() => {
            const musicInfo = JSON.parse(${JSONObject.quote(request.musicInfoJson)});
            globalThis.__liuliuLastBackend = '';
            globalThis.__liuliuBackendUrls = [];
            globalThis.__liuliuActiveSource = ${JSONObject.quote(request.source)};
            globalThis.__liuliuMusicInfo = musicInfo;
            globalThis.__liuliuActiveQuality = ${JSONObject.quote(request.quality)};
            globalThis.__liuliuBoundedRequests = musicInfo.__lxBoundedRequests === true;
            globalThis.__liuliuPinnedBackendRoutes = musicInfo.__lxBackendPlatform === globalThis.__liuliuActiveSource &&
              Array.isArray(musicInfo.__lxPinnedBackendRoutes) ? musicInfo.__lxPinnedBackendRoutes : [];
            globalThis.__liuliuRejectedBackendRoutes = new Set(
              Array.isArray(musicInfo.__lxRejectedBackendRoutes) ? musicInfo.__lxRejectedBackendRoutes : []);
            globalThis.__liuliuPinnedBackend = String(musicInfo.__lxPinnedBackend || '');
            globalThis.__liuliuPreferredBackend = String(musicInfo.__lxPreferredBackend || '');
            globalThis.__liuliuRejectedBackends = new Set(
              Array.isArray(musicInfo.__lxRejectedBackends)
                ? musicInfo.__lxRejectedBackends.map(value => String(value || '')).filter(Boolean)
                : []
            );
            if (globalThis.__liuliuRejectedBackends.has(globalThis.__liuliuPreferredBackend))
              globalThis.__liuliuPreferredBackend = '';
            globalThis.__liuliuCurrentBackend = '';
            globalThis.__liuliuBackendProtocolSeen = false;
            globalThis.__liuliuBackendHintAttempted = false;
            if (typeof globalThis.__liuliuRequestHandler !== 'function') {
              LiuliuSource.requestRejected(${JSONObject.quote(token)}, '音源未注册 request 处理器'); return;
            }
            const invoke = () => Promise.resolve(globalThis.__liuliuRequestHandler({
              action: 'musicUrl', source: ${JSONObject.quote(request.source)},
              info: { type: ${JSONObject.quote(request.quality)}, musicInfo }
            }));
            invoke().catch(error => {
              if (!globalThis.__liuliuPinnedBackend && globalThis.__liuliuPreferredBackend &&
                  globalThis.__liuliuBackendProtocolSeen && !globalThis.__liuliuBackendHintAttempted) {
                globalThis.__liuliuPreferredBackend = '';
                globalThis.__liuliuCurrentBackend = '';
                globalThis.__liuliuBackendProtocolSeen = false;
                return invoke();
              }
              throw error;
            }).then(value => {
              const backend = globalThis.__liuliuLastBackend || '';
              const endpoints = globalThis.__liuliuResolvedEndpoints(String(value || ''), backend);
              LiuliuSource.requestResolved(${JSONObject.quote(token)}, String(value || ''), backend, JSON.stringify(endpoints));
            })
              .catch(error => LiuliuSource.requestRejected(${JSONObject.quote(token)}, String(error && (error.stack || error.message) || error)));
          })();
        """.trimIndent()
    webView.evaluateJavascript(expression, null)
  }

  private fun resolved(token: String, value: String, backend: String?, backendUrlsJson: String) = webView.post {
    if (settled || token != activeToken) return@post
    if (!value.matches(Regex("^https?://.+", RegexOption.IGNORE_CASE))) {
      fail("音源未返回有效播放地址")
      return@post
    }
    settled = true
    cancelTimeout()
    Log.i(TAG, "resolved source=${active?.source} quality=${active?.quality} backend=${NetworkProtection.logLabel(backend.orEmpty())} elapsedMs=${System.currentTimeMillis() - requestStartedAt}")
    active?.promise?.resolve(Arguments.createMap().apply {
      putString("url", value)
      if (!backend.isNullOrBlank()) putString("backend", backend)
      val endpoints = Arguments.createArray()
      val captured = runCatching { JSONArray(backendUrlsJson) }.getOrNull() ?: JSONArray()
      for (index in 0 until captured.length()) {
        val endpoint = captured.optJSONObject(index) ?: continue
        val url = endpoint.optString("url")
        if (!url.matches(Regex("^https?://.+", RegexOption.IGNORE_CASE))) continue
        endpoints.pushMap(Arguments.createMap().apply {
          putString("url", url)
          endpoint.optString("requestRoute").takeIf { it.isNotBlank() }?.let { putString("requestRoute", it) }
          endpoint.optString("backend").takeIf { it.isNotBlank() }?.let { putString("backend", it) }
          endpoint.optString("quality").takeIf { it.isNotBlank() }?.let { putString("quality", it) }
          endpoint.optJSONArray("dependencyRoutes")?.let { dependencies ->
            putArray("dependencyRoutes", Arguments.createArray().apply {
              for (dependency in 0 until dependencies.length()) pushString(dependencies.optString(dependency))
            })
          }
        })
      }
      putArray("backendUrls", endpoints)
      val qualities = (0 until captured.length()).mapNotNull { captured.optJSONObject(it)?.optString("responseQuality")?.takeIf(String::isNotBlank) }.distinct()
      if (qualities.size == 1) putString("quality", qualities.single())
      Log.i(TAG, "response-tier source=${active?.source} requested=${active?.quality} returned=${qualities.singleOrNull().orEmpty()}")
    })
    completeRequest()
  }

  private fun fail(message: String, terminal: Boolean = false) = webView.post {
    if (settled) return@post
    settled = true
    cancelTimeout()
    Log.w(TAG, "failed source=${active?.source} quality=${active?.quality} terminal=$terminal")
    (active?.promise ?: promise).reject("SOURCE_RUNTIME_FAILED", message)
    if (terminal || poolKey == null || !initialized) {
      cleanup()
      poolKey?.let { discard(it, this) }
    } else completeRequest()
  }

  private fun requestFailed(token: String, message: String) {
    if (token != activeToken) return
    fail(message)
  }

  private fun completeRequest() {
    cancelHttpTransfers()
    webView.evaluateJavascript("globalThis.__liuliuResetHttp();", null)
    active = null
    idle = true
    poolKey?.let { release(it, this) }
  }

  private fun reuse(request: ResolveRequest) {
    check(resolutionContext == request.contextKey) { "音源运行时解析上下文不匹配" }
    active = request
    idle = false
    settled = false
    issueRequest(declaredSources)
  }

  private fun scheduleTimeout(milliseconds: Long) {
    cancelTimeout()
    val token = activeToken
    timeout = Runnable {
      if (token.isEmpty() || token == activeToken)
        fail("音源脚本请求超时", terminal = true)
    }.also { webView.postDelayed(it, milliseconds) }
  }

  private fun cancelTimeout() {
    timeout?.let(webView::removeCallbacks)
    timeout = null
  }

  private fun cleanup() {
    if (destroyed) return
    destroyed = true
    cancelTimeout()
    cancelHttpTransfers()
    httpTimeouts.values.forEach(webView::removeCallbacks)
    httpTimeouts.clear()
    (webView.parent as? ViewGroup)?.removeView(webView)
    webView.removeJavascriptInterface("LiuliuSource")
    webView.destroy()
  }

  private inner class RuntimeBridge {
    @JavascriptInterface fun initialized(payload: String) = this@SourceScriptRuntime.initialized(payload)
    @JavascriptInterface fun rejected(message: String) = fail(message, terminal = true)
    @JavascriptInterface fun requestRejected(token: String, message: String) = requestFailed(token, message)
    @JavascriptInterface fun requestResolved(token: String, value: String, backend: String?, backendUrlsJson: String) =
      resolved(token, value, backend, backendUrlsJson)
    @JavascriptInterface fun md5(value: String): String =
      MessageDigest.getInstance("MD5").digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    @JavascriptInterface
    fun base64Decode(value: String): String = byteArrayJson(Base64.decode(value, Base64.DEFAULT))

    @JavascriptInterface
    fun base64Encode(valueJson: String): String =
      Base64.encodeToString(byteArrayFromJson(valueJson), Base64.NO_WRAP)

    @JavascriptInterface
    fun aesEncrypt(dataJson: String, mode: String, keyJson: String, ivJson: String): String {
      val transformation = when (mode.lowercase()) {
        // Match Electron's node:crypto createCipheriv contract.  The desktop
        // runtime uses the provider's default PKCS#7 padding; Java exposes the
        // equivalent as PKCS5Padding.  NoPadding made otherwise valid LX
        // signatures differ on Android whenever the plaintext was not already
        // block aligned.
        "aes-128-ecb", "ecb" -> "AES/ECB/PKCS5Padding"
        "aes-128-cbc", "cbc" -> "AES/CBC/PKCS5Padding"
        else -> throw IllegalArgumentException("不支持的 AES 模式")
      }
      val cipher = Cipher.getInstance(transformation)
      val keySpec = SecretKeySpec(byteArrayFromJson(keyJson), "AES")
      if (transformation.contains("/CBC/"))
        cipher.init(Cipher.ENCRYPT_MODE, keySpec, IvParameterSpec(byteArrayFromJson(ivJson)))
      else cipher.init(Cipher.ENCRYPT_MODE, keySpec)
      return byteArrayJson(cipher.doFinal(byteArrayFromJson(dataJson)))
    }

    @JavascriptInterface
    fun zlibInflate(dataJson: String): String =
      inflate(byteArrayFromJson(dataJson))

    @JavascriptInterface
    fun zlibDeflate(dataJson: String): String =
      deflate(byteArrayFromJson(dataJson))

    @JavascriptInterface
    fun rsaEncrypt(dataJson: String, publicKey: String): String {
      val normalizedKey = publicKey
        .replace("-----BEGIN PUBLIC KEY-----", "")
        .replace("-----END PUBLIC KEY-----", "")
        .replace(Regex("\\s+"), "")
      val key = KeyFactory.getInstance("RSA").generatePublic(
        X509EncodedKeySpec(Base64.decode(normalizedKey, Base64.DEFAULT)),
      )
      val cipher = Cipher.getInstance("RSA/ECB/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, key)
      return byteArrayJson(cipher.doFinal(byteArrayFromJson(dataJson)))
    }

    @JavascriptInterface
    fun http(requestId: String, url: String, optionsJson: String) {
      try {
        performHttp(requestId, url, JSONObject(optionsJson))
      } catch (error: Exception) {
        completeHttpError(requestId, error.message ?: "音源网络请求失败")
      }
    }

    @JavascriptInterface fun cancelHttp(requestId: String) {
      cancelHttpTimeout(requestId)
      httpTransfers.remove(requestId)?.cancel()
    }
  }

  private fun byteArrayFromJson(value: String): ByteArray {
    val array = JSONArray(value)
    return ByteArray(array.length()) { index -> (array.optInt(index) and 0xff).toByte() }
  }

  private fun byteArrayJson(value: ByteArray): String =
    JSONArray(value.map { it.toInt() and 0xff }).toString()

  private fun inflate(value: ByteArray): String {
    val output = ByteArrayOutputStream()
    InflaterInputStream(ByteArrayInputStream(value)).use { input ->
      val buffer = ByteArray(16 * 1024)
      while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        output.write(buffer, 0, count)
        if (output.size() > MAX_RESPONSE_BYTES)
          throw IllegalArgumentException("音源解压响应超过 10 MB")
      }
    }
    return byteArrayJson(output.toByteArray())
  }

  private fun deflate(value: ByteArray): String {
    val output = ByteArrayOutputStream()
    DeflaterOutputStream(output).use { stream -> stream.write(value) }
    return byteArrayJson(output.toByteArray())
  }

  private fun cancelHttpTimeout(requestId: String) {
    httpTimeouts.remove(requestId)?.let(webView::removeCallbacks)
  }

  private fun cancelHttpTransfers() {
    httpTransfers.forEach { (id, transfer) ->
      if (httpTransfers.remove(id, transfer)) {
        cancelHttpTimeout(id)
        transfer.cancel()
      }
    }
  }

  private fun completeHttpError(requestId: String, message: String) = webView.post {
    if (settled || destroyed) return@post
    webView.evaluateJavascript(
      "globalThis.__liuliuHttpError(${JSONObject.quote(requestId)},${JSONObject.quote(message)});", null,
    )
  }

  /** Only the dispatcher waits; the UI thread receives one bounded block and acknowledges it. */
  private fun sendHttpBlock(requestId: String, transfer: HttpTransfer, expression: String): Boolean {
    if (httpTransfers[requestId] !== transfer || settled || destroyed) return false
    val signal = CountDownLatch(1)
    val accepted = AtomicBoolean(false)
    transfer.acknowledgement = signal
    try {
      if (httpTransfers[requestId] !== transfer || settled || destroyed) return false
      val posted = webView.post {
        if (httpTransfers[requestId] !== transfer || settled || destroyed ||
            SystemClock.elapsedRealtime() >= transfer.deadline) {
          signal.countDown()
          return@post
        }
        try {
          webView.evaluateJavascript(expression) { result ->
            accepted.set(result == "true")
            signal.countDown()
          }
        } catch (_error: Exception) {
          signal.countDown()
        }
      }
      if (!posted) return false
      val remaining = transfer.deadline - SystemClock.elapsedRealtime()
      if (remaining <= 0 || !signal.await(remaining, TimeUnit.MILLISECONDS))
        throw java.io.IOException("音源网络请求超时")
      return accepted.get() && httpTransfers[requestId] === transfer && !settled && !destroyed
    } finally {
      transfer.acknowledgement = null
    }
  }

  private fun performHttp(requestId: String, urlText: String, options: JSONObject) {
    if (settled || destroyed) return
    val parsedUrl = urlText.toHttpUrlOrNull()
      ?: throw IllegalArgumentException("仅允许 HTTP/HTTPS 请求")
    if (parsedUrl.scheme != "http" && parsedUrl.scheme != "https")
      throw IllegalArgumentException("仅允许 HTTP/HTTPS 请求")
    val timeout = options.optLong("timeout", 60_000L).coerceIn(1_000L, 60_000L).toInt()
    val method = options.optString("method", "GET").uppercase()
    val binary = options.optBoolean("binary", false)
    val request = Request.Builder().url(parsedUrl)
    val headers = options.optJSONObject("headers") ?: JSONObject()
    headers.keys().forEach { name ->
      val value = headers.opt(name)
      if (name.length < 128 && value is String && value.length < 8192)
        request.header(name, value)
    }
    val contentType = headers.optString("Content-Type", headers.optString("content-type", ""))
    val requestBody = when {
      method in setOf("GET", "HEAD") -> null
      options.has("body") -> encodeBody(options.opt("body"), contentType)
        .toRequestBody((if (contentType.isNotBlank()) contentType else "application/octet-stream").toMediaTypeOrNull())
      options.has("form") -> encodeForm(options.opt("form")).toByteArray(Charsets.UTF_8)
        .toRequestBody("application/x-www-form-urlencoded".toMediaTypeOrNull())
      options.has("formData") -> multipartBody(options.opt("formData"))
      else -> ByteArray(0).toRequestBody("application/octet-stream".toMediaTypeOrNull())
    }
    request.method(method, requestBody)
    val requestValue = request.build()
    val transfer = HttpTransfer(SystemClock.elapsedRealtime() + timeout)
    httpTransfers[requestId] = transfer
    Log.i(TAG, "http start id=$requestId host=${parsedUrl.host} method=$method timeoutMs=$timeout binary=$binary")
    val requestTimeout = Runnable {
      if (!httpTransfers.remove(requestId, transfer)) return@Runnable
      httpTimeouts.remove(requestId)
      transfer.cancel()
      Log.w(TAG, "http timeout id=$requestId host=${parsedUrl.host} timeoutMs=$timeout")
      completeHttpError(requestId, "音源网络请求超时（${timeout}ms）")
    }
    httpTimeouts[requestId] = requestTimeout
    webView.postDelayed(requestTimeout, timeout.toLong())
    fun enqueue(client: okhttp3.OkHttpClient, allowDirectFallback: Boolean) {
      if (httpTransfers[requestId] !== transfer || settled || destroyed) return
      val call = client.newBuilder()
        .connectTimeout(timeout.toLong(), TimeUnit.MILLISECONDS)
        .readTimeout(timeout.toLong(), TimeUnit.MILLISECONDS)
        .writeTimeout(timeout.toLong(), TimeUnit.MILLISECONDS)
        .build()
        .newCall(requestValue)
      transfer.call = call
      if (httpTransfers[requestId] !== transfer) { call.cancel(); return }
      call.timeout().timeout(timeout.toLong(), TimeUnit.MILLISECONDS)
      call.enqueue(object : Callback {
        override fun onFailure(call: Call, error: java.io.IOException) {
          if (httpTransfers[requestId] !== transfer || transfer.call !== call) return
          if (allowDirectFallback) {
            Log.w(TAG, "http primary failed, retrying direct id=$requestId host=${parsedUrl.host} errorCode=${NetworkProtection.failureCode(error)}")
            enqueue(AudioNetwork.directClient, false)
            return
          }
          if (!httpTransfers.remove(requestId, transfer)) return
          cancelHttpTimeout(requestId)
          Log.w(TAG, "http failed id=$requestId host=${parsedUrl.host} errorCode=${NetworkProtection.failureCode(error)}")
          completeHttpError(requestId, NetworkProtection.httpError(error))
        }

        override fun onResponse(call: Call, response: Response) {
          if (httpTransfers[requestId] !== transfer || transfer.call !== call) return response.close()
          try {
            response.use responseBlock@ {
              val quotedId = JSONObject.quote(requestId)
              val responseHeaders = JSONObject()
              for (name in it.headers.names())
                responseHeaders.put(name.lowercase(), it.headers.values(name).joinToString(", "))
              val metadata = JSONObject().apply {
                put("statusCode", it.code)
                put("statusMessage", it.message)
                put("headers", responseHeaders)
                put("request", JSONObject().put("url", it.request.url.toString()))
              }.toString()
              if (!sendHttpBlock(requestId, transfer,
                  "globalThis.__liuliuHttpStart($quotedId,${JSONObject.quote(metadata)});")) return@responseBlock
              val buffer = ByteArray(HTTP_CHUNK_BYTES)
              val textDecoder = if (binary) null else HttpResponseTextDecoder(HTTP_CHUNK_BYTES)
              var total = 0
              var chunks = 0
              it.body?.byteStream()?.use { input ->
                while (true) {
                  if (httpTransfers[requestId] !== transfer) return@responseBlock
                  val count = input.read(buffer)
                  if (count < 0) break
                  if (count == 0) continue
                  if (total + count > MAX_RESPONSE_BYTES)
                    throw IllegalArgumentException("音源响应超过 10 MB")
                  total += count
                  val encoded = Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP)
                  val text = textDecoder?.append(buffer, count).orEmpty()
                  if (!sendHttpBlock(requestId, transfer,
                      "globalThis.__liuliuHttpData($quotedId,${JSONObject.quote(encoded)},${JSONObject.quote(text)});")) return@responseBlock
                  chunks++
                }
              }
              val tail = textDecoder?.append(buffer, 0, last = true).orEmpty()
              if (tail.isNotEmpty() && !sendHttpBlock(requestId, transfer,
                  "globalThis.__liuliuHttpData($quotedId,'',${JSONObject.quote(tail)});")) return@responseBlock
              sendHttpBlock(requestId, transfer, "globalThis.__liuliuHttpEnd($quotedId,$total);")
              Log.i(TAG, "http complete id=$requestId host=${parsedUrl.host} code=${it.code} bytes=$total chunks=$chunks maxChunkBytes=$HTTP_CHUNK_BYTES")
            }
          } catch (error: Exception) {
            if (httpTransfers.remove(requestId, transfer)) {
              transfer.cancel()
                completeHttpError(requestId, NetworkProtection.httpError(error))
            }
          } finally {
            httpTransfers.remove(requestId, transfer)
            cancelHttpTimeout(requestId)
          }
        }
      })
    }
    enqueue(AudioNetwork.client, true)
  }

  private fun transportBytes(value: Any?): ByteArray? {
    if (value !is JSONObject || value.optString(TRANSPORT_TYPE_KEY) != TRANSPORT_BYTES) return null
    val encoded = value.optString(TRANSPORT_DATA_KEY)
    if (encoded.isBlank()) return ByteArray(0)
    return try {
      Base64.decode(encoded, Base64.DEFAULT)
    } catch (_error: IllegalArgumentException) {
      throw IllegalArgumentException("音源请求包含无效的二进制数据")
    }
  }

  private fun encodeBody(value: Any?, contentType: String?): ByteArray {
    transportBytes(value)?.let { return it }
    val text = when (value) {
      null, JSONObject.NULL -> ""
      is String -> value
      is JSONObject -> if (contentType?.contains("application/x-www-form-urlencoded", true) == true) encodeForm(value) else value.toString()
      is JSONArray -> value.toString()
      else -> value.toString()
    }
    return text.toByteArray(Charsets.UTF_8)
  }

  private fun formValue(value: Any?): String {
    transportBytes(value)?.let { return it.toString(Charsets.UTF_8) }
    return when (value) {
      null, JSONObject.NULL -> ""
      is String -> value
      else -> value.toString()
    }
  }

  private fun encodeForm(value: Any?): String {
    if (value is String) return value
    if (value !is JSONObject) return value?.toString() ?: ""
    return value.keys().asSequence().joinToString("&") { key ->
      "${URLEncoder.encode(key, "UTF-8") }=${URLEncoder.encode(formValue(value.opt(key)), "UTF-8") }"
    }
  }

  private fun multipartBody(value: Any?): MultipartBody {
    val builder = MultipartBody.Builder().setType(MultipartBody.FORM)
    if (value is JSONObject) value.keys().forEach { key -> addMultipartValue(builder, key, value.opt(key)) }
    else if (value != null && value != JSONObject.NULL) builder.addFormDataPart("data", value.toString())
    return builder.build()
  }

  private fun addMultipartValue(builder: MultipartBody.Builder, name: String, value: Any?) {
    if (value is JSONArray) {
      for (index in 0 until value.length()) addMultipartValue(builder, name, value.opt(index))
      return
    }
    transportBytes(value)?.let { bytes ->
      builder.addFormDataPart(
        name,
        name,
        bytes.toRequestBody("application/octet-stream".toMediaTypeOrNull()),
      )
      return
    }
    if (value is JSONObject) {
      val payload = when {
        value.has("data") -> value.opt("data")
        value.has("buffer") -> value.opt("buffer")
        value.has("value") -> value.opt("value")
        else -> null
      }
      val bytes = transportBytes(payload)
      if (bytes != null) {
        val filename = value.optString("filename", name).ifBlank { name }
        val mediaType = value.optString(
          "contentType",
          value.optString("content_type", "application/octet-stream"),
        ).toMediaTypeOrNull()
        builder.addFormDataPart(name, filename, bytes.toRequestBody(mediaType))
        return
      }
    }
    builder.addFormDataPart(name, formValue(value))
  }

  private fun scriptInfo(): JSONObject {
    val header = Regex("^/\\*[\\s\\S]+?\\*/").find(script)?.value.orEmpty()
    fun metadata(key: String, maxLength: Int): String =
      Regex("(?mi)^\\s*\\*\\s*@$key\\s+(.+)$").find(header)?.groupValues?.get(1)
        ?.trim()?.take(maxLength).orEmpty()
    return JSONObject().apply {
      put("name", metadata("name", 64))
      put("description", metadata("description", 256))
      put("version", metadata("version", 64))
      put("author", metadata("author", 128))
      put("homepage", metadata("homepage", 1024))
      put("rawScript", script)
    }
  }

  private fun bootstrap(): String = """
    (() => {
      const callbacks = Object.create(null);
      const responseTransfers = Object.create(null);
      let requestSequence = 0;
      globalThis.__liuliuLastBackend = '';
      globalThis.__liuliuBackendUrls = [];
      globalThis.__liuliuActiveSource = '';
      globalThis.__liuliuMusicInfo = {};
      globalThis.__liuliuActiveQuality = '';
      globalThis.__liuliuBoundedRequests = false;
      globalThis.__liuliuPinnedBackendRoutes = [];
      globalThis.__liuliuRejectedBackendRoutes = new Set();
      const qualityFields = new Set(['quality', 'level', 'br', 'bitrate', 'size', 'format']);
      const identityFields = new Set(['id', 'mid', 'songmid', 'songid', 'musicid', 'rid', 'hash', 'mainhash',
        'strmediamid', 'copyrightid', 'albumid', 'album_id', 'albummid', 'name', 'songname', 'singer', 'artist', 'albumname', 'keyword', 'msg']);
      const volatileFields = new Set(['sign', 'signature', 'timestamp', 'time', 'ts', 'token', 'tokents', 'nonce', 'deviceid', 'user', 'key', 'apikey', 'api_key', 'params', 'encparams', 'enctext', 'encseckey']);
      const wireQuality = value => {
        const tier = String(value || '').toLowerCase();
        return ({ '128k': '128k', '128': '128k', '128000': '128k', standard: '128k',
          '320k': '320k', '320': '320k', '320000': '320k', hq: '320k', exhigh: '320k',
          flac: 'flac', sq: 'flac', lossless: 'flac', '2000kflac': 'flac',
          flac24bit: 'flac24bit', '4000kflac': 'flac24bit', hires: 'hires' })[tier];
      };
      const qualityField = (key, value) => qualityFields.has(key.toLowerCase()) ||
        (key.toLowerCase() === 'type' && Boolean(wireQuality(value)));
      const requestBody = options => {
        let body = options.body === undefined ? options.form : options.body;
        if (typeof body === 'string') {
          try { return JSON.parse(body); } catch (_error) {}
          if (body.includes('=')) return Object.fromEntries(new URLSearchParams(body));
        }
        return body && typeof body === 'object' && !ArrayBuffer.isView(body) ? body : undefined;
      };
      const bodyQualities = (body, depth = 0) => {
        if (!body || typeof body !== 'object' || depth > 8) return [];
        return Object.entries(body).flatMap(([key, value]) => qualityField(key, value)
          ? [wireQuality(value)].filter(Boolean) : bodyQualities(value, depth + 1));
      };
      const requestQuality = (url, options) => {
        const parsed = new URL(String(url));
        const values = [...Array.from(parsed.searchParams.entries()).flatMap(([key, value]) =>
          qualityField(key, value) ? [wireQuality(value)].filter(Boolean) : []),
          ...bodyQualities(requestBody(options))];
        const distinct = [...new Set(values)];
        return distinct.length === 1 ? distinct[0] : undefined;
      };
      globalThis.__liuliuRequestRoute = (url, options = {}) => {
        const parsed = new URL(String(url));
        const info = globalThis.__liuliuMusicInfo;
        const identities = ['songmid', 'songId', 'hash', 'strMediaMid', 'copyrightId', 'albumId', 'albumMid']
          .map(key => String(info[key] || '')).filter(Boolean);
        const path = parsed.pathname.split('/').map(segment => {
          let decoded = segment;
          try { decoded = decodeURIComponent(segment); } catch (_error) {}
          if (identities.includes(decoded)) return '{track}';
          if (decoded === globalThis.__liuliuActiveQuality && decoded) return '{quality}';
          return segment;
        }).join('/');
        const field = (key, value) => {
          const lower = key.toLowerCase();
          if (qualityField(key, value)) return '{quality}';
          if (volatileFields.has(lower)) return '{volatile}';
          if (lower === 'interval' && info.interval != null && String(info.interval) !== '' &&
              String(value) === String(info.interval)) return '{track}';
          if (identityFields.has(lower) || identities.includes(String(value))) return '{track}';
          return value;
        };
        const queryKeys = Array.from(parsed.searchParams.entries()).map(([key, value]) => [key, field(key, value)])
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        const normalizeBody = (body, depth = 0, key = '') => {
          if (depth > 8) return body;
          if (!body || typeof body !== 'object') return field(key, body);
          if (Array.isArray(body)) return body.map(value => normalizeBody(value, depth + 1, key));
          return Object.fromEntries(Object.keys(body).sort().map(name => [name, normalizeBody(body[name], depth + 1, name)]));
        };
        const body = normalizeBody(requestBody(options));
        return JSON.stringify([String(options.method || 'GET').toUpperCase(), parsed.origin, path, queryKeys,
          ...(body === undefined ? [] : [body])]);
      };
      const responseUrls = (body, depth = 0) => {
        if (depth > 12) return [];
        if (typeof body === 'string') return /^https?:\/\//i.test(body.trim()) ? [body.trim()] : [];
        if (!body || typeof body !== 'object' || ArrayBuffer.isView(body)) return [];
        return Object.values(body).flatMap(value => responseUrls(value, depth + 1));
      };
      // Request aliases above are routing compatibility, never response evidence.
      const returnedQuality = value => typeof value === 'string' ? ({
        '128k': '128k', '标清': '128k', '320k': '320k', '高清': '320k',
        flac: 'flac', '无损': 'flac', flac24bit: 'flac24bit', '至臻': 'flac24bit',
        hires: 'hires', '母带': 'hires',
      })[value.trim().toLowerCase()] : undefined;
      const responseTiers = (body, inherited = [], depth = 0) => {
        if (!body || typeof body !== 'object' || depth > 8) return [];
        if (Array.isArray(body)) return body.flatMap(item => responseTiers(item, inherited, depth + 1));
        const fields = Object.entries(body).filter(([key]) =>
          ['quality', 'level', 'type', 'br', 'bitrate', 'format', '音质'].includes(key.toLowerCase()));
        const local = fields.map(([, value]) => returnedQuality(value)).filter(Boolean);
        const tiers = fields.length ? [...new Set(local)] : inherited;
        return Object.values(body).flatMap(value => typeof value === 'string' && /^https?:\/\//i.test(value)
          ? [{ url: value, tiers }] : responseTiers(value, tiers, depth + 1));
      };
      // Attribute a script's appended query to its unique originating interface.
      // This is routing evidence only; audio/tier evidence still needs the exact URL.
      const appendsQuery = (original, selected) => {
        try {
          const base = new URL(original), target = new URL(selected);
          if (['protocol', 'username', 'password', 'host', 'pathname', 'hash']
              .some(field => base[field] !== target[field])) return false;
          const before = Array.from(base.searchParams.entries());
          const after = Array.from(target.searchParams.entries());
          if (after.length <= before.length || before.some(([key, value], index) =>
              after[index][0] !== key || after[index][1] !== value)) return false;
          const keys = new Set(before.map(([key]) => key));
          for (const [key] of after.slice(before.length)) {
            if (keys.has(key)) return false;
            keys.add(key);
          }
          return true;
        } catch (_error) { return false; }
      };
      globalThis.__liuliuResolvedEndpoints = (url, backend = '') => {
        const captured = globalThis.__liuliuBackendUrls;
        const eligible = captured.filter(endpoint => !backend || !endpoint.backend || endpoint.backend === backend);
        let winners = eligible.filter(endpoint =>
          endpoint.responseUrls && endpoint.responseUrls.includes(url));
        if (!winners.length) {
          const derived = eligible.filter(endpoint => endpoint.responseUrls &&
            endpoint.responseUrls.some(original => appendsQuery(original, url)));
          if (derived.length === 1) winners = derived;
        }
        const dependencies = [...new Set(captured.filter(endpoint => !endpoint.responseUrls?.length)
          .map(endpoint => endpoint.requestRoute).filter(Boolean))];
        return winners.map(({ responseUrls: _urls, responseTiers: captures, ...endpoint }) => {
          const matches = (captures || []).filter(item => item.url === url);
          const tiers = [...new Set(matches.flatMap(item => item.tiers))];
          return { ...endpoint, ...(tiers.length === 1 ? { responseQuality: tiers[0] } : {}),
            ...(dependencies.length ? { dependencyRoutes: dependencies } : {}) };
        });
      };
      globalThis.__liuliuPinnedBackend = '';
      globalThis.__liuliuPreferredBackend = '';
      globalThis.__liuliuRejectedBackends = new Set();
      globalThis.__liuliuCurrentBackend = '';
      globalThis.__liuliuBackendProtocolSeen = false;
      globalThis.__liuliuBackendHintAttempted = false;
      const stringToBytes = input => {
        const bytes = [];
        for (let i = 0; i < input.length; i++) {
          const code = input.codePointAt(i);
          if (code > 0xffff) i++;
          if (code < 128) bytes.push(code);
          else if (code < 2048) bytes.push((code >> 6) | 192, (code & 63) | 128);
          else if (code < 65536) bytes.push((code >> 12) | 224, ((code >> 6) & 63) | 128, (code & 63) | 128);
          else bytes.push((code >> 18) | 240, ((code >> 12) & 63) | 128, ((code >> 6) & 63) | 128, (code & 63) | 128);
        }
        return bytes;
      };
      const bytesToString = bytes => {
        let result = '';
        for (let i = 0; i < bytes.length;) {
          const first = bytes[i++];
          if (first < 128) result += String.fromCharCode(first);
          else if (first < 224) result += String.fromCharCode(((first & 31) << 6) | (bytes[i++] & 63));
          else if (first < 240) result += String.fromCharCode(((first & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
          else result += String.fromCodePoint(((first & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
        }
        return result;
      };
      const asBytes = value => Array.from(ArrayBuffer.isView(value) ? value : value || []);
      const bufferFrom = (input, encoding) => {
        if (typeof input === 'string') {
          if (encoding === 'binary') throw new Error('Binary encoding is not supported for input strings');
          if (encoding === 'base64') return new Uint8Array(JSON.parse(LiuliuSource.base64Decode(input)));
          if (encoding === 'hex') return new Uint8Array((input.match(/.{1,2}/g) || []).map(byte => parseInt(byte, 16)));
          return new Uint8Array(stringToBytes(input));
        }
        if (Array.isArray(input) || ArrayBuffer.isView(input) || input instanceof ArrayBuffer) return new Uint8Array(input);
        throw new Error('Unsupported input type: ' + typeof input + ' encoding: ' + encoding);
      };
      const bufToString = (buf, format) => {
        if (!Array.isArray(buf) && !ArrayBuffer.isView(buf)) throw new Error('Input is not a valid buffer');
        const bytes = asBytes(buf);
        if (format === 'binary') return buf;
        if (format === 'hex') return bytes.reduce((text, byte) => text + byte.toString(16).padStart(2, '0'), '');
        if (format === 'base64') return LiuliuSource.base64Encode(JSON.stringify(bytes));
        return bytesToString(bytes);
      };
      const errorText = value => String(value && (value.stack || value.message) || value);
      const fail = value => LiuliuSource.rejected(errorText(value));
      window.onerror = (_message, _file, _line, _column, error) => { fail(error || _message); return true; };
      window.onunhandledrejection = event => fail(event.reason || '音源脚本运行失败');
      globalThis.__liuliuHttpError = (id, message) => {
        delete responseTransfers[id];
        const entry = callbacks[id];
        if (!entry) return false;
        delete callbacks[id];
        entry.callback(new Error(String(message)), null, null);
        return false;
      };
      globalThis.__liuliuHttpStart = (id, metadata) => {
        if (!callbacks[id]) return false;
        if (responseTransfers[id]) return globalThis.__liuliuHttpError(id, '音源响应重复开始');
        responseTransfers[id] = { response: JSON.parse(metadata), chunks: [], text: [], bytes: 0 };
        return true;
      };
      globalThis.__liuliuHttpData = (id, encoded, text) => {
        const transfer = responseTransfers[id];
        if (!callbacks[id] || !transfer) return false;
        const decoded = atob(encoded);
        if (decoded.length > ${HTTP_CHUNK_BYTES} || transfer.bytes + decoded.length > ${MAX_RESPONSE_BYTES}) {
          LiuliuSource.cancelHttp(id);
          return globalThis.__liuliuHttpError(id, '音源响应超过 10 MB 或分块上限');
        }
        if (decoded.length) {
          const chunk = new Uint8Array(decoded.length);
          for (let index = 0; index < decoded.length; index++) chunk[index] = decoded.charCodeAt(index);
          transfer.chunks.push(chunk);
          transfer.bytes += chunk.length;
        }
        if (!callbacks[id].binary && text) transfer.text.push(text);
        return true;
      };
      globalThis.__liuliuHttpEnd = (id, bytes) => {
        const entry = callbacks[id];
        const transfer = responseTransfers[id];
        if (!entry || !transfer) return false;
        if (bytes !== transfer.bytes) return globalThis.__liuliuHttpError(id, '音源响应传输不完整');
        delete callbacks[id];
        delete responseTransfers[id];
        const response = transfer.response;
        const raw = new Uint8Array(transfer.bytes);
        let offset = 0;
        for (const chunk of transfer.chunks) { raw.set(chunk, offset); offset += chunk.length; }
        transfer.chunks.length = 0;
        const rawBody = entry.binary ? raw : transfer.text.join('');
        transfer.text.length = 0;
        let body = rawBody;
        // LX's documented source example consumes resp.body as an object and
        // desktop LX-compatible runtimes JSON-decode valid response bodies.
        // Keep the original text/bytes on the response while exposing parsed
        // JSON only at this source-runtime callback boundary.
        if (!entry.binary && typeof rawBody === 'string' && rawBody) {
          try { body = JSON.parse(rawBody); } catch (_error) {}
        }
        response.bytes = bytes;
        response.bodyText = entry.binary ? '' : rawBody;
        response.raw = raw;
        response.body = body;
        if (response.statusCode >= 200 && response.statusCode < 300 && response.request &&
            /^https?:\/\//i.test(response.request.url || '')) {
          const endpoint = { ...(entry.backend ? { backend: entry.backend } : {}), url: response.request.url,
            requestRoute: entry.requestRoute, ...(entry.quality ? { quality: entry.quality } : {}),
            responseUrls: [...new Set([...responseUrls(body), ...responseUrls(response.headers?.location)])],
            responseTiers: responseTiers(body) };
          if (!globalThis.__liuliuBackendUrls.some(value => value.backend === endpoint.backend && value.url === endpoint.url))
            globalThis.__liuliuBackendUrls.push(endpoint);
        }
        entry.callback(null, response, body);
        return true;
      };
      globalThis.__liuliuResetHttp = () => {
        for (const id of Object.keys(callbacks)) delete callbacks[id];
        for (const id of Object.keys(responseTransfers)) delete responseTransfers[id];
      };
      const serializeRequestOptions = options => JSON.stringify(options || {}, (_key, value) => {
        if (ArrayBuffer.isView(value)) return {
          ${TRANSPORT_TYPE_KEY}: '${TRANSPORT_BYTES}',
          ${TRANSPORT_DATA_KEY}: bufToString(value, 'base64'),
        };
        if (value instanceof ArrayBuffer) return {
          ${TRANSPORT_TYPE_KEY}: '${TRANSPORT_BYTES}',
          ${TRANSPORT_DATA_KEY}: bufToString(new Uint8Array(value), 'base64'),
        };
        return value;
      });
      globalThis.lx = {
        EVENT_NAMES: { request: 'request', inited: 'inited', updateAlert: 'updateAlert' },
        version: '2.0.0', env: 'mobile',
        currentScriptInfo: ${scriptInfo()},
        request: (url, options = {}, callback) => {
          let quality;
          try { quality = requestQuality(url, options); } catch (_error) {}
          // Request names are transport hints. Only the returned audio URL's
          // native evidence can decide its tier and enforce the user's ceiling.
          let requestRoute;
          try { requestRoute = globalThis.__liuliuRequestRoute(url, options); } catch (_error) {}
          if (globalThis.__liuliuRejectedBackendRoutes.has(requestRoute)) {
            const skipped = typeof callback === 'function' ? callback : () => {};
            setTimeout(() => skipped(new Error('本曲该接口已返回较低真实音质，继续查找匹配上限的音频'), null, null), 0);
            return () => {};
          }
          const pinnedRoutes = globalThis.__liuliuPinnedBackendRoutes;
          if (pinnedRoutes.length && !pinnedRoutes.includes(requestRoute)) {
            const skipped = typeof callback === 'function' ? callback : () => {};
            setTimeout(() => skipped(new Error('已跳过未绑定接口的音源后端'), null, null), 0);
            return () => {};
          }
          if (globalThis.__liuliuCurrentBackend &&
              globalThis.__liuliuRejectedBackends.has(globalThis.__liuliuCurrentBackend)) {
            const skipped = typeof callback === 'function' ? callback : () => {};
            setTimeout(() => skipped(new Error('已跳过本次启动失效的音源后端'), null, null), 0);
            return () => {};
          }
          const targetBackend = globalThis.__liuliuPinnedBackend || globalThis.__liuliuPreferredBackend;
          if (targetBackend && globalThis.__liuliuBackendProtocolSeen &&
              globalThis.__liuliuCurrentBackend && globalThis.__liuliuCurrentBackend !== targetBackend) {
            const skipped = typeof callback === 'function' ? callback : () => {};
            setTimeout(() => skipped(new Error('已跳过未绑定的音源后端'), null, null), 0);
            return () => {};
          }
          const id = 'req_' + (++requestSequence) + '_' + Date.now();
          callbacks[id] = {
            callback: typeof callback === 'function' ? callback : () => {},
            binary: options.binary === true,
            backend: globalThis.__liuliuCurrentBackend || undefined,
            requestRoute,
            quality,
          };
          const boundedOptions = globalThis.__liuliuBoundedRequests && options.timeout === undefined
            ? { ...options, timeout: 10000 } : options;
          LiuliuSource.http(id, String(url), serializeRequestOptions(boundedOptions));
          return () => { delete callbacks[id]; delete responseTransfers[id]; LiuliuSource.cancelHttp(id); };
        },
        send: async (eventName, data) => {
          if (eventName === 'inited') { LiuliuSource.initialized(JSON.stringify(data)); return true; }
          if (eventName === 'updateAlert') return true;
          throw new Error('不支持的音源事件: ' + eventName);
        },
        on: async (eventName, handler) => {
          if (eventName !== 'request') throw new Error('不支持的音源事件: ' + eventName);
          globalThis.__liuliuRequestHandler = handler;
        },
          utils: {
          crypto: {
            md5: value => LiuliuSource.md5(String(value)),
            aesEncrypt: (buffer, mode, key, iv) => new Uint8Array(JSON.parse(LiuliuSource.aesEncrypt(
              JSON.stringify(asBytes(typeof buffer === 'string' ? bufferFrom(buffer) : buffer)),
              String(mode),
              JSON.stringify(asBytes(typeof key === 'string' ? bufferFrom(key) : key)),
              JSON.stringify(asBytes(typeof iv === 'string' ? bufferFrom(iv) : (iv || []))),
            ))),
            rsaEncrypt: (buffer, key) => new Uint8Array(JSON.parse(LiuliuSource.rsaEncrypt(
              JSON.stringify(asBytes(typeof buffer === 'string' ? bufferFrom(buffer) : buffer)),
              String(key),
            ))),
            randomBytes: size => {
              const bytes = new Uint8Array(Number(size) || 0);
              if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') globalThis.crypto.getRandomValues(bytes);
              else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
              return bytes;
            },
          },
          buffer: {
            from(input, encoding) { return bufferFrom(input, encoding); },
            bufToString(buf, format) { return bufToString(buf, format); },
          },
          zlib: {
            inflate: value => Promise.resolve(new Uint8Array(JSON.parse(LiuliuSource.zlibInflate(JSON.stringify(asBytes(value)))))) ,
            deflate: value => Promise.resolve(new Uint8Array(JSON.parse(LiuliuSource.zlibDeflate(JSON.stringify(asBytes(value)))))) ,
          },
        },
      };
      const originalConsoleLog = console.log.bind(console);
      console.log = (...args) => {
        const text = args.map(value => String(value)).join(' ');
        const attempt = /^\[(tx|wy|kw|kg|mg|qs)\]\s+尝试后端:\s+(.+?)(?:\s+ID:|$)/.exec(text);
        if (attempt && attempt[1] === globalThis.__liuliuActiveSource) {
          globalThis.__liuliuBackendProtocolSeen = true;
          globalThis.__liuliuCurrentBackend = attempt[2];
          if (attempt[2] === globalThis.__liuliuPreferredBackend)
            globalThis.__liuliuBackendHintAttempted = true;
        }
        const failed = /^\[(tx|wy|kw|kg|mg|qs)\]\s+(.+?)\s+失败:/.exec(text);
        if (failed && failed[1] === globalThis.__liuliuActiveSource &&
            failed[2] === globalThis.__liuliuPreferredBackend)
          globalThis.__liuliuPreferredBackend = '';
        const success = /^\[(tx|wy|kw|kg|mg|qs)\]\s+(.+?)\s+成功$/.exec(text);
        if (success && success[1] === globalThis.__liuliuActiveSource)
          globalThis.__liuliuLastBackend = success[2];
        if (${BuildConfig.DEBUG}) originalConsoleLog(...args);
      };
      if (!${BuildConfig.DEBUG}) {
        for (const name of ['info', 'warn', 'error', 'debug', 'trace', 'table', 'dir', 'dirxml'])
          console[name] = () => {};
      }
      try { (0, eval)(${JSONObject.quote(script)}); } catch (error) { fail(error); }
    })();
  """.trimIndent()

  companion object {
    private data class RuntimePool(
      val activity: Activity,
      val script: String,
      val sessions: MutableList<SourceScriptRuntime> = mutableListOf(),
      val waiting: ArrayDeque<ResolveRequest> = ArrayDeque(),
    )

    private const val INIT_TIMEOUT_MS = 10_000L
    private const val MAX_RESPONSE_BYTES = 10 * 1024 * 1024
    private const val HTTP_CHUNK_BYTES = 64 * 1024
    private const val MAX_SESSIONS_PER_SOURCE = 5
    private const val TAG = "LiuliuSourceRuntime"
    private const val TRANSPORT_TYPE_KEY = "__liuliuTransportType"
    private const val TRANSPORT_DATA_KEY = "data"
    private const val TRANSPORT_BYTES = "bytes"
    private val pools = linkedMapOf<String, RuntimePool>()

    fun resolve(
      activity: Activity,
      script: String,
      promise: Promise,
      source: String,
      musicInfoJson: String,
      quality: String,
      addressRequestId: String? = null,
    ) {
      val key = "${System.identityHashCode(activity)}:${scriptDigest(script)}"
      val pool = pools.getOrPut(key) { RuntimePool(activity, script) }
      val request = ResolveRequest(promise, source, musicInfoJson, quality, addressRequestId)
      val idleSession = pool.sessions.firstOrNull { it.idle && it.resolutionContext == request.contextKey }
      if (idleSession != null) {
        idleSession.reuse(request)
        return
      }
      if (pool.sessions.size < MAX_SESSIONS_PER_SOURCE) {
        createSession(key, pool, request)
        return
      }
      val replaceable = pool.sessions.firstOrNull { it.idle }
      if (replaceable != null) {
        replaceable.cleanup()
        pool.sessions.remove(replaceable)
        createSession(key, pool, request)
        return
      }
      pool.waiting.addLast(request)
    }

    private fun createSession(
      key: String,
      pool: RuntimePool,
      request: ResolveRequest,
    ) {
      val session = SourceScriptRuntime(
        pool.activity,
        pool.script,
        request.promise,
        request.source,
        request.musicInfoJson,
        request.quality,
        key,
        request.addressRequestId,
      )
      pool.sessions.add(session)
      session.start()
    }

    /** UI-thread operation; playback/health requests have no address ID. */
    fun cancelAddress(requestId: String): Boolean {
      for ((key, pool) in pools.toList()) {
        val queued = pool.waiting.iterator()
        while (queued.hasNext()) {
          val request = queued.next()
          if (request.addressRequestId == requestId) {
            queued.remove()
            request.promise.reject("SOURCE_ADDRESS_ABORTED", "URL 预解析已取消")
            return true
          }
        }
        val session = pool.sessions.firstOrNull { session -> session.active?.addressRequestId == requestId }
        if (session != null) {
          val request = session.active
          session.settled = true
          session.activeToken = ""
          session.active = null
          // Destroy only the cancelled request's WebView: delayed script tasks
          // cannot leak into a later request admitted to an idle session.
          session.cleanup()
          discard(key, session)
          request?.promise?.reject("SOURCE_ADDRESS_ABORTED", "URL 预解析已取消")
          return true
        }
      }
      return false
    }

    private fun release(key: String, session: SourceScriptRuntime) {
      val pool = pools[key] ?: return
      val next = pool.waiting.pollFirst() ?: return
      if (next.contextKey == session.resolutionContext) {
        session.reuse(next)
        return
      }
      session.cleanup()
      pool.sessions.remove(session)
      createSession(key, pool, next)
    }

    private fun discard(key: String, session: SourceScriptRuntime) {
      val pool = pools[key] ?: return
      pool.sessions.remove(session)
      val next = pool.waiting.pollFirst()
      if (next != null) createSession(key, pool, next)
      if (pool.sessions.isEmpty() && pool.waiting.isEmpty()) pools.remove(key)
    }

    private fun scriptDigest(script: String): String =
      MessageDigest.getInstance("SHA-256")
        .digest(script.toByteArray(Charsets.UTF_8))
        .take(12)
        .joinToString("") { "%02x".format(it) }

  }
}
