package com.liuliu.agentmusic

import android.content.Context
import android.app.KeyguardManager
import android.graphics.*
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Build
import android.os.Looper
import android.provider.Settings
import android.view.*
import android.widget.*
import androidx.media3.common.Player
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.Executors
import kotlin.math.abs

/** A presentation window owned by the existing media service. No audio or queue operations. */
internal object DesktopLyricsOverlay {
  private lateinit var context: Context
  private val main = Handler(Looper.getMainLooper())
  private val images = Executors.newSingleThreadExecutor()
  private var dispatch: ((String, Double?) -> Unit)? = null
  private var player: Player? = null
  private val policy = DesktopLyricsPolicy()
  private var publishLyric: ((String?, String) -> Unit)? = null
  private var style = "center"
  private var accent = Color.rgb(255, 199, 115)
  private var root: LinearLayout? = null
  private var params: WindowManager.LayoutParams? = null
  private var currentLine: TextView? = null
  private var nextLine: TextView? = null
  private var previousLine: TextView? = null
  private var afterLine: TextView? = null
  private var songTitle: TextView? = null
  private var waveform: WaveView? = null
  private var progress: SeekBar? = null
  private var time: TextView? = null
  private var playButton: TextView? = null
  private var favoriteButton: TextView? = null
  private var coverView: ImageView? = null
  private var lockButton: ImageButton? = null
  private var cover: Bitmap? = null
  private var coverUrl = ""
  private var coverRequest = 0
  private var song = JSONObject()
  private var lines = emptyList<Pair<Long, String>>()
  private var lineIndex = Int.MIN_VALUE
  private val tick = object : Runnable {
    override fun run() {
      if (!policy.enabled || !::context.isInitialized) return
      val playing = player
      val permission = Settings.canDrawOverlays(context)
      if (!permission) { removeWindow(); policy.stop(); publishLyric?.invoke(null, ""); return }
      if (playing == null || !policy.matches(playing.currentMediaItem?.mediaId, song.optString("id"))) {
        removeWindow(); publishLyric?.invoke(null, "")
      }
      else {
        val lockedScreen = context.getSystemService(KeyguardManager::class.java)?.isKeyguardLocked == true
        if (policy.canShowWindow(permission, lockedScreen, playing.currentMediaItem?.mediaId, song.optString("id"))) {
          if (root == null) buildWindow()
        } else removeWindow()
        update(playing)
      }
      main.postDelayed(this, 200)
    }
  }
  fun initialize(appContext: Context, actions: (String, Double?) -> Unit) {
    context = appContext.applicationContext; dispatch = actions
    val preferences = context.getSharedPreferences("liuliu_desktop_lyrics", Context.MODE_PRIVATE)
    policy.locked = preferences.getBoolean("locked", false)
    if (preferences.getBoolean("closed_by_user", false)) policy.closeByUser()
  }
  fun attach(mediaPlayer: Player, lyricPublisher: (String?, String) -> Unit) {
    player = mediaPlayer; publishLyric = lyricPublisher; schedule()
  }
  fun detach() { closeForExit(); player = null; publishLyric = null }
  fun closeForExit() { policy.stop(); main.removeCallbacks(tick); removeWindow(); publishLyric?.invoke(null, "") }
  fun setAppVisible(visible: Boolean) {
    policy.appVisible = visible
    if (visible) removeWindow()
    schedule()
  }
  fun wasClosed() = policy.closePending
  fun acknowledgeClose() {
    policy.acknowledgeClose()
    if (::context.isInitialized) context.getSharedPreferences("liuliu_desktop_lyrics", Context.MODE_PRIVATE)
      .edit().putBoolean("closed_by_user", false).apply()
  }
  private fun closeByUser() {
    policy.closeByUser()
    context.getSharedPreferences("liuliu_desktop_lyrics", Context.MODE_PRIVATE)
      .edit().putBoolean("closed_by_user", true).apply()
    main.removeCallbacks(tick); removeWindow(); publishLyric?.invoke(null, "")
    dispatch?.invoke("close", null)
  }
  fun configure(show: Boolean, selected: String, color: String) {
    if (!::context.isInitialized) return
    val nextStyle = selected.takeIf { it in setOf("center", "capsule", "card", "bottom", "wave", "vertical") } ?: "center"
    val nextAccent = runCatching { Color.parseColor(color) }.getOrDefault(accent)
    if (nextStyle != style || nextAccent != accent) { style = nextStyle; accent = nextAccent; removeWindow() }
    policy.configure(show)
    if (!policy.enabled) { main.removeCallbacks(tick); removeWindow(); publishLyric?.invoke(null, "") } else schedule()
  }
  private fun schedule() { main.removeCallbacks(tick); if (policy.enabled) main.post(tick) }
  fun setSong(value: JSONObject) {
    val changed = value.optString("id") != song.optString("id")
    song = value
    val data = value.optJSONArray("lines")
    lines = (0 until (data?.length() ?: 0)).mapNotNull { i ->
      val line = data?.optJSONObject(i) ?: return@mapNotNull null
      val stamp = line.optDouble("time", Double.NaN)
      if (!stamp.isFinite()) null else (stamp * 1000).toLong() to line.optString("text")
    }.sortedBy { it.first }
    lineIndex = Int.MIN_VALUE
    if (changed) { cover = null; removeWindow() }
    loadCover(value.optString("cover"))
    schedule()
  }
  private fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()
  private fun text(size: Float, color: Int = Color.WHITE) = TextView(context).apply {
    textSize = size; setTextColor(color); includeFontPadding = true; maxLines = 1
    ellipsize = android.text.TextUtils.TruncateAt.END
  }
  private fun button(label: String, action: String): TextView = text(23f).apply {
    text = label; gravity = Gravity.CENTER; contentDescription = action
    setOnClickListener { dispatch?.invoke(action, null) }
    layoutParams = LinearLayout.LayoutParams(0, dp(44), 1f)
  }
  private fun buildWindow() {
    val wm = context.getSystemService(WindowManager::class.java)
    val bounds = context.resources.displayMetrics
    val width = minOf(dp(if (style == "card") 392 else 372), bounds.widthPixels - dp(24))
    val outer = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(14), dp(10), dp(14), dp(10))
      background = GradientDrawable().apply {
        setColor(Color.argb(220, 34, 22, 28)); cornerRadius = dp(if (style == "capsule" || style == "bottom") 32 else 18).toFloat()
        setStroke(dp(1), Color.argb(150, Color.red(accent), Color.green(accent), Color.blue(accent)))
      }
    }
    root = outer
    val content = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
    outer.addView(content, LinearLayout.LayoutParams(0, -2, 1f))
    val windowActions = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
    lockButton = ImageButton(context).apply {
      setBackgroundColor(Color.TRANSPARENT); setImageDrawable(WindowActionIcon(false))
      contentDescription = if (policy.locked) "解除歌词锁定" else "锁定歌词位置"
      isSelected = policy.locked
      setOnClickListener {
        policy.locked = !policy.locked
        context.getSharedPreferences("liuliu_desktop_lyrics", Context.MODE_PRIVATE).edit().putBoolean("locked", policy.locked).apply()
        isSelected = policy.locked; contentDescription = if (policy.locked) "解除歌词锁定" else "锁定歌词位置"
        drawable.invalidateSelf()
      }
    }
    windowActions.addView(lockButton, LinearLayout.LayoutParams(dp(44), dp(44)))
    windowActions.addView(ImageButton(context).apply {
      setBackgroundColor(Color.TRANSPARENT); setImageDrawable(WindowActionIcon(true))
      contentDescription = "关闭桌面歌词"; setOnClickListener { closeByUser() }
    }, LinearLayout.LayoutParams(dp(44), dp(44)))
    outer.addView(windowActions, LinearLayout.LayoutParams(dp(44), -2).apply { leftMargin = dp(8) })
    if (style in setOf("capsule", "card", "bottom")) {
      val header = LinearLayout(context).apply { gravity = Gravity.CENTER_VERTICAL }
      coverView = ImageView(context).apply {
        scaleType = ImageView.ScaleType.CENTER_CROP; setImageBitmap(cover)
        if (cover == null) setImageResource(context.applicationInfo.icon)
      }
      header.addView(coverView, LinearLayout.LayoutParams(dp(42), dp(42)).apply { rightMargin = dp(10) })
      val titles = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
      songTitle = text(14f).apply { text = song.optString("title") }; titles.addView(songTitle)
      titles.addView(text(11f, Color.LTGRAY).apply { text = song.optString("artist") })
      header.addView(titles, LinearLayout.LayoutParams(0, -2, 1f))
      if (style == "card") { favoriteButton = button(if (song.optBoolean("favorite")) "♥" else "♡", "favorite"); header.addView(favoriteButton, LinearLayout.LayoutParams(dp(44), dp(44))) }
      content.addView(header)
    }
    if (style == "vertical") { previousLine = text(14f, Color.GRAY); content.addView(previousLine) }
    currentLine = text(if (style == "center") 20f else 16f, accent).apply {
      setTypeface(typeface, Typeface.BOLD); setPadding(0, dp(7), 0, dp(2)); gravity = if (style == "center" || style == "wave") Gravity.CENTER else Gravity.START
    }; content.addView(currentLine)
    nextLine = text(if (style == "center") 16f else 13f, Color.LTGRAY).apply {
      gravity = if (style == "center" || style == "wave") Gravity.CENTER else Gravity.START
    }; content.addView(nextLine)
    if (style == "vertical") { afterLine = text(14f, Color.GRAY).apply { setPadding(0, dp(6), 0, 0) }; content.addView(afterLine) }
    if (style == "wave") { waveform = WaveView(context); content.addView(waveform, LinearLayout.LayoutParams(-1, dp(48))) }
    if (style == "card") {
      progress = SeekBar(context).apply {
        max = 1000; progressTintList = android.content.res.ColorStateList.valueOf(accent)
        setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
          override fun onProgressChanged(bar: SeekBar?, value: Int, fromUser: Boolean) = Unit
          override fun onStartTrackingTouch(bar: SeekBar?) = Unit
          override fun onStopTrackingTouch(bar: SeekBar?) {
            dispatch?.invoke("seek", (player?.duration?.coerceAtLeast(0) ?: 0L) * (bar?.progress ?: 0) / 1_000_000.0)
          }
        })
      }; content.addView(progress)
      time = text(11f, Color.LTGRAY); content.addView(time)
      val controls = LinearLayout(context)
      controls.addView(button("◀", "previous")); playButton = button("Ⅱ", "toggle"); controls.addView(playButton); controls.addView(button("▶", "next")); content.addView(controls)
    }
    val preferences = context.getSharedPreferences("liuliu_desktop_lyrics", Context.MODE_PRIVATE)
    val window = WindowManager.LayoutParams(width, WindowManager.LayoutParams.WRAP_CONTENT,
      if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else WindowManager.LayoutParams.TYPE_PHONE,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT).apply {
      gravity = Gravity.TOP or Gravity.START
      x = preferences.getInt("${style}_x", (bounds.widthPixels - width) / 2).coerceIn(0, bounds.widthPixels - width)
      y = preferences.getInt("${style}_y", if (style == "bottom") bounds.heightPixels - dp(170) else bounds.heightPixels / 3).coerceIn(dp(24), bounds.heightPixels - dp(120))
    }
    params = window
    var downX = 0f; var downY = 0f; var originX = 0; var originY = 0; var dragging = false
    outer.setOnTouchListener { _, event ->
      if (!policy.canDrag()) { dragging = false; return@setOnTouchListener true }
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> { downX = event.rawX; downY = event.rawY; originX = window.x; originY = window.y; dragging = false; true }
        MotionEvent.ACTION_MOVE -> {
          if (abs(event.rawX - downX) + abs(event.rawY - downY) > dp(4)) dragging = true
          window.x = (originX + event.rawX - downX).toInt().coerceIn(0, bounds.widthPixels - width)
          window.y = (originY + event.rawY - downY).toInt().coerceIn(dp(24), bounds.heightPixels - outer.height.coerceAtLeast(dp(80)))
          runCatching { wm.updateViewLayout(outer, window) }; true
        }
        MotionEvent.ACTION_UP -> { if (dragging) preferences.edit().putInt("${style}_x", window.x).putInt("${style}_y", window.y).apply(); outer.performClick(); true }
        else -> true
      }
    }
    try { wm.addView(outer, window) } catch (_: Exception) { root = null }
    DesktopLyricsWaveform.observing = style == "wave" && root != null
    lineIndex = Int.MIN_VALUE
  }
  private fun update(media: Player) {
    val position = media.currentPosition.coerceAtLeast(0)
    val index = policy.lineIndex(position, lines)
    publishLyric?.invoke(song.optString("id"), lines.getOrNull(index)?.second ?: "")
    if (index != lineIndex) {
      currentLine?.text = lines.getOrNull(index)?.second ?: if (lines.isEmpty()) "暂无歌词" else "♪"
      nextLine?.text = lines.getOrNull(index + 1)?.second ?: ""
      previousLine?.text = lines.getOrNull(index - 1)?.second ?: ""
      afterLine?.text = lines.getOrNull(index + 2)?.second ?: ""
      lineIndex = index
    }
    songTitle?.text = song.optString("title")
    favoriteButton?.text = if (song.optBoolean("favorite")) "♥" else "♡"
    playButton?.text = if (media.isPlaying) "Ⅱ" else "▶"
    val duration = media.duration.coerceAtLeast(0)
    progress?.let { if (!it.isPressed) it.progress = if (duration > 0) (position * 1000 / duration).toInt() else 0 }
    time?.text = "${clock(position)}                         ${clock(duration)}"
    waveform?.invalidate()
  }
  private fun clock(milliseconds: Long) = "%02d:%02d".format(milliseconds / 60000, milliseconds / 1000 % 60)
  private fun removeWindow() {
    root?.let { if (::context.isInitialized) runCatching { context.getSystemService(WindowManager::class.java).removeView(it) } }
    root = null; params = null; currentLine = null; nextLine = null; previousLine = null; afterLine = null
    coverView = null; waveform = null; progress = null; time = null; playButton = null; favoriteButton = null; songTitle = null; lockButton = null
    DesktopLyricsWaveform.observing = false
  }
  private fun loadCover(url: String) {
    if (url == coverUrl && cover != null) { coverView?.setImageBitmap(cover); return }
    coverUrl = url
    val request = ++coverRequest
    if (!url.startsWith("https://") && !url.startsWith("http://")) return
    images.execute {
      val bitmap = runCatching {
        AudioNetwork.client.newCall(Request.Builder().url(url).build()).execute().use { response ->
          if (!response.isSuccessful) null else response.body?.byteStream()?.use { BitmapFactory.decodeStream(it) }
        }
      }.getOrNull()
      main.post { if (request == coverRequest) { cover = bitmap; coverView?.setImageBitmap(bitmap) } }
    }
  }
  private class WindowActionIcon(private val closing: Boolean) : android.graphics.drawable.Drawable() {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 2f; strokeCap = Paint.Cap.ROUND }
    override fun draw(canvas: Canvas) {
      canvas.save()
      canvas.translate(bounds.exactCenterX() - dp(12), bounds.exactCenterY() - dp(12))
      canvas.scale(dp(24) / 24f, dp(24) / 24f)
      paint.color = if (!closing && policy.locked) accent else Color.WHITE
      if (closing) { canvas.drawLine(6f, 6f, 18f, 18f, paint); canvas.drawLine(18f, 6f, 6f, 18f, paint) }
      else {
        canvas.drawRoundRect(5f, 11f, 19f, 21f, 2f, 2f, paint)
        canvas.drawPath(Path().apply { moveTo(8f, 11f); lineTo(8f, 7f); cubicTo(8f, 1f, 16f, 1f, 16f, 7f); if (policy.locked) lineTo(16f, 11f) }, paint)
        canvas.drawLine(12f, 15f, 12f, 17f, paint)
      }
      canvas.restore()
    }
    override fun setAlpha(alpha: Int) { paint.alpha = alpha }
    override fun setColorFilter(colorFilter: ColorFilter?) { paint.colorFilter = colorFilter }
    override fun getOpacity() = PixelFormat.TRANSLUCENT
  }
  private class WaveView(context: Context) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    override fun onDraw(canvas: Canvas) {
      paint.color = accent; paint.strokeWidth = dp(2).toFloat(); paint.strokeCap = Paint.Cap.ROUND
      val bars = if (player?.isPlaying == true) DesktopLyricsWaveform.bars else FloatArray(32)
      val step = width.toFloat() / bars.size
      for (index in bars.indices) {
        val half = maxOf(dp(1).toFloat(), bars[index] * height * .45f)
        canvas.drawLine(step * (index + .5f), height / 2f - half, step * (index + .5f), height / 2f + half, paint)
      }
    }
  }
}
