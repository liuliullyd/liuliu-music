package com.liuliu.agentmusic

import org.junit.Assert.*
import org.junit.Test

class PlayerPageMotionStateTest {
  @Test fun firstVsyncAlreadyIncludesElapsedReleaseTimeInBothDirections() {
    for (direction in listOf(-1f, 1f)) {
      val animation = PlayerPageAnimation(direction * 300f, direction * 800f, 1_000_000_000L, false)
      assertEquals(direction * 393.4815f, animation.positionAt(1_016_000_000L), 0.001f)
      assertFalse(animation.finishedAt(1_016_000_000L))
    }
  }

  @Test fun delayedFirstVsyncDoesNotRestartThe240MillisecondClock() {
    val animation = PlayerPageAnimation(-300f, -800f, 1_000_000_000L, false)
    assertEquals(-651.85187f, animation.positionAt(1_080_000_000L), 0.001f)
    assertEquals(-800f, animation.positionAt(1_240_000_000L), 0f)
    assertTrue(animation.finishedAt(1_240_000_000L))
  }

  @Test fun everySnapFrameAdvancesMonotonicallyThroughCompletion() {
    for (direction in listOf(-1f, 1f)) {
      val animation = PlayerPageAnimation(direction * 300f, direction * 800f, 0, false)
      var previous = direction * 300f
      for (milliseconds in 1..240) {
        val position = animation.positionAt(milliseconds * 1_000_000L)
        assertTrue((position - previous) * direction >= 0)
        previous = position
      }
      assertEquals(direction * 800f, previous, 0f)
    }
  }

  @Test fun springKeepsItsOriginalDurationAndExactRestingPosition() {
    val animation = PlayerPageAnimation(-300f, 0f, 1_000_000_000L, true)
    assertEquals(-300f, animation.positionAt(999_000_000L), 0f)
    assertTrue(animation.positionAt(1_016_000_000L) > -300f)
    assertFalse(animation.finishedAt(1_799_000_000L))
    assertTrue(animation.finishedAt(1_800_000_000L))
    assertEquals(0f, animation.positionAt(1_800_000_000L), 0f)
  }

  @Test fun systemDurationScaleAndDisabledAnimationsAreRespected() {
    val scaled = PlayerPageAnimation(0f, -800f, 0, false, 2f)
    assertFalse(scaled.finishedAt(240_000_000L))
    assertTrue(scaled.finishedAt(480_000_000L))
    val disabled = PlayerPageAnimation(0f, -800f, 0, false, 0f)
    assertEquals(-800f, disabled.positionAt(0), 0f)
    assertTrue(disabled.finishedAt(0))
  }

  @Test fun resampledMoveIsNotRewoundByShorterUpInEitherDirection() {
    for (direction in listOf(-1f, 1f)) {
      val motion = PlayerPageMotionState()
      motion.setPosition(400f)
      motion.beginDrag()
      motion.moveDrag(0f, direction * 350f, 800f)
      assertEquals(400f + direction * 350f, motion.releasePosition(0f, direction * 300f, 800f), 0f)
    }
  }

  @Test fun releaseIncludesForwardTailAndClampsToOnePage() {
    for (direction in listOf(-1f, 1f)) {
      val motion = PlayerPageMotionState()
      motion.beginDrag()
      motion.moveDrag(0f, direction * 60f, 800f)
      assertEquals(direction * 100f, motion.releasePosition(0f, direction * 100f, 800f), 0f)
      assertEquals(direction * 800f, motion.releasePosition(0f, direction * 900f, 800f), 0f)
    }
  }

  @Test fun realMoveReversalStillTracksAndUpCannotWriteAfterEnd() {
    val motion = PlayerPageMotionState()
    motion.beginDrag()
    motion.moveDrag(0f, -350f, 800f)
    assertEquals(-120f, motion.moveDrag(0f, -120f, 800f), 0f)
    assertEquals(-120f, motion.releasePosition(0f, -100f, 800f), 0f)
    assertEquals(-120f, motion.releasePosition(400f, -200f, 800f), 0f)
    motion.endDrag()
    assertEquals(-120f, motion.releasePosition(0f, -800f, 800f), 0f)
  }

  @Test fun preparedTargetsAreAvailableAtReleaseBeforeAnyReactCommand() {
    val motion = PlayerPageMotionState()
    motion.configureRelease(0, 0f, listOf(800f, 0f, -800f))
    motion.beginDrag()
    motion.moveDrag(0f, -100f, 800f)
    assertEquals(-800f, motion.releaseTarget(0f, -100f, 64f))
    assertEquals(800f, motion.releaseTarget(0f, 100f, 64f))
    assertNull(motion.releaseTarget(0f, -63.99f, 64f))
    assertNull(motion.releaseTarget(120f, -100f, 64f))
  }

