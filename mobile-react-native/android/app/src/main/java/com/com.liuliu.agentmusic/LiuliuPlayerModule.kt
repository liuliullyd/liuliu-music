package com.liuliu.agentmusic

import android.content.ComponentName
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.common.LifecycleState
import com.google.common.util.concurrent.ListenableFuture
import java.util.concurrent.TimeUnit
import java.net.HttpURLConnection
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

class LiuliuPlayerModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val main = Handler(Looper.getMainLooper())
  private val commandSequence = AtomicLong()
  private var lastDiagnosticState = ""
  private var progressSequence = 0L
  private data class PreviousItem(val sequence: Long, val mediaId: String, val position: Long, val duration: Long, val completed: Boolean)
  private var previousItem: PreviousItem? = null
  private val observedDurations = linkedMapOf<String, Long>()
  private val future: ListenableFuture<MediaController> = MediaController.Builder(context, SessionToken(context, ComponentName(context, MusicPlaybackService::class.java)))
    .setListener(object : MediaController.Listener {
      override fun onDisconnected(controller: MediaController) {
        diagnose("disconnected", controller)
      }
    }).buildAsync()
  private var listenerAttached = false
  private var sleepMode = "off"
  private var sleepDeadline = 0L
  private var sleepTask: Runnable? = null
  private var listeners = 0
  private val imageExecutor = Executors.newCachedThreadPool()
  private val mediaTasks = ReactRequestTasks(context, "navigation")
  private val mediaNotificationSink: (String, String) -> Boolean = { action, mediaId ->
    if (context.hasActiveReactInstance() && listeners > 0) {
      val payload = Arguments.createMap().apply {
        putString("action", action); putString("mediaId", mediaId)
        putString("requestId", MediaNotificationState.sequence.incrementAndGet().toString())
      }
      mediaTasks.start("mediaNotificationAction", payload, payload.getString("requestId").orEmpty()) {
        Log.w("LiuliuCarTask", "navigation task could not start")
      }
    } else false
  }
  private val spectrumLifecycle = object : LifecycleEventListener {
    override fun onHostResume() {}
    override fun onHostPause() { EffectSpectrumObserver.enable(false) }
    override fun onHostDestroy() { EffectSpectrumObserver.enable(false) }
  }

  override fun getName() = "LiuliuPlayer"
  @ReactMethod fun completeMediaNotificationAction(requestId: String) { mediaTasks.finish(requestId) }
  init {
    MediaNotificationState.actionSink = mediaNotificationSink
    context.addLifecycleEventListener(spectrumLifecycle)
    withController(action = { controller -> attach(controller); emit(controller) })
  }

  @ReactMethod fun setEffectSpectrumObserving(enabled: Boolean, promise: Promise) {
    main.post {
      EffectSpectrumObserver.enable(enabled && context.lifecycleState == LifecycleState.RESUMED)
      promise.resolve(null)
    }
  }

  @ReactMethod fun getEffectSpectrum(promise: Promise) {
    main.post {
      val playing = context.lifecycleState == LifecycleState.RESUMED && MusicPlaybackService.isNotificationPlaybackActive()
      if (!playing) EffectSpectrumObserver.clear()
      val frame = if (playing) EffectSpectrumObserver.freshFrame() else null
      promise.resolve(Arguments.createMap().apply {
        putBoolean("active", frame != null)
        putInt("sampleRate", frame?.sampleRate ?: EffectSpectrumObserver.sampleRate)
        if (frame != null) {
          putDouble("sequence", frame.timestampNanos / 1_000_000.0)
          for ((name, values) in listOf("frequencies" to frame.frequencies, "inputDb" to frame.inputDb, "outputDb" to frame.outputDb))
            putArray(name, Arguments.createArray().apply { values.forEach { pushDouble(it) } })
        }
      })
    }
  }

  /** Preview response uses the exact production PEQ coefficients and never selects an effect. */
  @ReactMethod fun getHeadphoneEqResponse(calibration: ReadableMap?, promise: Promise) {
    try {
      val json = org.json.JSONObject()
      if (calibration != null) json.put("headphone", org.json.JSONObject(calibration.toHashMap()))
      val profile = AudioEffectConfiguration.profile(DoubleArray(10), json.toString())
      val rate = EffectSpectrumObserver.sampleRate
      require(profile.headphoneFilters.none { it.frequency >= rate / 2.0 })
      val engine = HeadphoneDspEngine(profile.headphoneFilters, rate, 1)
      val upper = minOf(20000.0, rate / 2.0)
      promise.resolve(Arguments.createMap().apply {
        putInt("sampleRate", rate)
        putDouble("preampDb", profile.preampDb)
        putArray("frequencies", Arguments.createArray().apply {
          for (i in 0 until 64) pushDouble(20 * Math.pow(upper / 20, i / 63.0))
        })
        putArray("correctionDb", Arguments.createArray().apply {
          for (i in 0 until 64) pushDouble(20 * Math.log10(engine.magnitude(20 * Math.pow(upper / 20, i / 63.0), rate)))
        })
      })
    } catch (error: Throwable) { promise.reject("EFFECT_RESPONSE", "当前采样率无法准确展示该 PEQ 修正", error) }
  }

  @ReactMethod fun setMediaNotificationNavigation(mediaId: String?, previous: Boolean, next: Boolean, promise: Promise) {
    main.post {
      MediaNotificationState.navigation = MediaNotificationNavigation(mediaId, previous, next)
      MusicPlaybackService.refreshMediaNotification()
      promise.resolve(null)
    }
  }
  @ReactMethod fun beginMediaNotificationLyrics(mediaId: String?, generation: String, promise: Promise) {
    main.post {
      MediaNotificationState.lyrics.begin(mediaId, generation)
      MusicPlaybackService.refreshMediaNotification()
      promise.resolve(null)
    }
  }
  @ReactMethod fun setMediaNotificationLyrics(mediaId: String, generation: String, lines: ReadableArray, promise: Promise) {
    try {
      val timed = (0 until lines.size()).mapNotNull { index ->
        val line = lines.getMap(index) ?: return@mapNotNull null
        val time = line.getDouble("time"); val text = line.getString("text") ?: return@mapNotNull null
        if (!time.isFinite() || time < 0 || time > Long.MAX_VALUE / 1000.0) null
        else MediaNotificationLyricLine((time * 1000).toLong(), text)
      }
      main.post {
        if (MediaNotificationState.lyrics.complete(mediaId, generation, timed)) MusicPlaybackService.refreshMediaNotification()
        promise.resolve(null)
      }
    } catch (error: Throwable) { promise.reject("MEDIA_NOTIFICATION_LYRICS", "通知歌词数据无效", error) }
  }

  private fun withController(action: (MediaController) -> Unit, promise: Promise? = null, commandName: String? = null) {
    val command = commandName?.let { "$it#${commandSequence.incrementAndGet()}" }
    if (command != null) Log.i("LiuliuPlayerDiagnostics", "$command received futureDone=${future.isDone} futureCancelled=${future.isCancelled}")
    future.addListener({
      try {
        val controller = future.get()
        if (command != null) diagnose("$command before", controller)
        action(controller)
        if (command != null) diagnose("$command dispatched", controller)
        promise?.resolve(null)
      } catch (error: Throwable) {
        // Exception messages/cause strings can include signed media URLs.
        Log.w("LiuliuPlayerDiagnostics", "${command ?: "controller"} failed type=${error.javaClass.simpleName} causeType=${error.cause?.javaClass?.simpleName}")
        promise?.reject("PLAYER_ERROR", error.message, error)
      }
    }, ContextCompat.getMainExecutor(context))
  }
  private fun diagnose(stage: String, controller: MediaController) {
    Log.i("LiuliuPlayerDiagnostics", "$stage connected=${controller.isConnected} state=${controller.playbackState} playing=${controller.isPlaying} playWhenReady=${controller.playWhenReady} suppression=${controller.playbackSuppressionReason} index=${controller.currentMediaItemIndex} count=${controller.mediaItemCount} positionMs=${controller.currentPosition} durationMs=${controller.duration} errorCode=${controller.playerError?.errorCode ?: 0}")
  }
  private fun attach(controller: MediaController) {
    if (listenerAttached) return
    listenerAttached = true
    diagnose("attached", controller)
    controller.addListener(object : Player.Listener {
      override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) {
        val oldId = oldPosition.mediaItem?.mediaId ?: return
        val naturalEnd = reason == Player.DISCONTINUITY_REASON_AUTO_TRANSITION
        if (naturalEnd || oldId != newPosition.mediaItem?.mediaId) {
          previousItem = PreviousItem(++progressSequence, oldId,
            oldPosition.positionMs.coerceAtLeast(0), observedDurations[oldId] ?: 0L, naturalEnd)
          // Observation only: playback ordering and all Media3 operations remain owned by the existing service.
          emit(controller)
        }
      }
      override fun onEvents(player: Player, events: Player.Events) {
        val state = "${controller.isConnected}/${player.playbackState}/${player.isPlaying}/${player.playWhenReady}/${player.playbackSuppressionReason}/${player.currentMediaItemIndex}/${player.mediaItemCount}/${player.playerError?.errorCode ?: 0}"
        if (state != lastDiagnosticState) {
          lastDiagnosticState = state
          diagnose("state-changed", controller)
        }
        emit(controller)
      }
      override fun onPlaybackStateChanged(state: Int) { emit(controller) }
    })
  }
  private fun emit(controller: MediaController) {
    if (!context.hasActiveReactInstance() || listeners == 0) return
    observeDuration(controller)
    val map = Arguments.createMap().apply {
      putBoolean("playing", controller.isPlaying)
      putBoolean("ended", controller.playbackState == Player.STATE_ENDED)
      putInt("index", controller.currentMediaItemIndex.coerceAtLeast(0))
      putString("mediaId", controller.currentMediaItem?.mediaId)
      putDouble("position", controller.currentPosition.coerceAtLeast(0).toDouble() / 1000)
      putDouble("duration", controller.duration.coerceAtLeast(0).toDouble() / 1000)
      putDouble("volume", controller.volume.toDouble())
      putString("error", controller.playerError?.message)
      putString("audioEffectWarning",MusicPlaybackService.audioEffectWarning)
      putString("sleepMode", sleepMode)
      putDouble("sleepDeadline", sleepDeadline.toDouble())
      putUrlRecovery(this, controller)
      putPreviousItem(this)
    }
    context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("playbackState", map)
  }
  private fun observeDuration(controller: MediaController) {
    val id = controller.currentMediaItem?.mediaId ?: return
    if (controller.duration <= 0) return
    observedDurations[id] = controller.duration
    while (observedDurations.size > 256) observedDurations.remove(observedDurations.keys.first())
  }
  private fun putPreviousItem(map: WritableMap) {
    val item = previousItem ?: return
    map.putMap("previousItem", Arguments.createMap().apply {
      putDouble("sequence", item.sequence.toDouble())
      putString("mediaId", item.mediaId)
      putDouble("position", item.position.toDouble() / 1000)
      putDouble("duration", item.duration.toDouble() / 1000)
      putBoolean("completed", item.completed)
    })
  }
  private fun putUrlRecovery(map: WritableMap, controller: MediaController) {
    val recovery = MusicPlaybackService.recovery(controller.currentMediaItem?.mediaId)
    if (recovery == null) { map.putNull("urlRecovery"); return }
    map.putMap("urlRecovery", Arguments.createMap().apply {
      putString("token", recovery.token)
      putString("mediaId", recovery.mediaId)
      putDouble("position", recovery.positionMs.toDouble() / 1000)
      putBoolean("resume", recovery.resume)
      putString("status", recovery.status)
    })
    if (recovery.status == "failed") map.putString("error", "播放地址重新解析或重试失败")
  }
  private fun metadata(track: ReadableMap): MediaItem {
    val builder = MediaMetadata.Builder().setTitle(track.getString("title") ?: "未知歌曲").setArtist(track.getString("artist") ?: "未知艺人").setAlbumTitle(track.getString("album") ?: "")
    track.getString("artwork")?.takeIf { it.isNotBlank() }?.let { builder.setArtworkUri(android.net.Uri.parse(it)) }
    val url = track.getString("url") ?: ""
    return MediaItem.Builder().setMediaId(track.getString("mediaId") ?: track.getString("id") ?: url).setUri(url).setMediaMetadata(builder.build()).build()
  }

  @ReactMethod fun loadQueue(tracks: ReadableArray, index: Int, play: Boolean, position: Double, promise: Promise) = withController({ controller ->
    MusicPlaybackService.cancelUrlRecovery()
    val items=(0 until tracks.size()).mapNotNull { tracks.getMap(it)?.let(::metadata) }
    val startMs = (if (position.isFinite()) position.coerceAtLeast(0.0) * 1000 else 0.0).toLong()
    controller.stop(); controller.clearMediaItems(); controller.setMediaItems(items, index.coerceIn(0,(items.size-1).coerceAtLeast(0)), startMs); controller.prepare(); if (play) controller.play(); emit(controller)
  }, promise, "loadQueue")
  @ReactMethod fun appendQueue(tracks: ReadableArray, promise: Promise) = withController({ controller -> (0 until tracks.size()).mapNotNull { tracks.getMap(it)?.let(::metadata) }.forEach(controller::addMediaItem); emit(controller) }, promise)
  @ReactMethod fun replaceQueueItem(index: Int, track: ReadableMap, promise: Promise) = withController({ controller ->
    check(index in 0 until controller.mediaItemCount) { "播放队列条目不存在" }
    controller.replaceMediaItem(index, metadata(track))
    emit(controller)
  }, promise)
  @ReactMethod fun reorderQueue(currentId: String, mediaIds: ReadableArray, promise: Promise) = withController({ controller ->
    val desired = (0 until mediaIds.size()).map { requireNotNull(mediaIds.getString(it)) }
    check(controller.currentMediaItem?.mediaId == currentId) { "Current song changed before queue reversal" }
    val existing = (0 until controller.mediaItemCount).map { controller.getMediaItemAt(it).mediaId }
    check(desired.size == existing.size && desired.toSet().size == desired.size && desired.toSet() == existing.toSet()) { "Prepared queue changed before reversal" }
    desired.forEachIndexed { destination, id ->
      val origin = (0 until controller.mediaItemCount).first { controller.getMediaItemAt(it).mediaId == id }
      if (origin != destination) controller.moveMediaItem(origin, destination)
    }
    emit(controller)
  }, promise)
  @ReactMethod fun removeQueueItem(index: Int, promise: Promise) = withController({ controller ->
    if (index in 0 until controller.mediaItemCount) controller.removeMediaItem(index)
    emit(controller)
  }, promise)
  @ReactMethod fun removePreparedQueueItem(currentId: String, targetId: String, index: Int, promise: Promise) {
    var removed = false
    withController({ controller ->
      if (controller.currentMediaItem?.mediaId == currentId &&
        index in 0 until controller.mediaItemCount &&
        controller.getMediaItemAt(index).mediaId == targetId &&
        index != controller.currentMediaItemIndex) {
        controller.removeMediaItem(index)
        emit(controller)
        removed = true
      }
    }, object : Promise by promise {
      override fun resolve(value: Any?) { promise.resolve(removed) }
    })
  }
  @ReactMethod fun insertQueueAroundCurrent(currentId: String, beforeTracks: ReadableArray, afterTracks: ReadableArray, promise: Promise) = withController({ controller ->
    check(controller.mediaItemCount == 1 && controller.currentMediaItem?.mediaId == currentId) { "Current queue changed before background hydration" }
    val before=(0 until beforeTracks.size()).mapNotNull { beforeTracks.getMap(it)?.let(::metadata) }
    val after=(0 until afterTracks.size()).mapNotNull { afterTracks.getMap(it)?.let(::metadata) }
    if(before.isNotEmpty()) controller.addMediaItems(0,before)
    if(after.isNotEmpty()) controller.addMediaItems(controller.mediaItemCount,after)
    emit(controller)
  }, promise)
  @ReactMethod fun insertQueueItems(currentId: String, index: Int, tracks: ReadableArray, promise: Promise) = withController({ controller ->
    check(controller.currentMediaItem?.mediaId == currentId) { "Current song changed before background insertion" }
    check(index in 0..controller.mediaItemCount) { "Prepared queue insertion index changed" }
    val items=(0 until tracks.size()).mapNotNull { tracks.getMap(it)?.let(::metadata) }
    if (items.isNotEmpty()) controller.addMediaItems(index, items)
    emit(controller)
  }, promise)
  @ReactMethod fun playIndex(index: Int, position: Double, promise: Promise) = withController({ controller -> CarLibraryState.pendingSelection = null; MusicPlaybackService.cancelUrlRecovery();controller.stop();controller.seekTo(index.coerceIn(0,(controller.mediaItemCount-1).coerceAtLeast(0)), (if (position.isFinite()) position.coerceAtLeast(0.0) * 1000 else 0.0).toLong());controller.prepare();controller.play();emit(controller) },promise,"playIndex")
  @ReactMethod fun play(promise: Promise)=withController({if (!MusicPlaybackService.resumeExpiredUrl()) it.play();emit(it)},promise,"play")
  @ReactMethod fun pause(promise: Promise)=withController({MusicPlaybackService.cancelUrlRecovery();it.pause();emit(it)},promise,"pause")
  @ReactMethod fun stop(promise: Promise)=withController({MusicPlaybackService.cancelUrlRecovery();it.stop();emit(it)},promise,"stop")
  @ReactMethod fun seek(seconds: Double,promise: Promise)=withController({MusicPlaybackService.cancelUrlRecovery();it.seekTo((seconds.coerceAtLeast(0.0)*1000).toLong());emit(it)},promise,"seek")
  @ReactMethod fun replaceCurrent(track: ReadableMap, position: Double, play: Boolean, promise: Promise) = withController({ controller ->
    MusicPlaybackService.cancelUrlRecovery()
    val index = controller.currentMediaItemIndex
    check(index in 0 until controller.mediaItemCount) { "当前没有可替换的播放条目" }
    controller.replaceMediaItem(index, metadata(track))
    controller.seekTo(index, (position.coerceAtLeast(0.0) * 1000).toLong())
    controller.prepare()
    if (play) controller.play() else controller.pause()
    emit(controller)
  }, promise)
  @ReactMethod fun replaceExpiredUrl(token: String, track: ReadableMap, nativeFallback: Boolean, promise: Promise) = withController({ controller ->
    MusicPlaybackService.replaceExpiredUrl(token, metadata(track), nativeFallback)
    emit(controller)
  }, promise, "replaceExpiredUrl")
  @ReactMethod fun failExpiredUrlRecovery(token: String, nativeFallback: Boolean, promise: Promise) = withController({ controller ->
    MusicPlaybackService.failExpiredUrlRecovery(token, nativeFallback)
    emit(controller)
  }, promise, "failExpiredUrlRecovery")
  @ReactMethod fun setVolume(value: Double,promise: Promise)=withController({it.volume=value.coerceIn(0.0,1.0).toFloat();emit(it)},promise)
  @ReactMethod fun setShuffle(enabled: Boolean,promise: Promise)=withController({it.shuffleModeEnabled=enabled;emit(it)},promise)
  @ReactMethod fun setRepeatMode(mode: String,promise: Promise)=withController({it.repeatMode=when(mode){"one"->androidx.media3.common.Player.REPEAT_MODE_ONE;"all"->androidx.media3.common.Player.REPEAT_MODE_ALL;else->androidx.media3.common.Player.REPEAT_MODE_OFF};emit(it)},promise)
  @ReactMethod fun setNormalize(enabled: Boolean, promise: Promise) {
    context.getSharedPreferences("liuliu_player", android.content.Context.MODE_PRIVATE)
      .edit().putBoolean("normalize", enabled).apply()
    MusicPlaybackService.setNormalization(enabled)
    promise.resolve(null)
  }
  @ReactMethod fun setAudioFocus(enabled: Boolean, promise: Promise) {
    context.getSharedPreferences("liuliu_player", android.content.Context.MODE_PRIVATE)
      .edit()
      // The bridge receives Media3's handleAudioFocus value. Keep the UI
      // preference under its original key as the inverse for old installs.
      .putBoolean("handle_audio_focus", enabled)
      .putBoolean("interrupt_playback", !enabled)
      .apply()
    main.post {
      try {
        MusicPlaybackService.setAudioFocus(enabled)
        promise.resolve(null)
      } catch (error: Throwable) {
        promise.reject("AUDIO_FOCUS_UNAVAILABLE", error.message, error)
      }
    }
  }
  @ReactMethod fun setEqualizer(preset: String, promise: Promise) {
    if (preset !in setOf("Flat", "Pop", "Rock", "Classical", "Jazz", "Bass Boost", "Vocal", "DTS 风格", "蝰蛇风格", "电影", "舞曲", "原声", "清晰人声", "深沉低音", "现场空间", "游戏空间", "夜间聆听", "开车旅途", "超重低音", "车载音响"))
      return promise.reject("EQUALIZER_PRESET", "不支持的均衡器预设")
    context.getSharedPreferences("liuliu_player", android.content.Context.MODE_PRIVATE)
      .edit().putString("equalizer", preset).apply()
    // Media3's player and audio effects are main-thread confined. React
    // Native invokes this method on mqt_v_native, so dispatch the whole
    // service access instead of touching the active player from that thread.
    main.post {
      try {
        if (MusicPlaybackService.setEqualizer(preset))
          promise.resolve(null)
        else promise.reject("EQUALIZER_UNAVAILABLE", "当前设备暂不支持该音效")
      } catch (error: Throwable) {
        promise.reject("EQUALIZER_UNAVAILABLE", error.message, error)
      }
    }
  }
  @ReactMethod fun setCustomEqualizer(gains: ReadableArray, configuration: ReadableMap, promise: Promise) {
    val json=org.json.JSONObject(configuration.toHashMap()).toString()
    val values = try {
      DoubleArray(gains.size()) { gains.getDouble(it) }.also { AudioEffectConfiguration.profile(it,json) }
    } catch (error: Throwable) {
      return promise.reject("EQUALIZER_PARAMETERS", "需要十段 -12 至 +12 dB 的有效参数", error)
    }
    main.post {
      try {
        if (MusicPlaybackService.setCustomEqualizer(values,json)) {
          context.getSharedPreferences("liuliu_player", android.content.Context.MODE_PRIVATE)
            .edit().putString("custom_equalizer_gains", org.json.JSONArray(values.toList()).toString())
            .putString("custom_equalizer_configuration",json)
            .putString("equalizer", "Custom").apply()
          promise.resolve(null)
        } else promise.reject("EQUALIZER_UNAVAILABLE", "当前设备暂不支持该音效")
      } catch (error: Throwable) {
        promise.reject("EQUALIZER_UNAVAILABLE", error.message, error)
      }
    }
  }
  @ReactMethod fun getState(promise: Promise) {
    future.addListener({
      try {
        val controller = future.get()
        observeDuration(controller)
        promise.resolve(Arguments.createMap().apply {
          putBoolean("playing", controller.isPlaying)
          putBoolean("ended", controller.playbackState == Player.STATE_ENDED)
          putInt("index", controller.currentMediaItemIndex.coerceAtLeast(0))
          putString("mediaId", controller.currentMediaItem?.mediaId)
          putDouble("position", controller.currentPosition.coerceAtLeast(0).toDouble() / 1000)
          putDouble("duration", controller.duration.coerceAtLeast(0).toDouble() / 1000)
          putDouble("volume", controller.volume.toDouble())
          putString("error", controller.playerError?.message)
      putString("audioEffectWarning",MusicPlaybackService.audioEffectWarning)
          putString("sleepMode", sleepMode)
          putDouble("sleepDeadline", sleepDeadline.toDouble())
          putUrlRecovery(this, controller)
          putPreviousItem(this)
        })
      } catch (error: Throwable) {
        promise.reject("PLAYER_ERROR", error.message, error)
      }
    }, ContextCompat.getMainExecutor(context))
  }

  @ReactMethod fun setAutoNext(enabled: Boolean, promise: Promise) {
    context.getSharedPreferences("liuliu_player", android.content.Context.MODE_PRIVATE)
      .edit().putBoolean("auto_next", enabled).apply()
    promise.resolve(null)
  }

  private fun cancelTask(){sleepTask?.let(main::removeCallbacks);sleepTask=null}
  private fun scheduleTrackEnd(controller: MediaController){val task=object:Runnable{override fun run(){if(sleepMode!="track")return;val remaining=controller.duration-controller.currentPosition;if(controller.duration>0&&remaining<=700){controller.pause();sleepMode="off";sleepDeadline=0;emit(controller)}else main.postDelayed(this,250)}};sleepTask=task;main.post(task)}
  @ReactMethod fun setSleepTimer(mode:String,minutes:Int,promise:Promise)=withController({controller->cancelTask();sleepMode=if(mode=="track")"track" else "minutes";if(sleepMode=="track"){sleepDeadline=0;scheduleTrackEnd(controller)}else{sleepDeadline=System.currentTimeMillis()+TimeUnit.MINUTES.toMillis(minutes.coerceIn(1,720).toLong());val task=Runnable{controller.pause();sleepMode="off";sleepDeadline=0;emit(controller)};sleepTask=task;main.postDelayed(task,(sleepDeadline-System.currentTimeMillis()).coerceAtLeast(0))};emit(controller)},promise)
  @ReactMethod fun cancelSleepTimer(promise:Promise)=withController({controller->cancelTask();sleepMode="off";sleepDeadline=0;emit(controller)},promise)
  @ReactMethod fun addListener(eventName:String){listeners++}
  @ReactMethod fun removeListeners(count:Int){listeners=(listeners-count).coerceAtLeast(0)}
  @ReactMethod fun sampleCoverColor(uri: String, promise: Promise) = sampleImageColor(uri, false, promise)
  @ReactMethod fun sampleCoverEdgeColor(uri: String, promise: Promise) = sampleImageColor(uri, true, promise)
  private fun sampleImageColor(uri: String, edgesOnly: Boolean, promise: Promise) {
    val normalized = uri.trim().replace("^//".toRegex(), "https://").replace("^http:".toRegex(), "https:")
    if (normalized.isBlank()) return promise.resolve(null)
    imageExecutor.execute {
      var connection: HttpURLConnection? = null
      var bitmap: Bitmap? = null
      try {
        connection = NetworkProtection.openGet(normalized, 5000, 7000)
        connection.connect()
        bitmap = BitmapFactory.decodeStream(connection.inputStream)
        if (bitmap == null) return@execute promise.resolve(null)
        val sample = Bitmap.createScaledBitmap(bitmap, 24, 24, true)
        val color = weightedCoverTone(sample.width, sample.height, edgesOnly) { x, y -> sample.getPixel(x, y) }
        sample.recycle()
        promise.resolve(color)
      } catch (_: Throwable) {
        promise.resolve(null)
      } finally {
        bitmap?.recycle()
        connection?.disconnect()
      }
    }
  }
  override fun invalidate(){mediaTasks.close();if(MediaNotificationState.actionSink === mediaNotificationSink) MediaNotificationState.actionSink=null;EffectSpectrumObserver.enable(false);context.removeLifecycleEventListener(spectrumLifecycle);cancelTask();imageExecutor.shutdownNow();future.cancel(false);super.invalidate()}
}
