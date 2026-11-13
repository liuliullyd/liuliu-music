package com.liuliu.agentmusic

import com.google.common.util.concurrent.SettableFuture
import java.util.ArrayDeque
import java.util.concurrent.Executor
import java.lang.reflect.Proxy
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import org.junit.Assert.*
import org.junit.Test

class RecoverablePlayerConnectionTest {
  private class Controller(var connected: Boolean = true) { val commands = mutableListOf<String>() }
  private class MainQueue : Executor {
    private val tasks = ArrayDeque<Runnable>()
    override fun execute(task: Runnable) { tasks.add(task) }
    fun drain() { var count = 0; while (tasks.isNotEmpty()) { check(count++ < 100); tasks.removeFirst().run() } }
  }
  private class Fixture {
    val main = MainQueue()
    val attempts = mutableListOf<SettableFuture<Controller>>()
    val attached = mutableListOf<Controller>()
    val released = mutableListOf<Any>()
    val failures = mutableListOf<Throwable>()
    val deadlines = mutableListOf<() -> Unit>()
    val cancelled = mutableListOf<Int>()
    val lifecycle = PlaybackTaskLifecycle()
    val connection = RecoverablePlayerConnection(main,
      { SettableFuture.create<Controller>().also(attempts::add) }, { it.connected },
      { released.add(it) }, { attached.add(it) }, { task ->
        deadlines.add(task)
        val index = deadlines.lastIndex
        { cancelled.add(index); Unit }
      }, { lifecycle.allowed })
    init { lifecycle.observeRemoval { connection.reset() } }
    fun command(name: String) = connection.execute({ it.commands.add(name) }, failures::add)
    fun establish(): Controller {
      command("initial"); main.drain()
      return Controller().also { attempts.last().set(it); main.drain() }
    }
  }

  @Test fun taskRemovalRejectsQueuedCommandsEvenWhenActivityReopensBeforeDispatch() {
    val f = Fixture(); val old = f.establish()
    f.command("late-play")
    f.lifecycle.removeTask(); f.lifecycle.openActivity()
    f.command("new-load"); f.main.drain()
    val fresh = Controller(); f.attempts.last().set(fresh); f.main.drain()
    assertEquals(listOf("initial"), old.commands)
    assertEquals(listOf("new-load"), fresh.commands)
    assertEquals(1, f.failures.size)
    assertEquals(1, f.released.size)
  }

  @Test fun taskRemovalBlocksBackgroundPollAndPlayUntilActivityOpens() {
    val f = Fixture(); f.establish()
    f.lifecycle.removeTask(); f.main.drain()
    f.command("poll"); f.command("play"); f.main.drain()
    assertEquals(1, f.attempts.size)
    assertEquals(2, f.failures.size)
    f.lifecycle.openActivity(); f.command("reopened"); f.main.drain()
    val fresh = Controller(); f.attempts.last().set(fresh); f.main.drain()
    assertEquals(listOf("reopened"), fresh.commands)
  }

  @Test fun taskRemovalRejectsPendingConnectionAndItsLateCompletion() {
    val f = Fixture(); f.command("old-load"); f.main.drain()
    f.lifecycle.removeTask(); f.main.drain()
    f.lifecycle.openActivity(); f.command("new-load"); f.main.drain()
    val late = Controller(); f.attempts.first().set(late); f.main.drain()
    val fresh = Controller(); f.attempts.last().set(fresh); f.main.drain()
    assertTrue(late.commands.isEmpty())
    assertEquals(listOf(fresh), f.attached)
    assertEquals(listOf("new-load"), fresh.commands)
    assertEquals(1, f.failures.size)
  }

  @Test fun removalDuringCommandDeliveryRejectsRemainingWaiters() {
    val f = Fixture()
    f.connection.execute({ it.commands.add("first"); f.lifecycle.removeTask() }, f.failures::add)
    f.command("late-next"); f.main.drain()
    val controller = Controller(); f.attempts.single().set(controller); f.main.drain()
    assertEquals(listOf("first"), controller.commands)
    assertEquals(1, f.failures.size)
    assertEquals(1, f.released.size)
  }

  @Test fun repeatedRemovalCleansOnceAndOrdinaryBackgroundKeepsPermission() {
    val lifecycle = PlaybackTaskLifecycle()
    var removed = 0
    val unsubscribe = lifecycle.observeRemoval { removed++ }
    lifecycle.openActivity(); assertTrue(lifecycle.allowed)
    lifecycle.removeTask(); lifecycle.removeTask()
    assertFalse(lifecycle.allowed); assertEquals(1, removed)
    lifecycle.openActivity(); assertTrue(lifecycle.allowed)
    unsubscribe(); lifecycle.removeTask(); assertEquals(1, removed)
  }

  @Test fun disconnectedControllerIsReplacedBeforeNextAndPreviousCommands() {
    val f = Fixture(); val old = f.establish()
    old.connected = false; f.connection.disconnected(old); f.main.drain()
    f.command("next"); f.command("previous"); f.main.drain()
    assertEquals(2, f.attempts.size)
    val fresh = Controller(); f.attempts.last().set(fresh); f.main.drain()
    assertEquals(listOf("initial"), old.commands)
    assertEquals(listOf("next", "previous"), fresh.commands)
    assertEquals(listOf(old, fresh), f.attached)
  }

