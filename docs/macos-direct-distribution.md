# macOS Direct Distribution

HUMHUM is distributed from GitHub Releases as a signed and notarized DMG. This
is the correct path for the desktop-pet version because it uses the macOS
private transparent-window API and is therefore not a Mac App Store build.

## One-time Apple setup

1. The Apple Developer Program Account Holder creates a `Developer ID
   Application` certificate in Certificates, Identifiers & Profiles.
2. Install the certificate in Keychain Access and export its certificate and
   private key as a password-protected `.p12` file.
3. In App Store Connect, create an API key with `Developer` access for
   notarization. Record its issuer ID and key ID, and download the `.p8` key.
4. Create a protected GitHub Environment named `macos-release`. Require a
   reviewer for that environment before releases can access its secrets.

Do not commit the `.p12`, the `.p8`, the Apple account password, or an
app-specific password. The repository ignores `.p12` and `AuthKey_*.p8` files.

## GitHub Environment secrets

Add these secrets to the `macos-release` environment:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID `.p12` file |
| `APPLE_CERTIFICATE_PASSWORD` | Password used to export that `.p12` file |
| `APPLE_SIGNING_IDENTITY` | Full Developer ID identity, such as `Developer ID Application: Legal Name (TEAMID)` |
| `APPLE_API_ISSUER` | App Store Connect API issuer ID |
| `APPLE_API_KEY` | App Store Connect API key ID |
| `APPLE_API_KEY_P8` | Entire contents of the downloaded `.p8` file |

Use a separate API key for release automation. Rotate it immediately if a
secret is exposed. The Apple account password should not be stored in GitHub.

## Release procedure

1. Make sure `package.json` and `src-tauri/tauri.conf.json` have the intended
   release version.
2. Merge the release commit to `main`.
3. Create and push a protected release tag, for example:

   ```bash
   git tag v0.3.5
   git push origin v0.3.5
   ```

4. Approve the `macos-release` environment in GitHub Actions.
5. The `Release macOS` workflow builds the DMG, signs it with Developer ID,
   notarizes and staples it, verifies Gatekeeper acceptance, then uploads the
   DMG and its SHA-256 file to the matching GitHub Release.

Every changed executable needs a new signed and notarized release. This is an
automated notarization submission, not a Mac App Store App Review.

## Local verification

Before publishing a release, verify a built artifact on a clean macOS account:

```bash
codesign --verify --deep --strict --verbose=4 HumHum.app
spctl -a -vvv -t open HumHum.app
xcrun stapler validate HumHum.dmg
```

## Open source and brand protection

The signing certificate proves the publisher of official binaries; it must not
be shared with contributors. Open source forks may ship their own builds, but
they cannot produce an official HUMHUM signature without the certificate
private key. Keep the certificate in the protected release environment only.
Add a separate trademark policy before inviting broad redistribution so use of
the HUMHUM name, logo, and mascot artwork cannot imply an official release.
