# HUMHUM Android installation on Xiaomi

1. Download `HUMHUM-Android-0.3.9-Xiaomi.zip`.
2. Extract the ZIP in the Xiaomi Files app; do not ask WeChat or the browser to install the ZIP itself.
3. Open `HUMHUM-Android-0.3.9.apk` from the extracted folder and allow that file source when prompted.
2. Open Xiaomi File Manager, extract the ZIP into the local `Download` folder, then install the APK from the extracted folder.
3. Do not launch the APK directly from the browser download notification. Some Xiaomi download providers lose the temporary file path and report `open failed: ENOENT`.
4. If MIUI asks, allow this File Manager to install unknown apps. HUMHUM does not need that permission after installation.
5. Keep the phone and Mac on the same Wi-Fi. On the Mac, open Hexa and refresh the pairing QR code, then scan it from HUMHUM Android.

If Android reports that an existing app has a different signature, remove that older development build before installing this release build.
