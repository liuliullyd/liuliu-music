# Public-edition verification

Checked on 2026-10-22 against this standalone Android source edition:

| Check | Result |
| --- | --- |
| Production TypeScript typecheck | Passed |
| Public-edition Jest suites | 13 suites, 237 assertions passed |
| Source lifecycle integration | Empty install, no activation controls, picker cancellation, invalid metadata, failed initialization, successful import/persistence, duplicate rejection and deletion passed |
| Publication hygiene | No bundled playback source, source distribution/activation module, signing key or private build dependency in the selected public files |
| Release JavaScript bundle / Hermes | Built successfully |
| Production Kotlin compilation | Passed; existing deprecation warnings retained |
| x86_64 Release assembly | Passed with R8/Hermes; unsigned validation artifact |
| Android package identity | com.liuliu.music.opensource, version 1.0.0 / code 1 |

The unsigned x86_64 artifact is not an installable official release and is excluded from Git. Its SHA-256 was `3b8629b0bbf5c9be83c62e54cf8a04c5f44e6044ec68a09fbf237bb6576ecef9`. It contained no source-distribution assets or signing entries.

These results cover the exported source tree and its selected tests. They do not mean the old private repository's entire test history passed, nor do they establish device playback, all platforms, all ABIs, physical Bluetooth or commercial car-host compatibility. No device installation or user-data migration was performed for this public edition.
