package com.liuliu.agentmusic

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Looper
import android.view.KeyEvent
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionCommands
import androidx.media3.session.SessionResult
import androidx.media3.session.SessionError
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import org.json.JSONObject
import java.util.concurrent.Executor

/** System-card actions go to the original app controller, never to an invented native queue. */
@UnstableApi
internal class MediaNotificationController(context: Context, private val actual: Player, delegate: Player) : MediaSession.Callback {
  private val displayPlayer = MediaNotificationSessionPlayer(context, actual, delegate)
  val sessionPlayer = MediaTransportPlayer(actual, displayPlayer)
  private val resumption = MediaPlaybackResumption(
    ready = { CarConnectionState.snapshot.optBoolean("ready") && CarConnectionState.sink != null },
    current = { actual.currentMediaItem?.takeIf { actual.playerError == null }?.let {
      MediaPlaybackResumption.Snapshot(it, actual.currentPosition.coerceAtLeast(0))
    } },
    launch = { context.startActivity(Intent(context, MainActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)) },
    restore = { CarConnectionState.request("resume") },
    observe = { CarConnectionState.observe(it) },
    schedule = { milliseconds, action ->
      val task = Runnable { action() }
      CarConnectionState.main.postDelayed(task, milliseconds)
      ({ CarConnectionState.main.removeCallbacks(task) })
    },
    interrupt = { interruptResumption() },
    executor = Executor { task ->
      if (Looper.myLooper() == actual.applicationLooper) task.run() else CarConnectionState.main.post(task)
    },
  )
  private var pauseAfterStartup = false
  private var interruptionVersion = 0L
  private fun interruptResumption() {
    // Media3's failed-resumption callback tries play again. Hold that fallback
    // until the shared phone controller has cancelled its own preparation.
    sessionPlayer.resumptionPaused = true
    pauseAfterStartup = true
    interruptionVersion++
    pauseRestorationIfReady()
  }
  private fun pauseRestorationIfReady() {
    if (!pauseAfterStartup || !CarConnectionState.snapshot.optBoolean("ready") || CarConnectionState.sink == null) return
    pauseAfterStartup = false
    val version = interruptionVersion
    val request = CarConnectionState.request("pause")
    request.addListener({
      if (version == interruptionVersion && runCatching { request.get().optBoolean("ok") }.getOrDefault(false)) {
        sessionPlayer.resumptionPaused = false
      }
    }, MoreExecutors.directExecutor())
  }
  private var session: MediaSession? = null
  private var previousState: MediaNotificationNavigation? = null
  private val collectCommand = SessionCommand("ucar.media.action.COLLECT", Bundle.EMPTY)
  private val modeCommand = SessionCommand("ucar.media.action.PLAY_MODE", Bundle.EMPTY)
  private val stopCarChanges = CarConnectionState.observe { refresh() }
  private val listener = object : Player.Listener { override fun onEvents(player: Player, events: Player.Events) { refresh() } }
  init { actual.addListener(listener); sessionPlayer.onTransportInterruption = { resumption.cancel() } }
  private fun ownsButtons(session: MediaSession, controller: MediaSession.ControllerInfo): Boolean =
    session.isMediaNotificationController(controller) || controller.packageName == "com.android.systemui"
  private fun navigation(): MediaNotificationNavigation {
    val state = MediaNotificationState.navigation
    return if (state.mediaId == actual.currentMediaItem?.mediaId) state else MediaNotificationNavigation(null, false, false)
  }
  private fun sessionCommands(): SessionCommands =
    MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon().apply {
      add(collectCommand); add(modeCommand)
    }.build()
  // Media3 shares notification-controller permissions with its legacy session.
  // Keep standard transport authorized; MediaTransportPlayer supplies live queue capabilities.
  private fun playerCommands(): Player.Commands = MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS
  fun attach(value: MediaSession) { session = value; refresh() }
  fun refresh() {
    pauseRestorationIfReady()
    displayPlayer.refresh()
    val current = session ?: return
    if (CarConnectionState.hasSnapshot) current.setSessionExtras(Bundle().apply {
      // A boolean has no unknown value. Omit IS_TRIAL until a real entitlement model supplies it.
      putString("com.liuliu.agentmusic.TRIAL_STATUS", "unknown")
      putLong("ucar.media.bundle.TRIAL_BEGIN", -1)
      putLong("ucar.media.bundle.TRIAL_END", -1)
      val song = CarConnectionState.snapshot.takeIf { it.optString("mediaId") == actual.currentMediaItem?.mediaId }
      putLong("ucar.media.bundle.TOTAL_DURATION", song?.optLong("catalogDurationMs")?.takeIf { it > 0 } ?: actual.duration.coerceAtLeast(0))
    })
    val state = navigation()
    if (state == previousState) return
    previousState = state
    // Use Media3's default standard buttons. Explicit BACK/FORWARD preferences
    // become legacy custom actions and suppress AVRCP's standard skip action bits.
    for (controller in current.connectedControllers) if (ownsButtons(current, controller)) {
      current.setAvailableCommands(controller, sessionCommands(), playerCommands())
    } else {
      current.setAvailableCommands(controller, if (current is MediaLibraryService.MediaLibrarySession)
        MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon().add(collectCommand).add(modeCommand).build()
        else sessionCommands(),
        MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS)
    }
  }
  override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
    // Authorization must outlive preparation; Media3 intersects it with live capabilities.
    if (!ownsButtons(session, controller)) return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
      .setAvailablePlayerCommands(MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS)
      .setAvailableSessionCommands(sessionCommands()).build()
    return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
      .setAvailableSessionCommands(sessionCommands()).setAvailablePlayerCommands(playerCommands())
      .build()
  }
  override fun onCustomCommand(session: MediaSession, controller: MediaSession.ControllerInfo,
    command: SessionCommand, args: Bundle): ListenableFuture<SessionResult> {
    if (command.customAction == collectCommand.customAction || command.customAction == modeCommand.customAction) {
      val input = JSONObject().put("mediaId", actual.currentMediaItem?.mediaId ?: "")
      val action = if (command.customAction == collectCommand.customAction) "favorite" else "mode"
      if (action == "mode") input.put("mode", CarUcarMode.next(CarConnectionState.snapshot.optString("mode")))
      return Futures.transform(CarConnectionState.request(action, input), { result ->
        SessionResult(if (result?.optBoolean("ok") == true) SessionResult.RESULT_SUCCESS else SessionError.ERROR_INVALID_STATE,
          Bundle().apply { putString("result", result?.toString()) })
      }, MoreExecutors.directExecutor())
    }
    return super.onCustomCommand(session, controller, command, args)
  }
  @Suppress("DEPRECATION")
  override fun onPlayerCommandRequest(session: MediaSession, controller: MediaSession.ControllerInfo, playerCommand: Int): Int {
    // The phone controller must still be able to perform its original startup and queue preparation.
    if (controller.packageName == contextPackage) return SessionResult.RESULT_SUCCESS
    // Empty-timeline play goes through onPlaybackResumption's startup gate.
    if (playerCommand == Player.COMMAND_PLAY_PAUSE && actual.currentMediaItem == null) return SessionResult.RESULT_SUCCESS
    val mutatesPlayback = playerCommand in setOf(Player.COMMAND_PLAY_PAUSE, Player.COMMAND_PREPARE,
      Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM, Player.COMMAND_SEEK_TO_DEFAULT_POSITION,
      Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM, Player.COMMAND_SEEK_TO_PREVIOUS,
      Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM, Player.COMMAND_SEEK_BACK, Player.COMMAND_SEEK_FORWARD,
      Player.COMMAND_SET_MEDIA_ITEM, Player.COMMAND_CHANGE_MEDIA_ITEMS)
    return if (mutatesPlayback && (!CarLibraryState.ready ||
      (actual.currentMediaItem == null && playerCommand != Player.COMMAND_SET_MEDIA_ITEM && playerCommand != Player.COMMAND_CHANGE_MEDIA_ITEMS)))
      SessionError.ERROR_INVALID_STATE else SessionResult.RESULT_SUCCESS
  }
  override fun onPlaybackResumption(session: MediaSession, controller: MediaSession.ControllerInfo): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
    sessionPlayer.resumptionPaused = false; pauseAfterStartup = false; interruptionVersion++
    return Futures.transform(resumption.request(), { snapshot ->
      checkNotNull(snapshot)
      MediaSession.MediaItemsWithStartPosition(listOf(snapshot.item), 0, snapshot.positionMs)
    }, MoreExecutors.directExecutor())
  }
  override fun onMediaButtonEvent(session: MediaSession, controllerInfo: MediaSession.ControllerInfo, intent: Intent): Boolean {
    if (intent.action == Intent.ACTION_MEDIA_BUTTON) {
      @Suppress("DEPRECATION")
      val event = intent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)
      if (event?.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0 &&
        (event.keyCode == KeyEvent.KEYCODE_MEDIA_PLAY || (event.keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE && !actual.isPlaying))) {
        sessionPlayer.resumptionPaused = false; pauseAfterStartup = false; interruptionVersion++
      }
      if (event != null && MediaNotificationState.handleNavigationKey(event.action, event.keyCode,
          event.repeatCount, actual.currentMediaItem?.mediaId)) return true
    }
    return super.onMediaButtonEvent(session, controllerInfo, intent)
  }
  fun close() { stopCarChanges(); resumption.close(); sessionPlayer.onTransportInterruption = null
    actual.removeListener(listener); displayPlayer.close(); session = null; MediaNotificationState.clear() }
  private val contextPackage = context.packageName
}
