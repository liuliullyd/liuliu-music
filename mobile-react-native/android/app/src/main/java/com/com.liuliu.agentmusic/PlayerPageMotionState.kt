package com.liuliu.agentmusic

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.sin
import kotlin.math.sqrt

/** A frame samples elapsed release time, including time before the first vsync. */
internal class PlayerPageAnimation(
  private val start: Float,
  private val target: Float,
  private val startedAtNanos: Long,
  private val spring: Boolean,
  durationScale: Float = 1f,
) {
  private val durationNanos = ((if (spring) 800L else 240L) * 1_000_000L * durationScale.coerceAtLeast(0f)).toLong()

  fun finishedAt(frameTimeNanos: Long) = frameTimeNanos - startedAtNanos >= durationNanos

  fun positionAt(frameTimeNanos: Long): Float {
    if (finishedAt(frameTimeNanos)) return target
    val fraction = ((frameTimeNanos - startedAtNanos).toDouble() / durationNanos).coerceIn(0.0, 1.0).toFloat()
    val progress = if (spring) {
      val time = fraction * 0.8f
      val stiffness = (80f - 30f) * 3.62f + 194f
      val damping = ((9f - 8f) * 3f + 25f) / 2f
      val frequency = sqrt(stiffness - damping * damping)
      1f - exp(-damping * time) *
        (cos(frequency * time) + damping / frequency * sin(frequency * time))
    } else 1f - (1f - fraction) * (1f - fraction) * (1f - fraction)
    return start + (target - start) * progress
  }
}

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
  private data class ReleasePlan(val center: Float, val pages: List<Float>)
  private var releasePlan: ReleasePlan? = null
  private var dragReleasePlan: ReleasePlan? = null
  private var preparedRevision = -1

  fun configureRelease(revision: Int, center: Float, pages: List<Float>): Boolean {
    // Mounted geometry belongs to its React commit, not the finger which was
    // active when React rendered it. That finger may have ended before commit.
    if (revision <= preparedRevision) return false
    preparedRevision = revision
    val current = if (dragging) dragReleasePlan else releasePlan
    // A late render can refresh mounted neighbours, but only accepted native
    // releases and owned position commands may move an established center.
    val updated = ReleasePlan(current?.center ?: center, pages.distinct().sortedDescending())
    if (dragging && current != null) {
      val oldIndex = current.pages.indexOf(current.center)
      val newIndex = updated.pages.indexOf(current.center)
      if (oldIndex < 0 || newIndex < 0) return false
      // Accept newly mounted neighbours without replacing either target that
      // this gesture already captured. Distant pages may leave the window.
      for (direction in listOf(-1, 1)) {
        val captured = current.pages.getOrNull(oldIndex + direction)
        if (captured != null && captured != updated.pages.getOrNull(newIndex + direction)) return false
      }
    }
    releasePlan = updated
    if (dragging) dragReleasePlan = updated
    return true
  }

  fun clearReleasePlan(revision: Int) {
    if (revision <= preparedRevision) return
    preparedRevision = revision
    releasePlan = null
  }

  fun releaseTarget(dx: Float, dy: Float, threshold: Float): Float? {
    if (abs(dy) < threshold || abs(dx) > abs(dy)) return null
    val plan = dragReleasePlan ?: return null
    val index = plan.pages.indexOf(plan.center)
    if (index < 0) return null
    return plan.pages.getOrNull(index + if (dy < 0f) 1 else -1)
  }

  fun acceptRelease(target: Float) {
    releasePlan = dragReleasePlan?.copy(center = target)
  }

  fun rebaseRelease(target: Float) {
    releasePlan = ReleasePlan(target, releasePlan?.pages.orEmpty())
  }

  fun shouldCapture(dx: Float, dy: Float, pointers: Int, threshold: Float) =
    pointers == 1 && maxOf(abs(dx), abs(dy)) > threshold

  fun beginDrag() {
    dragReleasePlan = releasePlan
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

  fun releasePosition(dx: Float, dy: Float, extent: Float): Float {
    if (!dragging || abs(dy) <= abs(dx)) return position
    val terminal = dragBase + dy.coerceIn(-extent, extent)
    // A resampled MOVE can extend beyond UP. Retain displayed travel, while
    // still accepting forward travel delivered only by the terminal event.
    if ((dy < 0f && terminal < position) || (dy > 0f && terminal > position)) position = terminal
    return position
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