  @Test fun statePollDetectsLostConnectionEvenBeforeDisconnectCallback() {
    val f = Fixture(); val old = f.establish(); old.connected = false
    f.command("poll"); f.main.drain()
    assertEquals(2, f.attempts.size)
    val fresh = Controller(); f.attempts.last().set(fresh); f.main.drain()
    assertEquals(listOf("poll"), fresh.commands)
    assertEquals(listOf("initial"), old.commands)
  }

  @Test fun failedConnectionRejectsItsWaitersAndAllowsALaterAttempt() {
    val f = Fixture(); f.command("next"); f.main.drain()
    f.attempts.last().setException(IllegalStateException("unavailable")); f.main.drain()
    assertEquals(1, f.failures.size)
    f.command("previous"); f.main.drain()
    assertEquals(2, f.attempts.size)
    val fresh = Controller(); f.attempts.last().set(fresh); f.main.drain()
    assertEquals(listOf("previous"), fresh.commands)
  }

  @Test fun lateDisconnectFromOldControllerCannotInvalidateNewConnection() {
    val f = Fixture(); val old = f.establish(); old.connected = false
    f.command("next"); f.main.drain()
    assertEquals(2, f.attempts.size)
    val fresh = Controller(); f.attempts.last().set(fresh); f.main.drain()
    f.connection.disconnected(old); f.command("previous"); f.main.drain()
    assertEquals(2, f.attempts.size)
    assertEquals(listOf("next", "previous"), fresh.commands)
  }

  @Test fun closeReleasesCompletedConnectionAndRejectsFutureCommands() {
    val f = Fixture(); val old = f.establish()
    f.connection.close(); f.command("play"); f.main.drain()
    assertEquals(listOf("initial"), old.commands)
    assertEquals(listOf(f.attempts.single()), f.released)
    assertEquals(1, f.failures.size)
  }

  @Test fun closeRejectsPendingWaitersWithoutStartingAnotherConnection() {
    val f = Fixture(); f.command("next"); f.main.drain()
    f.connection.close(); f.main.drain()
    f.command("play"); f.main.drain()
    assertEquals(1, f.attempts.size)
    assertEquals(2, f.failures.size)
    assertEquals(1, f.released.size)
  }

  @Test fun concurrentCommandsShareOneConnectionAndAttachOnlyOnce() {
    val f = Fixture(); f.command("load"); f.command("play"); f.command("poll"); f.main.drain()
    assertEquals(1, f.attempts.size)
    val fresh = Controller(); f.attempts.single().set(fresh); f.main.drain()
    assertEquals(listOf("load", "play", "poll"), fresh.commands)
    assertEquals(listOf(fresh), f.attached)
    assertTrue(f.failures.isEmpty())
  }

  @Test fun commandFailureIsNotReplayedOrTreatedAsConnectionFailure() {
    val f = Fixture(); val old = f.establish()
    f.connection.execute({ it.commands.add("seek"); error("invalid index") }, f.failures::add)
    f.command("pause"); f.main.drain()
    assertEquals(listOf("initial", "seek", "pause"), old.commands)
    assertEquals(1, f.failures.size); assertEquals(1, f.attempts.size)
  }

  @Test fun disconnectDuringQueuedCommandDeliveryCannotDispatchLaterCommandsToDeadController() {
    val f = Fixture()
    f.connection.execute({ it.commands.add("first"); it.connected = false }, f.failures::add)
    f.command("second"); f.main.drain()
    val old = Controller(); f.attempts.last().set(old); f.main.drain()
    assertEquals(listOf("first"), old.commands); assertEquals(1, f.failures.size)
    f.command("retry"); f.main.drain(); assertEquals(2, f.attempts.size)
  }

  @Test fun closeBeforeQueuedDispatchNeverStartsAConnection() {
    val f = Fixture(); f.command("play"); f.connection.close(); f.main.drain()
    assertTrue(f.attempts.isEmpty()); assertEquals(1, f.failures.size)
  }

  @Test fun hungConnectionRejectsAllWaitingCommandsAndALaterPlayCanReconnect() {
    val f = Fixture(); f.command("play"); f.command("next"); f.command("poll"); f.main.drain()
    assertEquals(1, f.attempts.size)
    assertEquals(1, f.deadlines.size)
    f.deadlines.single()(); f.main.drain()
    assertEquals(3, f.failures.size)
    assertTrue(f.failures.all { it is java.util.concurrent.TimeoutException })
    assertEquals(listOf(f.attempts.first()), f.released)
    f.command("play-again"); f.main.drain()
    val fresh = Controller(); f.attempts.last().set(fresh); f.main.drain()
    assertEquals(2, f.attempts.size)
    assertEquals(listOf("play-again"), fresh.commands)
  }

