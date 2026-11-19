package com.liuliu.agentmusic

import org.junit.Assert.*
import org.junit.Test

class PlaybackListeningClockTest {
  private var time = 0L
  private fun clock() = PlaybackListeningClock { time }
  @Test fun onlyActualThirtySecondsQualifyOnce() {
    val clock = clock()
    clock.observe("qq:1", true)
    time = 29_999
    assertTrue(clock.snapshot().qualified.isEmpty())
    time = 30_000
    assertEquals(1, clock.snapshot().qualified.size)
    time = 100_000
    assertEquals(1, clock.snapshot().qualified.size)
    assertEquals(30_000L, clock.snapshot().qualified.single().listenedMs)
  }
  @Test fun pauseBufferAndFocusSuppressionDoNotAccumulate() {
    val clock = clock()
    clock.observe("qq:1", true)
    time = 12_000
    clock.observe("qq:1", false)
    time = 120_000
    assertEquals(12_000L, clock.snapshot().listenedMs)
    clock.observe("qq:1", true)
    time = 137_999
    assertTrue(clock.snapshot().qualified.isEmpty())
    time++
    assertEquals(1, clock.snapshot().qualified.size)
  }
  @Test fun seekingCannotAddTimeAndDoesNotLoseAlreadyHeardTime() {
    val clock = clock()
    clock.observe("qq:1", true)
    time = 2_000
    clock.observe("qq:1", true) // A seek updates native state but provides no playhead to this clock.
    assertEquals(2_000L, clock.snapshot().listenedMs)
    assertTrue(clock.snapshot().qualified.isEmpty())
    time = 30_000
    assertEquals(1, clock.snapshot().qualified.size)
  }
  @Test fun quickSkipsCannotPoolDurationsAcrossSongs() {
    val clock = clock()
    repeat(20) {
      clock.observe("qq:$it", true)
      time += 10_000
    }
    assertTrue(clock.snapshot().qualified.isEmpty())
  }
  @Test fun aQualifyingOutgoingSongSurvivesAnImmediateTransition() {
    val clock = clock()
    clock.observe("qq:1", true)
    time = 30_001
    clock.observe("qq:2", true)
    assertEquals("qq:1", clock.snapshot().qualified.single().mediaId)
    assertEquals(0L, clock.snapshot().listenedMs)
  }
  @Test fun nativeRepeatIsANewPlayButQueueMetadataAndUrlRefreshAreNot() {
    val clock = clock()
    clock.observe("qq:1", true)
    time = 30_000
    val first = clock.snapshot().qualified.single()
    clock.observe("qq:1", true)
    time = 31_000
    assertEquals(1, clock.snapshot().qualified.size)
    clock.observe("qq:1", true, restart = true)
    time = 60_999
    assertEquals(1, clock.snapshot().qualified.size)
    time++
    assertEquals(2, clock.snapshot().qualified.size)
    assertTrue(clock.snapshot().qualified.last().sequence > first.sequence)
  }
  @Test fun backgroundTimeCountsWithoutJavascriptPolling() {
    val clock = clock()
    clock.observe("qq:1", true)
    time = 80_000
    assertEquals(1, clock.snapshot().qualified.size)
    assertEquals(80_000L, clock.snapshot().listenedMs)
  }
  @Test fun qualificationTimerStopsDuringPauseAndAfterQualification() {
    val clock = clock()
    clock.observe("qq:1", true)
    time = 5_000
    assertEquals(25_000L, clock.untilQualification())
    clock.observe("qq:1", false)
    assertNull(clock.untilQualification())
    time = 60_000
    clock.observe("qq:1", true)
    time = 85_000
    assertNull(clock.untilQualification())
  }
  @Test fun boundedEventsNeverRetainAnUnboundedQueue() {
    val clock = clock()
    repeat(150) {
      clock.observe("qq:$it", true)
      time += 30_000
    }
    assertEquals(100, clock.snapshot().qualified.size)
    assertEquals("qq:50", clock.snapshot().qualified.first().mediaId)
    assertEquals("qq:149", clock.snapshot().qualified.last().mediaId)
  }
}
