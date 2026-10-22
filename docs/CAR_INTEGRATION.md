# 六六音乐车载接口

应用 ID 为 `com.liuliu.music.opensource`。车载界面、曲库、搜索和控制均操作手机现有的唯一播放器、音乐队列及用户导入音源，不创建第二个播放器，不借用其它音乐 App 的包名、签名或身份。

Android 标准入口是 `MusicPlaybackService` 的 Media3 `MediaLibraryService`、兼容的 `android.media.browse.MediaBrowserService` 和 MediaSession。标准播放、暂停、停止、前后切歌、进度与元数据由系统媒体接口传递。A2DP 音频路由和 AVRCP 连接由 Android 管理。应用车载页的显式 Intent action 为 `com.liuliu.music.opensource.action.CAR_PLAYER`。

附加收藏和模式命令分别为 `com.liuliu.music.opensource.car.FAVORITE`、`com.liuliu.music.opensource.car.PLAY_MODE`。应用自有 extras 使用 `com.liuliu.music.opensource.car.` 前缀；不使用其它音乐客户端的专用字段。通用浏览器可以忽略这些附加字段。

## 可选 BLE/SPP 外设

用户自行配置外设 profile 中的服务、读写特征和 SPP UUID。两端必须实现相同的六六协议；系统蓝牙配对不会自动赋予协议兼容能力。默认服务 UUID 以 `71372400-7485-4c12-a155-1030e1e62120` 为起点，profile 的 `protocol` 为 `liuliu-car-v1`。保留 `raw` 模式供用户选择的设备仅收发字节。

六六控制协议采用 UTF-8，每行一条 JSON，单帧上限 8,192 字节。示例：

```json
{"protocol":"liuliu-car-v1","id":1,"command":"pause","args":{}}
```

所有请求包含非负 `id` 和明确版本。相同 ID/相同请求返回缓存响应，不重复执行；相同 ID/不同请求拒绝。未知版本和命令拒绝。响应同样包含 `protocol`、`id` 及 `result` 或 `error`。

| 命令 | 参数 |
| --- | --- |
| `state` | 无；读取实际播放器状态，时间单位毫秒 |
| `library` | `parent`：已签发的 `car:` 目录；`page`：从 0 开始，每页最多 20 项 |
| `search` | `query`、`page`、`reset`；连续读取搜索页 |
| `select` | `id`：当前曲库或搜索签发的歌曲 ID |
| `play` / `pause` / `stop` / `next` / `previous` | 可带当前 `mediaId` 防止过期操作 |
| `seek` | `seconds`，可带当前 `mediaId` |
| `favorite` | 可选布尔 `value`，省略则切换 |
| `mode` | `mode`：`sequence`、`shuffle`、`repeat-one` |

断开外设使旧代次请求失效。选曲继续经过应用的音源健康、歌曲身份及实际播放检查。该接口不提供局域网自动发现或 PCM 传输。

JVM 合约测试见 `mobile-react-native/test-support/native/CarControlContract.kt`，与生产 `PeripheralCommands.kt`、`PeripheralFrames.kt`、`CarPlaybackMode.kt` 一起用 Kotlin/JDK 17 编译，并将 `org.json` 加入 classpath。它验证版本、命令分发、重复/冲突、分段与合包、帧大小上限及播放模式。真实 BLE/SPP、A2DP/AVRCP 和商业车机兼容性仍需目标硬件验证。
