# HUMHUM Android Living Signals Design QA

Date: 2026-07-18

Viewport: `390 x 844`, Android 16 / API 36 emulator, font scale `1.0`

Reference: [selected Living Signals target](docs/superpowers/specs/assets/humhum-android-living-signals.png)

Implementation capture: [Humi Living Signals](docs/superpowers/specs/assets/living-signals-first-viewport-actual.png)

## Blocking Comparison

The selected reference and the final implementation capture were normalized to the same viewport and inspected side by side. The implementation keeps the reference hierarchy: connection and settings, date, a factual Humi summary, one primary adjustment action, the day's route, private personal signals, and fixed four-role navigation.

The production layout intentionally uses shorter route cards than the concept image so all three fresh personal metrics remain visible above the fixed navigation on a real `390 x 844` surface. Longer stale or unavailable explanations remain scrollable instead of being compressed into unreadable text. Decorative sparklines, recovery scores and health conclusions were removed; the UI shows only source-backed daily health values and Agent state.

## States Reviewed

- [Pairing](docs/superpowers/specs/assets/pairing-first-viewport-actual.png)
- [Humi / Living Signals](docs/superpowers/specs/assets/living-signals-first-viewport-actual.png)
- [Hype](docs/superpowers/specs/assets/hype-first-viewport-actual.png)
- [Hush / sources enabled](docs/superpowers/specs/assets/hush-first-viewport-actual.png)
- [Hexa](docs/superpowers/specs/assets/hexa-first-viewport-actual.png)
- [Settings](docs/superpowers/specs/assets/settings-first-viewport-actual.png)
- [Health source unavailable](docs/superpowers/specs/assets/health-unavailable-viewport-actual.png)
- [Health permission denied](docs/superpowers/specs/assets/health-denied-viewport-actual.png)
- [Stale health summary](docs/superpowers/specs/assets/health-stale-viewport-actual.png)
- [Release Activity with real system bars](docs/superpowers/specs/assets/pairing-system-bars-actual.png)

## Findings

- P0: none.
- P1: none.
- P2: none after fixes.
- P3: the concept's decorative timeline connector and sparkline are not shipped. This is intentional: the release favors truthful source-backed summaries and a stable first viewport.

## Fixes Completed

- Replaced the legacy Android form-first shell with the Compose role experience while preserving QR, relay, approval, conversation and follow-up behavior.
- Compacted the route cards so the private-data label and personal signals remain visible without scrolling at the target viewport.
- Added one clipped mascot viewport so the four source PNGs render at consistent visual scale despite different white margins and aspect ratios.
- Kept Humi, Hype, Hush and Hexa visible as four fixed destinations, each with its own palette and mascot; Settings remains a separate gear action.
- Kept manual pairing fields collapsed as recovery-only UI.
- Made background-health opt-in persist only after Android grants the requested permission; denial leaves it off.
- Added Health Connect permission management, foreground permission/data refresh, and capture time for stale summaries.
- Preserved Hexa follow-up drafts through failed sends and clear them only after a matching success event.
- Applied real safe-drawing Insets, verified the release Activity against system bars, and kept the fresh personal-signals card above fixed navigation.
- Raised role and muted-text colors to WCAG AA contrast on their real white and soft backgrounds.
- Verified large-font primary actions and navigation at font scale `1.3` using both `LocalConfiguration` and `LocalDensity`.

## Automated Evidence

- Android JVM: `259` passed.
- Android instrumentation: `30` passed on API 36, including lifecycle recreation, foreground health refresh, permission-action boundaries, read-only Hexa controls, follow-up draft lifecycle, system Insets, large-font navigation and nine screenshot states.
- Android release lint, signed APK and signed AAB builds: passed.
- Release APK: certificate SHA-256 `c28cffbe0398b2db58dbb714dd394f0636cb55a690eefe6fda202a78ed4e12f8`; v2/v3 signatures verified; package `com.humhum.mobile`, version `0.3.15` / code `15`, target SDK `36`, no debuggable flag.
- Release install: clean `adb install --no-streaming` passed and `MainActivity` cold-launched in `407 ms` on the API 36 emulator.
- Desktop/web: `108` Vitest tests and `13` fixed Node tests passed.
- Relay: `19` tests passed.
- Rust: `327` passed, `3` ignored platform/live tests, `0` failed.

## Honest Device Gaps

The API 36 emulator validates rendering, Android lifecycle, Package Manager installation and the no-Health-Connect state. This machine does not have a connected physical Xiaomi phone, so real HyperOS permission sheets, Health Connect data, OEM process reclaim and 5G behavior remain explicitly unverified for this release.

final result: passed