  @Test fun lateCompletionOfTimedOutAttemptCannotDispatchOrReplaceTheNewController() {
    val f = Fixture(); f.command("old-next"); f.main.drain()
    assertEquals(1, f.deadlines.size)
    f.deadlines.first()(); f.main.drain()
    f.command("new-previous"); f.main.drain()
    val fresh = Controller(); f.attempts.last().set(fresh); f.main.drain()
    val late = Controller(); f.attempts.first().set(late); f.main.drain()
    // A cancelled timer already queued on main must also be harmless.
    f.deadlines.forEach { it() }; f.main.drain()
    f.command("play"); f.main.drain()
    assertEquals(listOf(fresh), f.attached)
    assertTrue(late.commands.isEmpty())
    assertEquals(listOf("new-previous", "play"), fresh.commands)
    assertEquals(1, f.failures.size)
    assertEquals(2, f.attempts.size)
    assertEquals(listOf(0, 1), f.cancelled)
  }

  @Test fun closingPendingConnectionCancelsItsDeadlineAndNeverReleasesTwice() {
    val f = Fixture(); f.command("play"); f.main.drain()
    assertEquals(1, f.deadlines.size)
    f.connection.close(); f.main.drain()
    f.deadlines.single()(); f.main.drain()
    assertEquals(listOf(0), f.cancelled)
    assertEquals(1, f.failures.size); assertEquals(1, f.released.size)
  }

  private class PlayerState(var items: List<MediaItem> = emptyList()) {
    var index = 0
    var position = 0L
    var volume = 1f
    var shuffle = false
    var repeat = Player.REPEAT_MODE_OFF
    var itemReads = 0
    val commands = mutableListOf<String>()
    val player = Proxy.newProxyInstance(Player::class.java.classLoader, arrayOf(Player::class.java)) { _, method, args ->
      when (method.name) {
        "getCurrentTimeline" -> Timeline.EMPTY
        "getMediaItemCount" -> items.size
        "getMediaItemAt" -> { itemReads++; items[args!![0] as Int] }
        "getCurrentMediaItemIndex" -> index
        "getCurrentPosition" -> position
        "getVolume" -> volume
        "getShuffleModeEnabled" -> shuffle
        "getRepeatMode" -> repeat
        "setMediaItems" -> {
          @Suppress("UNCHECKED_CAST")
          val restored = args!![0] as List<MediaItem>
          items = restored; index = args[1] as Int; position = args[2] as Long
          commands.add("items"); null
        }
        "setVolume" -> { volume = args!![0] as Float; commands.add("volume"); null }
        "setShuffleModeEnabled" -> { shuffle = args!![0] as Boolean; commands.add("shuffle"); null }
        "setRepeatMode" -> { repeat = args!![0] as Int; commands.add("repeat"); null }
        else -> { commands.add(method.name); null }
      }
    } as Player
  }
  private fun items() = listOf("previous", "current", "next").map { MediaItem.Builder().setMediaId(it).build() }

  @Test fun serviceRecreationRestoresAdmittedQueuePositionAndModesWithoutPlaying() {
    val old = PlayerState(items()).apply {
      index = 1; position = 123_000; volume = .42f; shuffle = true; repeat = Player.REPEAT_MODE_ONE
    }
    val snapshot = PlayerReconnectSnapshot.capture(old.player, null)
    val fresh = PlayerState()
    snapshot.restoreIfEmpty(fresh.player)
    assertEquals(old.items, fresh.items); assertEquals(1, fresh.index); assertEquals(123_000, fresh.position)
    assertEquals(.42f, fresh.volume); assertTrue(fresh.shuffle); assertEquals(Player.REPEAT_MODE_ONE, fresh.repeat)
    assertEquals(listOf("items", "volume", "shuffle", "repeat"), fresh.commands)
  }

  @Test fun reconnectToExistingSessionKeepsItsNewerQueueAndPosition() {
    val snapshot = PlayerReconnectSnapshot.capture(PlayerState(items()).player, null)
    val active = PlayerState(listOf(MediaItem.Builder().setMediaId("new-selection").build())).apply { position = 9000 }
    snapshot.restoreIfEmpty(active.player)
    assertEquals("new-selection", active.items.single().mediaId); assertEquals(9000, active.position)
    assertTrue(active.commands.isEmpty())
  }

  @Test fun explicitQueueClearCannotBeUndoneByLaterReconnect() {
    val prior = PlayerReconnectSnapshot.capture(PlayerState(items()).player, null)
    // A clear changes the real timeline; capture it without a prior timeline cache.
    val cleared = PlayerReconnectSnapshot.capture(PlayerState().player, null)
    assertFalse(prior.items.isEmpty())
    val fresh = PlayerState(); cleared.restoreIfEmpty(fresh.player)
    assertTrue(fresh.items.isEmpty()); assertTrue(fresh.commands.isEmpty())
  }

  @Test fun frequentProgressPollsReuseTheTimelineItemsButRefreshThePosition() {
    val old = PlayerState(items())
    val first = PlayerReconnectSnapshot.capture(old.player, null)
    old.position = 2500
    val second = PlayerReconnectSnapshot.capture(old.player, first)
    assertSame(first.items, second.items); assertEquals(2500, second.positionMs)
    assertEquals(3, old.itemReads)
  }
}
