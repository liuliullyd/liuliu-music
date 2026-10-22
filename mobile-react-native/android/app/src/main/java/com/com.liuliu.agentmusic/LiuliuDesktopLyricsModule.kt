package com.liuliu.agentmusic

import android.content.Intent
import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import com.facebook.react.bridge.*
import com.facebook.react.common.LifecycleState
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject

class LiuliuDesktopLyricsModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), Application.ActivityLifecycleCallbacks, LifecycleEventListener {
  private val main = Handler(Looper.getMainLooper())
  private val visibleActivities = mutableSetOf<Activity>()
  private val application = context.applicationContext as Application
  override fun getName() = "LiuliuDesktopLyrics"
  init {
    DesktopLyricsOverlay.initialize(context) { action, value ->
      if (context.hasActiveReactInstance()) {
        val payload = Arguments.createMap().apply { putString("action", action); value?.let { putDouble("value", it) } }
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("desktopLyricsAction", payload)
      }
    }
    main.post {
      application.registerActivityLifecycleCallbacks(this)
      context.addLifecycleEventListener(this)
      if (context.lifecycleState == LifecycleState.RESUMED) context.currentActivity?.let { visibleActivities.add(it) }
      DesktopLyricsOverlay.setAppVisible(visibleActivities.isNotEmpty())
    }
  }
  override fun onActivityStarted(activity: Activity) { visibleActivities.add(activity); DesktopLyricsOverlay.setAppVisible(true) }
  override fun onActivityStopped(activity: Activity) {
    visibleActivities.remove(activity)
    if (!activity.isChangingConfigurations) DesktopLyricsOverlay.setAppVisible(visibleActivities.isNotEmpty())
  }
  override fun onActivityCreated(activity: Activity, state: Bundle?) = Unit
  override fun onActivityResumed(activity: Activity) { DesktopLyricsOverlay.setAppVisible(true) }
  override fun onActivityPaused(activity: Activity) = Unit
  override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) = Unit
  override fun onActivityDestroyed(activity: Activity) { visibleActivities.remove(activity) }
  override fun onHostResume() { main.post {
    if (context.lifecycleState == LifecycleState.RESUMED) {
      context.currentActivity?.let { visibleActivities.add(it) }
      DesktopLyricsOverlay.setAppVisible(true)
    }
  } }
  override fun onHostPause() = Unit // A paused activity may still be visible (dialogs/multi-window).
  override fun onHostDestroy() = Unit
  @ReactMethod fun canDraw(promise: Promise) { promise.resolve(Settings.canDrawOverlays(context)) }
  @ReactMethod fun wasClosed(promise: Promise) { main.post { promise.resolve(DesktopLyricsOverlay.wasClosed()) } }
  @ReactMethod fun acknowledgeClose(promise: Promise) { main.post { DesktopLyricsOverlay.acknowledgeClose(); promise.resolve(null) } }
  @ReactMethod fun requestPermission(promise: Promise) {
    main.post {
      try {
        val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent); promise.resolve(null)
      } catch (error: Exception) { promise.reject("LYRICS_PERMISSION", "无法打开悬浮权限设置", error) }
    }
  }
  @ReactMethod fun configure(enabled: Boolean, style: String, accent: String, promise: Promise) {
    main.post {
      try {
        if (enabled && !Settings.canDrawOverlays(context)) throw IllegalStateException("请先授予桌面歌词悬浮权限")
        DesktopLyricsOverlay.configure(enabled, style, accent); promise.resolve(null)
      } catch (error: Exception) { promise.reject("LYRICS_OVERLAY", error.message, error) }
    }
  }
  @ReactMethod fun setSong(json: String, promise: Promise) {
    main.post {
      try { DesktopLyricsOverlay.setSong(JSONObject(json)); promise.resolve(null) }
      catch (error: Exception) { promise.reject("LYRICS_SONG", "歌词信息无法读取", error) }
    }
  }
  @ReactMethod fun addListener(name: String) = Unit
  @ReactMethod fun removeListeners(count: Double) = Unit
  override fun invalidate() {
    main.post {
      application.unregisterActivityLifecycleCallbacks(this)
      context.removeLifecycleEventListener(this)
      visibleActivities.clear(); DesktopLyricsOverlay.closeForExit()
    }
    super.invalidate()
  }
}
