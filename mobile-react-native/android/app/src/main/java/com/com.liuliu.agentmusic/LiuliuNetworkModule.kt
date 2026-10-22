package com.liuliu.agentmusic

import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

class LiuliuNetworkModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val connectivity = context.getSystemService(ConnectivityManager::class.java)
  private var observing = false
  private var listeners = 0
  private val callback = object : ConnectivityManager.NetworkCallback() {
    override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = emit()
    override fun onLost(network: Network) = emit()
  }
  override fun getName() = "LiuliuNetwork"
  private fun wifi(): Boolean = runCatching {
    connectivity.getNetworkCapabilities(connectivity.activeNetwork)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
  }.getOrDefault(false)
  private fun emit() {
    if (listeners > 0 && context.hasActiveReactInstance())
      context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("wifiNetworkChanged", wifi())
  }
  @ReactMethod fun getWifi(promise: Promise) { promise.resolve(wifi()) }
  @ReactMethod fun addListener(name: String) {
    listeners++
    if (!observing) { connectivity.registerDefaultNetworkCallback(callback); observing = true }
  }
  @ReactMethod fun removeListeners(count: Double) {
    listeners = (listeners - count.toInt()).coerceAtLeast(0)
    if (listeners == 0 && observing) { connectivity.unregisterNetworkCallback(callback); observing = false }
  }
  override fun invalidate() {
    if (observing) connectivity.unregisterNetworkCallback(callback)
    observing = false; listeners = 0
    super.invalidate()
  }
}
