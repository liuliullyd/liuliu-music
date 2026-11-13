package com.liuliu.agentmusic

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.util.Log
import android.view.MotionEvent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.PixelUtil
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.ViewGroupManager
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event
import com.facebook.react.uimanager.events.NativeGestureUtil
import com.facebook.react.views.view.ReactViewGroup
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.sin
import kotlin.math.sqrt

class PlayerPageMotionManager : ViewGroupManager<PlayerPageMotionView>() {
  override fun getName() = "LiuliuPlayerPageMotion"
  override fun createViewInstance(context: ThemedReactContext) = PlayerPageMotionView(context)

  @ReactProp(name = "pageExtent")
  fun setPageExtent(view: PlayerPageMotionView, extent: Float) {
    view.pageExtent = PixelUtil.toPixelFromDIP(extent).coerceAtLeast(1f)
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
    mutableMapOf(
      "topPageGesture" to mapOf("registrationName" to "onPageGesture"),
      "topMotionComplete" to mapOf("registrationName" to "onMotionComplete"),
    )

  override fun receiveCommand(view: PlayerPageMotionView, commandId: String, args: ReadableArray?) {
    if (commandId != "motion" || args == null || args.size() != 4) return
    view.command(args.getString(0) ?: return, args.getInt(1), args.getInt(2),
      PixelUtil.toPixelFromDIP(args.getDouble(3).toFloat()))
  }

  override fun onDropViewInstance(view: PlayerPageMotionView) {
    view.dispose()
    super.onDropViewInstance(view)
  }
}

private class PageMotionEvent(
  surface: Int,
  tag: Int,
  private val name: String,
  private val data: WritableMap,
) : Event<PageMotionEvent>(surface, tag) {
  override fun getEventName() = name
  override fun getEventData() = data
  override fun canCoalesce() = false
}

class PlayerPageMotionView(private val reactContext: ThemedReactContext) : ReactViewGroup(reactContext) {
  var pageExtent = 1f
  private val motion = PlayerPageMotionState()
  private val position get() = motion.position
  private var downX = 0f
  private var downY = 0f
  private var previewDirection = 0
  private var animation: ValueAnimator? = null
  private var animationCommand = 0
  private var disposed = false
  private val captureDistance = PixelUtil.toPixelFromDIP(12f)

  init {
    // Keep overflow pages drawable after the track translates outside its own
    // bounds. ReactViewGroup clips the viewport through dispatchDraw instead.
    overflow = "hidden"
  }

  override fun onViewAdded(child: android.view.View) {
    super.onViewAdded(child)
    child.translationY = position
  }

  private fun applyPosition(value: Float) {
    motion.setPosition(value)
    for (index in 0 until childCount) getChildAt(index).translationY = value
  }

  private fun emit(name: String, data: WritableMap) {
    if (disposed) return
    UIManagerHelper.getEventDispatcher(reactContext)?.dispatchEvent(
      PageMotionEvent(UIManagerHelper.getSurfaceId(this), id, name, data))
  }

  private fun complete(command: Int, finished: Boolean) {
    Log.i("LiuliuPlayerDiagnostics", "page-motion complete command=$command owner=${motion.gestureId} finished=$finished position=${PixelUtil.toDIPFromPixel(position)}")
    emit("topMotionComplete", Arguments.createMap().apply {
      putInt("id", command)
      putBoolean("finished", finished)
      putDouble("position", PixelUtil.toDIPFromPixel(position).toDouble())
    })
  }

  private fun cancelAnimation() {
    motion.cancelAnimation()
    val old = animation ?: return
    animation = null
    old.cancel()
    complete(animationCommand, false)
  }

