package com.liuliu.agentmusic

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.io.File

/** Bounded live PCM tap after the existing effects; never decodes a second stream. */
internal object CarPcmBuffer {
  @Volatile var enabled = false
  @Volatile var remoteOnly = false
  data class Chunk(val epoch: Long, val index: Long, val bytes: ByteArray)
  private val chunks = ArrayDeque<Chunk>()
  private var staging = java.io.ByteArrayOutputStream()
  private var directory: File? = null
  private var archive: CarPcmArchive? = null
  private var byteCount = 0L
  private var fromStart = false
  private var requestedOriginMs = -1L
  private var headFlushPending = false
  private var standardDurationMs = 0L
  private var nextConsumedIndex = 0L
  private var qqEpoch = -1L
  private var qqLength = -1L
  private var qqRate = 0
  private var qqChannels = 0
  private var qqNextSentIndex = 0L
  val startsFromBeginning: Boolean @Synchronized get() = fromStart
  val awaitingHeadFlush: Boolean @Synchronized get() = headFlushPending
  val totalLength: Long @Synchronized get() = if (fromStart && recordingError == null && archive?.failure == null) archive?.total ?: -1 else -1
  var recordingError: String? = null; private set
  @Synchronized fun initialize(directory: File) { this.directory = directory }
  @Synchronized fun origin(positionMs: Long) {
    requestedOriginMs = positionMs
    headFlushPending = positionMs == 0L
    fromStart = positionMs == 0L && !headFlushPending
    if (!fromStart) standardDurationMs = 0
  }
  var rate = 0; private set
  var channels = 0; private set
  @Volatile var epoch = 0L; private set
  var next = 0L; private set
  var packageSize = 1_048_576; private set
  @Synchronized fun packageSize(bytes: Int) { require(bytes in 1..1_048_576); packageSize = bytes; reset() }
  @Synchronized fun configure(sampleRate: Int, channelCount: Int) {
    rate = sampleRate; channels = channelCount; reset()
  }
  @Synchronized fun reset() {
    chunks.clear(); staging.reset(); next = 0; epoch++; byteCount = 0; fromStart = requestedOriginMs == 0L && !headFlushPending; recordingError = null
    nextConsumedIndex = 0
    qqEpoch = -1; qqLength = -1; qqRate = 0; qqChannels = 0; qqNextSentIndex = 0
    if (!fromStart) standardDurationMs = 0
    archive?.close(); archive = null
  }
  /** Only an explicit origin may bless a new renderer flush as the beginning of a track. */
  @Synchronized fun flush() { headFlushPending = false; reset(); requestedOriginMs = -1 }
  @Synchronized fun armHeadCapture() { enabled = true; headFlushPending = true; origin(0); reset() }
  fun awaitHeadCapture(timeoutMs: Long = 1000, active: () -> Boolean = { true }) {
    val deadline = System.nanoTime() + java.util.concurrent.TimeUnit.MILLISECONDS.toNanos(timeoutMs)
    while (true) {
      synchronized(this) {
        if (!enabled || !active()) throw CarPcmFailure(108, "PCM曲首采集请求已失效")
        if (fromStart && !headFlushPending) return
        if (!headFlushPending) throw CarPcmFailure(108, "PCM曲首采集代次已变化")
      }
      if (System.nanoTime() >= deadline) throw CarPcmFailure(106, "未观察到曲首渲染flush，请在手机实际从头采集后重试，或使用Live扩展")
      Thread.sleep(10)
    }
  }
  @Synchronized fun finish() {
    if (!enabled) return
    if (staging.size() > 0) { chunks.addLast(Chunk(epoch, next++, staging.toByteArray())); staging.reset(); if (chunks.size > 32) chunks.removeFirst() }
    if (fromStart && recordingError == null) archive?.finish()
  }
  fun readComplete(index: Long): ByteArray? {
    val source: CarPcmArchive; val start: Long; val length: Int; val token: Long
    synchronized(this) {
      if (totalLength <= 0 || index < 0 || index > Int.MAX_VALUE || index * packageSize >= totalLength) return null
      source = archive ?: return null; start = index * packageSize; token = epoch
      length = minOf(packageSize.toLong(), totalLength - start).toInt()
    }
    return source.read(start, length)?.takeIf { epoch == token }
  }
  private fun ensureArchive(): CarPcmArchive = archive ?: CarPcmArchive(directory ?: throw CarPcmFailure(106, "PCM磁盘缓冲尚未初始化")).also { archive = it }
  private fun estimatedLength(): Long {
    if (rate <= 0 || channels <= 0 || standardDurationMs <= 0) throw CarPcmFailure(114, "缺少真实音频格式或时长，无法声明PCM估算长度")
    val frames = try { Math.multiplyExact(standardDurationMs, rate.toLong()) / 1000 } catch (_: ArithmeticException) { throw CarPcmFailure(106, "PCM时长越界") }
    val bytes = try { Math.multiplyExact(frames, channels.toLong() * 2) } catch (_: ArithmeticException) { throw CarPcmFailure(106, "PCM估算长度越界") }
    if (bytes !in 1..268_435_456L) throw CarPcmFailure(106, "PCM估算缓冲超过256MiB或为空")
    return bytes
  }
  private fun checkStandard() {
    if (!enabled || !fromStart) throw CarPcmFailure(114, "标准PCM必须从曲首采集，请先暂停并seek到0，或使用Live扩展")
    (recordingError ?: archive?.failure)?.let { throw CarPcmFailure(106, it) }
  }
  /** Explicit six-six complete capture path; not the default QQ reference wire contract. */
  @Synchronized fun fullCaptureInfo(durationMs: Long): org.json.JSONObject {
    checkStandard()
    if (durationMs > 0) standardDurationMs = durationMs
    val source = ensureArchive(); val measured = source.total
    val length = if (measured >= 0) measured else estimatedLength()
    if (length <= 0) throw CarPcmFailure(106, "PCM采集为空，未取得实际音频")
    return org.json.JSONObject().put("PCMDataLength", length).put("Rate", rate).put("Bit", 16).put("Channel", channels)
      .put("LiuliuLengthKind", if (measured >= 0) "captured-complete" else "duration-estimate")
      .put("LiuliuMeasuredPCMDataLength", measured).put("LiuliuEpoch", epoch).put("LiuliuAvailablePCMBytes", source.available)
  }
  data class StandardChunk(val epoch: Long, val index: Long, val bytes: ByteArray, val total: Long, val measured: Long, val lengthKind: String)
  fun awaitFullCapture(index: Long, expectedEpoch: Long? = null, timeoutMs: Long = 3000, active: () -> Boolean = { true }): StandardChunk {
    val source: CarPcmArchive; val block: Int; val token: Long; val estimate: Long
    synchronized(this) {
      if (expectedEpoch != null && expectedEpoch != epoch) throw CarPcmFailure(108, "PCM采集代次已失效")
      checkStandard()
      if (index < 0 || index > Int.MAX_VALUE || index > nextConsumedIndex) throw CarPcmFailure(107, "PCM包须顺序请求，下一包为$nextConsumedIndex")
      if (index < (nextConsumedIndex - 64).coerceAtLeast(0)) throw CarPcmFailure(111, "PCM重复请求超过64包重放窗口")
      source = ensureArchive(); block = packageSize; token = epoch
      estimate = if (source.total >= 0) source.total else estimatedLength()
    }
    // Disk reads/waits happen outside the audio buffer monitor.
    val bytes = source.await(index * block, block, timeoutMs) { enabled && epoch == token && active() }
    synchronized(this) {
      if (!enabled || epoch != token || !active()) throw CarPcmFailure(108, "PCM采集代次已失效")
      checkStandard()
      val measured = source.total
      return StandardChunk(token, index, bytes, if (measured >= 0) measured else maxOf(estimate, source.available), measured,
        if (measured >= 0) "captured-complete" else "duration-estimate")
    }
  }
  @Synchronized fun sentFullCapture(token: Long, index: Long) {
    if (!enabled || epoch != token) throw CarPcmFailure(108, "PCM发送完成时采集代次已失效")
    if (index == nextConsumedIndex) nextConsumedIndex++ // Replayed bytes never advance consumption twice.
  }
  /** Matches reference controller.M and buffer.o: one frozen, even byte count minus 102400. */
  @Synchronized fun qqReferenceInfo(durationMs: Long): org.json.JSONObject {
    if (!enabled || !fromStart) throw CarPcmFailure(106, "参考PCM尚未完成真实曲首flush")
    (recordingError ?: archive?.failure)?.let { throw CarPcmFailure(106, it) }
    if (qqEpoch != epoch) {
      if (rate <= 0 || channels <= 0 || durationMs <= 0) throw CarPcmFailure(106, "参考PCM缺少实际格式或时长")
      val length = (((durationMs / 1000.0) * 2.0 * channels * rate).toLong() / 2) * 2 - 102400
      if (length !in 1..268_435_456L) throw CarPcmFailure(106, "参考PCM总长无效或超过256MiB")
      qqEpoch = epoch; qqLength = length; qqRate = rate; qqChannels = channels; qqNextSentIndex = 0
    }
    ensureArchive()
    return org.json.JSONObject().put("PCMDataLength", qqLength).put("Rate", qqRate).put("Bit", 16).put("Channel", qqChannels)
  }
  data class QqChunk(val epoch: Long, val index: Long, val bytes: ByteArray, val total: Long)
  fun awaitQqReference(index: Long, expectedEpoch: Long? = null, timeoutMs: Long = 3000, active: () -> Boolean = { true }): QqChunk {
    val source: CarPcmArchive; val token: Long; val start: Long; val length: Int; val declared: Long
    synchronized(this) {
      if (!enabled || (expectedEpoch != null && expectedEpoch != epoch)) throw CarPcmFailure(108, "参考PCM采集代次已失效")
      if (!fromStart || qqEpoch != epoch || qqLength <= 0) throw CarPcmFailure(106, "请先请求当前曲首的MediaInfo")
      (recordingError ?: archive?.failure)?.let { throw CarPcmFailure(106, it) }
      if (index < 0 || index > Int.MAX_VALUE || index * packageSize >= qqLength) throw CarPcmFailure(107, "参考PCM包索引越界")
      if (index < qqNextSentIndex) throw CarPcmFailure(111, "参考PCM重复包索引")
      if (index != qqNextSentIndex) throw CarPcmFailure(107, "参考PCM须顺序请求，下一包为$qqNextSentIndex")
      source = ensureArchive(); token = epoch; declared = qqLength; start = index * packageSize
      length = minOf(packageSize.toLong(), declared - start).toInt()
    }
    val bytes = try { source.await(start, length, timeoutMs) { enabled && epoch == token && active() } }
      catch (error: CarPcmFailure) { if (error.code == 107) throw CarPcmFailure(106, "实际PCM提前结束，未达到参考声明长度") else throw error }
    synchronized(this) {
      if (!enabled || epoch != token || qqEpoch != token || !active()) throw CarPcmFailure(108, "参考PCM采集代次已失效")
      if (bytes.size != length) throw CarPcmFailure(106, "实际PCM不足参考声明长度，不能填零冒充音频")
      return QqChunk(token, index, bytes, declared)
    }
  }
  @Synchronized fun sentQqReference(token: Long, index: Long) {
    if (!enabled || epoch != token || qqEpoch != token) throw CarPcmFailure(108, "参考PCM发送代次已失效")
    if (index < qqNextSentIndex) throw CarPcmFailure(111, "参考PCM重复包索引")
    if (index != qqNextSentIndex) throw CarPcmFailure(107, "参考PCM发送索引不连续")
    qqNextSentIndex++
  }
  @Synchronized fun release() { enabled = false; remoteOnly = false; requestedOriginMs = -1; headFlushPending = false; reset(); directory = null }
  @Synchronized fun offer(bytes: ByteArray) {
    if (!enabled) return
    if (directory != null && recordingError == null) try {
      ensureArchive()
      check(byteCount + bytes.size <= 268_435_456) { "PCM 会话缓冲超过256MiB" }
      archive!!.append(bytes); recordingError = archive!!.failure
    } catch (error: Exception) { recordingError = error.message; archive?.close(); archive = null }
    byteCount += bytes.size
    var offset = 0
    while (offset < bytes.size) {
      val count = minOf(packageSize - staging.size(), bytes.size - offset)
      staging.write(bytes, offset, count); offset += count
      if (staging.size() == packageSize) {
        chunks.addLast(Chunk(epoch, next++, staging.toByteArray())); staging.reset()
        if (chunks.size > 32) chunks.removeFirst() // Audio thread never blocks; missed packages report an explicit gap.
      }
    }
  }
  @Synchronized fun get(index: Long): Chunk? = chunks.firstOrNull { it.index == index }
  @Synchronized fun info() = org.json.JSONObject().put("SampleRate", rate).put("Channels", channels).put("BitsPerSample", 16)
    .put("Epoch", epoch).put("FirstPackageIndex", chunks.firstOrNull()?.index ?: next).put("NextPackageIndex", next)
    .put("PCMDataLength", totalLength).put("Mode", "LiuliuLivePCM-v1")
}

