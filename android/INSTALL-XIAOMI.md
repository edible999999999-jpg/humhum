# HUMHUM Android installation on Xiaomi

1. Download `HUMHUM-Android-0.3.15-Xiaomi.zip`.
2. Open Xiaomi File Manager and extract the ZIP into the local `Download` folder.
3. Open `HUMHUM-Android-0.3.15.apk` from the extracted folder. Do not launch the APK directly from the browser or WeChat download notification; some Xiaomi download providers lose the temporary file path and report `open failed: ENOENT`.
4. If MIUI asks, allow this File Manager to install unknown apps. HUMHUM does not need that permission after installation.
5. In the desktop app, open Hexa and refresh the pairing QR code, then scan it from HUMHUM Android. Same-Wi-Fi pairing uses direct HTTPS; an enabled HUMHUM Anywhere invite also works from 5G or another Wi-Fi.

If Android reports that an existing app has a different signature, remove that older development build before installing this release build.
