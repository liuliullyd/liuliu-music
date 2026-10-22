package com.liuliu.agentmusic

import org.json.JSONObject

/** JVM contract runner for the production app-owned peripheral dispatcher. */
fun main() {
  var calls = 0
  val router = PeripheralCommands { action, args -> calls++; JSONObject().put("action", action).put("value", args.optInt("value")) }
  fun request(id: Int, action: String, protocol: String = "liuliu-car-v1") =
    JSONObject().put("protocol", protocol).put("id", id).put("command", action).put("args", JSONObject().put("value", 7)).toString()
  fun reply(text: String) = JSONObject(String(router.execute(text), Charsets.UTF_8))
  val first = router.execute(request(1, "pause"))
  check(JSONObject(String(first)).getString("protocol") == "liuliu-car-v1")
  check(calls == 1)
  check(router.execute(request(1, "pause")).contentEquals(first) && calls == 1)
  check(reply(request(1, "play")).has("error") && calls == 1)
  check(reply(request(2, "play", "other-protocol")).has("error") && calls == 1)
  check(reply(request(3, "unknown")).has("error") && calls == 1)
  check(reply(request(-1, "play")).has("error") && calls == 1)
  check(reply("{malformed").has("error") && calls == 1)
  PeripheralCommands.COMMANDS.forEachIndexed { index, action ->
    check(reply(request(index + 10, action)).getJSONObject("result").getString("action") == action)
  }
  val frames = PeripheralFrames(128)
  val collected = mutableListOf<String>()
  val bytes = (request(60, "stop") + "\n").toByteArray()
  bytes.forEach { frames.accept(byteArrayOf(it), collected::add) }
  check(collected == listOf(request(60, "stop")))
  frames.accept("one\r\ntwo\n".toByteArray(), collected::add)
  check(collected.takeLast(2) == listOf("one", "two"))
  check(runCatching { PeripheralFrames(3).accept("toolong".toByteArray()) {} }.isFailure)
  check(CarPlaybackMode.next("sequence") == "shuffle")
  check(CarPlaybackMode.next("shuffle") == "repeat-one")
  check(CarPlaybackMode.next("repeat-one") == "sequence")
  println("App-owned car contract passed: version, dispatch, duplicate/conflict, rejection, segmented framing, limits and playback modes.")
}
