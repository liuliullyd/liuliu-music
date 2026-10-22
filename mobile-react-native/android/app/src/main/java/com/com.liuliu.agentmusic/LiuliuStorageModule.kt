package com.liuliu.agentmusic

import android.app.Activity
import android.app.DownloadManager
import android.app.RecoverableSecurityException
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.content.ContentUris
import android.provider.OpenableColumns
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.os.Environment
import android.os.Build
import android.system.Os
import android.system.OsConstants
import android.webkit.WebStorage
import android.webkit.WebView
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.drawee.backends.pipeline.Fresco
import com.facebook.react.modules.network.OkHttpClientProvider
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.ConcurrentHashMap
import org.json.JSONObject

class LiuliuStorageModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context), ActivityEventListener {
  private val preferences = context.getSharedPreferences("liuliu_standalone_state", 0)
  private val stateStore by lazy {
    ApplicationStateStore(
      AtomicApplicationStateFile(File(context.filesDir, "application-state.json")),
      readLegacy = { preferences.getString("state", null) },
      isMigrated = { preferences.getBoolean("state_atomic_file_v1", false) },
      markMigrated = { preferences.edit().putBoolean("state_atomic_file_v1", true).commit() },
    )
  }
  private val bottomPlayerHints = context.getSharedPreferences("liuliu_bottom_player_hints", 0)
  private var sourceImportPromise: Promise? = null
  private var backupImportPromise: Promise? = null
  private var backupExportPromise: Promise? = null
  private var backupExportValue: String? = null
  private var directoryPromise: Promise? = null
  private var audioImportPromise: Promise? = null
  private var musicScanPromise: Promise? = null
  private data class MediaDirectoryScan(val preferenceKey: String, val promise: Promise, var awaitingResult: Boolean = false)
  @Volatile private var mediaDirectoryScan: MediaDirectoryScan? = null
  private var fileDeletePromise: Promise? = null
  private var fileDeleteUri: Uri? = null
  private val backgroundAudioProbes = ConcurrentHashMap<String, BackgroundAudioProbe>()
  private val downloadHeaderCalls = ConcurrentHashMap<String, okhttp3.Call>()

  init {
    context.addActivityEventListener(this)
    // Retire only the old backend persistence keys; user state and directories remain intact.
    val legacyBackendKeys = preferences.all.keys.filter { key ->
      key.startsWith("source_backend_hint_") || key.startsWith("source_backend_pool_")
    }
    if (legacyBackendKeys.isNotEmpty()) preferences.edit().apply {
      legacyBackendKeys.forEach { remove(it) }
    }.apply()
  }

  override fun getName() = "LiuliuStorage"

  override fun getConstants(): Map<String, Any> {
    val settings = runCatching {
      JSONObject(stateStore.load() ?: "{}").optJSONObject("settings")
    }.getOrNull()
    return mapOf(
      "startupTheme" to (settings?.optString("theme") ?: "white"),
      "startupAccent" to (settings?.optString("accent") ?: "")
    )
  }

  @ReactMethod fun getAppVersion(promise: Promise) {
    try {
      val version = context.packageManager
        .getPackageInfo(context.packageName, 0)
        .versionName
        ?.trim()
        .orEmpty()
      promise.resolve(version)
    } catch (error: Exception) {
      promise.reject("APP_VERSION_FAILED", "无法读取应用版本", error)
    }
  }

  override fun invalidate() {
    backgroundAudioProbes.values.forEach { it.cancel() }
    downloadHeaderCalls.values.forEach { it.cancel() }
    super.invalidate()
  }

  @ReactMethod
  fun load(promise: Promise) {
    stateIoExecutor.execute {
      try {
        val rawState = stateStore.load()
        if (rawState != null) {
          promise.resolve(rawState)
          return@execute
        }
        @Suppress("DEPRECATION")
        val packageInfo = try {
          context.packageManager.getPackageInfo(context.packageName, 0)
        } catch (error: Exception) {
          promise.reject("STATE_INSTALL_METADATA_FAILED", "无法确认本地状态是否应已存在", error)
          return@execute
        }
        if (shouldRejectMissingPersistedState(rawState, packageInfo.firstInstallTime, packageInfo.lastUpdateTime)) {
          promise.reject("STATE_MISSING_AFTER_UPDATE", "应用已更新，但本地状态缺失；为保护数据，已阻止默认值覆盖保存")
        } else promise.resolve(null)
      } catch (error: ApplicationStateStoreException) {
        promise.reject(error.code, error.message, error)
      } catch (error: Exception) {
        promise.reject("STATE_READ_FAILED", "无法读取本地应用状态", error)
      }
    }
  }
  private val headphoneLibrary by lazy { HeadphoneLibraryStore(context.filesDir) { id ->
    context.assets.open("headphones/$id.json").use { it.readBytes().toString(Charsets.UTF_8) }
  } }
  private fun headphoneIo(promise: Promise, action: () -> Any?) {
    ioExecutor.execute { try { promise.resolve(action()) } catch (error: Exception) {
      promise.reject("HEADPHONE_LIBRARY_FAILED", error.message ?: "本地耳机数据库操作失败", error)
    } }
  }
  @ReactMethod fun loadHeadphoneCatalog(promise: Promise) = headphoneIo(promise) { headphoneLibrary.catalog() }
  @ReactMethod fun beginHeadphoneUpdate(promise: Promise) = headphoneIo(promise) { headphoneLibrary.begin() }
  @ReactMethod fun stageHeadphoneModel(token: String, id: String, value: String, promise: Promise) = headphoneIo(promise) { headphoneLibrary.stage(token, id, value); null }
  @ReactMethod fun commitHeadphoneUpdate(token: String, value: String, promise: Promise) = headphoneIo(promise) { headphoneLibrary.commit(token, value) }
  @ReactMethod fun cancelHeadphoneUpdate(token: String, promise: Promise) = headphoneIo(promise) { headphoneLibrary.cancel(token); null }
  @ReactMethod fun headphoneHash(value: String, gitBlob: Boolean, promise: Promise) = headphoneIo(promise) { HeadphoneLibraryStore.hash(value, gitBlob) }
  @ReactMethod fun readBundledHeadphoneProfiles(modelId: String, promise: Promise) {
    if (!modelId.matches(Regex("(?=.*[a-z0-9])[a-z0-9-]{1,221}")))
      return promise.reject("HEADPHONE_ID_INVALID", "耳机型号编号无效")
    ioExecutor.execute {
      try {
        val text = headphoneLibrary.profiles(modelId)
        promise.resolve(text)
      } catch (error: Exception) {
        promise.reject("HEADPHONE_ASSET_FAILED", "本地耳机校准读取失败，可点击重试", error)
      }
    }
  }
  @ReactMethod fun loadBottomPlayerHints(promise: Promise) {
    promise.resolve(bottomPlayerHints.getInt("learned", 0))
  }
  @ReactMethod fun learnBottomPlayerHint(hint: String, promise: Promise) {
    val bit = when (hint) {
      "hide" -> 1
      "show" -> 2
      "previous" -> 4
      "next" -> 8
      else -> return promise.reject("UNKNOWN_PLAYER_HINT", "未知的播放器手势提示")
    }
    synchronized(bottomPlayerHints) {
      val learned = bottomPlayerHints.getInt("learned", 0) or bit
      if (bottomPlayerHints.edit().putInt("learned", learned).commit()) {
        promise.resolve(learned)
      } else {
        promise.reject("PLAYER_HINT_SAVE_FAILED", "无法保存播放器手势提示")
      }
    }
  }
  @ReactMethod fun md5(value: String, promise: Promise) {
    try {
      val digest = MessageDigest.getInstance("MD5").digest(value.toByteArray(Charsets.UTF_8))
      promise.resolve(digest.joinToString("") { "%02x".format(it) })
    } catch (error: Exception) {
      promise.reject("HASH_FAILED", "MD5 计算失败", error)
    }
  }
  @ReactMethod fun save(value: String, promise: Promise) {
    saveApplicationState(value, promise)
  }

  @ReactMethod fun saveDurable(value: String, promise: Promise) {
    saveApplicationState(value, promise)
  }

