package com.liuliu.agentmusic

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.widget.*
import androidx.media3.common.Player
import com.google.common.util.concurrent.MoreExecutors
import org.json.JSONObject
import java.util.concurrent.Executors

/** Host-launchable UI. It observes the existing Player and never constructs a playback service. */
@Suppress("MissingPermission")
class CarPlayerActivity : Activity() {
  private lateinit var root: LinearLayout
  private lateinit var title: TextView
  private lateinit var status: TextView
  private lateinit var lyrics: TextView
  private lateinit var progress: SeekBar
  private lateinit var time: TextView
  private lateinit var playing: Button
  private lateinit var previous: Button
  private lateinit var next: Button
  private lateinit var favorite: Button
  private lateinit var mode: Button
  private lateinit var directory: LinearLayout
  private var remove: (() -> Unit)? = null
  private var parent = CarLibraryState.ROOT
  private var page = 0
  private var searchQuery: String? = null
  private var searchResultPage = 0
  private var searchHasMore = false
  private var searchBusy = false
  private val history = ArrayDeque<Pair<String, Int>>()
  private var browseGeneration = 0L
  private var alive = false
  private var previousReady = false
  private var colorKey = ""
  private val dialogs = linkedSetOf<android.app.Dialog>()
  private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "LiuliuCarUI").apply { isDaemon = true } }
  private val ticker = object : Runnable { override fun run() { if (alive) { update(); CarConnectionState.main.postDelayed(this, 750) } } }
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState); CarConnections.initialize(applicationContext)
    parent = savedInstanceState?.getString("parent") ?: CarLibraryState.ROOT; page = savedInstanceState?.getInt("page") ?: 0
    savedInstanceState?.getStringArrayList("history")?.takeLast(32)?.forEach { value ->
      val split = value.lastIndexOf('\n'); if (split > 0) value.substring(split+1).toIntOrNull()?.let { history.addLast(value.substring(0, split) to it) }
    }
    val scroll = ScrollView(this); root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL; isFocusableInTouchMode = true
      setPadding(dp(20), dp(16), dp(20), dp(24))
    }
    scroll.addView(root); setContentView(scroll)
    val toolbar = row(root); button(toolbar, "返回") { back() }; button(toolbar, "手机应用") {
      startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
    }; button(toolbar, "连接设备") { connections() }
    title = text(root, "六六音乐", 28f); status = text(root, "", 16f)
    lyrics = text(root, "", 24f).apply {
      // TextView includes fallback-font metrics and font padding when reserving lines.
      // Raw lineHeight underestimated Chinese glyphs and clipped the second line.
      minLines = 2; maxLines = 2; ellipsize = android.text.TextUtils.TruncateAt.END
    }
    time = text(root, "", 16f)
    progress = SeekBar(this).apply { max = 10_000; setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
      override fun onProgressChanged(bar: SeekBar?, value: Int, user: Boolean) { }
      override fun onStartTrackingTouch(bar: SeekBar?) { }
      override fun onStopTrackingTouch(bar: SeekBar?) {
        val duration = CarConnectionState.player?.duration?.coerceAtLeast(0) ?: 0
        action("seek", JSONObject().put("seconds", duration * (bar?.progress ?: 0) / 10_000.0 / 1000.0))
      }
    }) }; root.addView(progress)
    val controls = row(root)
    previous = button(controls, "上一首") { action("previous") }
    playing = button(controls, "播放") { action(if (CarConnectionState.player?.isPlaying == true) "pause" else "play") }
    next = button(controls, "下一首") { action("next") }
    val extra = row(root)
    favorite = button(extra, "收藏") { action("favorite") }
    mode = button(extra, "顺序播放") {
      val current = CarConnectionState.snapshot.optString("mode")
      action("mode", JSONObject().put("mode", CarUcarMode.next(current)))
    }
    button(extra, "整首歌词") { android.app.AlertDialog.Builder(this).setTitle("歌词").setMessage(
      MediaNotificationState.lyrics.whole(CarConnectionState.player?.currentMediaItem?.mediaId).ifBlank { "暂无有效歌词" }).setPositiveButton("关闭", null).show() }
    val nav = row(root); button(nav, "曲库首页") { searchQuery = null; history.clear(); parent = CarLibraryState.ROOT; page = 0; browse() }
    button(nav, "上一页") { val query = searchQuery
      if (query != null) { if (!searchBusy && searchResultPage > 0) search(query, false, searchResultPage - 1) }
      else if (page > 0) { page--; browse() }
    }; button(nav, "下一页") { val query = searchQuery
      if (query != null) { if (!searchBusy && searchHasMore) search(query, false, searchResultPage + 1) }
      else { page++; browse() }
    }
    val search = EditText(this).apply { hint = "在线搜索歌名、歌手"; setSingleLine() }; root.addView(search)
    button(root, "搜索") { search(search.text.toString()) }
    directory = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }; root.addView(directory)
    remove = CarConnectionState.observe { update() }; update(); browse()
  }
  override fun onStart() { super.onStart(); alive = true; carForeground = true; CarConnectionState.main.post(ticker) }
  override fun onStop() { alive = false; carForeground = false; CarConnectionState.main.removeCallbacks(ticker); CarConnections.peripheral?.stopScan(); super.onStop() }
  override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); update(); browse() }
  override fun onSaveInstanceState(out: Bundle) { out.putString("parent", parent); out.putInt("page", page)
    out.putStringArrayList("history", ArrayList(history.takeLast(32).map { "${it.first}\n${it.second}" })); super.onSaveInstanceState(out) }
  @Deprecated("Android Activity callback") override fun onBackPressed() { back() }
  private fun back() { if (searchQuery != null) { searchQuery = null; browse() }
    else if (history.isNotEmpty()) { val previous = history.removeLast(); parent = previous.first; page = previous.second; browse() } else finish() }
  override fun onDestroy() { dialogs.toList().forEach { it.dismiss() }; dialogs.clear(); remove?.invoke(); remove = null; browseGeneration++; worker.shutdownNow(); if (CarConnectionState.player == null && !isChangingConfigurations) CarConnections.close(); super.onDestroy() }
  private fun action(name: String, args: JSONObject = JSONObject()) {
    val id = CarConnectionState.player?.currentMediaItem?.mediaId
    if (id != null) args.put("mediaId", id)
    val future = CarConnectionState.request(name, args)
    future.addListener({ runOnUiThread { if (!isDestroyed) { val result = future.get(); if (!result.optBoolean("ok")) Toast.makeText(this, result.optString("error"), Toast.LENGTH_LONG).show(); update() } } }, MoreExecutors.directExecutor())
  }
  private fun update() {
    if (!::title.isInitialized || isDestroyed) return
    val s = CarConnections.state(); val player = CarConnectionState.player
    val ready = s.optBoolean("ready")
    if (ready && !previousReady && ::directory.isInitialized) browse()
    previousReady = ready
    val same = player?.currentMediaItem?.mediaId == s.optString("mediaId")
    title.text = if (s.optString("title").isBlank()) "六六音乐 · 车载" else "${s.optString("title")}\n${s.optString("artist") }"
    val songMark = when (s.optString("vip")) { "1" -> "是"; "0" -> "否"; else -> "未知" }
    status.text = if (s.optBoolean("ready")) "歌曲VIP标记：$songMark · 试听：未知\n${CarConnections.network.status}"
      else "请在手机应用完成原启动检测，再返回车载界面"
    lyrics.text = if (same) MediaNotificationState.lyrics.textAt(s.optString("mediaId"), player?.currentPosition ?: 0) else ""
    val position = player?.currentPosition?.coerceAtLeast(0) ?: 0; val duration = player?.duration?.coerceAtLeast(0) ?: 0
    time.text = "${position / 60_000}:${"%02d".format(position / 1000 % 60)} / ${duration / 60_000}:${"%02d".format(duration / 1000 % 60)}"
    if (!progress.isPressed) progress.progress = if (duration > 0) (position * 10_000 / duration).toInt() else 0
    playing.text = if (player?.isPlaying == true) "暂停" else "播放"
    favorite.text = if (s.optBoolean("favorite")) "取消收藏" else "收藏"
    playing.isEnabled = ready && s.optString("mediaId").isNotBlank()
    favorite.isEnabled = playing.isEnabled && CarConnectionState.snapshot.optString("mediaId") == s.optString("mediaId")
    mode.isEnabled = favorite.isEnabled
    progress.isEnabled = ready && duration > 0 && player?.isCommandAvailable(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM) == true
    val navigation = MediaNotificationState.navigation.takeIf { it.mediaId == s.optString("mediaId") }
    previous.isEnabled = ready && navigation?.previous == true; next.isEnabled = ready && navigation?.next == true
    mode.text = when (s.optString("mode")) { "shuffle" -> "随机播放"; "repeat-one" -> "单曲循环"; else -> "顺序播放" }
    val colors = s.optString("bg") + s.optString("text")
    if (colors != colorKey) {
      colorKey = colors; root.setBackgroundColor(parseColor(s.optString("bg"), Color.BLACK))
      fun recolor(view: View) {
        if (view is TextView && view !is Button) {
          val foreground = parseColor(s.optString("text"), Color.WHITE)
          view.setTextColor(foreground)
          if (view is EditText) view.setHintTextColor(Color.argb(170, Color.red(foreground), Color.green(foreground), Color.blue(foreground)))
        }
        if (view is android.view.ViewGroup) for (i in 0 until view.childCount) recolor(view.getChildAt(i))
      }
      recolor(root)
    }
  }
  private fun browse() {
    searchQuery?.let { search(it, false, searchResultPage); return }
    val token = ++browseGeneration; directory.removeAllViews()
    if (!CarLibraryState.ready) { text(directory, "手机端尚未就绪", 18f); return }
    text(directory, "正在读取曲库…", 18f)
    val future = CarLibraryState.request(parent, page, 20, strict = true)
    future.addListener({ runOnUiThread { if (!isDestroyed && token == browseGeneration) {
      directory.removeAllViews()
      val result = runCatching { future.get() }
      if (result.isFailure) {
        text(directory, result.exceptionOrNull()?.cause?.message ?: "读取失败，请重试", 18f)
        button(directory, "重试本页") { browse() }
        return@runOnUiThread
      }
      val items = result.getOrThrow(); if (items.isEmpty()) text(directory, "本页没有内容", 18f)
      items.forEach { item -> button(directory, item.mediaMetadata.title?.toString() ?: item.mediaId) {
        if (item.mediaMetadata.isBrowsable == true) { history.addLast(parent to page); parent = item.mediaId; page = 0; browse() }
        else if (item.mediaMetadata.isPlayable == true) select(item)
      } }
    } } }, MoreExecutors.directExecutor())
  }
  private fun search(query: String, reset: Boolean = true, requestedPage: Int = 0) {
    if (query.isBlank()) { Toast.makeText(this, "请输入搜索词", Toast.LENGTH_LONG).show(); return }
    // A focused input otherwise pulls a scrolled result list back into view on layout.
    currentFocus?.clearFocus(); root.requestFocus()
    searchQuery = query; searchBusy = true
    val token = ++browseGeneration
    directory.removeAllViews(); text(directory, "正在在线搜索…", 18f)
    worker.execute { val result = runCatching { CarConnections.command("LiuliuSearch", JSONObject().put("Key", query)
        .put("PageFlag", if (reset) 0 else 1).put("LiuliuPageIndex", requestedPage)) }
      runOnUiThread { if (!isDestroyed && token == browseGeneration) {
        searchBusy = false; directory.removeAllViews(); val response = result.getOrNull(); val rows = response?.optJSONArray("Lists")
        if (rows == null) { if (reset) searchHasMore = false
          text(directory, result.exceptionOrNull()?.message ?: response?.optString("ErrorMessage", "搜索失败，请重试") ?: "搜索失败，请重试", 18f)
          button(directory, "重试本页") { search(query, reset, requestedPage) }
        }
        else {
          searchResultPage = requestedPage; searchHasMore = response?.optBoolean("LiuliuHasMore") == true
          text(directory, "在线搜索 · 第 ${requestedPage + 1} 页 · 返回可恢复曲库", 18f)
          if (rows.length() == 0) text(directory, if (searchHasMore) "本页没有可用结果，可继续下一页" else "没有更多匹配歌曲", 18f)
        else for (i in 0 until rows.length()) { val item = rows.getJSONObject(i); button(directory, item.optString("Name")) {
          CarLibraryState.item(item.optString("ID"))?.let { select(it) }
        } }
        }
      } }
    }
  }
  private fun select(item: androidx.media3.common.MediaItem) {
    val future = CarLibraryState.selectResult(item)
    future.addListener({ runOnUiThread { if (!isDestroyed) {
      val outcome = future.get(); if (!outcome.ok) Toast.makeText(this, outcome.message, Toast.LENGTH_LONG).show()
    } } }, MoreExecutors.directExecutor())
  }
  private fun requestBluetooth() {
    val permissions = if (Build.VERSION.SDK_INT >= 31) arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
      else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
    if (permissions.any { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }) requestPermissions(permissions, 902)
    else CarConnections.bluetooth?.start()
  }
  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode == 902 && grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }) CarConnections.bluetooth?.start()
    else if (requestCode == 902) Toast.makeText(this, "附近设备权限被拒绝；可在系统设置重新授权", Toast.LENGTH_LONG).show()
  }
  private fun connections() {
    val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(8), dp(16), dp(16)) }
    val scroll = ScrollView(this).apply { addView(content) }
    val dialog = android.app.AlertDialog.Builder(this).setTitle("车载连接").setView(scroll).setNegativeButton("关闭", null).create()
    val info = text(content, "", 16f)
    val deviceList = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }; content.addView(deviceList)
    fun refresh() {
      info.text = "${CarConnections.network.status}\n蓝牙：${CarConnections.bluetooth?.status}\n外设：${CarConnections.peripheral?.status}\n收包：${CarConnections.peripheral?.received}"
      deviceList.removeAllViews()
      CarConnections.network.devices.values.forEach { device -> button(deviceList, "连接局域网：${device.name}") { CarConnections.network.connect(device.id) } }
    }
    dialogs.add(dialog)
    val unsubscribe = CarConnectionState.observe { refresh() }; dialog.setOnDismissListener { unsubscribe(); dialogs.remove(dialog) }
    button(content, "启动局域网发现") { CarConnections.startNetwork() }
    button(content, "停止网络会话") { CarConnections.stopNetwork() }
    val pcm = CheckBox(this).apply { text = "PCM 远端输出时静音手机（远端负责音量）"; isChecked = CarPcmBuffer.remoteOnly
      setOnCheckedChangeListener { _, checked -> CarPcmBuffer.remoteOnly = checked } }; content.addView(pcm)
    button(content, "从头采集当前歌曲PCM（最多256MiB）") {
      CarPcmBuffer.enabled = true; CarPcmBuffer.origin(0); CarPcmBuffer.reset()
      val capture = CarConnectionState.request("seek", JSONObject().put("seconds", 0).put("mediaId", CarConnectionState.player?.currentMediaItem?.mediaId))
      capture.addListener({ if (capture.get().optBoolean("ok")) CarConnectionState.request("play") else CarPcmBuffer.enabled = false }, MoreExecutors.directExecutor())
    }
    button(content, "授权并监测 A2DP") { requestBluetooth() }
    button(content, "关闭蓝牙监测") { CarConnections.bluetooth?.stop() }
    button(content, "系统蓝牙配对与音频连接") { startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS)) }
    val offset = EditText(this).apply { hint = "本设备歌词偏移毫秒，-10000 至 10000"; setText((CarConnections.bluetooth?.offsetMs ?: 0).toString()); inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_SIGNED }; content.addView(offset)
    val lyric = CheckBox(this).apply { text = "A2DP 逐句歌词标题兼容"; isChecked = CarConnections.bluetooth?.lyricEnabled == true }; content.addView(lyric)
    button(content, "保存歌词设置") { CarConnections.bluetooth?.setLyrics(lyric.isChecked, offset.text.toString().toLongOrNull() ?: 0) }
    val driving = CheckBox(this).apply { text = "前台遇到车载设备时进入驾驶界面"; isChecked = CarConnections.bluetooth?.autoDriving == true }; content.addView(driving)
    val autoPlay = CheckBox(this).apply { text = "车载设备连接时恢复播放（独立选项）"; isChecked = CarConnections.bluetooth?.autoPlay == true }; content.addView(autoPlay)
    button(content, "保存驾驶设置 / 标记设备") {
      CarConnections.bluetooth?.setDriving(driving.isChecked, autoPlay.isChecked)
      CarConnections.bluetooth?.devices?.forEach { device -> android.app.AlertDialog.Builder(this).setTitle(device.name ?: device.address).setMessage("将此设备标记为车载设备？")
        .setPositiveButton("车载") { _, _ -> CarConnections.bluetooth?.mark(device, true) }.setNegativeButton("非车载") { _, _ -> CarConnections.bluetooth?.mark(device, false) }.show() }
    }
    text(content, "外设 profile 必须与对端匹配。liuliu-json-v1 是六六控制协议；raw 仅收发字节。未知厂商协议需要厂家资料。", 16f)
    val prefs = getSharedPreferences("liuliu_car", MODE_PRIVATE)
    val profile = EditText(this).apply { minLines = 4; setText(prefs.getString("peripheral_profile", DEFAULT_PROFILE)) }; content.addView(profile)
    fun selected() = PeripheralChannel.Profile.parse(profile.text.toString()).also { prefs.edit().putString("peripheral_profile", profile.text.toString()).apply() }
    var useBle = true
    button(content, "BLE 扫描") { useBle = true; CarConnections.peripheral?.scan(selected(), true) }
    button(content, "经典蓝牙 / SPP 扫描") { useBle = false; CarConnections.peripheral?.scan(selected(), false) }
    button(content, "选择已发现设备") {
      val devices = CarConnections.peripheral?.devices?.values?.toList().orEmpty()
      android.app.AlertDialog.Builder(this).setItems(devices.map { "${it.name ?: "设备"} · ${it.address}" }.toTypedArray()) { _, index -> CarConnections.peripheral?.connect(devices[index].address, selected(), useBle) }.show()
    }
    button(content, "取消扫描 / 断开外设") { CarConnections.peripheral?.disconnect() }
    button(content, "重新连接上次外设") { CarConnections.peripheral?.reconnect() }
    button(content, "读取 profile 特征") { CarConnections.peripheral?.read() }
    val outgoing = EditText(this).apply { hint = "发送 UTF-8 文本；六六协议每行一条 JSON" }; content.addView(outgoing)
    button(content, "发送") { CarConnections.peripheral?.send((outgoing.text.toString() + "\n").toByteArray(Charsets.UTF_8)) }
    refresh(); dialog.show()
  }
  private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
  private fun row(parent: LinearLayout) = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; parent.addView(this) }
  private fun text(parent: LinearLayout, value: String, size: Float) = TextView(this).apply { text = value; textSize = size
    setTextColor(parseColor(CarConnectionState.snapshot.optString("text"), Color.WHITE)); setPadding(0, dp(8), 0, dp(8)); parent.addView(this) }
  private fun button(parent: LinearLayout, label: String, action: () -> Unit) = Button(this).apply {
    text = label; textSize = 18f; minHeight = dp(56); isAllCaps = false
    parent.addView(this, if (parent.orientation == LinearLayout.HORIZONTAL) LinearLayout.LayoutParams(0, -2, 1f) else LinearLayout.LayoutParams(-1, -2))
    setOnClickListener { runCatching(action).onFailure { Toast.makeText(this@CarPlayerActivity, it.message ?: "操作失败", Toast.LENGTH_LONG).show() } }
  }
  private fun parseColor(value: String, fallback: Int) = runCatching { Color.parseColor(value) }.getOrDefault(fallback)
  companion object {
    @Volatile var phoneForeground = false
    @Volatile var carForeground = false
    const val DEFAULT_PROFILE = "{\"service\":\"71372400-7485-4c12-a155-1030e1e62120\",\"write\":\"71372401-7485-4c12-a155-1030e1e62120\",\"notify\":\"71372402-7485-4c12-a155-1030e1e62120\",\"spp\":\"71372403-7485-4c12-a155-1030e1e62120\",\"secure\":true,\"protocol\":\"liuliu-json-v1\"}"
  }
}
