package com.liuliu.agentmusic

import android.Manifest
import android.bluetooth.*
import android.content.*
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat

/** A2DP is owned by Android. This observes profiles and opens the system connection UI. */
@Suppress("MissingPermission")
internal class CarBluetoothManager(private val context: Context) : AutoCloseable {
  private val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter
  private val prefs = context.getSharedPreferences("liuliu_car", Context.MODE_PRIVATE)
  private var proxy: BluetoothProfile? = null
  private var registered = false
  private var requesting = false
  var status = "蓝牙监测未启用"; private set
  var devices: List<BluetoothDevice> = emptyList(); private set
  val connected: Boolean get() = devices.isNotEmpty()
  val lyricEnabled: Boolean get() = prefs.getBoolean("bluetooth_lyrics", false)
  val offsetMs: Long get() = devices.firstOrNull()?.let { prefs.getLong("offset_${it.address}", 0) } ?: 0
  val autoDriving: Boolean get() = prefs.getBoolean("auto_driving_ui", false)
  // Auto-play is deliberately independent and opt-in, never inferred from a connected device.
  val autoPlay: Boolean get() = prefs.getBoolean("auto_driving_play", false)
  fun setLyrics(enabled: Boolean, offset: Long) {
    prefs.edit().putBoolean("bluetooth_lyrics", enabled).apply()
    devices.firstOrNull()?.let { prefs.edit().putLong("offset_${it.address}", offset.coerceIn(-10_000, 10_000)).apply() }
    refresh()
  }
  fun setDriving(enter: Boolean, play: Boolean) { prefs.edit().putBoolean("auto_driving_ui", enter).putBoolean("auto_driving_play", play).apply() }
  fun mark(device: BluetoothDevice, car: Boolean) { prefs.edit().putBoolean("car_${device.address}", car).apply(); refresh() }
  fun isCar(device: BluetoothDevice): Boolean {
    if (prefs.contains("car_${device.address}")) return prefs.getBoolean("car_${device.address}", false)
    val name = if (Build.VERSION.SDK_INT >= 30) device.alias ?: device.name else device.name
    val type = device.bluetoothClass?.deviceClass
    return type == BluetoothClass.Device.AUDIO_VIDEO_CAR_AUDIO || name?.contains(Regex("(?i)(car|车载|车机|车载音响)")) == true
  }
  private val listener = object : BluetoothProfile.ServiceListener {
    override fun onServiceConnected(profile: Int, service: BluetoothProfile) {
      if (!registered) { adapter?.closeProfileProxy(profile, service); return }
      proxy = service; refresh()
      requesting = false
    }
    override fun onServiceDisconnected(profile: Int) { proxy = null; requesting = false; devices = emptyList(); refresh() }
  }
  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(c: Context?, intent: Intent?) { refresh() }
  }
  fun permitted(): Boolean = Build.VERSION.SDK_INT < 31 || ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
  fun start() {
    if (!permitted()) { status = "需要附近设备权限"; CarConnectionState.changed(); return }
    if (!registered) {
      registered = true
      ContextCompat.registerReceiver(context, receiver, IntentFilter().apply {
        addAction(BluetoothAdapter.ACTION_STATE_CHANGED); addAction(BluetoothA2dp.ACTION_CONNECTION_STATE_CHANGED)
        addAction(BluetoothDevice.ACTION_ACL_CONNECTED); addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED)
      }, ContextCompat.RECEIVER_EXPORTED)
    }
    if (adapter?.isEnabled == true && proxy == null && !requesting) requesting = adapter.getProfileProxy(context, listener, BluetoothProfile.A2DP)
    prefs.edit().putBoolean("monitor_enabled", true).apply(); refresh()
  }
  fun restore() { if (prefs.getBoolean("monitor_enabled", false)) start() }
  private var previous = emptySet<String>()
  fun refresh() {
    val before = previous
    try {
      if (registered && permitted() && adapter?.isEnabled == true && proxy == null && !requesting) requesting = adapter.getProfileProxy(context, listener, BluetoothProfile.A2DP)
      devices = if (permitted() && adapter?.isEnabled == true) proxy?.connectedDevices.orEmpty() else emptyList()
      status = when { !permitted() -> "附近设备权限已拒绝"; adapter == null -> "本机无蓝牙适配器"; !adapter.isEnabled -> "蓝牙已关闭";
        devices.isEmpty() -> "A2DP 未连接；请在系统蓝牙设置连接"; else -> devices.joinToString { it.name ?: it.address } }
      previous = devices.map { it.address }.toSet()
      devices.forEach { prefs.edit().putString("history_${it.address}", it.name ?: it.address).apply() }
      val newlyConnectedCar = devices.any { it.address !in before && isCar(it) }
      if (newlyConnectedCar && autoDriving && CarPlayerActivity.phoneForeground && !CarPlayerActivity.carForeground && CarConnectionState.player?.isPlaying == true && CarConnectionState.snapshot.optBoolean("ready")) {
        context.startActivity(Intent(context, CarPlayerActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      if (newlyConnectedCar && autoPlay && CarConnectionState.snapshot.optBoolean("ready")) CarConnectionState.request("play")
    } catch (_: SecurityException) { devices = emptyList(); status = "蓝牙权限已撤回" }
    MusicPlaybackService.refreshMediaNotification(); CarConnectionState.changed()
  }
  fun stop() { prefs.edit().putBoolean("monitor_enabled", false).apply(); close(); status = "蓝牙监测已关闭"; CarConnectionState.changed() }
  override fun close() {
    if (registered) runCatching { context.unregisterReceiver(receiver) }; registered = false
    proxy?.let { runCatching { adapter?.closeProfileProxy(BluetoothProfile.A2DP, it) } }; proxy = null
    devices = emptyList(); previous = emptySet(); MusicPlaybackService.refreshMediaNotification()
    requesting = false
  }
}
