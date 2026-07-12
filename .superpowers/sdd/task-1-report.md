# Task 1: Strict Snapshot And Cipher Contracts

## Files

- Added `android/app/src/main/java/com/humhum/mobile/SessionSnapshot.java` with an immutable session list.
- Added `android/app/src/main/java/com/humhum/mobile/SessionSnapshotCodec.java` for the strict, redacted snapshot JSON payload and offline freshness copy.
- Added `android/app/src/main/java/com/humhum/mobile/SessionSnapshotCipher.java` for the bounded AES-GCM envelope and authenticated binding.
- Added `android/app/src/test/java/com/humhum/mobile/SessionSnapshotCodecTest.java`.
- Added `android/app/src/test/java/com/humhum/mobile/SessionSnapshotCipherTest.java`.
- Checked only Task 1 in `docs/superpowers/plans/2026-07-12-humhum-android-encrypted-offline-snapshot.md`.

## TDD Evidence

All Gradle commands used the installed Android SDK and Homebrew OpenJDK 17 explicitly:

```sh
JDK_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
ANDROID_HOME="$HOME/Library/Android/sdk" ANDROID_SDK_ROOT="$HOME/Library/Android/sdk" \
JAVA_HOME="$JDK_HOME" PATH="$JDK_HOME/bin:$PATH"
```

### Red: codec contract

Command:

```sh
./android/gradlew -p android :app:testDebugUnitTest --tests '*SessionSnapshot*'
```

Observed expected compilation failure after the codec test was added: `SessionSnapshot` and `SessionSnapshotCodec` were unresolved symbols in `SessionSnapshotCodecTest` (15 compiler errors).

### Green: codec contract

Command:

```sh
./android/gradlew -p android :app:testDebugUnitTest --tests '*SessionSnapshot*'
```

Observed output: `BUILD SUCCESSFUL in 1s` after implementing `SessionSnapshot` and `SessionSnapshotCodec`.

### Red: cipher contract

Command:

```sh
./android/gradlew -p android :app:testDebugUnitTest --tests '*SessionSnapshot*'
```

Observed expected compilation failure after the cipher test was added: `SessionSnapshotCipher` and `SessionSnapshotCipher.Decrypted` were unresolved in `SessionSnapshotCipherTest` (14 compiler errors).

### Green: cipher contract

Command:

```sh
./android/gradlew -p android :app:testDebugUnitTest --tests '*SessionSnapshot*'
```

Observed output: `BUILD SUCCESSFUL in 1s` after implementing `SessionSnapshotCipher`.

### Final verification

Command:

```sh
./android/gradlew -p android :app:testDebugUnitTest
```

Observed output: `BUILD SUCCESSFUL in 1s`.

## Self-Review

- The payload accepts exactly `{version,saved_at_ms,sessions}` and each entry exactly `{project,agent,status,last_activity_at,needs_attention}`. Unknown keys, non-exact number/boolean types, bounds violations, future/negative/expired times, and more than 30 sessions fail closed.
- Encoding persists only the five permitted session fields. Decoding constructs a new `Models.Session` with an empty ID, no actions, and `canMessage=false`.
- The cipher requires a four-field envelope, canonical unpadded Base64URL, a 12-byte nonce, a 256 KiB envelope cap, a seven-day maximum age, and UTF-8 binding AAD. Tampering or a changed binding fails AES-GCM authentication.
- `SessionSnapshot` freezes its session list, and `Decrypted.payload()` returns a defensive copy.
- `git diff --check` completed with no whitespace errors. Unrelated `design-qa-assets/` and `design-qa.md` were not modified or staged.

## Commit

Planned commit message: `feat(android): define encrypted snapshot format`.

## Concerns

The repository does not provide a working default Android toolchain in this shell: `ANDROID_HOME` was unset and the default DevEco Studio runtime lacks `jlink`. Verification succeeded only with the explicit local SDK and Homebrew OpenJDK 17 environment shown above. No repository configuration was changed.