  @Test fun anUncommittedGestureKeepsItsPreparedNeighboursAndQueueEdge() {
    val motion = PlayerPageMotionState()
    motion.configureRelease(0, 0f, listOf(0f, -800f))
    motion.beginDrag()
    assertNull(motion.releaseTarget(0f, 100f, 64f))
    motion.endDrag()
    motion.beginDrag()
    assertEquals(-800f, motion.releaseTarget(0f, -100f, 64f))
  }

  @Test fun stalePlansAndMidDragReplacementCannotRewriteCapturedTargets() {
    val motion = PlayerPageMotionState()
    motion.configureRelease(0, 0f, listOf(800f, 0f, -800f))
    motion.beginDrag()
    motion.configureRelease(1, 0f, listOf(1600f, 0f, -1600f))
    motion.clearReleasePlan(2)
    assertEquals(-800f, motion.releaseTarget(0f, -100f, 64f))
    motion.endDrag()
    motion.configureRelease(0, 0f, listOf(2400f, 0f, -2400f))
    motion.beginDrag()
    assertNull(motion.releaseTarget(0f, -100f, 64f))
  }

  @Test fun rapidSecondReleaseUsesTheNextPreparedPageBeforeReactAcknowledgesFirst() {
    val motion = PlayerPageMotionState()
    motion.configureRelease(0, 0f, listOf(800f, 0f, -800f, -1600f))
    motion.beginDrag()
    motion.endDrag()
    motion.acceptRelease(-800f)
    motion.setPosition(-650f)
    motion.beginDrag()
    assertEquals(-650f, motion.dragBase, 0f)
    assertEquals(-1600f, motion.releaseTarget(0f, -100f, 64f))
  }

  @Test fun delayedCenterCannotRewindAndUnmountedPagesAreNoLongerPrepared() {
    val motion = PlayerPageMotionState()
    motion.configureRelease(0, 0f, listOf(800f, 0f, -800f, -1600f))
    motion.beginDrag()
    motion.endDrag()
    motion.acceptRelease(-800f)
    motion.configureRelease(1, 0f, listOf(800f, 0f, -800f))
    motion.beginDrag()
    assertNull(motion.releaseTarget(0f, -100f, 64f))
    assertEquals(0f, motion.releaseTarget(0f, 100f, 64f))
  }

  @Test fun reverseDuringSnapTargetsTheOriginalPageWithoutWaitingForReact() {
    val motion = PlayerPageMotionState()
    motion.configureRelease(0, 0f, listOf(0f, -800f, -1600f))
    motion.beginDrag()
    motion.endDrag()
    motion.acceptRelease(-800f)
    motion.beginDrag()
    assertEquals(0f, motion.releaseTarget(0f, 100f, 64f))
    motion.endDrag()
    motion.acceptRelease(0f)
    motion.beginDrag()
    assertNull(motion.releaseTarget(0f, 100f, 64f))
    assertEquals(-800f, motion.releaseTarget(0f, -100f, 64f))
  }

  @Test fun newerMountingSnapshotExtendsPreparedPagesButOlderRevisionCannot() {
    val motion = PlayerPageMotionState()
    motion.configureRelease(0, 0f, listOf(0f, -800f))
    motion.beginDrag()
    motion.endDrag()
    motion.acceptRelease(-800f)
    motion.configureRelease(1, -800f, listOf(0f, -800f, -1600f))
    motion.configureRelease(0, 0f, listOf(0f, -800f))
    motion.beginDrag()
    assertEquals(-1600f, motion.releaseTarget(0f, -100f, 64f))
  }

  @Test fun pagesMountedDuringTheCurrentDragAreReadyAtUpInBothDirections() {
    for (direction in listOf(-1f, 1f)) {
      val motion = PlayerPageMotionState()
      motion.configureRelease(0, 0f, listOf(0f, direction * 800f))
      motion.beginDrag()
      motion.endDrag()
      motion.acceptRelease(direction * 800f)
      motion.setPosition(direction * 700f)
      motion.beginDrag()
      motion.moveDrag(0f, direction * 100f, 800f)
      // React mounts the new neighbour after GRANT, before the matching UP.
      motion.configureRelease(2, direction * 800f,
        listOf(0f, direction * 800f, direction * 1600f))
      assertEquals(direction * 1600f, motion.releaseTarget(0f, direction * 100f, 64f))
      assertEquals(direction * 700f, motion.dragBase, 0f)
      assertEquals(direction * 800f, motion.position, 0f)
    }
  }