internal class CarPcmProcessor : BaseAudioProcessor() {
  override fun onConfigure(format: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
    if (format.encoding != C.ENCODING_PCM_16BIT && format.encoding != C.ENCODING_PCM_FLOAT) throw AudioProcessor.UnhandledAudioFormatException(format)
    CarPcmBuffer.configure(format.sampleRate, format.channelCount)
    return format
  }
  override fun onFlush() { CarPcmBuffer.flush() }
  override fun onQueueEndOfStream() { CarPcmBuffer.finish() }
  override fun queueInput(input: ByteBuffer) {
    val view = input.duplicate().order(ByteOrder.nativeOrder())
    val original = view.duplicate()
    if (CarPcmBuffer.enabled) {
      val bytes = if (inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT) {
        val converted = ByteBuffer.allocate(view.remaining() / 2).order(ByteOrder.LITTLE_ENDIAN)
        while (view.remaining() >= 4) {
          val sample = view.float
          converted.putShort(if (sample.isFinite()) (sample.coerceIn(-1f, 1f) * 32767).toInt().toShort() else 0)
        }; converted.array()
      } else ByteArray(view.remaining()).also { view.get(it) }
      CarPcmBuffer.offer(bytes)
    }
    val output = replaceOutputBuffer(input.remaining())
    if (CarPcmBuffer.enabled && CarPcmBuffer.remoteOnly) { repeat(input.remaining()) { output.put(0.toByte()) }; input.position(input.limit()) }
    else if (output === input) output.put(original)
    else output.put(input)
    output.flip()
  }
}
