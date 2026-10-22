package com.liuliu.agentmusic

import android.util.AtomicFile
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

/** A committed catalog points at immutable model files. Staging never changes the reader. */
class HeadphoneLibraryStore(filesDir: File, private val bundled: (String) -> String) {
  private val root = File(filesDir, "headphone-library")
  private val index = AtomicFile(File(root, "current.json"))
  private var transaction: String? = null
  private val ids = Regex("(?=.*[a-z0-9])[a-z0-9-]{1,221}")

  @Synchronized fun catalog(): String? = if (index.baseFile.exists() || File(root, "current.json.bak").exists()) index.openRead().use { it.readBytes().toString(Charsets.UTF_8) } else null

  @Synchronized fun profiles(id: String): String {
    require(ids.matches(id)) { "耳机型号编号无效" }
    val ref = catalog()?.let { JSONObject(it).optJSONObject("files")?.optString(id) }
    val text = if (!ref.isNullOrEmpty()) {
      require(Regex("[a-f0-9]{64}").matches(ref)) { "本地耳机文件标识无效" }
      File(root, "profiles/$ref.json").readText(Charsets.UTF_8)
    } else bundled(id)
    require(text.toByteArray(Charsets.UTF_8).size <= 1_000_000) { "本地耳机配置文件过大" }
    return text
  }

  @Synchronized fun begin(): String {
    check(transaction == null) { "已有耳机数据库更新正在进行" }
    // A killed process may leave an unpublished staging directory behind.
    File(root, "staging").listFiles().orEmpty().forEach { runCatching { removeStage(it) } }
    val token = UUID.randomUUID().toString()
    check(File(root, "staging/$token").mkdirs()) { "无法创建耳机更新目录" }
    transaction = token
    return token
  }

  @Synchronized fun stage(token: String, id: String, text: String) {
    check(token == transaction) { "耳机更新任务已失效" }
    require(ids.matches(id) && text.toByteArray(Charsets.UTF_8).size <= 1_000_000) { "耳机配置无效或过大" }
    val profiles = JSONArray(text)
    require(profiles.length() in 1..100) { "耳机配置数量无效" }
    for (i in 0 until profiles.length()) require(profiles.getJSONObject(i).getString("modelId") == id) { "耳机方案归属错误" }
    File(root, "staging/$token/$id.json").writeText(text, Charsets.UTF_8)
  }

  @Synchronized fun commit(token: String, value: String): String {
    check(token == transaction) { "耳机更新任务已失效" }
    require(value.toByteArray(Charsets.UTF_8).size <= 16_000_000) { "耳机目录过大" }
    val next = JSONObject(value)
    val models = next.getJSONArray("models")
    require(next.getInt("version") == 1 && models.length() in 1..30000 && next.getJSONArray("brands").length() in 1..10000) { "耳机目录无效" }
    val refs = catalog()?.let { JSONObject(it).optJSONObject("files") } ?: JSONObject()
    val staging = File(root, "staging/$token")
    val destination = File(root, "profiles").apply { mkdirs() }
    for (file in staging.listFiles().orEmpty()) {
      val bytes = file.readBytes()
      val hash = digest(bytes, "SHA-256")
      val target = File(destination, "$hash.json")
      if (!target.exists()) check(file.renameTo(target)) { "无法保存耳机参数" }
      refs.put(file.nameWithoutExtension, hash)
    }
    // Every committed model must have a complete local file or an APK fallback.
    for (i in 0 until models.length()) {
      val id = models.getJSONObject(i).getString("id")
      require(ids.matches(id)) { "耳机型号编号无效" }
      val ref = refs.optString(id)
      if (ref.isNotEmpty()) check(File(destination, "$ref.json").isFile) { "耳机参数未下载完整" }
      else bundled(id)
    }
    next.put("files", refs)
    val text = next.toString()
    root.mkdirs()
    val stream = index.startWrite()
    try {
      stream.write(text.toByteArray(Charsets.UTF_8))
      index.finishWrite(stream)
    } catch (error: Exception) {
      index.failWrite(stream)
      throw error
    }
    transaction = null
    runCatching {
      removeStage(staging)
      val used = refs.keys().asSequence().map { refs.getString(it) + ".json" }.toSet()
      destination.listFiles().orEmpty().filter { it.name !in used }.forEach { it.delete() }
    }
    return text
  }

  @Synchronized fun cancel(token: String) {
    if (transaction != token) return
    transaction = null
    removeStage(File(root, "staging/$token"))
    // Do not remove profiles referenced by the committed index after a failed commit.
    val refs = catalog()?.let { JSONObject(it).optJSONObject("files") } ?: JSONObject()
    val used = refs.keys().asSequence().map { refs.getString(it) + ".json" }.toSet()
    File(root, "profiles").listFiles().orEmpty().filter { it.name !in used }.forEach { it.delete() }
  }

  private fun removeStage(directory: File) {
    check(directory.canonicalPath.startsWith(File(root, "staging").canonicalPath + File.separator)) { "耳机暂存目录越界" }
    directory.listFiles().orEmpty().forEach { check(it.isFile); it.delete() }
    directory.delete()
  }

  companion object {
    fun digest(bytes: ByteArray, algorithm: String): String = MessageDigest.getInstance(algorithm).digest(bytes).joinToString("") { "%02x".format(it) }
    fun hash(text: String, gitBlob: Boolean): String {
      val bytes = text.toByteArray(Charsets.UTF_8)
      return digest(if (gitBlob) "blob ${bytes.size}\u0000".toByteArray(Charsets.UTF_8) + bytes else bytes, if (gitBlob) "SHA-1" else "SHA-256")
    }
  }
}
