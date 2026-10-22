package com.liuliu.agentmusic

import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.SystemClock
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Response
import java.io.IOException
import java.nio.ByteBuffer
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import java.util.concurrent.atomic.AtomicBoolean

internal class AudioProbeFailure(val code: String, message: String) : IOException(message)

/** Shared audio-track probe; startup adds a frame-after-time check without using container duration. */
internal object AudioProbeGate {
  fun read(
    extractor: MediaExtractor,
    url: String,
    fallbackMime: String,
    prefix: ByteArray = byteArrayOf(),
    requiredSampleAfterUs: Long? = null,
  ): WritableMap {
    val track = (0 until extractor.trackCount).firstOrNull {
      extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
    } ?: throw AudioProbeFailure("AUDIO_NO_TRACK", "播放链路未识别到音频轨道")
    val format = extractor.getTrackFormat(track)
    val durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else -1L
    if (durationUs <= 0L && requiredSampleAfterUs == null)
      throw AudioProbeFailure("AUDIO_DURATION_UNREADABLE", "播放链路无法读取音频轨道时长")
    extractor.selectTrack(track)
    var sampleBytes = 0
    if (requiredSampleAfterUs == null) {
      sampleBytes = extractor.readSampleData(ByteBuffer.allocate(64 * 1024), 0)
      if (sampleBytes <= 0) throw AudioProbeFailure("AUDIO_NO_FRAMES", "播放链路未读取到音频帧")
    }
    val verifiedThroughUs = requiredSampleAfterUs?.let { thresholdUs ->
      var sampleTimeUs = extractor.sampleTime
      if (sampleTimeUs <= thresholdUs) {
        extractor.seekTo(thresholdUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
        var advances = 0
        while (extractor.sampleTime <= thresholdUs && advances < MAX_SEEK_ADVANCES) {
          if (!extractor.advance()) break
          advances += 1
        }
        sampleTimeUs = extractor.sampleTime
      }
      if (sampleTimeUs <= thresholdUs)
        throw AudioProbeFailure(
          "AUDIO_NO_FRAME_AFTER_THRESHOLD",
          "播放链路未读取到 ${thresholdUs / 1_000_000.0} 秒后的音频帧",
        )
      sampleBytes = extractor.readSampleData(ByteBuffer.allocate(64 * 1024), 0)
      if (sampleBytes <= 0)
        throw AudioProbeFailure("AUDIO_NO_FRAME_AFTER_THRESHOLD", "播放链路未读取到阈值后的音频帧")
      sampleTimeUs
    }
    val duration = if (durationUs > 0L) durationUs.toDouble() / 1_000_000.0 else 0.0
    val streamInfo = FlacSourceMetadata.read(prefix) ?: runCatching {
      format.getByteBuffer("csd-0")?.duplicate()?.let { config ->
        // Codec config belongs to this extracted audio track. Never mutate its position.
        if (config.remaining() > 65536) null
        else FlacSourceMetadata.read(ByteArray(config.remaining()).also { config.get(it) })
      }
    }.getOrNull()
    val formatMime = format.getString(MediaFormat.KEY_MIME) ?: fallbackMime
    val sourceBits = streamInfo?.bitsPerSample ?: if (format.containsKey("bits-per-sample"))
      format.getInteger("bits-per-sample").takeIf { it > 0 } else null
    val sourceRate = streamInfo?.sampleRate ?: if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE))
      format.getInteger(MediaFormat.KEY_SAMPLE_RATE).takeIf { it > 0 } else null
    // PCM_ENCODING describes the extractor/decoder output. It cannot certify
    // a FLAC/ALAC source's original bit depth (including extractors returning audio/raw).
    android.util.Log.i("LiuliuAudioQuality", "urlHash=${url.hashCode().toUInt().toString(16)} nativeMime=$formatMime evidence=${if (streamInfo != null) "flac-streaminfo" else "media-format"} bits=${sourceBits ?: 0} rate=${sourceRate ?: 0}")
    return Arguments.createMap().apply {
      putDouble("durationSeconds", duration)
      putString("resolvedUrl", url)
      putString("mimeType", if (streamInfo != null) "audio/flac" else formatMime)
      if (format.containsKey(MediaFormat.KEY_BIT_RATE)) putInt("bitrate", format.getInteger(MediaFormat.KEY_BIT_RATE))
      sourceRate?.let { putInt("sampleRate", it) }
      sourceBits?.let { putInt("bitsPerSample", it) }
      putInt("sampleBytes", sampleBytes)
      verifiedThroughUs?.let { putDouble("verifiedThroughSeconds", it.toDouble() / 1_000_000.0) }
      putString("message", "播放链路返回 $sampleBytes 字节 · ${"%.1f".format(duration)} 秒")
    }
  }

  private const val MAX_SEEK_ADVANCES = 128
}