  @Test fun anOlderOrRepeatedSnapshotCannotReplaceCurrentDragPreparedPages() {
    val motion = PlayerPageMotionState()
    motion.configureRelease(0, 0f, listOf(0f, -800f))
    motion.beginDrag()
    motion.endDrag()
    motion.acceptRelease(-800f)
    motion.beginDrag()
    motion.configureRelease(2, -800f, listOf(0f, -800f, -1600f))
    motion.configureRelease(1, -800f, listOf(0f, -800f))
    motion.configureRelease(2, 0f, listOf(0f, -800f))
    assertEquals(-1600f, motion.releaseTarget(0f, -100f, 64f))
    assertEquals(0f, motion.releaseTarget(0f, 100f, 64f))
    motion.endDrag()
    motion.acceptRelease(-1600f)
    motion.beginDrag()
    assertEquals(-800f, motion.releaseTarget(0f, 100f, 64f))
    assertNull(motion.releaseTarget(0f, -100f, 64f))
  }

  @Test fun currentDragCanDropDistantPagesWithoutReplacingItsCapturedNeighbour() {
    val motion = PlayerPageMotionState()
    motion.configureRelease(0, 0f, listOf(0f, -800f, -1600f))
    motion.beginDrag()
    motion.configureRelease(1, 0f, listOf(800f, 0f, -800f))
    assertEquals(800f, motion.releaseTarget(0f, 100f, 64f))
    assertEquals(-800f, motion.releaseTarget(0f, -100f, 64f))
    // Even a matching owner cannot move an already captured adjacent target.
    motion.configureRelease(1, 0f, listOf(400f, 0f, -800f))
    assertEquals(800f, motion.releaseTarget(0f, 100f, 64f))
    motion.endDrag()
    motion.acceptRelease(-800f)
    motion.beginDrag()
    assertNull(motion.releaseTarget(0f, -100f, 64f))
  }

  @Test fun repeatedReleaseCannotAdvancePastMountedPreparedPages() {
    val motion = PlayerPageMotionState()
    motion.configureRelease(0, 0f, listOf(0f, -800f))
    motion.beginDrag()
    motion.endDrag()
    motion.acceptRelease(-800f)
    motion.beginDrag()
    assertNull(motion.releaseTarget(0f, -100f, 64f))
    assertEquals(0f, motion.releaseTarget(0f, 100f, 64f))
  }

  @Test fun mountedPagesCommittedAfterTheNextGrantExtendTheCurrentDrag() {
    for (direction in listOf(-1f, 1f)) {
      val motion = PlayerPageMotionState()
      motion.configureRelease(0, 0f, listOf(0f, direction * 800f))
      motion.beginDrag()
      motion.endDrag()
      motion.acceptRelease(direction * 800f)
      motion.beginDrag()
      // Mount revision 1 was rendered during finger 1 and arrives after GRANT 2.
      motion.configureRelease(1, direction * 800f,
        listOf(0f, direction * 800f, direction * 1600f))
      assertEquals(direction * 1600f, motion.releaseTarget(0f, direction * 100f, 64f))
    }
  }

  @Test fun mountingSnapshotCanExtendPagesWithoutRewindingItsNativeCenter() {
    val motion = PlayerPageMotionState()
    motion.configureRelease(0, 0f, listOf(0f, -800f, -1600f))
    motion.beginDrag()
    motion.endDrag()
    motion.acceptRelease(-800f)
    motion.beginDrag()
    motion.endDrag()
    motion.acceptRelease(-1600f)
    motion.beginDrag()
    // The mounted window includes the third target but React's center lags.
    motion.configureRelease(2, -800f, listOf(0f, -800f, -1600f, -2400f))
    assertEquals(-2400f, motion.releaseTarget(0f, -100f, 64f))
    assertEquals(-800f, motion.releaseTarget(0f, 100f, 64f))
  }

  @Test fun fourQuickReleasesInEitherDirectionUseLateMountsWithoutMovingTheDrag() {
    for (direction in listOf(-1f, 1f)) {
      val motion = PlayerPageMotionState()
      motion.configureRelease(0, 0f, listOf(-direction * 800f, 0f, direction * 800f))
      var center = 0f
      repeat(4) { step ->
        motion.beginDrag()
        val start = motion.position
        motion.moveDrag(0f, direction * 100f, 800f)
        // Geometry can be rendered from the previous center; its revision is
        // newer even when React has not handled the current GRANT yet.
        motion.configureRelease(step + 1, center - direction * 800f,
          (-1..2).map { center + direction * it * 800f })
        assertEquals(start + direction * 100f, motion.position, 0f)
        val target = center + direction * 800f
        assertEquals(target, motion.releaseTarget(0f, direction * 100f, 64f))
        motion.endDrag()
        motion.acceptRelease(target)
        motion.setPosition(target)
        center = target
      }
      motion.beginDrag()
      assertEquals(center - direction * 800f, motion.releaseTarget(0f, -direction * 100f, 64f))
      assertFalse(motion.acceptsCommand(motion.gestureId - 1, "set"))
    }
  }

