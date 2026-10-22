package com.liuliu.agentmusic

import androidx.media3.common.C
import java.nio.ByteBuffer
import java.util.concurrent.Executors
import java.util.concurrent.ExecutorService

/** Process-only PCM observer owned exclusively by the visible effects detail. */
internal object EffectSpectrumObserver {
  @Volatile private var engine: EffectSpectrumEngine? = null
  private var worker: ExecutorService? = null
  @Volatile private var lastPublishNanos = 0L
  private var lastLogNanos = 0L
  @Volatile var frame: EffectSpectrumEngine.Frame? = null
    private set
  @Volatile var sampleRate = 48000
    private set
  val observing: Boolean get() = engine != null

  @Synchronized fun enable(enabled: Boolean) {
    if (enabled == observing) return
    engine = null; frame = null; lastPublishNanos = 0L
    android.util.Log.d("LiuliuEffectSpectrum", "observing=$enabled")
    worker?.shutdownNow(); worker = null
    if (enabled) {
      worker = Executors.newSingleThreadExecutor { task -> Thread(task, "LiuliuEffectSpectrum").apply { isDaemon = true } }
      engine = EffectSpectrumEngine()
    }
  }
  fun configure(rate: Int) { sampleRate = rate; clear() }
  @Synchronized fun clear() { frame = null; engine?.clear() }
  fun input(buffer: ByteBuffer, encoding: Int, rate: Int, channels: Int) {
    engine?.offerInput(buffer, encoding == C.ENCODING_PCM_FLOAT, rate, channels)
  }
  @Synchronized fun output(buffer: ByteBuffer, encoding: Int) {
    val current = engine ?: return
    if (!current.offerOutput(buffer, encoding == C.ENCODING_PCM_FLOAT)) return
    try {
      worker?.execute {
        val delay = lastPublishNanos + 100_000_000L - System.nanoTime()
        if (delay > 0) java.util.concurrent.locks.LockSupport.parkNanos(delay)
        if (Thread.currentThread().isInterrupted || engine !== current) return@execute
        val result = current.analyze()
        synchronized(this) {
          if (engine === current && result != null && current.isCurrent(result)) {
            frame = result; lastPublishNanos = result.timestampNanos
            if (result.timestampNanos - lastLogNanos >= 1_000_000_000L) {
              lastLogNanos = result.timestampNanos
              android.util.Log.d("LiuliuEffectSpectrum", "frame rate=${result.sampleRate} bands=${result.frequencies.size} inputPeak=${result.inputDb.maxOrNull()} outputPeak=${result.outputDb.maxOrNull()}")
            }
          }
        }
      }
    } catch (_: java.util.concurrent.RejectedExecutionException) { /* Page closed during observation. */ }
  }
  fun freshFrame(): EffectSpectrumEngine.Frame? = frame?.takeIf {
    observing && System.nanoTime() - it.timestampNanos <= 600_000_000L
  }
}
