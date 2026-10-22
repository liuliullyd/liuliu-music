package com.liuliu.agentmusic

import androidx.media3.common.C
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs

/** Read-only PCM observation: never moves the source cursor or writes a sample. */
internal object DesktopLyricsWaveform {
  @Volatile var observing = false
  @Volatile var bars = FloatArray(32)
  fun observe(input: ByteBuffer, encoding: Int) {
    if (!observing || !input.hasRemaining()) return
    val bytes = if (encoding == C.ENCODING_PCM_FLOAT) 4 else 2
    val snapshot = input.duplicate().order(ByteOrder.nativeOrder())
    val count = snapshot.remaining() / bytes
    if (count == 0) return
    val result = FloatArray(32)
    // Bounded samples per sink buffer. No microphone, FFT or audio transformation.
    for (index in result.indices) {
      val offset = snapshot.position() + ((index.toLong() * count / result.size).toInt().coerceAtMost(count - 1)) * bytes
      result[index] = abs(if (bytes == 4) snapshot.getFloat(offset) else snapshot.getShort(offset) / 32768f).coerceIn(0f, 1f)
    }
    bars = result
  }
}
