# macOS Release Signing and Notarization

This project is distributed outside the Mac App Store, so release builds must be signed with a Developer ID certificate and notarized by Apple. Without both steps, Gatekeeper may show a scary warning or block the app.

## Requirements

- Apple Developer Program membership
- Xcode or Xcode Command Line Tools
- Developer ID Application certificate installed in the login keychain
- App-specific password or a stored `notarytool` profile

## One-Time Apple Setup

1. Create a Developer ID Application certificate in the Apple Developer portal.
2. Install the downloaded certificate on the build Mac.
3. Confirm the signing identity:

```bash
security find-identity -v -p codesigning
```

Expected format:

```text
Developer ID Application: Your Name (TEAMID)
```

4. Create an app-specific password at `appleid.apple.com`, or store notary credentials:

```bash
xcrun notarytool store-credentials humhum-notary
```

## Local Release Build

Use environment variables so secrets never enter the repository:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="your-apple-id@example.com"
export APPLE_TEAM_ID="TEAMID"
export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"

npm run tauri build
scripts/notarize-macos.sh
```

Or use a stored keychain profile:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export NOTARYTOOL_PROFILE="humhum-notary"

npm run tauri build
scripts/notarize-macos.sh
```

## Manual Verification

After notarization:

```bash
xcrun stapler validate src-tauri/target/release/bundle/dmg/*.dmg
spctl -a -vv --type open src-tauri/target/release/bundle/dmg/*.dmg
```

For the `.app` bundle:

```bash
codesign --verify --deep --strict --verbose=2 src-tauri/target/release/bundle/macos/HumHum.app
spctl -a -vv --type execute src-tauri/target/release/bundle/macos/HumHum.app
```

## Notes

- The app identifier is currently `com.humhum.app` in `src-tauri/tauri.conf.json`.
- The macOS entitlements file is `src-tauri/entitlements.plist`.
- Do not commit Apple passwords, API keys, `.p12` certificates, or exported private keys.