  @Test fun externalSelectionRebasesThePreparedCenterAndAllowsItsNewPlan() {
    val motion = PlayerPageMotionState()
    motion.configureRelease(0, 0f, listOf(0f, -800f))
    motion.rebaseRelease(-800f)
    motion.configureRelease(1, -800f, listOf(0f, -800f, -1600f))
    motion.beginDrag()
    assertEquals(-1600f, motion.releaseTarget(0f, -100f, 64f))
    motion.endDrag()
    motion.rebaseRelease(2400f)
    motion.configureRelease(2, 2400f, listOf(2400f, 1600f))
    motion.beginDrag()
    assertEquals(1600f, motion.releaseTarget(0f, -100f, 64f))
  }

  @Test fun captureKeepsOriginalTwelveDipThresholdAndSinglePointer() {
    val motion = PlayerPageMotionState()
    assertFalse(motion.shouldCapture(0f, 12f, 1, 12f))
    assertTrue(motion.shouldCapture(0f, 12.01f, 1, 12f))
    assertTrue(motion.shouldCapture(-13f, 0f, 1, 12f))
    assertFalse(motion.shouldCapture(0f, 100f, 2, 12f))
  }

  @Test fun slowDragUpdatesEveryNativeMoveWithoutReactEvents() {
    val motion = PlayerPageMotionState()
    motion.beginDrag()
    for (distance in 1..300) {
      assertEquals(-distance.toFloat(), motion.moveDrag(0f, -distance.toFloat(), 800f), 0f)
    }
  }

  @Test fun captureIncludesTravelBeforeInterceptionAndFinalUpPosition() {
    val motion = PlayerPageMotionState()
    motion.beginDrag()
    assertEquals(-80f, motion.moveDrag(0f, -80f, 800f), 0f)
    assertEquals(-100f, motion.moveDrag(0f, -100f, 800f), 0f)
    motion.endDrag()
    assertEquals(-100f, motion.position, 0f)
  }

  @Test fun dragClampsToOnePageAndKeepsExactReversePosition() {
    val motion = PlayerPageMotionState()
    motion.setPosition(-400f)
    motion.beginDrag()
    assertEquals(-1200f, motion.moveDrag(0f, -900f, 800f), 0f)
    assertEquals(-368f, motion.moveDrag(0f, 32f, 800f), 0f)
    assertEquals(-368f, motion.moveDrag(100f, 10f, 800f), 0f)
  }

  @Test fun nextGestureStartsAtActualMidAnimationPosition() {
    val motion = PlayerPageMotionState()
    motion.beginAnimation(1)
    motion.animationPosition(1, -320f)
    motion.beginDrag()
    assertEquals(-320f, motion.dragBase, 0f)
    assertEquals(-200f, motion.moveDrag(0f, 120f, 800f), 0f)
  }

  @Test fun oldAnimationCannotWriteAfterNewGestureOrAfterItsOwnCancellation() {
    val motion = PlayerPageMotionState()
    motion.beginAnimation(1)
    motion.animationPosition(1, -320f)
    motion.beginDrag()
    motion.moveDrag(0f, 120f, 800f)
    assertFalse(motion.animationPosition(1, -800f))
    assertFalse(motion.finishAnimation(1, -800f))
    assertEquals(-200f, motion.position, 0f)
    motion.endDrag()
    motion.beginAnimation(2)
    motion.cancelAnimation()
    assertFalse(motion.finishAnimation(2, 0f))
  }

  @Test fun queuedOldGestureCommandsCannotMoveNewOwner() {
    val motion = PlayerPageMotionState()
    motion.beginDrag()
    motion.endDrag()
    val old = motion.gestureId
    motion.beginDrag()
    assertFalse(motion.acceptsCommand(old, "animate"))
    assertFalse(motion.acceptsCommand(old, "set"))
    assertFalse(motion.acceptsCommand(old, "stop"))
    assertFalse(motion.acceptsCommand(motion.gestureId, "animate"))
    assertTrue(motion.acceptsCommand(motion.gestureId, "stop"))
    motion.endDrag()
    assertTrue(motion.acceptsCommand(motion.gestureId, "animate"))
  }

  @Test fun oldCompletionCannotRewindNewAnimationAndCompletionIsOnce() {
    val motion = PlayerPageMotionState()
    motion.beginAnimation(1)
    motion.beginAnimation(2)
    assertTrue(motion.animationPosition(2, -250f))
    assertFalse(motion.finishAnimation(1, -800f))
    assertEquals(-250f, motion.position, 0f)
    assertTrue(motion.finishAnimation(2, 0f))
    assertFalse(motion.finishAnimation(2, -800f))
    assertEquals(0f, motion.position, 0f)
  }
}
