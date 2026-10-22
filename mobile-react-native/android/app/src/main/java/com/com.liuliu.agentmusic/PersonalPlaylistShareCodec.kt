package com.liuliu.agentmusic

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.zip.DeflaterOutputStream
import java.util.zip.InflaterInputStream

/** Standard zlib transport only. Limits apply before and during decompression. */
internal object PersonalPlaylistShareCodec {
  private const val maxChars = 250000
  private const val maxBytes = 1000000
  fun compress(text: String): ByteArray {
    require(text.isNotBlank() && text.length <= maxChars)
    val output = ByteArrayOutputStream()
    DeflaterOutputStream(output).use { it.write(text.toByteArray(Charsets.UTF_8)) }
    return output.toByteArray()
  }
  fun expand(bytes: ByteArray): String {
    require(bytes.isNotEmpty() && bytes.size <= maxChars)
    val output = ByteArrayOutputStream()
    InflaterInputStream(ByteArrayInputStream(bytes)).use { input ->
      val buffer = ByteArray(4096)
      while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        require(output.size() + count <= maxBytes) { "Playlist output too large" }
        output.write(buffer, 0, count)
      }
    }
    val result = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
      .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(output.toByteArray())).toString()
    require(result.isNotBlank() && result.length <= maxChars)
    return result
  }
}