  private fun saveApplicationState(value: String, promise: Promise) {
    stateIoExecutor.execute {
      try {
        stateStore.save(value)
        promise.resolve(null)
      } catch (error: ApplicationStateStoreException) {
        promise.reject(error.code, error.message, error)
      } catch (error: Exception) {
        promise.reject("STATE_SAVE_FAILED", "本地状态未能可靠保存", error)
      }
    }
  }

  @ReactMethod
  fun pickSourceScript(promise: Promise) {
    if (sourceImportPromise != null) {
      promise.reject("SOURCE_IMPORT_BUSY", "已有音乐源文件选择器正在打开")
      return
    }
    val activity = context.currentActivity
    if (activity == null) {
      promise.reject("SOURCE_IMPORT_NO_ACTIVITY", "当前页面暂时无法打开文件选择器")
      return
    }
    sourceImportPromise = promise
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "*/*"
      putExtra(
        Intent.EXTRA_MIME_TYPES,
        arrayOf("application/javascript", "text/javascript", "text/plain", "application/octet-stream"),
      )
    }
    try {
      activity.startActivityForResult(intent, SOURCE_SCRIPT_REQUEST)
    } catch (error: Exception) {
      sourceImportPromise = null
      promise.reject("SOURCE_IMPORT_OPEN_FAILED", "无法打开系统文件选择器", error)
    }
  }
  private var headphoneImportPromise: Promise? = null
  @ReactMethod fun pickHeadphoneProfile(promise: Promise) {
    if(headphoneImportPromise!=null) return promise.reject("HEADPHONE_IMPORT_BUSY","已有耳机配置选择器正在打开")
    val activity=context.currentActivity ?: return promise.reject("HEADPHONE_IMPORT_ACTIVITY","无法打开文件选择器")
    headphoneImportPromise=promise
    try { activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply { addCategory(Intent.CATEGORY_OPENABLE); type="*/*" },HEADPHONE_IMPORT_REQUEST) }
    catch(error:Exception) { headphoneImportPromise=null;promise.reject("HEADPHONE_IMPORT_OPEN",error.message,error) }
  }

  @ReactMethod
  fun testSourceScript(script: String, promise: Promise) {
    if (script.toByteArray(Charsets.UTF_8).size > MAX_SOURCE_BYTES) {
      promise.reject("SOURCE_TEST_TOO_LARGE", "音乐源脚本不能超过 2 MB")
      return
    }
    val activity = context.currentActivity
    if (activity == null) {
      promise.reject("SOURCE_TEST_NO_ACTIVITY", "当前页面暂时无法测试音乐源")
      return
    }
    UiThreadUtil.runOnUiThread { SourceScriptRuntime(activity, script, promise).start() }
  }

  @ReactMethod
  fun resolveSourceScript(
    script: String,
    source: String,
    musicInfoJson: String,
    quality: String,
    promise: Promise,
  ) {
    if (script.toByteArray(Charsets.UTF_8).size > MAX_SOURCE_BYTES) {
      promise.reject("SOURCE_RESOLVE_TOO_LARGE", "音乐源脚本不能超过 2 MB")
      return
    }
    if (source !in MusicSourcePlatforms.allowed) {
      promise.reject("SOURCE_RESOLVE_PLATFORM", "不支持的音乐平台")
      return
    }
    val activity = context.currentActivity
    if (activity == null) {
      promise.reject("SOURCE_RESOLVE_NO_ACTIVITY", "当前页面暂时无法解析音乐源")
      return
    }
    UiThreadUtil.runOnUiThread {
      SourceScriptRuntime.resolve(activity, script, promise, source, musicInfoJson, quality)
    }
  }

  @ReactMethod
  fun resolveSourceScriptForHealth(
    script: String,
    source: String,
    musicInfoJson: String,
    quality: String,
    promise: Promise,
  ) {
    if (quality != "128k") {
      promise.reject("SOURCE_HEALTH_QUALITY", "启动检测只允许 128k")
      return
    }
    if (source !in MusicSourcePlatforms.allowed) {
      promise.reject("SOURCE_RESOLVE_PLATFORM", "不支持的音乐平台")
      return
    }
    if (script.toByteArray(Charsets.UTF_8).size > MAX_SOURCE_BYTES) {
      promise.reject("SOURCE_RESOLVE_TOO_LARGE", "音乐源脚本不能超过 2 MB")
      return
    }
    val activity = context.currentActivity
    if (activity == null) {
      promise.reject("SOURCE_RESOLVE_NO_ACTIVITY", "当前页面暂时无法解析音乐源")
      return
    }
    UiThreadUtil.runOnUiThread {
      SourceScriptRuntime.resolve(activity, script, promise, source, musicInfoJson, quality)
    }
  }

  @ReactMethod
  fun resolveSourceScriptAddress(
    script: String,
    source: String,
    musicInfoJson: String,
    quality: String,
    requestId: String,
    promise: Promise,
  ) {
    if (script.toByteArray(Charsets.UTF_8).size > MAX_SOURCE_BYTES) {
      promise.reject("SOURCE_RESOLVE_TOO_LARGE", "音乐源脚本不能超过 2 MB")
      return
    }
    if (source !in MusicSourcePlatforms.allowed) {
      promise.reject("SOURCE_RESOLVE_PLATFORM", "不支持的音乐平台")
      return
    }
    if (requestId.isBlank() || requestId.length > 128) {
      promise.reject("SOURCE_ADDRESS_REQUEST_ID", "URL 预解析请求标识无效")
      return
    }
    val activity = context.currentActivity
    if (activity == null) {
      promise.reject("SOURCE_RESOLVE_NO_ACTIVITY", "当前页面暂时无法解析音乐源")
      return
    }
    UiThreadUtil.runOnUiThread {
      SourceScriptRuntime.resolve(activity, script, promise, source, musicInfoJson, quality, requestId)
    }
  }

  @ReactMethod
  fun cancelSourceScriptAddress(requestId: String, promise: Promise) {
    UiThreadUtil.runOnUiThread {
      promise.resolve(SourceScriptRuntime.cancelAddress(requestId))
    }
  }

  @ReactMethod
  fun clearCache(parts: ReadableArray, promise: Promise) {
    try {
      val selected = mutableSetOf<String>()
      for (index in 0 until parts.size()) {
        if (!parts.isNull(index)) parts.getString(index)?.let { selected.add(it) }
      }
      require(selected.all { it in setOf("network", "local-artwork") }) { "未知缓存清理项目" }
      UiThreadUtil.runOnUiThread {
        try {
          if ("network" in selected) {
            WebStorage.getInstance().deleteAllData()
            // Clear WebView's disk cache without stopping/reloading a warmed
            // source runtime. This temporary view never loads a page or script.
            WebView(context).apply { clearCache(true); destroy() }
            Fresco.getImagePipeline().clearMemoryCaches()
          }
          ioExecutor.execute {
            try {
              var networkEntries = 0
              val deletedArtwork = mutableListOf<String>()
              var removedBytes = 0L
              var failedFiles = 0
              if ("network" in selected) {
                OkHttpClientProvider.getOkHttpClient().cache?.evictAll()
                Fresco.getImagePipeline().clearDiskCaches()
                val caches = Fresco.getImagePipelineFactory().diskCachesStoreSupplier.get()
                (listOf(caches.mainFileCache, caches.smallImageFileCache) +
                  caches.dynamicFileCaches.values).distinct().forEach { it.clearAll() }
                val roots = listOfNotNull(context.cacheDir, context.externalCacheDir)
                  .distinctBy { it.canonicalPath }
                roots.forEach { root ->
                  failedFiles += deleteCacheFiles(root) { _, size ->
                    networkEntries += 1
                    removedBytes += size
                  }
                }
              }
              if ("local-artwork" in selected) {
                val root = File(context.filesDir, "local-artwork")
                failedFiles += deleteCacheFiles(root) { file, size ->
                  deletedArtwork += Uri.fromFile(file).toString()
                  removedBytes += size
                }
              }
              promise.resolve(Arguments.createMap().apply {
                putInt("networkEntries", networkEntries)
                putInt("localArtworkFiles", deletedArtwork.size)
                putDouble("removedBytes", removedBytes.toDouble())
                putInt("failedFiles", failedFiles)
                putArray("deletedArtworkUris", Arguments.createArray().apply {
                  deletedArtwork.forEach(::pushString)
                })
              })
            } catch (error: Exception) {
              promise.reject("CACHE_CLEAR_FAILED", "部分缓存未能清理，请重试", error)
            }
          }
        } catch (error: Exception) {
          promise.reject("CACHE_CLEAR_FAILED", "缓存清理失败", error)
        }
      }
    } catch (error: Exception) {
      promise.reject("CACHE_CLEAR_FAILED", "缓存清理失败", error)
    }
  }

  /** Traverse only the selected private cache root; never follow links outside it. */
  private fun deleteCacheFiles(root: File, onDeleted: (File, Long) -> Unit): Int {
    if (!root.exists()) return 0
    val canonicalRoot = root.canonicalFile
    val prefix = canonicalRoot.absolutePath + File.separator
    var failures = 0
    fun remove(entry: File) {
      try {
      check(entry.canonicalPath == entry.absolutePath) { "缓存路径包含外部链接" }
      check(entry == canonicalRoot || entry.absolutePath.startsWith(prefix)) { "缓存路径越界" }
      if (!entry.exists()) return
      if (entry.isDirectory) {
        val children = checkNotNull(entry.listFiles()) { "无法读取缓存目录" }
        children.forEach(::remove)
        if (entry != canonicalRoot) check(entry.delete() || !entry.exists()) { "无法删除缓存目录" }
      } else {
        val size = entry.length()
        check(entry.delete() || !entry.exists()) { "无法删除缓存文件" }
        onDeleted(File(root, entry.relativeTo(canonicalRoot).path), size)
      }
      } catch (_: Exception) { failures += 1 }
    }
    remove(canonicalRoot)
    return failures
  }

  @ReactMethod
  fun chooseDownloadDirectory(promise: Promise) {
    if (directoryPromise != null) return promise.reject("DIRECTORY_BUSY", "目录选择器正在打开")
    val activity = context.currentActivity ?: return promise.reject("DIRECTORY_NO_ACTIVITY", "当前页面无法选择目录")
    directoryPromise = promise
    activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
    }, DIRECTORY_REQUEST)
  }

  @ReactMethod
  fun exportBackup(value: String, promise: Promise) {
    if (backupExportPromise != null) return promise.reject("BACKUP_EXPORT_BUSY", "备份文件选择器正在打开")
    val activity = context.currentActivity ?: return promise.reject("BACKUP_EXPORT_NO_ACTIVITY", "当前页面无法导出备份")
    backupExportPromise = promise
    backupExportValue = value
    activity.startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "application/json"
      putExtra(Intent.EXTRA_TITLE, "liuliu-music-backup.json")
    }, BACKUP_EXPORT_REQUEST)
  }

  @ReactMethod
  fun importBackup(promise: Promise) {
    if (backupImportPromise != null) return promise.reject("BACKUP_IMPORT_BUSY", "恢复文件选择器正在打开")
    val activity = context.currentActivity ?: return promise.reject("BACKUP_IMPORT_NO_ACTIVITY", "当前页面无法恢复备份")
    backupImportPromise = promise
    activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "application/json"
    }, BACKUP_IMPORT_REQUEST)
  }

  @ReactMethod
  fun pickAudioFiles(promise: Promise) {
    if (audioImportPromise != null) return promise.reject("AUDIO_IMPORT_BUSY", "本地音乐选择器正在打开")
    val activity = context.currentActivity ?: return promise.reject("AUDIO_IMPORT_NO_ACTIVITY", "当前页面无法选择本地音乐")
    audioImportPromise = promise
    activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "audio/*"
      putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
    }, AUDIO_IMPORT_REQUEST)
  }

  @ReactMethod
  fun scanMusicDirectory(promise: Promise) {
    if (musicScanPromise != null || mediaDirectoryScan != null) return promise.reject("MUSIC_SCAN_BUSY", "本地音乐扫描正在进行")
    musicScanPromise = promise
    val saved = preferences.getString("music_scan_tree", null)
    val activity = context.currentActivity ?: run {
      musicScanPromise = null
      return promise.reject("MUSIC_SCAN_NO_ACTIVITY", "当前页面无法打开目录选择器")
    }
    try {
      activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        if (Build.VERSION.SDK_INT >= 26) initialScanDirectory(saved)?.let { putExtra(DocumentsContract.EXTRA_INITIAL_URI, it) }
      }, MUSIC_DIRECTORY_REQUEST)
    } catch (error: Exception) {
      musicScanPromise = null
      promise.reject("MUSIC_SCAN_DIRECTORY_FAILED", "无法打开本地音乐目录选择器", error)
    }
  }

  @ReactMethod
  fun scanMediaDirectory(kind: String, promise: Promise) {
    val preferenceKey = when (kind) {
      "podcast" -> "podcast_scan_tree"
      "audiobook" -> "audiobook_scan_tree"
      else -> return promise.reject("MEDIA_SCAN_KIND", "不支持的本地媒体类型")
    }
    if (musicScanPromise != null || mediaDirectoryScan != null)
      return promise.reject("MEDIA_SCAN_BUSY", "本地音频扫描正在进行")
    val scan = MediaDirectoryScan(preferenceKey, promise)
    mediaDirectoryScan = scan
    val saved = preferences.getString(preferenceKey, null)
    val activity = context.currentActivity ?: run {
      mediaDirectoryScan = null
      return promise.reject("MEDIA_SCAN_NO_ACTIVITY", "当前页面无法打开目录选择器")
    }
    scan.awaitingResult = true
    try {
      activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        if (Build.VERSION.SDK_INT >= 26) initialScanDirectory(saved)?.let { putExtra(DocumentsContract.EXTRA_INITIAL_URI, it) }
      }, MEDIA_DIRECTORY_REQUEST)
    } catch (error: Exception) {
      mediaDirectoryScan = null
      promise.reject("MEDIA_SCAN_DIRECTORY_FAILED", "无法打开本地音频目录选择器", error)
    }
  }

  private fun initialScanDirectory(saved: String?): Uri? {
    if (saved == null) return null
    return runCatching {
      val tree = Uri.parse(saved)
      DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
    }.getOrNull()
  }

  @ReactMethod
  fun scanAllMusic(promise: Promise) {
    ioExecutor.execute {
      try { promise.resolve(scanMediaStore()) }
      catch (error: Exception) { promise.reject("MUSIC_FULL_SCAN_FAILED", "全盘扫描本地音乐失败", error) }
    }
  }

  @ReactMethod
  fun downloadAudio(url: String, title: String, artist: String, promise: Promise) {
    downloadAudioTransfer(url, title, artist, null, promise)
  }

  @ReactMethod
  fun downloadAudioWithProgress(url: String, title: String, artist: String, requestId: String, promise: Promise) {
    downloadAudioTransfer(url, title, artist, requestId, promise)
  }

  @ReactMethod fun addListener(eventName: String) { /* Required by NativeEventEmitter. */ }
  @ReactMethod fun removeListeners(count: Double) { /* Events have process-scoped subscriptions. */ }

  private fun publishDownloadProgress(requestId: String?, received: Long, total: Long, complete: Boolean = false) {
    if (requestId == null || !context.hasActiveReactInstance()) return
    val payload = Arguments.createMap().apply {
      putString("requestId", requestId)
      putDouble("bytesDownloaded", received.toDouble())
      if (total > 0) putDouble("totalBytes", total.toDouble())
      if (complete) putDouble("fileSize", received.toDouble())
    }
    context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("downloadProgress", payload)
  }

  private fun downloadAudioTransfer(url: String, title: String, artist: String, requestId: String?, promise: Promise) {
    try {
      val uri = Uri.parse(url)
      if (uri.scheme !in setOf("http", "https")) throw IllegalArgumentException("只允许下载 HTTP/HTTPS 音频")
      val safeName = "${title}-${artist}".replace(Regex("[\\/:*?\"<>|]"), "_").take(120).ifBlank { "六六Music" }
      val selectedTree = preferences.getString("download_uri", null)
      if (selectedTree != null) {
        ioExecutor.execute {
          try {
            val tree = Uri.parse(selectedTree)
            val parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
            val target = DocumentsContract.createDocument(context.contentResolver, parent, "audio/mpeg", "$safeName.mp3")
              ?: throw IllegalArgumentException("无法在所选目录创建文件")
            val connection = NetworkProtection.openGet(url, 15_000, 60_000,
              mapOf("User-Agent" to "Mozilla/5.0 (Linux; Android 13) 六六Music/1.0"))
            if (connection.responseCode !in 200..299) throw IllegalArgumentException("下载 HTTP ${connection.responseCode}")
            var received = 0L
            val total = connection.contentLengthLong
            var lastEventAt = 0L
            try {
              context.contentResolver.openOutputStream(target, "wt").use { output ->
                requireNotNull(output) { "下载文件不可写" }
                connection.inputStream.use { input ->
                  val buffer = ByteArray(32 * 1024)
                  while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    output.write(buffer, 0, count)
                    received += count
                    val now = android.os.SystemClock.elapsedRealtime()
                    if (now - lastEventAt >= 250L) {
                      publishDownloadProgress(requestId, received, total)
                      lastEventAt = now
                    }
                  }
                  if (total > 0 && received != total) throw IllegalArgumentException("下载文件不完整")
                }
              }
              publishDownloadProgress(requestId, received, total, true)
            } finally { connection.disconnect() }
            promise.resolve(target.toString())
          } catch (error: Exception) {
            promise.reject("DOWNLOAD_FAILED", "下载到所选目录失败", error)
          }
        }
        return
      }
      val request = DownloadManager.Request(uri).apply {
        addRequestHeader("User-Agent", AudioNetwork.USER_AGENT)
        addRequestHeader("Accept", "*/*")
        setTitle(title)
        setDescription(artist)
        setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        setAllowedOverMetered(true)
        setAllowedOverRoaming(false)
        setDestinationInExternalPublicDir(Environment.DIRECTORY_MUSIC, "六六Music/$safeName.mp3")
      }
      val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
      promise.resolve("download:${manager.enqueue(request)}")
    } catch (error: Exception) {
      promise.reject("DOWNLOAD_FAILED", "无法创建下载任务", error)
    }
  }

  @ReactMethod
  fun queryDownload(downloadToken: String, promise: Promise) {
    try {
      val id = downloadToken.removePrefix("download:").toLongOrNull()
        ?: throw IllegalArgumentException("无效的系统下载任务")
      val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
      manager.query(DownloadManager.Query().setFilterById(id)).use { cursor ->
        if (!cursor.moveToFirst()) {
          promise.resolve(Arguments.createMap().apply {
            putString("status", "failed")
            putString("reason", "系统下载任务不存在")
          })
          return
        }
        val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
        val reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
        val received = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
        val total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
        val localUriIndex = cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI)
        val localUri = if (status == DownloadManager.STATUS_SUCCESSFUL)
          manager.getUriForDownloadedFile(id)?.toString()
        else if (localUriIndex >= 0 && !cursor.isNull(localUriIndex)) cursor.getString(localUriIndex) else null
        promise.resolve(Arguments.createMap().apply {
          putString("status", when (status) {
            DownloadManager.STATUS_SUCCESSFUL -> "downloaded"
            DownloadManager.STATUS_FAILED -> "failed"
            else -> "queued"
          })
          if (!localUri.isNullOrBlank()) putString("localUri", localUri)
          putDouble("bytesDownloaded", maxOf(0L, received).toDouble())
          if (total > 0) putDouble("totalBytes", total.toDouble())
          if (status == DownloadManager.STATUS_SUCCESSFUL && received > 0) putDouble("fileSize", received.toDouble())
          if (status == DownloadManager.STATUS_FAILED) putString("reason", "系统下载失败（$reason）")
        })
      }
    } catch (error: Exception) {
      promise.reject("DOWNLOAD_QUERY_FAILED", "无法读取系统下载状态", error)
    }
  }

  /** Header-only metadata query: never reads an audio response body. */
  @ReactMethod
  fun queryDownloadHeaders(url: String, requestId: String, promise: Promise) {
    try {
      val uri = Uri.parse(url)
      require(uri.scheme in setOf("http", "https")) { "音频地址无效" }
      val client = AudioNetwork.client.newBuilder().callTimeout(10, java.util.concurrent.TimeUnit.SECONDS).build()
      val call = client.newCall(okhttp3.Request.Builder().url(url).head()
        .header("User-Agent", AudioNetwork.USER_AGENT).header("Accept-Encoding", "identity").build())
      downloadHeaderCalls[requestId] = call
      ioExecutor.execute {
        try {
          call.execute().use { response ->
            val size = if (response.isSuccessful) response.header("Content-Length")?.toLongOrNull()?.takeIf { it > 0 } else null
            promise.resolve(Arguments.createMap().apply { size?.let { putDouble("sizeBytes", it.toDouble()) } })
          }
        } catch (error: Exception) { promise.reject("DOWNLOAD_HEADERS_FAILED", "文件大小暂不可读", error) }
        finally { downloadHeaderCalls.remove(requestId, call) }
      }
    } catch (error: Exception) { promise.reject("DOWNLOAD_HEADERS_FAILED", "文件大小暂不可读", error) }
  }
  @ReactMethod fun cancelDownloadHeaders(requestId: String) { downloadHeaderCalls.remove(requestId)?.cancel() }

  @ReactMethod
  fun queryLocalFileSize(reference: String, promise: Promise) {
    ioExecutor.execute {
      try {
        val uri = if (reference.startsWith("download:")) {
          val id = reference.removePrefix("download:").toLongOrNull() ?: throw IllegalArgumentException("下载记录无效")
          (context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).getUriForDownloadedFile(id)
            ?: throw IllegalArgumentException("本地文件不可用")
        } else Uri.parse(reference)
        require(uri.scheme in setOf("content", "file")) { "本地文件地址无效" }
        var bytes: Long? = if (uri.scheme == "file") File(requireNotNull(uri.path)).takeIf { it.isFile }?.length() else null
        if (bytes == null) context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
          if (cursor.moveToFirst() && !cursor.isNull(0)) bytes = cursor.getLong(0).takeIf { it > 0 }
        }
        if (bytes == null) context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { bytes = it.length.takeIf { size -> size > 0 } }
        promise.resolve(bytes?.takeIf { it > 0 }?.toDouble())
      } catch (error: Exception) { promise.reject("DOWNLOAD_SIZE_FAILED", "文件大小暂不可读", error) }
    }
  }

  @ReactMethod
  fun queryLocalFileIdentities(references: ReadableArray, promise: Promise) {
    val selected = (0 until references.size()).mapNotNull { references.getString(it) }.distinct()
    ioExecutor.execute {
      val result = Arguments.createMap()
      selected.forEach { reference ->
        try {
          val uri = if (reference.startsWith("download:")) {
            val id = reference.removePrefix("download:").toLongOrNull() ?: return@forEach
            val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            manager.getUriForDownloadedFile(id) ?: return@forEach
          } else Uri.parse(reference)
          if (uri.scheme != "content" && uri.scheme != "file") return@forEach
          context.contentResolver.openFileDescriptor(uri, "r")?.use { descriptor ->
            val stat = Os.fstat(descriptor.fileDescriptor)
            if (OsConstants.S_ISREG(stat.st_mode) && stat.st_ino > 0)
              result.putString(reference, "inode:${stat.st_dev}:${stat.st_ino}")
          }
        } catch (_: Exception) { }
      }
      promise.resolve(result)
    }
  }

  @ReactMethod
  fun deleteLocalFile(uriText: String, promise: Promise) {
    try {
      if (uriText.startsWith("download:")) {
        val id = uriText.removePrefix("download:").toLongOrNull()
          ?: throw IllegalArgumentException("无效的系统下载任务")
        val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        promise.resolve(manager.remove(id) > 0)
        return
      }
      val uri = Uri.parse(uriText)
      val deleted = if (uri.scheme == "content") {
        if (DocumentsContract.isDocumentUri(context, uri)) {
          DocumentsContract.deleteDocument(context.contentResolver, uri)
        } else {
          try {
            context.contentResolver.delete(uri, null, null) > 0
          } catch (error: SecurityException) {
            val activity = context.currentActivity ?: throw error
            if (fileDeletePromise != null) return promise.reject("DELETE_FILE_BUSY", "文件删除确认正在进行")
            val pending = if (android.os.Build.VERSION.SDK_INT >= 30)
              MediaStore.createDeleteRequest(context.contentResolver, listOf(uri))
            else if (android.os.Build.VERSION.SDK_INT == 29 && error is RecoverableSecurityException)
              error.userAction.actionIntent
            else throw error
            fileDeletePromise = promise
            fileDeleteUri = uri
            activity.startIntentSenderForResult(pending.intentSender, FILE_DELETE_REQUEST, null, 0, 0, 0)
            return
          }
        }
      } else false
      promise.resolve(deleted)
    } catch (error: Exception) {
      fileDeletePromise = null
      fileDeleteUri = null
      promise.reject("DELETE_FILE_FAILED", "删除本地文件失败", error)
    }
  }

  @ReactMethod
  fun probeAudioPrefix(url: String, promise: Promise) {
    ioExecutor.execute {
      try {
        AudioNetwork.execute(url, "bytes=0-65535", 8_000L).use { response ->
          if (!response.isSuccessful)
            throw IllegalArgumentException("播放链路 HTTP ${response.code}")
          val type = response.header("Content-Type").orEmpty()
          if (Regex("json|html|text/plain", RegexOption.IGNORE_CASE).containsMatchIn(type))
            throw IllegalArgumentException("返回内容不是音频（${if (type.isBlank()) "未知类型" else type}）")
          val buffer = ByteArray(8 * 1024)
          var total = 0
          response.body?.byteStream()?.use { input ->
            while (total < 65_536) {
              val count = input.read(buffer, 0, minOf(buffer.size, 65_536 - total))
              if (count < 0) break
              total += count
            }
          }
          if (total <= 0) throw IllegalArgumentException("播放链路未返回音频数据")
          promise.resolve(Arguments.createMap().apply {
            putInt("sampleBytes", total)
            putString("mimeType", type)
            putString("resolvedUrl", response.request.url.toString())
          })
        }
      } catch (error: Exception) {
        promise.reject("AUDIO_PREFIX_PROBE_FAILED", error.message ?: "播放链路测试失败", error)
      }
    }
  }

  @ReactMethod
  fun probeBackgroundAudioUrl(url: String, requestId: String, promise: Promise) {
    runBackgroundAudioProbe(url, requestId, null, promise)
  }

  @ReactMethod
  fun probeStartupAudioUrl(url: String, requestId: String, promise: Promise) {
    runBackgroundAudioProbe(url, requestId, 61_000_000L, promise)
  }

  private fun runBackgroundAudioProbe(url: String, requestId: String, requiredSampleAfterUs: Long?, promise: Promise) {
    val probe = BackgroundAudioProbe(requiredSampleAfterUs)
    if (backgroundAudioProbes.putIfAbsent(requestId, probe) != null) {
      promise.reject("AUDIO_PROBE_FAILED", "重复的预解析校验请求")
      return
    }
    ioExecutor.execute {
      try {
        promise.resolve(probe.run(url))
      } catch (error: Exception) {
        val code = (error as? AudioProbeFailure)?.code ?: "AUDIO_PROBE_FAILED"
        promise.reject(code, error.message ?: "预解析音频校验失败", error)
      } finally {
        backgroundAudioProbes.remove(requestId, probe)
        probe.completion.complete(Unit)
      }
    }
  }

  @ReactMethod
  fun cancelBackgroundAudioProbe(requestId: String, promise: Promise) {
    val probe = backgroundAudioProbes[requestId]
    if (probe == null) { promise.resolve(false); return }
    probe.cancel()
    probe.completion.whenComplete { _, _ -> promise.resolve(true) }
  }

  @ReactMethod
  fun probeAudioUrl(url: String, promise: Promise) {
    val submittedAt = android.os.SystemClock.elapsedRealtime()
    ioExecutor.execute {
      val startedAt = android.os.SystemClock.elapsedRealtime()
      var prefixMs = 0L
      var prefixBytes = 0
      var rangeCalls = 0
      var rangeBytes = 0L
      var rangeMs = 0L
      var outcome = "passed"
      var extractor: MediaExtractor? = null
      var data: AudioRangeDataSource? = null
      try {
        var extractorUrl = url
        var extractorLength = -1L
        var prefix = byteArrayOf()
        val prefixStartedAt = android.os.SystemClock.elapsedRealtime()
        val prefixCall = AudioNetwork.newCall(url, "bytes=0-65535", 10_000L)
        val type = try { prefixCall.execute().use { response ->
          try {
          if (!response.isSuccessful)
            throw IllegalArgumentException("播放链路 HTTP ${response.code}")
          AudioNetwork.checkRange(response, 0L)
          val contentType = response.header("Content-Type").orEmpty()
          if (Regex("json|html|text/plain", RegexOption.IGNORE_CASE).containsMatchIn(contentType))
            throw IllegalArgumentException("返回内容不是音频（${if (contentType.isBlank()) "未知类型" else contentType}）")
          val buffer = ByteArray(AudioRangeReader.FOREGROUND_BLOCK_SIZE)
          val count = response.body?.byteStream()?.let { input ->
            var total = 0
            while (total < buffer.size) {
              val read = input.read(buffer, total, buffer.size - total)
              if (read <= 0) break
              total += read
            }
            total
          } ?: -1
          if (count <= 0) throw IllegalArgumentException("播放链路未返回音频数据")
          prefix = buffer.copyOf(count)
          prefixBytes = count
          // Android 12's MediaExtractor is less tolerant of redirect chains than
          // the shared HTTP client. Parse the final URL that passed the prefix probe.
          extractorUrl = response.request.url.toString()
          extractorLength = response.header("Content-Range")?.substringAfterLast('/')?.toLongOrNull()
            ?: if (response.code == 200) response.body?.contentLength() ?: -1L else -1L
          contentType
          } finally {
            // Cancel before response.close(): ignored Range responses must not
            // drain the remaining song merely to release this prefix response.
            prefixCall.cancel()
          }
        } } finally {
          prefixCall.cancel()
          prefixMs = android.os.SystemClock.elapsedRealtime() - prefixStartedAt
        }
        // An HTTP range response alone is not enough: some providers return
        // an HTML/JSON-compatible 206 response that ExoPlayer cannot decode.
        // The normal selected-song playback path parses the media container
        // natively before allowing the URL into the validated cache.
        extractor = MediaExtractor()
        data = AudioRangeDataSource(AudioRangeReader.foreground(extractorLength, { start, limit ->
          val rangeStartedAt = android.os.SystemClock.elapsedRealtime()
          rangeCalls += 1
          try {
            AudioNetwork.readRange(extractorUrl, start, limit).also { rangeBytes += it.size }
          } finally { rangeMs += android.os.SystemClock.elapsedRealtime() - rangeStartedAt }
        }, prefix))
        extractor.setDataSource(data)
        data.reader.transportError?.let { throw it }
        val evidence = AudioProbeGate.read(extractor, extractorUrl, type, prefix)
        data.reader.transportError?.let { throw it }
        promise.resolve(evidence)
      } catch (error: Exception) {
        // MediaExtractor may wrap a transport refusal as missing media. Keep the
        // original network failure so it cannot enter the audio blacklist.
        val failure = data?.reader?.transportError ?: error
        outcome = (failure as? AudioProbeFailure)?.code ?: failure.javaClass.simpleName
        promise.reject((failure as? AudioProbeFailure)?.code ?: "AUDIO_PROBE_FAILED", failure.message ?: "播放链路测试失败", failure)
      } finally {
        extractor?.release()
        data?.close()
        android.util.Log.i("LiuliuPlayerDiagnostics", "event=audio-probe queueMs=${startedAt - submittedAt} prefixMs=$prefixMs prefixBytes=$prefixBytes rangeCalls=$rangeCalls rangeBytes=$rangeBytes rangeMs=$rangeMs totalMs=${android.os.SystemClock.elapsedRealtime() - startedAt} outcome=$outcome")
      }
    }
  }

  @ReactMethod
  fun probeLocalAudio(uriText: String, promise: Promise) {
    ioExecutor.execute {
      val extractor = MediaExtractor()
      try {
        val uri = Uri.parse(uriText)
        require(uri.scheme in setOf("content", "file")) { "本地音频地址无效" }
        // Open explicitly: MediaExtractor's context/URI overload hides a missing
        // MediaStore file behind a generic extractor error and retries the URI as a path.
        val descriptor = context.contentResolver.openAssetFileDescriptor(uri, "r")
          ?: throw java.io.FileNotFoundException("本地音频文件不存在")
        descriptor.use {
          if (it.declaredLength >= 0) extractor.setDataSource(it.fileDescriptor, it.startOffset, it.declaredLength)
          else extractor.setDataSource(it.fileDescriptor)
        }
        val audioTrack = (0 until extractor.trackCount).firstOrNull {
          extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
        } ?: throw IllegalArgumentException("本地文件未识别到音频轨道")
        val format = extractor.getTrackFormat(audioTrack)
        val durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else -1L
        require(durationUs > 0) { "本地音频时长无法读取" }
        extractor.selectTrack(audioTrack)
        val sampleBytes = extractor.readSampleData(java.nio.ByteBuffer.allocate(64 * 1024), 0)
        require(sampleBytes > 0) { "本地文件没有可读取的音频帧" }
        android.util.Log.i("LiuliuLocalAudio", "validated scheme=${uri.scheme} durationMs=${durationUs / 1000} frames=$sampleBytes")
        promise.resolve(Arguments.createMap().apply {
          putDouble("durationSeconds", durationUs.toDouble() / 1_000_000.0)
          putString("mimeType", format.getString(MediaFormat.KEY_MIME))
          putInt("sampleBytes", sampleBytes)
          if (format.containsKey(MediaFormat.KEY_BIT_RATE)) putInt("bitrate", format.getInteger(MediaFormat.KEY_BIT_RATE))
          if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) putInt("sampleRate", format.getInteger(MediaFormat.KEY_SAMPLE_RATE))
        })
      } catch (error: Exception) {
        android.util.Log.w("LiuliuLocalAudio", "failed type=${error.javaClass.simpleName} reason=${error.message}")
        when (error) {
          is SecurityException -> promise.reject("LOCAL_FILE_PERMISSION", "没有本地文件读取权限，请重新选择音乐目录", error)
          is java.io.FileNotFoundException -> promise.reject("LOCAL_FILE_MISSING", "本地音频文件已移动或删除，请重新添加或下载", error)
          else -> promise.reject("LOCAL_AUDIO_UNREADABLE", "本地音频文件无法读取或格式不受支持，请重新添加或下载", error)
        }
      } finally { extractor.release() }
    }
  }

  @ReactMethod
  fun readLocalAudioMetadata(uriText: String, promise: Promise) {
    ioExecutor.execute {
      try {
        val uri = Uri.parse(uriText)
        require(uri.scheme in setOf("content", "file")) { "本地音频地址无效" }
        val tags = localAudioMetadata(uri)
        promise.resolve(Arguments.createMap().apply {
          tags["title"]?.let { putString("title", it) }
          tags["artist"]?.let { putString("artist", it) }
          tags["album"]?.let { putString("album", it) }
          tags["duration"]?.toLongOrNull()?.let { putDouble("durationSeconds", it / 1000.0) }
        })
      } catch (error: Exception) { promise.reject("LOCAL_METADATA_UNREADABLE", "本地歌曲信息无法读取", error) }
    }
  }

  @ReactMethod
  fun readLocalAudioArtwork(uriText: String, promise: Promise) {
    ioExecutor.execute {
      val uri = Uri.parse(uriText)
      promise.resolve(if (uri.scheme in setOf("content", "file")) localAudioArtwork(uri) else null)
    }
  }

  @ReactMethod
  fun sampleLocalCoverEdgeColor(uriText: String, promise: Promise) {
    ioExecutor.execute {
      var bitmap: Bitmap? = null
      var thumbnail: Bitmap? = null
      try {
        val uri = Uri.parse(uriText)
        require(uri.scheme in setOf("content", "file"))
        context.contentResolver.openInputStream(uri).use { input ->
          bitmap = BitmapFactory.decodeStream(input)
        }
        if (bitmap == null) return@execute promise.resolve(null)
        thumbnail = Bitmap.createScaledBitmap(bitmap!!, 24, 24, true)
        promise.resolve(weightedCoverTone(24, 24, true) { x, y -> thumbnail!!.getPixel(x, y) })
      } catch (_: Exception) { promise.resolve(null) }
      finally {
        if (thumbnail !== bitmap) thumbnail?.recycle()
        bitmap?.recycle()
      }
    }
  }

  @ReactMethod
  fun sampleBundledCoverEdgeColor(name: String, promise: Promise) {
    ioExecutor.execute {
      var bitmap: Bitmap? = null
      var thumbnail: Bitmap? = null
      try {
        require(name.matches(Regex("[a-z0-9_]+")))
        val resource = context.resources.getIdentifier(name, "drawable", context.packageName)
        if (resource == 0) return@execute promise.resolve(null)
        bitmap = BitmapFactory.decodeResource(context.resources, resource)
        if (bitmap == null) return@execute promise.resolve(null)
        thumbnail = Bitmap.createScaledBitmap(bitmap!!, 24, 24, true)
        promise.resolve(weightedCoverTone(24, 24, true) { x, y -> thumbnail!!.getPixel(x, y) })
      } catch (_: Exception) { promise.resolve(null) }
      finally {
        if (thumbnail !== bitmap) thumbnail?.recycle()
        bitmap?.recycle()
      }
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if(requestCode==HEADPHONE_IMPORT_REQUEST) {
      val promise=headphoneImportPromise ?: return
      headphoneImportPromise=null
      val uri=data?.data
      if(resultCode!=Activity.RESULT_OK||uri==null) return promise.resolve(null)
      try { promise.resolve(Arguments.createMap().apply { putString("fileName",queryDisplayName(uri) ?: "profile.txt"); putString("content",readUtf8Limit(uri,1_000_000)) }) }
      catch(error:Exception) { promise.reject("HEADPHONE_IMPORT_READ",error.message,error) }
      return
    }
    if (requestCode == FILE_DELETE_REQUEST) {
      val promise = fileDeletePromise ?: return
      val uri = fileDeleteUri
      fileDeletePromise = null
      fileDeleteUri = null
      if (resultCode != Activity.RESULT_OK) {
        promise.reject("DELETE_FILE_CANCELLED", "已取消删除本地文件，记录仍保留")
      } else try {
        promise.resolve(if (android.os.Build.VERSION.SDK_INT == 29 && uri != null)
          context.contentResolver.delete(uri, null, null) > 0 else true)
      } catch (error: Exception) { promise.reject("DELETE_FILE_FAILED", "删除本地文件失败", error) }
      return
    }
    if (requestCode == MEDIA_DIRECTORY_REQUEST) {
      val scan = mediaDirectoryScan ?: return
      if (!scan.awaitingResult) return
      scan.awaitingResult = false
      val promise = scan.promise
      val uri = data?.data
      if (resultCode != Activity.RESULT_OK || uri == null) {
        mediaDirectoryScan = null
        return promise.resolve(Arguments.createArray())
      }
      try {
        val grants = data!!.flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        context.contentResolver.takePersistableUriPermission(uri, grants)
        preferences.edit().putString(scan.preferenceKey, uri.toString()).apply()
        ioExecutor.execute {
          try { promise.resolve(scanMediaTree(uri)) }
          catch (error: Exception) { promise.reject("MEDIA_SCAN_FAILED", "扫描本地音频失败", error) }
          finally { if (mediaDirectoryScan === scan) mediaDirectoryScan = null }
        }
      } catch (error: Exception) {
        mediaDirectoryScan = null
        promise.reject("MEDIA_SCAN_DIRECTORY_FAILED", "无法保存本地音频目录", error)
      }
      return
    }
    if (requestCode == MUSIC_DIRECTORY_REQUEST) {
      val promise = musicScanPromise ?: return
      val uri = data?.data
      if (resultCode != Activity.RESULT_OK || uri == null) {
        musicScanPromise = null
        return promise.resolve(Arguments.createArray())
      }
      try {
        val grants = data!!.flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        context.contentResolver.takePersistableUriPermission(uri, grants)
        preferences.edit().putString("music_scan_tree", uri.toString()).apply()
        ioExecutor.execute {
          try { promise.resolve(scanTree(uri)) }
          catch (error: Exception) { promise.reject("MUSIC_SCAN_FAILED", "扫描本地音乐失败", error) }
          finally { musicScanPromise = null }
        }
      } catch (error: Exception) {
        musicScanPromise = null
        promise.reject("MUSIC_SCAN_DIRECTORY_FAILED", "无法保存音乐目录", error)
      }
      return
    }
    if (requestCode == AUDIO_IMPORT_REQUEST) {
      val promise = audioImportPromise ?: return
      audioImportPromise = null
      if (resultCode != Activity.RESULT_OK || data == null) return promise.resolve(Arguments.createArray())
      try {
        val uris = mutableListOf<Uri>()
        data.clipData?.let { clip -> for (index in 0 until clip.itemCount) uris.add(clip.getItemAt(index).uri) }
        data.data?.let { if (!uris.contains(it)) uris.add(it) }
        val result = Arguments.createArray()
        uris.take(200).forEach { uri ->
          try { context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: Exception) {}
          val fileName = queryDisplayName(uri) ?: "本地音乐"
          result.pushMap(Arguments.createMap().apply {
            putString("id", "local-${uri.toString().hashCode()}")
            putString("title", fileName.substringBeforeLast('.'))
            putString("artist", "本地音乐")
            putString("album", "设备文件")
            val duration = audioDurationSeconds(uri)
            if (duration < 60) return@forEach
            putInt("duration", duration)
            putString("provider", "custom")
            putString("providerId", uri.toString())
            putString("playUrl", uri.toString())
            putString("coverKey", "vinyl")
            localAudioArtwork(uri)?.let { putString("cover", it) }
            putString("language", "华语")
            putString("genre", "本地")
            putString("mood", "收藏")
            putInt("releaseYear", 0)
          })
        }
        promise.resolve(result)
      } catch (error: Exception) {
        promise.reject("AUDIO_IMPORT_FAILED", "本地音乐读取失败", error)
      }
      return
    }
    if (requestCode == DIRECTORY_REQUEST) {
      val promise = directoryPromise ?: return
      directoryPromise = null
      val uri = data?.data
      if (resultCode != Activity.RESULT_OK || uri == null) return promise.resolve(null)
      try {
        context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        preferences.edit().putString("download_uri", uri.toString()).apply()
        promise.resolve(uri.toString())
      } catch (error: Exception) {
        promise.reject("DIRECTORY_FAILED", "无法保存所选目录", error)
      }
      return
    }
    if (requestCode == BACKUP_EXPORT_REQUEST) {
      val promise = backupExportPromise ?: return
      backupExportPromise = null
      val value = backupExportValue
      backupExportValue = null
      val uri = data?.data
      if (resultCode != Activity.RESULT_OK || uri == null || value == null) return promise.resolve(null)
      ioExecutor.execute {
        try {
          context.contentResolver.openOutputStream(uri, "wt").use { output ->
            requireNotNull(output) { "备份文件不可写" }
            output.write(value.toByteArray(Charsets.UTF_8))
          }
          promise.resolve(uri.toString())
        } catch (error: Exception) {
          promise.reject("BACKUP_EXPORT_FAILED", "备份写入失败", error)
        }
      }
      return
    }
    if (requestCode == BACKUP_IMPORT_REQUEST) {
      val promise = backupImportPromise ?: return
      backupImportPromise = null
      val uri = data?.data
      if (resultCode != Activity.RESULT_OK || uri == null) return promise.resolve(null)
      ioExecutor.execute {
        try {
          promise.resolve(readStateBackup(uri))
        } catch (error: Exception) {
          promise.reject("BACKUP_IMPORT_FAILED", "备份文件读取失败", error)
        }
      }
      return
    }
    if (requestCode != SOURCE_SCRIPT_REQUEST) return
    val promise = sourceImportPromise ?: return
    sourceImportPromise = null
    if (resultCode != Activity.RESULT_OK || data?.data == null) {
      promise.resolve(null)
      return
    }
    try {
      val uri = data.data!!
      val fileName = queryDisplayName(uri) ?: "source.js"
      if (!fileName.endsWith(".js", ignoreCase = true)) {
        promise.reject("SOURCE_IMPORT_TYPE", "请选择 .js 音乐源脚本")
        return
      }
      val content = readUtf8(uri)
      promise.resolve(Arguments.createMap().apply {
        putString("fileName", fileName)
        putString("content", content)
      })
    } catch (error: SourceScriptTooLargeException) {
      promise.reject("SOURCE_IMPORT_TOO_LARGE", "音乐源脚本不能超过 2 MB")
    } catch (error: Exception) {
      promise.reject("SOURCE_IMPORT_READ_FAILED", "无法读取所选音乐源脚本", error)
    }
  }

  override fun onNewIntent(intent: Intent) = Unit

  private fun audioDurationSeconds(uri: Uri): Int {
    val retriever = MediaMetadataRetriever()
    return try {
      retriever.setDataSource(context, uri)
      ((retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L) / 1000L).toInt()
    } catch (_: Exception) { 0 } finally { retriever.release() }
  }

  private fun localAudioMetadata(uri: Uri): Map<String, String> {
    val retriever = MediaMetadataRetriever()
    return try {
      retriever.setDataSource(context, uri)
      mapOf(
        "title" to MediaMetadataRetriever.METADATA_KEY_TITLE,
        "artist" to MediaMetadataRetriever.METADATA_KEY_ARTIST,
        "album" to MediaMetadataRetriever.METADATA_KEY_ALBUM,
        "duration" to MediaMetadataRetriever.METADATA_KEY_DURATION,
      ).mapNotNull { (name, key) -> retriever.extractMetadata(key)?.trim()?.takeIf { it.isNotBlank() }?.let { name to it } }.toMap()
    } catch (_: Exception) { emptyMap() } finally { retriever.release() }
  }

  private fun localAudioArtwork(uri: Uri): String? {
    val retriever = MediaMetadataRetriever()
    var bitmap: Bitmap? = null
    return try {
      retriever.setDataSource(context, uri)
      val bytes = retriever.embeddedPicture ?: return null
      if (bytes.size > 16 * 1024 * 1024) return null
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
      val options = BitmapFactory.Options().apply {
        inSampleSize = 1
        while (bounds.outWidth / inSampleSize > 512 || bounds.outHeight / inSampleSize > 512)
          inSampleSize *= 2
      }
      bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: return null
      val key = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
      val directory = File(context.filesDir, "local-artwork").apply { mkdirs() }
      val target = File(directory, "$key.jpg")
      if (!target.exists()) {
        val temporary = File.createTempFile("cover-", ".jpg", directory)
        try {
          temporary.outputStream().use { output ->
            check(bitmap!!.compress(Bitmap.CompressFormat.JPEG, 90, output))
          }
          check(temporary.renameTo(target) || target.exists())
        } finally { temporary.delete() }
      }
      Uri.fromFile(target).toString()
    } catch (_: Exception) { null }
    finally { bitmap?.recycle(); retriever.release() }
  }

  private fun scanTree(tree: Uri): com.facebook.react.bridge.WritableArray {
    val result = Arguments.createArray()
    val resolver = context.contentResolver
    val visited = HashSet<String>()
    fun visit(documentId: String, depth: Int) {
      if (depth > 32 || visited.size >= 5000 || !visited.add(documentId)) return
      val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, documentId)
      resolver.query(children, arrayOf(
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_MIME_TYPE,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      ), null, null, null)?.use { cursor ->
        val idIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
        val mimeIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE)
        val nameIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
        while (cursor.moveToNext()) {
          val childId = cursor.getString(idIndex)
          val mime = cursor.getString(mimeIndex)
          val name = cursor.getString(nameIndex) ?: "本地音乐"
          val child = DocumentsContract.buildDocumentUriUsingTree(tree, childId)
          if (mime == DocumentsContract.Document.MIME_TYPE_DIR) visit(childId, depth + 1)
          else if (mime.startsWith("audio/") || name.substringAfterLast('.', "").lowercase() in setOf("mp3", "m4a", "aac", "flac", "wav", "ogg", "opus")) {
            val tags = localAudioMetadata(child)
            val duration = ((tags["duration"]?.toLongOrNull() ?: 0L) / 1000L).toInt()
            if (duration >= 60) result.pushMap(Arguments.createMap().apply {
              putString("id", "local-${child}")
              putString("title", tags["title"] ?: name.substringBeforeLast('.'))
              putString("artist", tags["artist"] ?: "本地音乐")
              putString("album", tags["album"] ?: "设备文件")
              putInt("duration", duration)
              putString("provider", "custom")
              putString("providerId", child.toString())
              putString("playUrl", child.toString())
              putString("coverKey", "vinyl")
              localAudioArtwork(child)?.let { putString("cover", it) }
              putString("language", "华语")
              putString("genre", "本地")
              putString("mood", "收藏")
              putInt("releaseYear", 0)
            })
          }
        }
      }
    }
    visit(DocumentsContract.getTreeDocumentId(tree), 0)
    return result
  }

  private fun scanMediaTree(tree: Uri): com.facebook.react.bridge.WritableArray {
    val tracks = scanTree(tree)
    val result = Arguments.createArray()
    for (index in 0 until tracks.size()) {
      val track = tracks.getMap(index) ?: continue
      val enriched = Arguments.createMap().apply { merge(track) }
      track.getString("providerId")?.let { mediaStoreAudioIdentity(Uri.parse(it)) }?.let { identity ->
        enriched.putMap("metadata", Arguments.createMap().apply {
          if (track.hasKey("metadata") && !track.isNull("metadata")) track.getMap("metadata")?.let { merge(it) }
          putString("_libraryLocalFileIdentity", identity)
        })
      }
      result.pushMap(enriched)
    }
    return result
  }

  private fun mediaStoreAudioIdentity(uri: Uri): String? {
    if (android.os.Build.VERSION.SDK_INT < 29) return null
    return try {
      val equivalent = MediaStore.getMediaUri(context, uri) ?: return null
      val mappedRow = mediaStoreAudioRow(equivalent) ?: return null
      val canonical = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, mappedRow.first)
      // The external audio view must identify the same real volume and row.
      // An ID alone cannot prove that a files alias or another volume is audio.
      if (mediaStoreAudioRow(canonical) == mappedRow) canonical.toString() else null
    } catch (_: Exception) { null }
  }

  private fun mediaStoreAudioRow(uri: Uri): Pair<Long, String>? {
    return context.contentResolver.query(uri, arrayOf(
      MediaStore.MediaColumns._ID, MediaStore.MediaColumns.VOLUME_NAME,
    ), null, null, null)?.use { cursor ->
      if (!cursor.moveToFirst()) return@use null
      val idIndex = cursor.getColumnIndex(MediaStore.MediaColumns._ID)
      val volumeIndex = cursor.getColumnIndex(MediaStore.MediaColumns.VOLUME_NAME)
      if (idIndex < 0 || volumeIndex < 0 || cursor.isNull(idIndex) || cursor.isNull(volumeIndex)) return@use null
      val id = cursor.getLong(idIndex)
      val volume = cursor.getString(volumeIndex)
      if (id <= 0 || volume.isNullOrBlank() || cursor.moveToNext()) return@use null
      id to volume
    }
  }

  private fun scanMediaStore(): com.facebook.react.bridge.WritableArray {
    val result = Arguments.createArray()
    val projection = arrayOf(
      MediaStore.Audio.Media._ID,
      MediaStore.Audio.Media.TITLE,
      MediaStore.Audio.Media.ARTIST,
      MediaStore.Audio.Media.ALBUM,
      MediaStore.Audio.Media.DURATION,
    )
    val collection = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q)
      MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
    else MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
    context.contentResolver.query(
      collection,
      projection,
      "${MediaStore.Audio.Media.DURATION} >= ?",
      arrayOf("60000"),
      "${MediaStore.Audio.Media.TITLE} COLLATE NOCASE ASC",
    )?.use { cursor ->
      val idIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
      val titleIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
      val artistIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
      val albumIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
      val durationIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
      while (cursor.moveToNext()) {
        val mediaId = cursor.getLong(idIndex)
        val title = cursor.getString(titleIndex).orEmpty().ifBlank { "本地音乐" }
        val artist = cursor.getString(artistIndex).orEmpty().ifBlank { "本地音乐" }
        val uri = ContentUris.withAppendedId(collection, mediaId)
        val duration = (cursor.getLong(durationIndex) / 1000L).toInt()
        if (duration < 60) continue
        result.pushMap(Arguments.createMap().apply {
          putString("id", "local-media-$mediaId")
          putString("title", title)
          putString("artist", artist)
          putString("album", cursor.getString(albumIndex).orEmpty().ifBlank { "设备音乐" })
          putInt("duration", duration)
          putString("provider", "custom")
          putString("providerId", uri.toString())
          putString("playUrl", uri.toString())
          putString("coverKey", "vinyl")
          localAudioArtwork(uri)?.let { putString("cover", it) }
          putString("language", "华语")
          putString("genre", "本地")
          putString("mood", "收藏")
          putInt("releaseYear", 0)
        })
      }
    }
    return result
  }

  private fun queryDisplayName(uri: Uri): String? {
    var cursor: Cursor? = null
    return try {
      cursor = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
      if (cursor != null && cursor.moveToFirst()) cursor.getString(0) else null
    } finally {
      cursor?.close()
    }
  }

  private fun readUtf8(uri: Uri): String {
    val output = ByteArrayOutputStream()
    context.contentResolver.openInputStream(uri).use { input ->
      requireNotNull(input) { "文件内容不可读" }
      val buffer = ByteArray(16 * 1024)
      while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        if (output.size() + count > MAX_SOURCE_BYTES) throw SourceScriptTooLargeException()
        output.write(buffer, 0, count)
      }
    }
    return output.toString(Charsets.UTF_8.name()).removePrefix("\uFEFF")
  }

  private fun readStateBackup(uri: Uri): String =
    context.contentResolver.openInputStream(uri).use { input ->
      requireNotNull(input) { "文件内容不可读" }
      readApplicationStateBackup(input)
    }

  // Still used by headphone-profile imports; their independent 1 MB input bound remains.
  private fun readUtf8Limit(uri: Uri, limit: Int): String {
    val output = ByteArrayOutputStream()
    context.contentResolver.openInputStream(uri).use { input ->
      requireNotNull(input) { "文件内容不可读" }
      val buffer = ByteArray(16 * 1024)
      while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        if (output.size() + count > limit) throw IllegalArgumentException("文件超过安全上限")
        output.write(buffer, 0, count)
      }
    }
    return output.toString(Charsets.UTF_8.name()).removePrefix("\uFEFF")
  }

  private class SourceScriptTooLargeException : Exception()

  companion object {
    private const val SOURCE_SCRIPT_REQUEST = 6107
    private const val HEADPHONE_IMPORT_REQUEST = 6115
    private const val DIRECTORY_REQUEST = 6108
    private const val BACKUP_EXPORT_REQUEST = 6109
    private const val BACKUP_IMPORT_REQUEST = 6110
    private const val AUDIO_IMPORT_REQUEST = 6111
    private const val MUSIC_DIRECTORY_REQUEST = 6112
    private const val FILE_DELETE_REQUEST = 6113
    private const val MEDIA_DIRECTORY_REQUEST = 6114
    private const val MAX_SOURCE_BYTES = 2 * 1024 * 1024
    private val stateIoExecutor = Executors.newSingleThreadExecutor()
    private val ioExecutor = Executors.newCachedThreadPool()
  }
}
