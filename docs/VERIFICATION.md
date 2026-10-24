# Public-edition verification

## V1.0.5 — remove eight selected themes

Checked on 2026-10-24. Removed 热血少年 and 月下幻想 (anime), 滑雪极境 and 街头滑板 (sports), 公路落日 and 深海奇境 (film), 玄月灵狐 and 星轨花园 (featured). Their catalog entries, palette tokens, theme IDs, artwork references and eight PNG files were removed together. The remaining 24 entries keep their exact order, labels, palettes and PNG hashes: classic 8, each other category 4. Persisted and native-startup selections of removed themes use the existing white/default-accent fallback.

All 17 public Jest suites / 282 tests pass, including 31 theme cases. Production and direct-test TypeScript checks pass; the four changed sources and new test have zero ESLint errors or warnings. The independent app was cleaned before the four-ABI Release build to remove stale generated resources. The signed APK has exactly 24 theme drawables and zero resources for the removed IDs; all retained images have identical decoded RGBA pixels. All 6428 frozen application inputs have zero drift, the four theme sources match the fresh Metro map, and the APK Hermes bytes match the generated output. Full ZIP integrity, dedicated v2/v3 signing, 16 KB alignment and the existing no-obfuscation gates pass.

Application ID: `com.liuliu.music.opensource`; version `1.0.5` / code `6`. Artifact: `liuliu-music-V1.0.5-code6-release.apk`, 114710953 bytes, SHA-256 `3c820a4c9f8060fead2a431ce29f70bfa780d1e574cb94fd081877c380528900`. No device installation or visual device acceptance was performed. Playback, image preloading, audio preparation/cache, queue pagination and the main project are unchanged. The existing playlist audio-cache issue remains open.

## V1.0.4 — upgrade cached song thumbnails on the player

Checked on 2026-10-24. The player already requested larger provider artwork candidates, but a cached later thumbnail could become the current candidate and skip every earlier large image. Player-sized artwork now starts at the first candidate while using the cached image as a preview. A successful larger image replaces it; unavailable candidates retain the existing retries and fallback order. Preview display errors do not consume the independent larger-image request, and late preview errors cannot clear the accepted larger image. Ordinary thumbnail surfaces keep their existing cache behavior.

Six component cases cover the cached-thumbnail upgrade, preview error isolation, exhausted large-image fallback, late preview callbacks, an already cached large cover and ordinary thumbnail behavior. All 16 public Jest suites / 251 tests pass. Production and direct regression-test TypeScript checks pass. ESLint introduces no new diagnostics (the component retains its two existing warnings). Four-ABI Release assembly, Android vital lint, dedicated v2/v3 signing and 16 KB ZIP alignment pass. All 6,435 frozen application inputs have zero drift; the changed component matches the fresh Metro map, and the generated Hermes bytes match the signed APK. All 6,700 ZIP entries pass length/CRC and directory checks. All 32 theme backgrounds retain their exact decoded RGBA pixels.

Application ID: `com.liuliu.music.opensource`; version `1.0.4` / code `5`. Artifact: `liuliu-music-V1.0.4-code5-release.apk`, 124066665 bytes, SHA-256 `a6de4216a782e904cb0b1f4ed4c027b14622f3a908fcfe813d9b9ef7e75b0999`. The dedicated signing certificate and disabled obfuscation/minification policies are unchanged. This package check does not establish device visual acceptance or guarantee high-resolution originals from every provider. Audio preparation/cache, queue pagination, themes and layout are outside this change; the separately diagnosed playlist audio-cache issue remains open.

## V1.0.3 — continuous playlist gradients and two-row local controls

Checked on 2026-10-23. Older collection details (including all-playlists, Roam and search entries) and the Library favorites/downloads/local headers applied a bottom fade before the toolbar, followed by another fade in the toolbar. Removing the header fade leaves the sampled color continuous across that boundary and preserves the toolbar fade, top treatment and sticky behavior. The already-correct shared HomePlaylistDetail implementation is unchanged.

Local music now places favorite, download, playback mode and play-all in the first row, with scan, add and delete-all in the second. The action surface and sticky container both cover the full 144 logical-pixel height. Button sizes, original callbacks, empty-list disabled states and deletion confirmation are retained; the ordinary and personal-playlist single-row layouts remain intact. The obsolete local single-row compression styles were removed.

The new component regression reproduced seven failures before the repair; all ten cases pass afterward. All 15 public Jest suites / 245 tests, production TypeScript and direct test TypeScript checks pass. The four changed production files introduce no ESLint errors or rule-count increases relative to the frozen V1.0.2 source; pre-existing screen lint findings remain. Four-ABI Release assembly, Kotlin compilation, Android vital Release lint, unobfuscated configuration, dedicated v2/v3 signing and 16 KB ZIP alignment pass. All 6,434 frozen application inputs have zero drift, the four UI sources match the fresh Metro source map, and both new row markers are present in the signed APK. All 32 packaged theme images retain their original dimensions and exact decoded RGBA pixels.

Application ID: `com.liuliu.music.opensource`; version `1.0.3` / code `4`. Artifact: `liuliu-music-V1.0.3-code4-release.apk`, 124066665 bytes, SHA-256 `7bb8f41c06ff6004c75651f0ca0b093a7425270313dccb5daf9816eec6ec3411`. The dedicated signing certificate and no-obfuscation policy are unchanged. Startup, source handling, playback preparation/cache and pagination are outside this UI change; the separately diagnosed cached playlist selection issue remains open.

No device installation or visual device acceptance is established by these checks. The existing shared emulators are occupied by a separate main-project validation task. Component and package evidence must not be represented as Android screenshot, physical-phone, font-scale or car compatibility acceptance.

