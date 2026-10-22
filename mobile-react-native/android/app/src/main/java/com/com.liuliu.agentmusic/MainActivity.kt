package com.liuliu.agentmusic

import android.os.Bundle
import android.os.Build
import android.view.View
import android.view.ViewTreeObserver
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.uimanager.util.ReactFindViewUtil

class MainActivity : ReactActivity() {
  private var initialDraw: ViewTreeObserver.OnPreDrawListener? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme)
    super.onCreate(savedInstanceState)
    val decor = window.decorView
    val listener = object : ViewTreeObserver.OnPreDrawListener {
      override fun onPreDraw(): Boolean {
        if (!hasReadyStartupSplash(decor)) return false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) setTranslucent(false)
        decor.viewTreeObserver.removeOnPreDrawListener(this)
        initialDraw = null
        return true
      }
    }
    initialDraw = listener
    decor.viewTreeObserver.addOnPreDrawListener(listener)
  }

  private fun hasReadyStartupSplash(view: View): Boolean {
    // Safe-area/root containers can mount before the themed splash. Releasing
    // on their presence exposes an unthemed window between the two commits.
    val splash = ReactFindViewUtil.findView(view, "liuliu-startup-splash") ?: return false
    return splash.isAttachedToWindow && splash.isLaidOut && splash.isShown &&
      splash.width > 0 && splash.height > 0
  }

  override fun onDestroy() {
    initialDraw?.let { window.decorView.viewTreeObserver.removeOnPreDrawListener(it) }
    initialDraw = null
    super.onDestroy()
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "LiuliuMusic"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
