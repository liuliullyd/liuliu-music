package com.liuliu.agentmusic

import android.app.PendingIntent
import android.content.Intent
import android.content.Context
import android.media.AudioManager
import android.media.AudioDeviceInfo
import android.os.Handler
import android.os.Looper
import android.media.audiofx.DynamicsProcessing
import android.media.audiofx.Equalizer
import android.os.Build
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionParameters
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.exoplayer.audio.ForwardingAudioSink
import androidx.media3.common.PlaybackException
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.DefaultMediaNotificationProvider
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONArray

class MusicPlaybackService : MediaLibraryService() {
  private var session: MediaLibrarySession? = null
  private var mediaNotificationController: MediaNotificationController? = null
  private var stopLibraryChanges: (() -> Unit)? = null
  private lateinit var player: ExoPlayer
  private var normalizer: DynamicsProcessing? = null
  private var equalizer: Equalizer? = null
  private val tuningProcessor = TuningAudioProcessor()
  private val effectVolumeHandler = Handler(Looper.getMainLooper())
  private val effectVolumeMonitor = object : Runnable {
    override fun run() {
      if(!tuningProcessor.needsLoudnessVolume)return
      updateEffectVolume()
      effectVolumeHandler.postDelayed(this,250)
    }
  }
  private var softwareDynamics = false
  private var requestedEqualizer = "Flat"
  private var requestedAudioFocus = true
  private var failures = 0
  private var expiredFailures = 0
  internal data class UrlRecovery(
    val token: String, val mediaId: String, val positionMs: Long,
    var resume: Boolean, var status: String = "pending", var nativeFallback: Boolean = true,
  )
  private var urlRecovery: UrlRecovery? = null

  companion object {
    private var active: MusicPlaybackService? = null
    fun isNotificationPlaybackActive(): Boolean = active?.player?.isPlaying == true
    fun refreshMediaNotification() { active?.mediaNotificationController?.refresh() }
    private val recoverySequence = AtomicLong()
    internal fun recovery(mediaId: String?): UrlRecovery? = active?.let { service ->
      service.urlRecovery?.takeIf { it.mediaId == mediaId && service.player.currentMediaItem?.mediaId == mediaId }
    }
    fun cancelUrlRecovery() { active?.let { it.urlRecovery = null; it.expiredFailures = 0 } }
    fun resumeExpiredUrl(): Boolean = active?.let { service ->
      if (service.urlRecovery?.status == "pending") {
        service.urlRecovery?.resume = true
        true
      } else if (isExpiredUrl(service.player.playerError)) {
        service.captureExpiredUrl(true)
        true
      } else false
    } ?: false
    fun replaceExpiredUrl(token: String, item: androidx.media3.common.MediaItem, nativeFallback: Boolean) {
      val service = checkNotNull(active) { "播放地址恢复已取消" }
      val recovery = checkNotNull(service.urlRecovery) { "播放地址恢复已取消" }
      check(recovery.token == token && recovery.status == "pending" && recovery.resume &&
        service.player.currentMediaItem?.mediaId == recovery.mediaId && item.mediaId == recovery.mediaId) { "播放地址恢复已取消" }
      recovery.status = "retrying"
      recovery.nativeFallback = nativeFallback
      val index = service.player.currentMediaItemIndex
      service.player.replaceMediaItem(index, item)
      service.player.seekTo(index, recovery.positionMs)
      service.player.prepare()
      service.player.play()
      Log.i("LiuliuPlayerDiagnostics", "expired-url-retry token=$token positionMs=${recovery.positionMs}")
    }
    fun failExpiredUrlRecovery(token: String, nativeFallback: Boolean) {
      val service = active ?: return
      val recovery = service.urlRecovery ?: return
      if (recovery.token != token || recovery.status == "failed" ||
        service.player.currentMediaItem?.mediaId != recovery.mediaId) return
      recovery.status = "failed"
      service.fallbackAfterError(recovery.resume && nativeFallback && service.expiredFailures++ < 6)
    }
    private fun isExpiredUrl(error: Throwable?): Boolean {
      var cause = error
      repeat(12) {
        if (cause is HttpDataSource.InvalidResponseCodeException && cause.responseCode == 410) return true
        cause = cause?.cause ?: return false
      }
      return false
    }
    fun setNormalization(enabled: Boolean) { active?.applyNormalization(enabled) }
    val audioEffectWarning: String? get() = active?.tuningProcessor?.warning
    fun setAudioFocus(enabled: Boolean) { active?.applyAudioFocus(enabled) }
    fun setEqualizer(preset: String): Boolean {
      val service = active ?: return true
      service.requestedEqualizer = preset
      return service.applyEqualizer(preset)
    }
    fun setCustomEqualizer(gains: DoubleArray, configuration: String = "{}"): Boolean {
      val profile = AudioEffectConfiguration.profile(gains,configuration)
      val service = active ?: return true
      service.tuningProcessor.select(profile)
      service.synchronizeEffectVolume()
      service.synchronizeSoftwareDynamics(profile)
      service.equalizer?.release()
      service.equalizer = null
      service.requestedEqualizer = "Custom"
      return true
    }
  }

