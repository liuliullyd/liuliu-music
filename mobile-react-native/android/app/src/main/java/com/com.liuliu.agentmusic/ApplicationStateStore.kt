package com.liuliu.agentmusic

import android.util.AtomicFile
import java.io.File
import java.io.InputStream

internal fun readApplicationStateBackup(input: InputStream): String =
  input.bufferedReader(Charsets.UTF_8).use { it.readText().removePrefix("\uFEFF") }

internal interface ApplicationStateFile {
  fun exists(): Boolean
  fun read(): String
  /** A failed write must retain the previously committed file. */
  fun write(value: String)
  fun delete()
}

internal class AtomicApplicationStateFile(private val path: File) : ApplicationStateFile {
  private val file = AtomicFile(path)
  override fun exists() = path.exists() || File(path.path + ".bak").exists()
  override fun read(): String = file.openRead().bufferedReader(Charsets.UTF_8).use { it.readText() }
  override fun write(value: String) {
    path.parentFile?.let { check(it.isDirectory || it.mkdirs()) { "无法创建本地状态目录" } }
    val output = file.startWrite()
    try {
      output.write(value.toByteArray(Charsets.UTF_8))
      output.fd.sync()
      file.finishWrite(output)
    } catch (error: Exception) {
      file.failWrite(output)
      throw error
    }
  }
  override fun delete() = file.delete()
}

internal class ApplicationStateStoreException(val code: String, message: String, cause: Throwable? = null) :
  Exception(message, cause)

/** One authoritative JSON document; the old preference is read only until a verified migration. */
internal class ApplicationStateStore(
  private val file: ApplicationStateFile,
  private val readLegacy: () -> String?,
  private val isMigrated: () -> Boolean,
  private val markMigrated: () -> Boolean,
) {
  companion object {
    // Also protects a new RN module reading while an older module finishes its queued write.
    private val lock = Any()
  }

  fun load(): String? = synchronized(lock) {
    try {
      if (file.exists()) return@synchronized file.read()
      if (isMigrated()) throw ApplicationStateStoreException(
        "STATE_FILE_MISSING", "本地状态文件缺失；已阻止旧数据或默认值覆盖",
      )
      readLegacy()
    } catch (error: ApplicationStateStoreException) {
      throw error
    } catch (error: Exception) {
      throw ApplicationStateStoreException("STATE_FILE_READ_FAILED", "无法读取本地应用状态", error)
    }
  }

  fun save(value: String) = synchronized(lock) {
    val previous = try {
      if (file.exists()) file.read() else {
        if (isMigrated()) throw ApplicationStateStoreException("STATE_FILE_MISSING", "本地状态文件缺失，禁止覆盖保存")
        null
      }
    } catch (error: ApplicationStateStoreException) { throw error }
    catch (error: Exception) {
      throw ApplicationStateStoreException("STATE_FILE_READ_FAILED", "无法核对原本地状态，禁止覆盖保存", error)
    }
    var committed = false
    try {
      file.write(value)
      committed = true
      if (file.read() != value) throw ApplicationStateStoreException("STATE_VERIFY_FAILED", "本地状态写入后核对失败")
      if (!isMigrated() && !markMigrated())
        throw ApplicationStateStoreException("STATE_MIGRATION_FAILED", "本地状态迁移标记未能可靠保存")
    } catch (error: Exception) {
      if (committed) {
        try {
          if (previous == null) {
            file.delete()
            check(!file.exists()) { "未能移除未提交状态" }
          } else {
            file.write(previous)
            check(file.read() == previous) { "本地状态回退核对失败" }
          }
        } catch (rollback: Exception) {
          error.addSuppressed(rollback)
          throw ApplicationStateStoreException("STATE_RECOVERY_FAILED", "本地状态写入与回退均失败，原偏好数据仍保留", error)
        }
      }
      if (error is ApplicationStateStoreException) throw error
      throw ApplicationStateStoreException("STATE_SAVE_FAILED", "本地状态未能可靠写入磁盘", error)
    }
  }
}
