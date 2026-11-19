package com.liuliu.agentmusic

import android.provider.Settings
import android.util.Log
import android.view.Choreographer
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

class PlayerPageMotionManager : ViewGroupManager<PlayerPageMotionView>() {
  override fun getName() = "LiuliuPlayerPageMotion"
  override fun createViewInstance(context: ThemedReactContext) = PlayerPageMotionView(context)

  @ReactProp(name = "pageExtent")
  fun setPageExtent(view: PlayerPageMotionView, extent: Float) {
    view.pageExtent = PixelUtil.toPixelFromDIP(extent).coerceAtLeast(1f)
  }

  @ReactProp(name = "releasePlan")
  fun setReleasePlan(view: PlayerPageMotionView, plan: ReadableArray?) {
    view.configureRelease(plan)
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
  private var animation: Choreographer.FrameCallback? = null
  private var animationCommand = 0
  private var automaticTarget: Float? = null
  private var automaticFinished = false
  private var disposed = false
  private val captureDistance = PixelUtil.toPixelFromDIP(12f)

  fun configureRelease(plan: ReadableArray?) {
    if (plan == null || plan.size() == 0) return
    if (plan.size() < 3) { motion.clearReleasePlan(plan.getInt(0)); return }
    val accepted = motion.configureRelease(plan.getInt(0), PixelUtil.toPixelFromDIP(plan.getDouble(1).toFloat()),
      (2 until plan.size()).map { PixelUtil.toPixelFromDIP(plan.getDouble(it).toFloat()) })
    Log.i("LiuliuPlayerDiagnostics", "page-motion mounted revision=${plan.getInt(0)} owner=${motion.gestureId} center=${plan.getDouble(1)} accepted=$accepted pages=${(2 until plan.size()).joinToString(",") { plan.getDouble(it).toString() }}")
  }

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
    automaticTarget = null
    automaticFinished = false
    motion.cancelAnimation()
    val old = animation ?: return
    animation = null
    Choreographer.getInstance().removeFrameCallback(old)
    complete(animationCommand, false)
  }

  fun command(action: String, command: Int, owner: Int, target: Float) {
    // A command queued before a later finger gesture has no position ownership.
    if (!motion.acceptsCommand(owner, action) || disposed) {
      complete(command, false)
      return
    }
    // UP already started this exact prepared-page animation on the UI thread.
    // Attach React's completion without restarting its clock or pixel position.
    if (action == "animate" && automaticTarget == target) {
      automaticTarget = null
      if (automaticFinished) complete(command, true)
      else animationCommand = command
      return
    }
    cancelAnimation()
    if (action == "stop") {
      complete(command, true)
      return
    }
    if (action == "set") {
      motion.rebaseRelease(target)
      applyPosition(target)
      return
    }
    motion.rebaseRelease(target)
    val timeline = PlayerPageAnimation(position, target, System.nanoTime(), action == "spring",
      Settings.Global.getFloat(reactContext.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f))
    animationCommand = command
    motion.beginAnimation(command)
    // Anchor to UP/command receipt. A delayed first frame consumes elapsed time
    // instead of becoming another zero-progress frame before the slide resumes.
    val next = object : Choreographer.FrameCallback {
      override fun doFrame(frameTimeNanos: Long) {
        if (animation !== this || disposed) return
        if (timeline.finishedAt(frameTimeNanos)) {
          if (!motion.finishAnimation(command, target)) return
          animation = null
          applyPosition(target)
          if (automaticTarget == target) automaticFinished = true
          complete(animationCommand, true)
        } else if (motion.animationPosition(command, timeline.positionAt(frameTimeNanos))) {
          applyPosition(motion.position)
          Choreographer.getInstance().postFrameCallback(this)
        }
      }
    }
    animation = next
    Choreographer.getInstance().postFrameCallback(next)
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
      if (event.actionMasked == MotionEvent.ACTION_MOVE)
        applyPosition(motion.moveDrag(dx, dy, pageExtent))
      else if (event.actionMasked == MotionEvent.ACTION_UP)
        applyPosition(motion.releasePosition(dx, dy, pageExtent))
      val direction = if (dy < 0) -1 else 1
      if (direction != previewDirection) {
        previewDirection = direction
        gesture("move", event)
      }
    }
    if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) {
      val target = if (event.actionMasked == MotionEvent.ACTION_UP)
        motion.releaseTarget(dx, dy, PixelUtil.toPixelFromDIP(64f)) else null
      Log.i("LiuliuPlayerDiagnostics", "page-motion prepared owner=${motion.gestureId} target=${target?.let { PixelUtil.toDIPFromPixel(it) }}")
      motion.endDrag()
      if (target != null) {
        motion.acceptRelease(target)
        command("animate", 0, motion.gestureId, target)
        automaticTarget = target
        automaticFinished = false
      }
      gesture(if (event.actionMasked == MotionEvent.ACTION_UP) "release" else "terminate", event)
      NativeGestureUtil.notifyNativeGestureEnded(this, event)
      parent?.requestDisallowInterceptTouchEvent(false)
    }
    return true
  }

  fun dispose() {
    disposed = true
    motion.cancelAnimation()
    animation?.let { Choreographer.getInstance().removeFrameCallback(it) }
    animation = null
  }
}
