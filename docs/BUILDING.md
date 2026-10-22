# Android build and signing

Use Node.js >=22.11, JDK 17, Android SDK/build tools 36 and NDK 27.1.12297006. Install the pinned JavaScript dependencies with `npm ci` in `mobile-react-native`.

The build has no dependency on a private memory file, an E-drive path, a source server or an activation asset. `preBuild` runs the publication hygiene check. Release disables R8/ProGuard minification/obfuscation, resource shrinking and Metro minification. Hermes remains the ordinary JavaScript runtime, with no `-O` compiler optimization flag or hardening/packing step. Normal APK signing remains enabled when configured.

## Release signing

Provide all four settings as environment variables or in your private Gradle user properties file:

```text
LIULIU_RELEASE_STORE_FILE=/absolute/path/outside/the/repository/release.jks
LIULIU_RELEASE_STORE_PASSWORD=<your-private-password>
LIULIU_RELEASE_KEY_ALIAS=<your-private-alias>
LIULIU_RELEASE_KEY_PASSWORD=<your-private-password>
```

Never commit these values or your keystore. Do not put real values into example files or issue reports. A Release build without all four values remains unsigned; it never falls back to the debug key. Debug builds use the Android plugin's local debug keystore.

```sh
cd mobile-react-native/android
./gradlew assembleRelease
```

The public application ID is `com.liuliu.music.opensource`; Java/Kotlin namespace remains `com.liuliu.agentmusic`. This edition does not replace the existing private application's installation or share its private data.

The source check and unit tests do not replace hardware testing of Bluetooth, A2DP, AVRCP or a commercial car host. Platform music endpoints may change independently of the app.

On Windows, prefer a short checkout path. If CMake/Ninja reports paths longer than 260 characters, pass `-PliuliuNativeBuildDir=<short-absolute-build-directory>` to Gradle. This changes only the generated native build directory; it is not needed on most other systems.
