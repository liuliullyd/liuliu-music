package com.liuliu.agentmusic

import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener

/** Per-request timer lease on the already mounted controller; never starts a React instance. */
internal class ReactRequestTasks(private val context: ReactApplicationContext, private val label: String) {
  private val pending = mutableMapOf<String, Int>()
  private var closed = false
  private val listener = object : HeadlessJsTaskEventListener {
    override fun onHeadlessJsTaskStart(taskId: Int) = Unit
    override fun onHeadlessJsTaskFinish(taskId: Int) {
      val id = pending.entries.firstOrNull { it.value == taskId }?.key ?: return
      pending.remove(id)
      Log.i("LiuliuCarTask", "$label finish id=$taskId remaining=${pending.size}")
    }
  }
  init { context.runOnUiQueueThread { HeadlessJsTaskContext.getInstance(context).addTaskEventListener(listener) } }
  fun start(event: String, payload: WritableMap, id: String, failed: (String) -> Unit): Boolean {
    if (closed || !context.hasActiveReactInstance()) return false
    context.runOnUiQueueThread {
      try {
        check(!closed && context.hasActiveReactInstance() && pending.size < 32) { "手机控制器未连接或操作过多" }
        val task = HeadlessJsTaskContext.getInstance(context).startTask(HeadlessJsTaskConfig("LiuliuCarLibrary",
          Arguments.createMap().apply { putString("event", event); putMap("payload", payload) }, 16_000L, true))
        pending[id] = task
        Log.i("LiuliuCarTask", "$label start id=$task event=$event")
      } catch (error: Exception) { failed(error.message ?: "车载请求无法启动") }
    }
    return true
  }
  fun finish(id: String) { context.runOnUiQueueThread {
    val task = pending[id] ?: return@runOnUiQueueThread
    val tasks = HeadlessJsTaskContext.getInstance(context)
    if (tasks.isTaskRunning(task)) tasks.finishTask(task)
  } }
  fun close() { context.runOnUiQueueThread {
    closed = true
    val tasks = HeadlessJsTaskContext.getInstance(context)
    pending.values.toList().forEach { if (tasks.isTaskRunning(it)) tasks.finishTask(it) }
    pending.clear(); tasks.removeTaskEventListener(listener)
  } }
}
