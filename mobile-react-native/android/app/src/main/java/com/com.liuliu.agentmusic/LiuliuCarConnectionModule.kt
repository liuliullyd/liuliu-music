package com.liuliu.agentmusic

import android.content.Intent
import com.facebook.react.bridge.*
import org.json.JSONObject

class LiuliuCarConnectionModule(private val react: ReactApplicationContext) : ReactContextBaseJavaModule(react) {
  private val tasks = ReactRequestTasks(react, "connection")
  override fun getName() = "LiuliuCarConnection"
  private val eventSink: (String) -> Boolean = { request ->
    val id = JSONObject(request).getString("id")
    tasks.start("carConnectionRequest", Arguments.createMap().apply { putString("requestId", id); putString("request", request) }, id) {
      CarConnectionState.complete(id, CarConnectionState.error(it))
    }
  }
  override fun initialize() { super.initialize(); CarConnectionState.main.post {
    if (CarConnectionState.sink != null && CarConnectionState.sink !== eventSink) CarConnectionState.closeBridge()
    CarConnectionState.sink = eventSink
  } }
  @ReactMethod fun addListener(name: String) { }
  @ReactMethod fun removeListeners(count: Double) { }
  @ReactMethod fun foreground(value: Boolean) { CarPlayerActivity.phoneForeground = value }
  @ReactMethod fun isRequestActive(id: String, promise: Promise) { CarConnectionState.main.post { promise.resolve(CarConnectionState.activeRequest(id)) } }
  @ReactMethod fun isSearchSessionActive(session: String, promise: Promise) { CarConnectionState.main.post {
    val valid = when {
      session == "local" -> true
      session.startsWith("peripheral:") -> session == "peripheral:${CarConnections.peripheral?.connectionGeneration()}"
      else -> false
    }
    promise.resolve(valid && CarConnectionState.snapshot.optBoolean("ready"))
  } }
  @ReactMethod fun publish(json: String) { CarConnectionState.main.post { runCatching { CarConnectionState.publish(JSONObject(json)) } } }
  @ReactMethod fun complete(id: String, json: String) { CarConnectionState.main.post {
    runCatching { CarConnectionState.complete(id, JSONObject(json)) }; tasks.finish(id)
  } }
  @ReactMethod fun open(promise: Promise) {
    try { react.startActivity(Intent(react, CarPlayerActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); promise.resolve(true) }
    catch (error: Exception) { promise.reject("CAR_OPEN", error) }
  }
  override fun invalidate() { tasks.close(); CarConnectionState.main.post { if (CarConnectionState.sink === eventSink) CarConnectionState.closeBridge() }; super.invalidate() }
}
