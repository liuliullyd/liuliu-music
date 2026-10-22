package com.liuliu.agentmusic

/** Original stream precision, independent of MediaExtractor's PCM output format. */
internal data class FlacSourceMetadata(val bitsPerSample: Int, val sampleRate: Int) {
  companion object {
    fun read(bytes: ByteArray): FlacSourceMetadata? {
      var start = 0
      // A bounded prefix may contain an ID3 tag before the FLAC stream marker.
      while (start + 10 <= bytes.size && bytes[start] == 73.toByte() &&
        bytes[start + 1] == 68.toByte() && bytes[start + 2] == 51.toByte()) {
        var size = 0
        for (at in start + 6..start + 9) {
          val value = bytes[at].toInt() and 255
          if (value and 128 != 0) return null
          size = (size shl 7) or value
        }
        val footer = if (bytes[start + 3] == 4.toByte() && bytes[start + 5].toInt() and 16 != 0) 10 else 0
        val next = start.toLong() + 10L + size + footer
        if (next > bytes.size) return null
        start = next.toInt()
      }
      // STREAMINFO must be the first metadata block and must contain all 34 bytes.
      if (start + 42 > bytes.size || bytes[start] != 102.toByte() ||
        bytes[start + 1] != 76.toByte() || bytes[start + 2] != 97.toByte() ||
        bytes[start + 3] != 67.toByte() || bytes[start + 4].toInt() and 127 != 0 ||
        bytes[start + 5] != 0.toByte() || bytes[start + 6] != 0.toByte() ||
        bytes[start + 7] != 34.toByte()) return null
      var packed = 0L
      for (at in start + 18..start + 25) packed = (packed shl 8) or (bytes[at].toLong() and 255L)
      val rate = (packed ushr 44).toInt()
      val bits = ((packed ushr 36) and 31L).toInt() + 1
      if (rate !in 1..655350 || bits !in 4..32) return null
      return FlacSourceMetadata(bits, rate)
    }
  }
}
