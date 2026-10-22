package com.liuliu.agentmusic

import org.json.JSONObject
import java.io.InputStream
import java.io.OutputStream
import java.io.ByteArrayOutputStream

/** Evidence-backed QPlay envelopes. Additional six-six fields are explicitly extensions. */
internal object CarProtocol {
  // Observed QQ builders. Extensions live under Liuliu* commands, never in these standard objects.
  private val responseFields = mapOf(
    "MobileDeviceInfos" to setOf("Brand", "Models", "OS", "OSVer", "AppVer", "Mac", "Ver", "Network"),
    "NetworkState" to setOf("State"),
    "Items" to setOf("Count", "ParentID", "PageIndex", "Lists"),
    "Search" to setOf("Key", "PageFlag", "Lists"),
    "PlaySong" to setOf("SongID", "ParentID", "Type", "Name", "Artist", "Album"),
    "RegisterPlayState" to setOf("State"),
    "MediaInfo" to setOf("SongID", "PCMDataLength", "Rate", "Bit", "Channel"),
    "PCMData" to setOf("SongID", "PackageIndex", "Length", "TotalLength"),
    "PICData" to setOf("SongID", "PackageIndex", "Length", "TotalLength"),
    "LyricData" to setOf("SongID", "PackageIndex", "Length", "TotalLength", "LyricType"),
    "PlayState" to setOf("SongID", "State", "Times", "Duration"),
  )
  fun standardResult(name: String, result: JSONObject): JSONObject {
    val fields = responseFields[name] ?: return result
    return JSONObject().apply { result.keys().forEach { key ->
      if (key in fields || key == "Error" || key == "ErrorMessage") put(key, result.get(key))
    } }
  }
  data class LibraryPage(val index: Int, val size: Int) {
    val offset: Long get() = index.toLong() * size
  }
  // QQ E(): negative page becomes zero; invalid or excessive page size becomes 50.
  fun libraryPage(index: Int, size: Int) = LibraryPage(index.coerceAtLeast(0), if (size <= 0 || size > 50) 50 else size)
  fun searchResult(key: String, continuation: Boolean, rows: org.json.JSONArray) =
    JSONObject().put("Key", key).put("PageFlag", if (continuation) 1 else 0).put("Lists", rows)
  fun libraryRows(items: List<androidx.media3.common.MediaItem>) = org.json.JSONArray().apply { items.forEach { item ->
    val metadata = item.mediaMetadata
    put(JSONObject().put("ID", item.mediaId).put("ParentID", metadata.extras?.getString("carParent") ?: "-1")
      .put("Name", metadata.title?.toString().orEmpty()).put("Artist", metadata.artist?.toString().orEmpty())
      .put("Album", metadata.albumTitle?.toString().orEmpty()).put("Duration", songListDuration(metadata.durationMs))
      .put("Type", if (metadata.isBrowsable == true) 2 else 1).put("HasChild", if (metadata.isBrowsable == true) 1 else 0)
      .put("IsSong", if (metadata.isBrowsable == true) 0 else 1))
  } }
  fun libraryResult(parent: String, page: LibraryPage, directory: List<androidx.media3.common.MediaItem>): JSONObject {
    val selected = if (page.offset >= directory.size) emptyList() else directory.drop(page.offset.toInt()).take(page.size)
    return JSONObject().put("ParentID", parent).put("PageIndex", page.index).put("Lists", libraryRows(selected)).put("Count", directory.size)
  }
  data class Binary(val bytes: ByteArray, val total: Long, val lyricType: Int? = null, val epoch: Long? = null,
    val lengthKind: String? = null, val measuredLength: Long? = null, val onSent: (() -> Unit)? = null)
  const val MAX_HEADER = 16_384
  const val MAX_PAYLOAD = 1_048_576
  // QQ's song-list Duration is whole seconds; PlayState.Duration and Times remain milliseconds.
  fun songListDuration(durationMs: Long?) = durationMs?.takeIf { it > 0 }?.div(1000) ?: -1L
  fun request(name: String, id: Long, args: JSONObject = JSONObject()) =
    JSONObject().put("Request", name).put("RequestID", id).put("Arguments", if (name == "PlayState") standardResult(name, args) else args)
  fun response(name: String, id: Long, result: JSONObject): JSONObject = JSONObject().apply {
    require(id >= 0)
    if (id != 0L) put("RequestID", id)
    put(name, standardResult(name, result))
  }
  fun responseKey(name: String) = when (name) { "PlayInfos" -> "PlaySong"; else -> name }
  fun hasSuccessResponse(name: String) = name !in setOf("DevicePlayPlay", "DevicePlayPause", "DevicePlayPre", "DevicePlayNext", "DevicePlayStop", "PlaySong", "StopSendData", "Disconnect", "UnRegisterPlayState", "PlayState", "Heartbeat")
  data class Frame(val header: JSONObject, val payload: ByteArray)
  fun write(output: OutputStream, header: JSONObject, payload: ByteArray) {
    require(payload.size <= MAX_PAYLOAD)
    val bytes = header.toString().toByteArray(Charsets.UTF_8)
    require(bytes.size <= MAX_HEADER)
    synchronized(output) { output.write(bytes); output.write(byteArrayOf(13, 10)); output.write(payload); output.flush() }
  }
  /** Reads exactly one frame, tolerating arbitrary TCP segmentation/coalescing. */
  fun read(input: InputStream): Frame {
    val header = ByteArrayOutputStream()
    var previous = -1
    while (true) {
      val next = input.read(); check(next >= 0) { "TCP closed in header" }
      if (previous == 13 && next == 10) break
      if (previous >= 0) header.write(previous)
      previous = next
      require(header.size() < MAX_HEADER) { "Header too large" }
    }
    val json = JSONObject(header.toString("UTF-8"))
    val key = json.keys().asSequence().firstOrNull { it != "RequestID" } ?: error("Missing data type")
    val length = json.getJSONObject(key).getInt("Length")
    require(length in 0..MAX_PAYLOAD) { "Invalid payload length" }
    val payload = ByteArray(length); var offset = 0
    while (offset < length) { val count = input.read(payload, offset, length - offset); check(count > 0) { "TCP closed in payload" }; offset += count }
    return Frame(json, payload)
  }
}
