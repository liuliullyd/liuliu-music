package com.liuliu.agentmusic

import kotlin.math.abs

/** Coordinates and ownership shared by touch interception and the UI animator. */
internal class PlayerPageMotionState {
  var position = 0f
    private set
  var gestureId = 0
    private set
  var dragging = false
    private set
  var dragBase = 0f
    private set
  private var animationId: Int? = null

  fun shouldCapture(dx: Float, dy: Float, pointers: Int, threshold: Float) =
    pointers == 1 && maxOf(abs(dx), abs(dy)) > threshold

  fun beginDrag() {
    gestureId += 1
    animationId = null
    dragging = true
    dragBase = position
  }

  fun moveDrag(dx: Float, dy: Float, extent: Float): Float {
    if (dragging && abs(dy) > abs(dx))
      position = dragBase + dy.coerceIn(-extent, extent)
    return position
  }

  fun endDrag() {
    dragging = false
  }

  fun acceptsCommand(owner: Int, action: String) =
    owner == gestureId && (!dragging || action == "stop")

  fun setPosition(value: Float) {
    position = value
  }

  fun beginAnimation(id: Int) {
    animationId = id
  }

  fun cancelAnimation() {
    animationId = null
  }

  fun animationPosition(id: Int, value: Float): Boolean {
    if (animationId != id) return false
    position = value
    return true
  }

  fun finishAnimation(id: Int, value: Float): Boolean {
    if (!animationPosition(id, value)) return false
    animationId = null
    return true
  }
}
