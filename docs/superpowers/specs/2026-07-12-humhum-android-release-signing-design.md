# HUMHUM Android Release Signing Design

## Goal

Produce a non-debuggable, installable HUMHUM Android release APK and a Play-compatible AAB signed by one durable project-specific key, while keeping every private key and password outside the repository.

## Approach

Use Android Gradle Plugin signing configuration backed by an owner-only properties file at `~/.humhum/android-signing.properties` and a JKS keystore at `~/.humhum/android-signing/humhum-release.jks`.

This is preferred over two alternatives:

1. Manually calling `apksigner` after every build is simpler once, but separates alignment/signing from Gradle, makes AAB signing awkward, and is easier to perform inconsistently.
2. Google Play App Signing is appropriate when a Play developer account exists, but it cannot produce a locally verifiable release today without external account setup. The local key can later be used as a Play upload key or replaced under a documented migration.

Android's official guidance recommends keeping signing information in a separate properties file and warns that losing the signing key prevents updates. HUMHUM therefore treats the local key as durable release state, not generated build output.

## Secret Boundary

- The repository contains only loading and validation logic, never paths with embedded usernames, passwords, private-key bytes, or certificate exports.
- The properties file contains absolute `storeFile`, `storePassword`, `keyAlias`, and `keyPassword` values and is mode `0600`.
- The signing directory is mode `0700`; the JKS is mode `0600`.
- A 32-byte cryptographically random password is generated locally and never printed in command output or copied into docs.
- The keystore has one alias, `humhum-release`, with a 4096-bit RSA key and SHA-256 certificate signature valid for 30 years.
- Build logs and final reports may expose only the certificate SHA-256 digest, subject, validity dates, APK/AAB hashes, and paths to public artifacts.

## Gradle Behavior

`android/app/build.gradle.kts` loads signing properties from the fixed user-home location before `android {}`.

- If all four values exist and the keystore is a regular file, create signing config `humhumRelease` and assign it to the `release` build type.
- If the properties file is absent, debug and tests continue working; a requested release task fails with a direct setup message instead of silently emitting an unsigned artifact.
- If the file is partial, malformed, or points outside the current user's home directory, configuration fails before signing.
- Release remains `isDebuggable=false`; debug remains signed by the Android debug key.
- Build both `assembleRelease` and `bundleRelease`. Copy resulting public artifacts to ignored `build/releases/` only after verification.

## Upgrade Identity

Android accepts an update only when package name and signing identity match. Runtime verification will:

1. Install the signed release APK on the existing API 36 ARM64 emulator.
2. Build the same package again with the same key and a temporary higher `versionCode` override or reinstall path.
3. Use Package Manager replacement to prove the second artifact is accepted without clearing app data.
4. Compare signer certificate digests across both artifacts.

The existing debug-signed APK cannot update over the release APK and vice versa. Documentation must tell users to uninstall the debug build once before moving to the release channel; that transition clears Android-local pairing state and requires re-pairing.

## Verification

- `assembleRelease` and `bundleRelease` exit successfully.
- `apksigner verify --verbose --print-certs --Werr` passes for min SDK 26 and reports v2/v3 signing as produced by current build tools.
- `aapt2 dump badging` reports package `com.humhum.mobile`, version `0.1.0`, min SDK 26, target SDK 36, and no `application-debuggable` line.
- `jarsigner -verify` validates the AAB.
- Keystore and property permissions, alias count, algorithm, key size, certificate validity, and certificate digest are inspected without exposing passwords.
- Emulator streamed install, cold launch, same-key replacement, and retained marker/app data are verified.
- Android JVM tests, lint, frontend tests/build, Rust tests, and desktop HTTPS bridge smoke remain green.

## Release Boundary

This creates a durable locally signed release channel, not Play/Xiaomi Store publication, notarized key custody, an HSM backup, or automatic updates. The user must back up both local signing files together before relying on this key for public distribution.
