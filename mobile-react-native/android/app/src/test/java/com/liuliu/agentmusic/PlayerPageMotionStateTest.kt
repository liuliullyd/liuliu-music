package com.liuliu.agentmusic

import org.junit.Assert.*
import org.junit.Test

class PlayerPageMotionStateTest {
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
