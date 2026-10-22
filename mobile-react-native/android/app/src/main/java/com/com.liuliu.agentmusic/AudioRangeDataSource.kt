package com.liuliu.agentmusic

import android.media.MediaDataSource
import java.io.IOException

/** On-demand, memory-only blocks. A cache bound is not a total download budget. */
internal class AudioRangeReader private constructor(
  val length: Long,
  private val load: (Long, Int) -> ByteArray,
  private val check: () -> Unit,
  private val blockSize: Int,
  prefix: ByteArray,
) {
  constructor(length: Long, load: (Long, Int) -> ByteArray, check: () -> Unit = {}) :
    this(length, load, check, BLOCK_SIZE, byteArrayOf())

  private val blocks = object : LinkedHashMap<Long, ByteArray>(16, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Long, ByteArray>?) = size > MAX_CACHE_BYTES / blockSize
  }
  // A partial prefix cannot represent a complete block: doing so could report
  // false EOF at its end even though the server has more audio bytes.
  init { if (prefix.size == blockSize) blocks[0L] = prefix.copyOf() }
  private var closed = false
  @Volatile var transportError: IOException? = null
    private set

  @Synchronized fun close() { closed = true; blocks.clear() }

  @Synchronized fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
    try {
      check()
      if (closed) throw IOException("音频数据源已关闭")
      if (size == 0) return 0
      if (position < 0 || (length >= 0 && position >= length)) return -1
      require(offset >= 0 && size >= 0 && offset <= buffer.size - size)
      val start = position / blockSize * blockSize
      val block = blocks[start] ?: load(start, blockSize).also { blocks[start] = it }
      check()
      val index = (position - start).toInt()
      if (index >= block.size) return -1
      val count = minOf(size, block.size - index)
      System.arraycopy(block, index, buffer, offset, count)
      return count
    } catch (error: IOException) {
      transportError = error
      throw error
    }
  }

  companion object {
    const val BLOCK_SIZE = 16 * 1024
    const val FOREGROUND_BLOCK_SIZE = 64 * 1024
    private const val MAX_CACHE_BYTES = 256 * 1024

    fun foreground(length: Long, load: (Long, Int) -> ByteArray, prefix: ByteArray) =
      AudioRangeReader(length, load, {}, FOREGROUND_BLOCK_SIZE, prefix)
  }
}

internal class AudioRangeDataSource(val reader: AudioRangeReader) : MediaDataSource() {
  override fun getSize() = reader.length
  override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int) = reader.readAt(position, buffer, offset, size)
  override fun close() = reader.close()
}
