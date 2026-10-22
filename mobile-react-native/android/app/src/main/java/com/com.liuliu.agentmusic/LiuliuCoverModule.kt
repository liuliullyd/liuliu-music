package com.liuliu.agentmusic

import android.net.Uri
import android.util.Log
import com.facebook.common.references.CloseableReference
import com.facebook.datasource.BaseDataSubscriber
import com.facebook.datasource.DataSource
import com.facebook.drawee.backends.pipeline.Fresco
import com.facebook.imagepipeline.common.ResizeOptions
import com.facebook.imagepipeline.image.CloseableImage
import com.facebook.imagepipeline.request.ImageRequestBuilder
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.network.OkHttpClientProvider
import com.facebook.react.modules.fresco.ReactNetworkImageRequest
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executor

/** Artwork requests use the existing image pipeline without waiting for a View to attach. */
class LiuliuCoverModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private class Pending(val promise: Promise, val started: Long, val host: String) {
    var source: DataSource<CloseableReference<CloseableImage>>? = null
    var lookup: Call? = null
  }
  private val requests = ConcurrentHashMap<String, Pending>()
  private val direct = Executor { it.run() }
  override fun getName() = "LiuliuCover"

  @ReactMethod
  fun load(uri: String, id: String, promise: Promise) {
    val parsed = Uri.parse(uri)
    if (parsed.scheme !in listOf("http", "https") || parsed.host.isNullOrEmpty()) {
      promise.reject("E_COVER_URI", "Invalid remote artwork URI")
      return
    }
    val pending = Pending(promise, android.os.SystemClock.elapsedRealtime(), parsed.host.orEmpty())
    requests[id] = pending
    Log.i("LiuliuCover", "start id=$id host=${pending.host} active=${requests.size}")
    if (parsed.host == "artistpicserver.kuwo.cn" && parsed.path == "/pic.web") {
      if (parsed.getQueryParameter("type") != "rid_pic" ||
        !parsed.getQueryParameter("rid").orEmpty().matches(Regex("\\d+"))) {
        fail(id, pending, IOException("Invalid Kuwo artwork identity"))
        return
      }
      lookupKuwo(parsed, id, pending)
    } else decode(parsed, id, pending)
  }

  private fun lookupKuwo(uri: Uri, id: String, pending: Pending) {
    try {
      val call = OkHttpClientProvider.getOkHttpClient().newCall(Request.Builder()
        .url(uri.toString()).header("User-Agent", "Mozilla/5.0")
        .header("Referer", "http://www.kuwo.cn/").build())
      synchronized(pending) {
        if (requests[id] !== pending) { call.cancel(); return }
        pending.lookup = call
      }
      call.enqueue(object : Callback {
        override fun onFailure(call: Call, error: IOException) = fail(id, pending, error)
        override fun onResponse(call: Call, response: Response) {
          response.use {
            try {
              if (!response.isSuccessful) throw IOException("Kuwo artwork HTTP ${response.code}")
              val body = response.body ?: throw IOException("Missing Kuwo artwork response")
              // The endpoint returns one plain URL, never music bytes or arbitrary HTML.
              val buffer = body.source()
              buffer.request(2049)
              val text = buffer.readUtf8(minOf(2049L, buffer.buffer.size)).trim()
              if (text.length > 2048) throw IOException("Invalid Kuwo artwork response")
              val image = Uri.parse(text)
              val host = image.host.orEmpty().lowercase()
              if (image.scheme !in listOf("http", "https") ||
                (host != "kuwo.cn" && !host.endsWith(".kuwo.cn")))
                throw IOException("Invalid Kuwo artwork URL")
              synchronized(pending) { pending.lookup = null }
              Log.i("LiuliuCover", "lookup id=$id host=$host")
              decode(image, id, pending)
            } catch (error: Exception) { fail(id, pending, error) }
          }
        }
      })
    } catch (error: Exception) { fail(id, pending, error) }
  }

  private fun decode(uri: Uri, id: String, pending: Pending) {
    try {
      val source: DataSource<CloseableReference<CloseableImage>>
      synchronized(pending) {
        if (requests[id] !== pending) return
        val builder = ImageRequestBuilder.newBuilderWithSource(uri)
          .setResizeOptions(ResizeOptions(512, 512))
        val request = if (uri.host.orEmpty().endsWith(".kuwo.cn"))
          ReactNetworkImageRequest.fromBuilderWithHeaders(builder, Arguments.createMap().apply {
            putString("User-Agent", "Mozilla/5.0")
            putString("Referer", "http://www.kuwo.cn/")
          }) else builder.build()
        source = Fresco.getImagePipeline().fetchDecodedImage(request, this)
        pending.source = source
      }
      source.subscribe(object : BaseDataSubscriber<CloseableReference<CloseableImage>>() {
        override fun onNewResultImpl(data: DataSource<CloseableReference<CloseableImage>>) {
          if (!data.isFinished || !requests.remove(id, pending)) return
          val reference = data.result
          try {
            val image = reference?.get()
            if (image == null || image.width <= 0 || image.height <= 0) {
              pending.promise.reject("E_COVER_DECODE", "Artwork has no decoded pixels")
              Log.i("LiuliuCover", "failure id=$id host=${pending.host} reason=decode")
            } else {
              pending.promise.resolve(Arguments.createMap().apply {
                putString("uri", uri.toString())
                putInt("width", image.width)
                putInt("height", image.height)
              })
              Log.i("LiuliuCover", "success id=$id host=${uri.host} ms=${android.os.SystemClock.elapsedRealtime()-pending.started} size=${image.width}x${image.height}")
            }
          } finally {
            CloseableReference.closeSafely(reference)
            data.close()
            synchronized(pending) { pending.source = null; pending.lookup = null }
          }
        }
        override fun onFailureImpl(data: DataSource<CloseableReference<CloseableImage>>) {
          fail(id, pending, data.failureCause ?: IOException("Artwork request failed"))
          data.close()
        }
      }, direct)
    } catch (error: Exception) { fail(id, pending, error) }
  }

  private fun fail(id: String, pending: Pending, error: Throwable) {
    if (!requests.remove(id, pending)) return
    synchronized(pending) {
      pending.lookup?.cancel()
      pending.source?.close()
      pending.lookup = null
      pending.source = null
    }
    val pool = if (error.javaClass.simpleName == "PoolSizeViolationException")
      " pool=${error.message} origin=${error.stackTrace.take(5).joinToString("|") { "${it.className}.${it.methodName}" }}" else ""
    Log.i("LiuliuCover", "failure id=$id host=${pending.host} ms=${android.os.SystemClock.elapsedRealtime()-pending.started} reason=${error.javaClass.simpleName} active=${requests.size}$pool")
    pending.promise.reject("E_COVER_LOAD", error)
  }

  @ReactMethod
  fun cancel(id: String) {
    val pending = requests.remove(id) ?: return
    synchronized(pending) {
      pending.lookup?.cancel()
      pending.source?.close()
      pending.lookup = null
      pending.source = null
    }
    pending.promise.reject("E_COVER_CANCELLED", "Artwork request cancelled")
    Log.i("LiuliuCover", "cancel id=$id host=${pending.host} active=${requests.size}")
  }

  override fun invalidate() {
    requests.keys.toList().forEach { cancel(it) }
    super.invalidate()
  }
}