  fun command(action: String, command: Int, owner: Int, target: Float) {
    // A command queued before a later finger gesture has no position ownership.
    if (!motion.acceptsCommand(owner, action) || disposed) {
      complete(command, false)
      return
    }
    cancelAnimation()
    if (action == "stop") {
      complete(command, true)
      return
    }
    if (action == "set") {
      applyPosition(target)
      return
    }
    val start = position
    val next = ValueAnimator.ofFloat(0f, 1f)
    animation = next
    animationCommand = command
    motion.beginAnimation(command)
    next.duration = if (action == "spring") 800L else 240L
    next.interpolator = android.animation.TimeInterpolator { fraction ->
      if (action == "spring") {
        // React Native converts Origami tension/friction before solving the spring.
        val time = fraction * 0.8f
        val stiffness = (80f - 30f) * 3.62f + 194f
        val damping = ((9f - 8f) * 3f + 25f) / 2f
        val frequency = sqrt(stiffness - damping * damping)
        1f - exp(-damping * time) *
          (cos(frequency * time) + damping / frequency * sin(frequency * time))
      } else 1f - (1f - fraction) * (1f - fraction) * (1f - fraction)
    }
    next.addUpdateListener {
      if (motion.animationPosition(command, start + (target - start) * (it.animatedValue as Float)))
        applyPosition(motion.position)
    }
    next.addListener(object : AnimatorListenerAdapter() {
      override fun onAnimationEnd(animator: Animator) {
        if (animation !== next || !motion.finishAnimation(command, target)) return
        animation = null
        applyPosition(target)
        complete(command, true)
      }
    })
    next.start()
  }

  private fun gesture(phase: String, event: MotionEvent) {
    if (phase != "move") Log.i("LiuliuPlayerDiagnostics", "page-motion phase=$phase owner=${motion.gestureId} base=${PixelUtil.toDIPFromPixel(motion.dragBase)} position=${PixelUtil.toDIPFromPixel(position)} dy=${PixelUtil.toDIPFromPixel(event.y - downY)}")
    emit("topPageGesture", Arguments.createMap().apply {
      putString("phase", phase)
      putInt("gestureId", motion.gestureId)
      putDouble("position", PixelUtil.toDIPFromPixel(motion.dragBase).toDouble())
      putDouble("dx", PixelUtil.toDIPFromPixel(event.x - downX).toDouble())
      putDouble("dy", PixelUtil.toDIPFromPixel(event.y - downY).toDouble())
    })
  }

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    if (event.actionMasked == MotionEvent.ACTION_DOWN) {
      downX = event.x
      downY = event.y
      previewDirection = 0
    }
    return super.dispatchTouchEvent(event)
  }

  private fun captureGesture(event: MotionEvent): Boolean {
    if (event.actionMasked != MotionEvent.ACTION_MOVE ||
      !motion.shouldCapture(event.x - downX, event.y - downY, event.pointerCount, captureDistance)) return false
    cancelAnimation()
    motion.beginDrag()
    parent?.requestDisallowInterceptTouchEvent(true)
    NativeGestureUtil.notifyNativeGestureStarted(this, event)
    gesture("grant", event)
    return true
  }

  override fun onInterceptTouchEvent(event: MotionEvent): Boolean =
    motion.dragging || captureGesture(event)

  override fun onTouchEvent(event: MotionEvent): Boolean {
    // Once the translated track misses DOWN, Android sends this container the
    // rest of the stream directly and skips onInterceptTouchEvent for MOVE.
    if (!motion.dragging && !captureGesture(event)) return true
    if (event.pointerCount != 1) {
      motion.endDrag()
      gesture("terminate", event)
      NativeGestureUtil.notifyNativeGestureEnded(this, event)
      parent?.requestDisallowInterceptTouchEvent(false)
      return true
    }
    val dx = event.x - downX
    val dy = event.y - downY
    if (abs(dy) > abs(dx)) {
      applyPosition(motion.moveDrag(dx, dy, pageExtent))
      val direction = if (dy < 0) -1 else 1
      if (direction != previewDirection) {
        previewDirection = direction
        gesture("move", event)
      }
    }
    if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) {
      motion.endDrag()
      gesture(if (event.actionMasked == MotionEvent.ACTION_UP) "release" else "terminate", event)
      NativeGestureUtil.notifyNativeGestureEnded(this, event)
      parent?.requestDisallowInterceptTouchEvent(false)
    }
    return true
  }

  fun dispose() {
    disposed = true
    motion.cancelAnimation()
    animation?.removeAllListeners()
    animation?.cancel()
    animation = null
  }
}
