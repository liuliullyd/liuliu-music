package com.liuliu.agentmusic

import java.io.File
import java.io.RandomAccessFile
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit

/** One bounded disk archive, readable while receiving the sole player's PCM. */
internal class CarPcmArchive(directory: File, private val maxBytes: Long = 268_435_456, queueCapacity: Int = 64) : AutoCloseable {
  private val io = Any()
  private val changed = Object()
  private var file: RandomAccessFile? = null
  private val queue = ArrayBlockingQueue<ByteArray>(queueCapacity)
  private val end = ByteArray(0)
  @Volatile private var closed = false
  @Volatile private var finishing = false
  @Volatile var available = 0L; private set
  @Volatile var total = -1L; private set
  @Volatile var failure: String? = null; private set
  private fun signal() = synchronized(changed) { changed.notifyAll() }
  private fun fail(message: String) { failure = message; queue.clear(); writer.interrupt(); signal() }
  private val writer = Thread({
    var path: File? = null
    try {
      path = File.createTempFile("liuliu-pcm-", ".session", directory)
      synchronized(io) { file = RandomAccessFile(path, "rw") }
      while (!closed) {
        val bytes = queue.take()
        if (bytes === end) { total = available; signal(); continue }
        check(total < 0) { "PCM归档已完成，须重新采集" }
        check(available + bytes.size <= maxBytes) { "PCM缓冲超过上限，消费端过慢或曲目过长，请重新采集" }
        synchronized(io) {
          if (closed) return@Thread
          file!!.seek(available); file!!.write(bytes); available += bytes.size
        }
        signal()
      }
    } catch (error: Exception) { if (!closed && failure == null) { failure = error.message ?: "PCM磁盘写入失败"; signal() } }
    finally { synchronized(io) { runCatching { file?.close() }; file = null }; path?.delete(); signal() }
  }, "LiuliuPcmArchive").apply { isDaemon = true; start() }
  fun append(bytes: ByteArray) {
    if (closed || failure != null) return
    if (finishing) { fail("PCM归档已结束，须重新采集"); return }
    if (!queue.offer(bytes)) fail("PCM归档队列已满，磁盘处理过慢，请重新采集")
  }
  fun finish() {
    if (closed || failure != null || finishing) return
    finishing = true
    if (!queue.offer(end)) fail("PCM归档队列已满，无法完成采集")
  }
  fun read(start: Long, length: Int): ByteArray? {
    if (closed || failure != null || start < 0 || length < 0 || start > Long.MAX_VALUE - length || start + length > available) return null
    return synchronized(io) {
      val input = file ?: return null
      if (closed || failure != null) return null
      ByteArray(length).also { input.seek(start); input.readFully(it) }
    }
  }
  /** Wait for a full block or actual EOS tail; reset/close wakes or cancels the wait. */
  fun await(start: Long, length: Int, timeoutMs: Long, active: () -> Boolean): ByteArray {
    require(start >= 0 && length > 0 && timeoutMs > 0)
    val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
    while (true) {
      if (closed || !active()) throw CarPcmFailure(108, "PCM采集代次已失效")
      failure?.let { throw CarPcmFailure(106, it) }
      val measured = total
      if (measured >= 0 && start >= measured) throw CarPcmFailure(107, "PCM包索引超过实际结束位置")
      val size = if (measured >= 0) minOf(length.toLong(), measured - start).toInt() else length
      if (available - start >= size) {
        val result = read(start, size)
        if (result != null && active()) return result
      }
      val remaining = deadline - System.nanoTime()
      if (remaining <= 0) throw CarPcmFailure(106, "PCM首包或后续数据等待超时，请在播放后重试")
      synchronized(changed) { changed.wait(minOf(50L, TimeUnit.NANOSECONDS.toMillis(remaining).coerceAtLeast(1))) }
    }
  }
  override fun close() {
    closed = true; queue.clear(); writer.interrupt(); signal()
  }
}

internal class CarPcmFailure(val code: Int, message: String) : IllegalStateException(message)
