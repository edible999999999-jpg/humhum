# HUMHUM Tailnet Mobile Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional Tailscale private-overlay pairing so HUMHUM Android can use the existing secure Mobile Bridge across physical networks without exposing a public service.

**Architecture:** A focused Rust module discovers a strict `100.64.0.0/10` address through the official Tailscale CLI under a total timeout. Mobile Bridge advertises LAN plus optional tailnet URLs and creates transport-specific pairing artifacts while retaining one durable certificate identity. Android's exact certificate pin is paired with an exact configured-host verifier so the same leaf works safely on future private addresses.

**Tech Stack:** Rust, Tokio process/time, Hyper/TLS, React/TypeScript, Java 17 `HttpsURLConnection`, JUnit 4, Android SDK 26-36.

## Global Constraints

- Never install, authenticate, configure, or persist Tailscale credentials.
- Accept only one strict IPv4 address in `100.64.0.0/10`; never advertise arbitrary public hosts.
- Run only fixed `ip -4` CLI arguments with a two-second total discovery timeout.
- Preserve legacy LAN `url`, default LAN pairing, existing token/scope protocol, realtime wake and exact certificate pin.
- Add no Android permission or dependency.
- Do not claim physical cross-network success while Tailscale is absent from this Mac.

---

### Task 1: Bounded Tailnet Discovery

**Files:**
- Create: `src-tauri/src/tailnet.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- `parse_tailnet_ipv4(output: &[u8]) -> Option<Ipv4Addr>`.
- `discover_tailnet_ipv4() -> Option<Ipv4Addr>`.
- Internal `discover_from_candidates(paths: &[PathBuf], timeout: Duration)` supports deterministic tests.

- [x] **Step 1: Write failing tests** for one valid CGNAT address, both range boundaries, public/RFC1918/reserved-Quad100/multiple/noisy output rejection, and official candidate paths.
- [x] **Step 2: Run focused Rust tests** and require failure because the tailnet module is absent.
- [x] **Step 3: Implement strict parsing and candidate ordering** with deduplication and `TAILSCALE_BE_CLI=1`.
- [x] **Step 4: Add executable fixture tests** proving valid output succeeds, nonzero exit is ignored, and a sleeping fixture is killed by the total timeout.
- [x] **Step 5: Run focused tests and commit** `feat(mobile): discover bounded tailnet addresses`.

### Task 2: Dual-Address Bridge And Stable Identity

**Files:**
- Modify: `src-tauri/src/mobile_bridge.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/hook_server.rs`

**Interfaces:**
- `MobileNetwork::{Lan,Tailnet}` serialized snake case.
- `MobileBridgeStatus` adds `lan_url` and `tailnet_url`; legacy `url` equals LAN.
- `MobilePairingInfo` adds `network`.
- `create_pairing_on(scope, network)`; existing `create_pairing(scope)` delegates to LAN.

- [x] **Step 1: Add failing tests** for legacy LAN selection, valid tailnet selection, unavailable-tailnet rejection, `network=tailnet` query parsing, and unchanged Android setup privacy.
- [x] **Step 2: Add failing certificate test**: generating/reusing identity across two different LAN addresses must retain the same fingerprint and files.
- [x] **Step 3: Run focused tests** and require missing enum/selection/stable-identity failures.
- [x] **Step 4: Extend runtime state and status**, discover tailnet during enable, keep listener unchanged, select URL explicitly during pairing, and retain backwards-compatible LAN defaults.
- [x] **Step 5: Rework certificate creation** to reuse an existing cert/key pair without IP-triggered rotation; new certificates use ten-year validity. Malformed pairs fail later TLS loading rather than silently rotating.
- [x] **Step 6: Run Rust tests and commit** `feat(mobile): pair through optional tailnet`.

### Task 3: Android Durable-Pin Routing

**Files:**
- Modify: `android/app/src/main/java/com/humhum/mobile/BridgeConfig.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/PinnedTlsClient.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/MainActivity.java`
- Modify: `android/app/src/test/java/com/humhum/mobile/BridgeConfigTest.java`
- Modify: `android/app/src/test/java/com/humhum/mobile/CertificateFingerprintTest.java`

**Interfaces:**
- `BridgeConfig.isTailnet(): boolean`.
- `PinnedTlsClient.hostMatchesConfig(String hostname, BridgeConfig config): boolean`.

- [x] **Step 1: Write failing tests** for CGNAT classification boundaries, private/public rejection, exact configured-host acceptance and alternate private-host rejection.
- [x] **Step 2: Run focused JVM tests** and require missing APIs.
- [x] **Step 3: Implement classification and install a hostname verifier** that accepts only the immutable parsed config host while the existing trust manager independently checks date and exact leaf fingerprint.
- [x] **Step 4: Label paired status as `Tailnet` only for CGNAT destinations**, run all Android tests/lint/release builds and inspect unchanged permissions.
- [x] **Step 5: Commit** `feat(android): support pinned tailnet routes`.

### Task 4: Hexa Selection, Runtime And Release

**Files:**
- Modify: `src/hooks/useHexaData.ts`
- Modify: `src/components/Hub/HexaModule.tsx`
- Modify: `docs/android-install.md`
- Modify: `docs/competitive-parity-2026-07-12.md`
- Modify: this plan to check completed steps.
- Generate ignored: `build/releases/HUMHUM-Android-0.1.0.apk`
- Generate ignored: `build/releases/HUMHUM-Android-0.1.0.aab`

**Interfaces:**
- `startMobilePairing(scope, network)` sends both values.
- Hexa shows LAN/Tailnet segmented selection only when `tailnet_url` is non-null.

- [x] **Step 1: Extend TypeScript contracts and initial state**, then wire selected transport into both read/control pairing commands.
- [x] **Step 2: Add a compact segmented control when tailnet exists**; keep the LAN-only layout unchanged when unavailable.
- [x] **Step 3: Build/relaunch desktop on this no-Tailscale Mac**, require `url == lan_url`, `tailnet_url == null`, unchanged fingerprint, LAN HTTPS 200, and successful Android visible pairing/realtime approval/follow-up smoke.
- [x] **Step 4: Use executable CLI fixtures in tests to prove valid tailnet discovery and timeout**, while explicitly recording that physical remote routing remains unverified.
- [x] **Step 5: Run frontend tests/build, Android tests/lint/release build, Rust tests, signatures, exact permissions, revocation cleanup and zero-device checks.**
- [x] **Step 6: Copy verified artifacts, update hashes/docs, stop emulator, and commit** `docs(mobile): verify optional tailnet access`.