## V1.0.2 — remove the peripheral configuration entry from My/settings

Checked on 2026-10-23. Removed the “车载互联与蓝牙” button and its two unused styles from SettingsScreen. The native car/media integration is unchanged. Theme artwork, startup autoplay, playback settings, imported-source management and playlist code are unchanged in this release.

The actual App settings-render regression failed before removal and passed afterward. TypeScript and all 13 public Jest suites / 235 tests passed. Four-ABI Release assembly, Kotlin compilation, Android Release lint, the unobfuscated configuration gate, dedicated v2/v3 signing and 16 KB ZIP alignment passed. The V1.0.1 Hermes bundle contains the removed entry's test ID as a positive control; the V1.0.2 bundle does not, while the normal playback, theme and source-management IDs remain present. All 32 packaged theme backgrounds retain their original resolutions and exact decoded RGBA pixels.

Application ID: `com.liuliu.music.opensource`; version `1.0.2` / code `3`. Artifact: `liuliu-music-V1.0.2-code3-release.apk`, 124066665 bytes, SHA-256 `b93dc2722ad511cf1d7b8b1059ca8ac339f6d111e82463d08afa6a95be2ed20b`. The signing certificate and disabled obfuscation/minification policies are unchanged. No device installation was performed. These entry-removal checks do not establish complete playlist/cache acceptance; that requires its own diagnostics and device verification.

## V1.0.1 — original theme artwork restored

Checked on 2026-10-23. Restored all 32 existing project theme backgrounds in the five theme categories. V1.0.0 accidentally shipped 180×320 generated gradients under the original theme names; the original scenes and names now correspond again. Theme IDs, palettes, layout, preview rendering and startup autoplay logic are unchanged.

TypeScript and all 13 Jest suites / 235 tests passed. Four-ABI Release assembly, Kotlin compilation, Android Release lint, the unobfuscated configuration gate, dedicated v2/v3 signing and 16 KB ZIP alignment passed. All 32 restored source PNG hashes match the frozen original artwork. All 32 APK resource-table mappings and resolutions were checked, then the PNGs were extracted and decoded: every RGBA pixel matches its original (zero mismatches). Android's ordinary lossless PNG re-encoding changes file bytes, so pixel identity was checked in addition to source hashes.

Application ID: `com.liuliu.music.opensource`; version `1.0.1` / code `2`. Artifact: `liuliu-music-V1.0.1-code2-release.apk`, 124066665 bytes, SHA-256 `9846fbd9cbc5a3fe73759c8da6a127edb80084ca16225f96240ddc61ff0fab1b`. The dedicated signing certificate is unchanged from V1.0.0. R8/ProGuard, resource shrinking and Metro minification remain disabled. No bundled sources, activation or removed spoken-media/vendor-car implementation was restored. No device installation was performed in this repair.

## V1.0.0 — historical verification

Checked on 2026-10-23 for the music-only V1.0.0 / Android code 1 release.

| Check | Result |
| --- | --- |
| Production TypeScript typecheck | Passed |
| Public-edition Jest suites | 13 suites, 235 tests passed |
| Source lifecycle integration | Empty install, no activation controls, picker cancellation, invalid metadata, failed initialization, import/persistence, duplicate rejection and deletion passed |
| Music-only UI and storage | Removed Home/Library/Search entry points; obsolete backup buckets are discarded while music playlists, albums, artists and history remain supported |
| App-owned car protocol JVM contract | Passed: version, dispatch, duplicate/conflicting IDs, rejected input, segmented/coalesced frames, size limit and playback modes |
| Publication hygiene | No bundled playback source, distribution/activation module, dedicated signing key, obsolete media implementation or vendor car protocol in the public source |
| Release Kotlin compilation | Passed |
| Four-ABI Release assembly | Passed, including Android Release lint |
| Effective Release configuration | R8/ProGuard obfuscation, resource shrinking and Metro minification disabled; Hermes optimization flags empty |
| Actual APK | Hermes bytecode; all four application ELF architectures verified; readable application class descriptors; removed media endpoints and old car protocol classes absent |
| Package signing and alignment | Dedicated release certificate, APK signature schemes v2/v3 verified, 16 KB ZIP alignment passed |
| Frozen application inputs | 6,432 files, zero drift through build and package verification |

The application ID is `com.liuliu.music.opensource`, version name `1.0.0`, version code `1`, minimum Android API 24. The actual native libraries cover `armeabi-v7a`, `arm64-v8a`, `x86` and `x86_64`.

The signed artifact `liuliu-music-V1.0.0-code1-release.apk` is 86,522,729 bytes. SHA-256:

```text
31a9ffc9cb9b42b61d3b94f8909cc4cadc5f01199bd2384efafaf84d5861a2ee
```

The dedicated signing certificate SHA-256 is `50a57b40c978d6c455a2c260b30a398fa4968701052f8dea01cff07256817250`. Signing keys and passwords are excluded from the repository. Subsequent official updates must use the same certificate.

The car implementation uses Android MediaSession/MediaBrowser and the documented [app-owned peripheral protocol](CAR_INTEGRATION.md). The former vendor discovery, LAN audio/PCM, protocol state and vendor-specific metadata/mode files have been deleted. Ordinary QQ music catalog support is separate from those removed car protocols.

These checks cover this public source edition and the signed package. No device installation was performed. Device startup, imported-source playback, physical BLE/SPP, A2DP/AVRCP and commercial car-host compatibility require separate device verification. They are not established by compiler, JVM or package checks. Older validation artifacts are superseded by this release.
