# HUMHUM Android installation on Xiaomi

1. Download `HUMHUM-Android-0.3.8-Xiaomi.zip`.
2. Open Xiaomi File Manager, extract the ZIP into the local `Download` folder, then install the APK from the extracted folder.
3. Do not launch the APK directly from the browser download notification. Some Xiaomi download providers lose the temporary file path and report `open failed: ENOENT`.
4. If MIUI asks, allow this File Manager to install unknown apps. HUMHUM does not need that permission after installation.
5. Keep the phone and Mac on the same Wi-Fi. On the Mac, open Hexa and refresh the pairing QR code, then scan it from HUMHUM Android.

If Android reports that an existing app has a different signature, remove that older development build before installing this release build.
