# 用户导入音源接口

在线播放音源只来自用户通过系统文件选择器导入的 `.js` 文件。默认列表为空，不存在订阅地址、远程音源目录、口令、机器码、后台同步或开发者提供的下载链接。

## 文件与协议

脚本头部必须包含块注释和 `@name`；可选 `@description`、`@author`、`@homepage`、`@version`。同名称同版本的重复导入会被拒绝，初始化失败不会替换原列表。

兼容 LX 2.0 核心接口：

- `lx.EVENT_NAMES.inited` 和 `lx.EVENT_NAMES.request`。
- `musicUrl`、`lyric`、`pic` 动作。
- `lx.request`、Buffer、MD5、AES、RSA、zlib 工具。
- `kw`、`kg`、`tx`、`wy`、`mg`、`qs` 等来源能力声明。

脚本初始化仅证明接口可加载，不证明任何歌曲已获授权或必然可播放。实际播放继续经过平台健康检测、地址和音频完整性校验。

## 生命周期

文件导入 → 元数据校验 → 隔离运行时初始化 → 保存用户导入记录 → 平台播放链路检测。

启停、排序和删除会使旧播放准备与地址缓存失效，随后重新检测来源绑定。关闭应用后保留用户自行导入的脚本；普通备份只恢复用户导入记录，旧版本中的内置和远程分发记录不会被恢复为可用音源。

## 安全边界

Android 使用无 Node.js API 的 WebView 脚本运行时，禁用导航、弹窗及直接页面网络访问，脚本网络请求通过原生受限桥接。运行时提供的网络能力仍可向第三方发送请求，用户应只导入可信且有权使用的脚本。沙箱不构成对脚本隐私或版权的保证。

实现位于 `src/services/sourcePolicy.ts`、`src/services/sourceRuntime.ts`、`src/services/storage.ts`、`src/state/AppContext.tsx` 和 Android `SourceScriptRuntime.kt`。
