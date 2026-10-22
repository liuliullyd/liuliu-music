# liuliu-music · 六六音乐

基于 React Native、TypeScript 和 Android Media3 的音乐播放器。保留首页目录、搜索、歌单、本地音乐、播放队列、音效、桌面歌词和车载媒体控制。

**首次安装没有音源。** 在线音乐播放需要用户自行选择并导入有权使用的 LX 2.0 兼容 `.js` 音源。应用不提供音源文件、音源下载服务器或口令激活。

## 使用音源

1. 打开“我的 → 音源”。
2. 点击“导入音源”，从系统文件选择器选择 `.js` 文件。
3. 应用校验脚本声明并测试初始化，再进行对应平台的播放链路检测。
4. 已导入的音源可以启停、拖动排序、检测或删除。取消文件选择不会改变已有音源。

无音源时可以进入界面、管理本地内容。在线目录数据仍通过平台目录接口获取；导入音源主要负责播放地址、歌词和封面解析。接口可用性和使用权限由相关服务规则决定，项目不保证平台持续兼容。

## 开发

需要 Node.js 22.11 或以上、JDK 17 和 Android SDK 36。Android NDK 版本见 `mobile-react-native/android/build.gradle`。

```sh
cd mobile-react-native
npm ci
npm run typecheck
npm test
npm run check:public
npm start
```

另开终端运行 `npm run android`，或在 Android Studio 打开 `mobile-react-native/android`。使用系统 `ANDROID_HOME`，也可在忽略的 `android/local.properties` 中配置 `sdk.dir`。

项目目前以 Android 为目标；未包含旧桌面端、iOS 工程或原开发仓库的历史记录。

## 构建

```sh
cd mobile-react-native/android
./gradlew assembleDebug
# Windows: gradlew.bat assembleDebug
```

调试签名由本机 Android 工具生成，不分发任何现有应用的签名密钥。公开版应用 ID 是 `com.liuliu.music.opensource`，可以与原开发版并存，数据目录彼此独立。

Release 启用 R8 和 Hermes。未提供正式签名时生成未签名产物；正式分发必须使用维护者自行保管的密钥。配置方式见 [构建与签名](docs/BUILDING.md)。

## 文档与许可

- [音源接口与安全边界](docs/SOURCE_INTERFACE.md)
- [构建与签名](docs/BUILDING.md)
- [第三方依赖和素材](THIRD_PARTY_NOTICES.md)
- [安全问题处理](SECURITY.md)
- [贡献说明](CONTRIBUTING.md)
- [公开版验证记录](docs/VERIFICATION.md)

项目代码采用 MIT 许可证，第三方依赖、字体和数据遵循各自许可证。主题与参考图使用本公开版原创的抽象图形；耳机品牌采用文字标签。

源代码许可不授予任何音乐、歌词、封面或第三方服务的使用权。请只导入具有相应权限的脚本与内容。
