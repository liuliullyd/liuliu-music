package com.liuliu.agentmusic

import java.io.ByteArrayOutputStream

/** Six-six UTF-8 newline protocol framing; BLE notification and RFCOMM read boundaries are irrelevant. */
internal class PeripheralFrames(private val maximum: Int = 8192) {
  private val pending = ByteArrayOutputStream()
  fun accept(bytes: ByteArray, frame: (String) -> Unit) {
    bytes.forEach { byte ->
      if (byte == 10.toByte()) { val text = pending.toString("UTF-8").removeSuffix("\r"); pending.reset(); if (text.isNotBlank()) frame(text) }
      else { require(pending.size() < maximum) { "外设帧超过$maximum 字节" }; pending.write(byte.toInt()) }
    }
  }
  fun clear() { pending.reset() }
}
