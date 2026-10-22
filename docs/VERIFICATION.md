# Public-edition verification

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
