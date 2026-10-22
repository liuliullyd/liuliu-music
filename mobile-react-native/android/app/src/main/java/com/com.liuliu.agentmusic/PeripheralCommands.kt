package com.liuliu.agentmusic

import org.json.JSONObject

/** Own protocol framing semantics; GATT and RFCOMM share this exact business dispatcher. */
internal class PeripheralCommands(private val business: (String, JSONObject) -> JSONObject) {
  private val completed = object : LinkedHashMap<Long, Pair<String, ByteArray>>() {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Long, Pair<String, ByteArray>>?) = size > 64
  }
  fun execute(text: String, decorate: (JSONObject) -> Unit = {}): ByteArray {
    var id: Long? = null
    val result = try {
      val input = JSONObject(text)
      id = input.getLong("id").also { require(it >= 0) { "请求ID必须非负" } }
      completed[id]?.let { cached ->
        return if (cached.first == text) cached.second else encode(JSONObject().put("id", id).put("error", "请求ID冲突"))
      }
      val action = input.getString("command")
      require(action !in listOf("RegisterPlayState", "UnRegisterPlayState", "PlayState", "MediaInfo", "LiuliuLiveMediaInfo", "StopSendData")) { "该命令仅适用于局域网会话" }
      val args = input.optJSONObject("args") ?: JSONObject()
      decorate(args)
      JSONObject().put("id", id).put("result", business(action, args))
    } catch (error: Exception) {
      JSONObject().apply { id?.takeIf { it >= 0 }?.let { put("id", it) } }.put("error", error.message?.take(160) ?: "外设操作失败")
    }
    return encode(result).also { bytes -> id?.takeIf { it >= 0 }?.let { completed[it] = text to bytes } }
  }
  private fun encode(value: JSONObject) = (value.toString() + "\n").toByteArray(Charsets.UTF_8)
}