  override fun onCreate() {
    super.onCreate()
    active = this
    setMediaNotificationProvider(DefaultMediaNotificationProvider(this).apply {
      setSmallIcon(R.drawable.ic_notification_music)
    })
    val playerPreferences = getSharedPreferences("liuliu_player", MODE_PRIVATE)
    requestedAudioFocus = if (playerPreferences.contains("handle_audio_focus"))
      playerPreferences.getBoolean("handle_audio_focus", false)
    else
      // Before the semantic fix this key stored the UI value, so migrate it
      // as the inverse of Media3's handleAudioFocus flag.
      !playerPreferences.getBoolean("interrupt_playback", true)
    val httpDataSource = OkHttpDataSource.Factory(AudioNetwork.playbackClient)
      .setUserAgent(AudioNetwork.USER_AGENT)
    val renderers = object : DefaultRenderersFactory(this) {
      override fun buildAudioSink(context: Context, enableFloatOutput: Boolean,
        enableAudioOutputPlaybackParameters: Boolean): AudioSink =
        object : ForwardingAudioSink(DefaultAudioSink.Builder(context)
          // Media3's float/passthrough path can bypass custom processors.
          // Keep decoded PCM on the existing processor chain for all effect switches.
          .setEnableFloatOutput(false)
          .setEnableAudioOutputPlaybackParameters(enableAudioOutputPlaybackParameters)
          .setAudioProcessors(arrayOf(tuningProcessor))
          .build()) {
            override fun getFormatSupport(format: Format): Int =
              if(format.sampleMimeType==MimeTypes.AUDIO_RAW) super.getFormatSupport(format) else AudioSink.SINK_FORMAT_UNSUPPORTED
            override fun supportsFormat(format: Format): Boolean = getFormatSupport(format)!=AudioSink.SINK_FORMAT_UNSUPPORTED
          }
    }
    player = ExoPlayer.Builder(this, renderers)
      .setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(this, httpDataSource)))
      .build().apply {
      trackSelectionParameters=trackSelectionParameters.buildUpon().setAudioOffloadPreferences(
        TrackSelectionParameters.AudioOffloadPreferences.Builder().setAudioOffloadMode(
          TrackSelectionParameters.AudioOffloadPreferences.AUDIO_OFFLOAD_MODE_DISABLED).build()).build()
      setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), requestedAudioFocus)
      setHandleAudioBecomingNoisy(true)
      repeatMode = Player.REPEAT_MODE_OFF
      addListener(object : Player.Listener {
        override fun onMediaItemTransition(mediaItem: androidx.media3.common.MediaItem?, reason: Int) {
          if (mediaItem?.mediaId != urlRecovery?.mediaId) urlRecovery = null
          failures = 0
          if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO &&
            !getSharedPreferences("liuliu_player", MODE_PRIVATE).getBoolean("auto_next", true)) {
            pause()
          }
        }
        override fun onPlayerError(error: PlaybackException) {
          Log.w("LiuliuPlayerDiagnostics", "service-player-error code=${error.errorCode} type=${error.javaClass.simpleName} causeType=${error.cause?.javaClass?.simpleName} state=$playbackState playing=$isPlaying index=$currentMediaItemIndex")
          val recovery = urlRecovery
          if (recovery != null && recovery.mediaId == currentMediaItem?.mediaId && recovery.status == "retrying") {
            recovery.status = "failed"
            fallbackAfterError(recovery.resume && recovery.nativeFallback && expiredFailures++ < 6)
          } else if (isExpiredUrl(error)) {
            captureExpiredUrl(playWhenReady)
          } else fallbackAfterError(true)
        }
        override fun onIsPlayingChanged(isPlaying: Boolean) {
          if (isPlaying) { urlRecovery = null; expiredFailures = 0 }
        }
        override fun onVolumeChanged(volume: Float) { updateEffectVolume() }
        override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) {
        }
        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
          if (!playWhenReady && urlRecovery?.status != "failed") urlRecovery = null
        }
        override fun onAudioSessionIdChanged(audioSessionId: Int) {
          applyNormalization(
            getSharedPreferences("liuliu_player", MODE_PRIVATE)
              .getBoolean("normalize", false),
          )
          requestedEqualizer = getSharedPreferences("liuliu_player", MODE_PRIVATE)
            .getString("equalizer", "Flat") ?: "Flat"
          applyEqualizer(requestedEqualizer)
        }
      })
    }
    val intent = packageManager.getLaunchIntentForPackage(packageName)
    CarConnectionState.player = player
    CarConnections.initialize(applicationContext)
    CarConnections.bluetooth?.restore()
    val pending = intent?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
    val lyricsSessionPlayer = DesktopLyricsSessionPlayer(player)
    val notification = MediaNotificationController(this, player, lyricsSessionPlayer)
    mediaNotificationController = notification
    val library = CarMediaLibrary(notification)
    session = MediaLibrarySession.Builder(this, notification.sessionPlayer, library)
      .apply { if (pending != null) setSessionActivity(pending) }.build()
    val librarySession = requireNotNull(session)
    stopLibraryChanges = CarLibraryState.observeChanges { availabilityChanged ->
      effectVolumeHandler.post {
        if (session === librarySession) library.notifyChanged(librarySession, availabilityChanged)
      }
    }
    notification.attach(requireNotNull(session))
    DesktopLyricsOverlay.attach(player, lyricsSessionPlayer::setLyric)
    Log.i("LiuliuPlayerDiagnostics", "service-created")
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session
  private fun captureExpiredUrl(resume: Boolean) {
    val mediaId = player.currentMediaItem?.mediaId ?: return
    urlRecovery = UrlRecovery(recoverySequence.incrementAndGet().toString(), mediaId,
      player.currentPosition.coerceAtLeast(0), resume)
    Log.i("LiuliuPlayerDiagnostics", "expired-url-pending token=${urlRecovery?.token} positionMs=${player.currentPosition} resume=$resume")
  }
  private fun fallbackAfterError(allowAdvance: Boolean) {
    if (allowAdvance && player.hasNextMediaItem() && failures++ < 6) {
      player.stop(); player.seekToNextMediaItem(); player.prepare(); player.play()
    } else player.pause()
  }
  override fun onTaskRemoved(rootIntent: Intent?) { DesktopLyricsOverlay.closeForExit(); if (session?.player?.isPlaying != true) stopSelf() }
  private fun applyAudioFocus(enabled: Boolean) {
    requestedAudioFocus = enabled
    player.setAudioAttributes(
      AudioAttributes.Builder()
        .setUsage(C.USAGE_MEDIA)
        .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
        .build(),
      enabled,
    )
  }
  private fun applyNormalization(enabled: Boolean) {
    normalizer?.release()
    normalizer = null
    if (!enabled || softwareDynamics || Build.VERSION.SDK_INT < Build.VERSION_CODES.P ||
      player.audioSessionId == C.AUDIO_SESSION_ID_UNSET) return
    try {
      val compressor = DynamicsProcessing.Mbc(true, true, 1).apply {
        setBand(0, DynamicsProcessing.MbcBand(
          true, 20_000f, 3f, 80f, 4f, -24f, 6f, -90f, 1f, 0f, 0f,
        ))
      }
      val limiter = DynamicsProcessing.Limiter(
        true, true, 0, 1f, 60f, 10f, -1f, 0f,
      )
      val config = DynamicsProcessing.Config.Builder(
        DynamicsProcessing.VARIANT_FAVOR_TIME_RESOLUTION,
        2,
        false,
        0,
        true,
        1,
        false,
        0,
        true,
      ).setMbcAllChannelsTo(compressor)
        .setLimiterAllChannelsTo(limiter)
        .build()
      normalizer = DynamicsProcessing(0, player.audioSessionId, config).apply {
        setEnabled(true)
      }
    } catch (_: Throwable) {
      normalizer?.release()
      normalizer = null
    }
  }
  private fun applyEqualizer(preset: String): Boolean {
    if (player.audioSessionId == C.AUDIO_SESSION_ID_UNSET) return true
    var candidate: Equalizer? = null
    try {
      val tuned = if (preset == "Custom") {
        val stored = JSONArray(getSharedPreferences("liuliu_player", MODE_PRIVATE)
          .getString("custom_equalizer_gains", "[0,0,0,0,0,0,0,0,0,0]"))
        AudioEffectConfiguration.profile(DoubleArray(stored.length()) { stored.getDouble(it) },
          getSharedPreferences("liuliu_player",MODE_PRIVATE).getString("custom_equalizer_configuration","{}") ?: "{}")
      } else TenBandTuning.preset(preset)
      if (tuned != null) {
        tuningProcessor.select(tuned)
        synchronizeEffectVolume()
        synchronizeSoftwareDynamics(tuned)
        equalizer?.release()
        equalizer = null
        return true
      }
      val gains = mapOf(
        "Flat" to intArrayOf(0, 0, 0, 0, 0, 0),
        "Pop" to intArrayOf(-1, 2, 4, 3, 1, -1),
        "Rock" to intArrayOf(4, 3, -1, 1, 3, 4),
        "Classical" to intArrayOf(3, 2, 0, -1, 1, 3),
        "Jazz" to intArrayOf(3, 2, 1, 2, 3, 2),
        "Bass Boost" to intArrayOf(7, 5, 3, 0, -1, -2),
        "Vocal" to intArrayOf(-2, -1, 3, 5, 3, -1),
        "DTS 风格" to intArrayOf(4, 2, 0, 2, 4, 5),
        "蝰蛇风格" to intArrayOf(6, 3, -1, 1, 4, 6),
        "电影" to intArrayOf(3, 1, -1, 2, 4, 3),
        "舞曲" to intArrayOf(5, 4, 1, 2, 4, 5),
        "原声" to intArrayOf(2, 1, 0, 1, 2, 2),
        "清晰人声" to intArrayOf(-2, -1, 3, 6, 4, 0),
        "深沉低音" to intArrayOf(8, 6, 3, 0, -2, -3),
        "现场空间" to intArrayOf(5, 3, 0, 2, 5, 6),
        "游戏空间" to intArrayOf(4, 2, 1, 4, 5, 4),
        "夜间聆听" to intArrayOf(-3, -2, 1, 2, 1, -2),
      )[preset] ?: intArrayOf(0, 0, 0, 0, 0, 0)
      val effect = Equalizer(0, player.audioSessionId)
      candidate = effect
      val range = effect.bandLevelRange
      val bandCount = effect.numberOfBands.toInt().coerceAtLeast(1)
      for (band in 0 until bandCount) {
        val gainIndex = if (bandCount <= 1) 0
          else band * (gains.size - 1) / (bandCount - 1)
        val millibels = (gains[gainIndex] * 100).coerceIn(range[0].toInt(), range[1].toInt())
        effect.setBandLevel(band.toShort(), millibels.toShort())
      }
      effect.enabled = preset != "Flat"
      tuningProcessor.select(null)
      synchronizeEffectVolume()
      synchronizeSoftwareDynamics(null)
      equalizer?.release()
      equalizer = effect
      return true
    } catch (_: Throwable) {
      candidate?.release()
      return false
    }
  }
  private fun synchronizeSoftwareDynamics(profile: TenBandTuning.Profile?) {
    val ownsDynamics=profile!=null && (profile.dsp.ratio>1 || profile.headphoneFilters.isNotEmpty())
    if(softwareDynamics==ownsDynamics)return
    softwareDynamics=ownsDynamics
    applyNormalization(getSharedPreferences("liuliu_player",MODE_PRIVATE).getBoolean("normalize",false))
  }
  private fun synchronizeEffectVolume() {
    effectVolumeHandler.removeCallbacks(effectVolumeMonitor)
    if(tuningProcessor.needsLoudnessVolume)effectVolumeMonitor.run()
  }
  private fun updateEffectVolume() {
    if(!tuningProcessor.needsLoudnessVolume||!::player.isInitialized)return
    val manager=getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val index=manager.getStreamVolume(AudioManager.STREAM_MUSIC)
    val maximum=manager.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
    val appGain=player.volume.toDouble()
    val muted=index==0||appGain<=0||manager.isStreamMute(AudioManager.STREAM_MUSIC)
    var systemDb=20*kotlin.math.log10((index.toDouble()/maximum).coerceAtLeast(.00001))
    // Relative device attenuation improves the estimate; it is never presented as ear SPL.
    if(Build.VERSION.SDK_INT>=28)try {
      val devices=manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
      val type=devices.firstOrNull { it.type==AudioDeviceInfo.TYPE_BLUETOOTH_A2DP }?.type
        ?: devices.firstOrNull { it.type==AudioDeviceInfo.TYPE_WIRED_HEADPHONES||it.type==AudioDeviceInfo.TYPE_WIRED_HEADSET||it.type==AudioDeviceInfo.TYPE_USB_HEADSET }?.type
        ?: AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
      val current=manager.getStreamVolumeDb(AudioManager.STREAM_MUSIC,index,type).toDouble()
      val reference=manager.getStreamVolumeDb(AudioManager.STREAM_MUSIC,maximum,type).toDouble()
      if(current.isFinite()&&reference.isFinite())systemDb=current-reference
    } catch(_: Throwable) { /* Retain the explicitly approximate volume-index estimate. */ }
    val attenuation=systemDb+20*kotlin.math.log10(appGain.coerceAtLeast(.00001))
    tuningProcessor.updateLoudnessVolume(attenuation,muted)
  }
  override fun onDestroy() {
    CarConnections.close()
    CarConnectionState.player = null
    stopLibraryChanges?.invoke()
    stopLibraryChanges = null
    mediaNotificationController?.close()
    mediaNotificationController = null
    effectVolumeHandler.removeCallbacks(effectVolumeMonitor)
    DesktopLyricsOverlay.detach()
    Log.i("LiuliuPlayerDiagnostics", "service-destroyed state=${player.playbackState} playing=${player.isPlaying} index=${player.currentMediaItemIndex}")
    normalizer?.release()
    normalizer = null
    equalizer?.release()
    equalizer = null
    active = null
    session?.run { player.release(); release() }
    session = null
    super.onDestroy()
  }
}
