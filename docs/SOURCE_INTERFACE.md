
## 文件与协议

兼容 LX 2.0 核心接口：

脚本初始化仅证明接口可加载，不证明任何歌曲已获授权或必然可播放

## 生命周期

文件导入 → 元数据校验 → 隔离运行时初始化 → 保存用户导入记录 → 平台播放链路检测。

启停、排序和删除会使旧播放准备与地址缓存失效，随后重新检测来源绑定。关闭应用后保留用户自行导入的脚本；普通备份只恢复用户导入记录，旧版本中的内置和远程分发记录不会被恢复为可用音源。

## 安全边界

Android 使用无 Node.js API 的 WebView 脚本运行时，禁用导航、弹窗及直接页面网络访问，脚本网络请求通过原生受限桥接。运行时提供的网络能力仍可向第三方发送请求，用户应只导入可信且有权使用的脚本。沙箱不构成对脚本隐私或版权的保证。

实现位于 `src/services/sourcePolicy.ts`、`src/services/sourceRuntime.ts`、`src/services/storage.ts`、`src/state/AppContext.tsx` 和 Android `SourceScriptRuntime.kt`。