/** No player, file cache, queue or decoder is created by this task. */
internal class BackgroundAudioProbe(private val requiredSampleAfterUs: Long? = null) {
  val completion = CompletableFuture<Unit>()
  private val cancelled = AtomicBoolean(false)
  private val deadline = SystemClock.elapsedRealtime() + 10_000L
  @Volatile private var activeCall: Call? = null
  private var bytesRead = 0

  fun cancel() {
    cancelled.set(true)
    activeCall?.cancel()
  }

  fun check() {
    if (cancelled.get()) throw AudioProbeFailure("AUDIO_PROBE_CANCELLED", "预解析音频校验已取消")
    if (SystemClock.elapsedRealtime() >= deadline) throw IOException("预解析音频校验超时")
  }

  private fun failTransport(message: String): Nothing {
    activeCall?.cancel()
    throw IOException(message)
  }

  private fun request(url: String, range: String): Response {
    check()
    val call = AudioNetwork.newCall(url, range, (deadline - SystemClock.elapsedRealtime()).coerceAtLeast(1))
    activeCall = call
    if (cancelled.get()) call.cancel()
    val response = CompletableFuture<Response>()
    call.enqueue(object : Callback {
      override fun onFailure(call: Call, error: IOException) { response.completeExceptionally(error) }
      override fun onResponse(call: Call, value: Response) {
        if (!response.complete(value)) value.close()
      }
    })
    try {
      val value = response.get()
      try { check() } catch (error: Exception) { value.close(); throw error }
      return value
    } catch (error: ExecutionException) {
      check()
      throw IOException(error.cause?.message ?: "预解析网络读取失败", error.cause)
    }
  }

  private fun readLimited(response: Response, limit: Int): ByteArray {
    if (!response.isSuccessful) failTransport("播放链路 HTTP ${response.code}")
    val remaining = MAX_BYTES - bytesRead
    if (remaining <= 0) failTransport("预解析音频读取超出限制")
    val buffer = ByteArray(minOf(limit, remaining))
    val stream = response.body?.byteStream() ?: failTransport("播放链路未返回音频数据")
    var count = 0
    while (count < buffer.size) {
      check()
      val read = stream.read(buffer, count, buffer.size - count)
      if (read < 0) break
      if (read == 0) break
      count += read
      bytesRead += read
    }
    check()
    val declaredLength = response.body?.contentLength() ?: -1L
    if (declaredLength > count || (declaredLength < 0 && count == buffer.size))
      activeCall?.cancel() // Do not let close() silently drain an ignored Range response.
    return buffer.copyOf(count)
  }

  fun run(url: String): WritableMap {
    var extractor: MediaExtractor? = null
    var data: AudioRangeDataSource? = null
    try {
      var finalUrl = ""
      var mime = ""
      var length = -1L
      var prefix = byteArrayOf()
      // This check follows the same shared HTTP redirect/content policy as playback.
      request(url, "bytes=0-4095").use { response ->
        mime = response.header("Content-Type").orEmpty()
        if (Regex("json|html|text/plain", RegexOption.IGNORE_CASE).containsMatchIn(mime))
          failTransport("返回内容不是音频（$mime）")
        prefix = readLimited(response, 4096)
        if (prefix.isEmpty()) throw IOException("播放链路未返回音频数据")
        finalUrl = response.request.url.toString()
        length = response.header("Content-Range")?.substringAfterLast('/')?.toLongOrNull()
          ?: if (response.code == 200) response.body?.contentLength() ?: -1L else -1L
      }
      check()
      data = AudioRangeDataSource(AudioRangeReader(length, { start, limit ->
        request(finalUrl, "bytes=$start-${start + limit - 1}").use { response ->
          AudioNetwork.checkRange(response, start)
          readLimited(response, limit)
        }
      }, ::check))
      extractor = MediaExtractor()
      extractor.setDataSource(data)
      check()
      data.reader.transportError?.let { throw it }
      val result = AudioProbeGate.read(extractor, finalUrl, mime, prefix, requiredSampleAfterUs)
      check()
      data.reader.transportError?.let { throw it }
      android.util.Log.i(
        "LiuliuAudioPrewarm",
        "validated bytes=$bytesRead duration=${result.getDouble("durationSeconds")} verifiedThrough=${if (result.hasKey("verifiedThroughSeconds")) result.getDouble("verifiedThroughSeconds") else 0.0}",
      )
      return result
    } catch (error: Exception) {
      check()
      data?.reader?.transportError?.let { throw it }
      throw error
    } finally {
      extractor?.release()
      data?.close()
      activeCall?.cancel()
    }
  }

  companion object {
    private const val MAX_BYTES = 256 * 1024
  }
}
