package com.liuliu.agentmusic

import android.util.Log
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Always admitted to the sink; legacy presets pass through byte for byte.
 * Selecting a profile updates parameters without flushing or rebuilding audio. */
class TuningAudioProcessor : BaseAudioProcessor() {
  @Volatile private var requested: TenBandTuning.Profile? = null
  private var applied: TenBandTuning.Profile? = null
  private var kernel: TenBandTuning.Kernel? = null
  private var previous: TenBandTuning.Kernel? = null
  private var transitionFrames = 0
  private var transitionLength = 1
  private var aliasScratch = ByteBuffer.allocateDirect(0).order(ByteOrder.nativeOrder())
  private var frame = DoubleArray(0)
  private var oldFrame = DoubleArray(0)
  @Volatile var warning: String? = null
    private set
  @Volatile private var loudnessAmount = 1.0
  private var appliedAmount = 1.0
  val needsLoudnessVolume: Boolean get() = requested?.dsp?.loudness == true
  fun updateLoudnessVolume(attenuationDb: Double, muted: Boolean) {
    loudnessAmount = EffectDspSettings.loudnessAmount(attenuationDb, muted)
  }

  fun select(profile: TenBandTuning.Profile?) {
    if(inputAudioFormat.sampleRate>0 && profile!=null)
      require(profile.headphoneFilters.none { it.frequency>=inputAudioFormat.sampleRate/2.0 }) { "当前音轨采样率不足，无法准确应用该耳机 PEQ；当前音效保持不变" }
    if (requested != profile) { requested = profile; EffectSpectrumObserver.clear() }
  }
  private fun buildKernel(profile: TenBandTuning.Profile, amount: Double): TenBandTuning.Kernel {
    val rate=inputAudioFormat.sampleRate
    val usable=if(profile.headphoneFilters.any { it.frequency>=rate/2.0 }) {
      warning="该音轨采样率不足，耳机校准暂时停用；均衡器与高级设置保留"
      Log.w("LiuliuPlayerDiagnostics",warning!!)
      TenBandTuning.configured(profile.gains(),profile.clarity,profile.reverb,profile.surround,profile.bass,profile.dynamics,profile.mode,emptyArray(),0.0,profile.dsp)
    } else { warning=null;profile }
    return TenBandTuning.Kernel(usable,rate,inputAudioFormat.channelCount,amount)
  }

  override fun onConfigure(format: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
    if (format.encoding != C.ENCODING_PCM_16BIT && format.encoding != C.ENCODING_PCM_FLOAT)
      throw AudioProcessor.UnhandledAudioFormatException(format)
    EffectSpectrumObserver.configure(format.sampleRate)
    return format
  }

  override fun onFlush() {
    EffectSpectrumObserver.clear()
    applied = requested
    appliedAmount = if(applied?.dsp?.loudness == true) loudnessAmount else 1.0
    kernel = applied?.let { buildKernel(it,appliedAmount) }
    previous = null
    transitionFrames = 0
  }

  override fun queueInput(input: ByteBuffer) {
    DesktopLyricsWaveform.observe(input, inputAudioFormat.encoding)
    EffectSpectrumObserver.input(input, inputAudioFormat.encoding, inputAudioFormat.sampleRate, inputAudioFormat.channelCount)
    val profile = requested
    val amount = if(profile?.dsp?.loudness == true) loudnessAmount else 1.0
    if (applied !== profile || kotlin.math.abs(amount-appliedAmount) > 0.0001) {
      previous = kernel
      kernel = profile?.let { buildKernel(it,amount).also { next -> next.copyState(previous) } }
      applied = profile
      appliedAmount = amount
      transitionLength = (inputAudioFormat.sampleRate / 50).coerceAtLeast(1)
      transitionFrames = transitionLength
      Log.i("LiuliuPlayerDiagnostics", "tuning-applied profile=${profile?.name ?: "legacy"} bands=${if (profile == null) 0 else 10} peq=${profile?.headphoneFilters?.size ?: 0} clarity=${profile?.clarity ?: 0} reverb=${profile?.reverb ?: 0} surround=${profile?.surround ?: 0} bass=${profile?.bass ?: 0} dynamics=${profile?.dynamics ?: 0} width=${profile?.dsp?.width ?: 0} preamp=${profile?.dsp?.preampDb ?: 0} ratio=${profile?.dsp?.ratio ?: 1} loudness=$amount rate=${inputAudioFormat.sampleRate}")
    }
    // Media3 may hand the processor its previous output buffer again. BaseAudioProcessor
    // clears that buffer inside replaceOutputBuffer(), so keep the source bounds before
    // asking for output and explicitly handle the input/output alias on Android 12.
    val inputPosition = input.position()
    val inputLimit = input.limit()
    val sourceSnapshot = input.duplicate().order(ByteOrder.nativeOrder())
    val output = replaceOutputBuffer(inputLimit - inputPosition).order(ByteOrder.nativeOrder())
    val aliased = output === input
    if (aliased && kernel == null && transitionFrames == 0) {
      // The legacy/Flat path is byte-for-byte pass-through. Publishing the restored
      // buffer avoids ByteBuffer.put() rejecting a self-copy on API 32.
      output.position(inputPosition)
      output.limit(inputLimit)
      EffectSpectrumObserver.output(output, inputAudioFormat.encoding)
      return
    }
    val source = if (aliased) snapshotAliasedInput(sourceSnapshot) else input
    if (kernel == null && transitionFrames == 0) {
      output.put(source)
    } else {
      source.order(ByteOrder.nativeOrder())
      val channels = inputAudioFormat.channelCount
      val floating = inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT
      if (frame.size != channels) { frame=DoubleArray(channels); oldFrame=DoubleArray(channels) }
      while (source.remaining() >= inputAudioFormat.bytesPerFrame) {
        val mix = if (transitionFrames > 0) 1.0 - transitionFrames.toDouble() / transitionLength else 1.0
        for (channel in 0 until channels) {
          val sample = if (floating) source.float.toDouble() else source.short.toDouble() / 32768
          frame[channel]=sample; oldFrame[channel]=sample
        }
        kernel?.processFrame(frame)
        if(transitionFrames>0) previous?.processFrame(oldFrame)
        for(channel in 0 until channels) {
          var tuned=frame[channel]
          if (transitionFrames > 0) {
            val old = oldFrame[channel]
            tuned = old + (tuned - old) * mix
          }
          if (floating) output.putFloat(tuned.toFloat())
          else output.putShort(Math.round(tuned * 32768).coerceIn(-32768L, 32767L).toShort())
        }
        if (transitionFrames > 0 && --transitionFrames == 0) previous = null
      }
      check(!source.hasRemaining()) { "Incomplete PCM frame" }
    }
    output.flip()
    EffectSpectrumObserver.output(output, inputAudioFormat.encoding)
  }

  private fun snapshotAliasedInput(source: ByteBuffer): ByteBuffer {
    val size = source.remaining()
    if (aliasScratch.capacity() < size) {
      aliasScratch = ByteBuffer.allocateDirect(size).order(ByteOrder.nativeOrder())
    } else {
      aliasScratch.clear()
    }
    aliasScratch.put(source)
    aliasScratch.flip()
    return aliasScratch
  }

  override fun onReset() {
    EffectSpectrumObserver.clear()
    applied = null
    kernel = null
    previous = null
    transitionFrames = 0
  }
}
