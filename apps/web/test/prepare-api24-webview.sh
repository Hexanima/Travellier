#!/usr/bin/env bash
# Only changes the disposable userdebug API 24 AVD. Never a production dependency.
set -euo pipefail
[[ "${ANDROID_SERIAL:-}" == emulator-* ]] || exit 2
[[ "$(adb -s "$ANDROID_SERIAL" shell getprop ro.kernel.qemu | tr -d '\r')" == 1 ]] || exit 2
[[ "$(adb -s "$ANDROID_SERIAL" shell getprop ro.build.version.sdk | tr -d '\r')" == 24 ]] || exit 2
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[[ -n "$sdk" ]] || exit 2
fixture="$(cd ../test/api24-webview && pwd)"
work="$(mktemp -d)"
curl --fail --location --retry 3 \
  https://github.com/bromite/bromite/releases/download/108.0.5359.156/x64_SystemWebView.apk \
  --output "$work/webview.apk"
echo "990e1c052eeca7380496f1ec81843d002402346dffddf60368fa77c888ac10e5  $work/webview.apk" | sha256sum --check
"$sdk/build-tools/36.1.0/aapt" package -f -M "$fixture/AndroidManifest.xml" \
  -S "$fixture/res" -I "$sdk/platforms/android-36/android.jar" -F "$work/overlay.apk"
keytool -genkeypair -keystore "$work/test.keystore" -storepass android -keypass android \
  -dname CN=T46EmulatorTest -keyalg RSA -validity 365 -alias t46
"$sdk/build-tools/36.1.0/apksigner" sign --ks "$work/test.keystore" --ks-pass pass:android \
  --out "$work/overlay-signed.apk" "$work/overlay.apk"
adb -s "$ANDROID_SERIAL" root
adb -s "$ANDROID_SERIAL" wait-for-device
adb -s "$ANDROID_SERIAL" remount
adb -s "$ANDROID_SERIAL" shell mkdir -p /system/vendor/overlay
adb -s "$ANDROID_SERIAL" push "$work/overlay-signed.apk" /system/vendor/overlay/t46-webview-overlay.apk
adb -s "$ANDROID_SERIAL" install -r "$work/webview.apk"
adb -s "$ANDROID_SERIAL" reboot
adb -s "$ANDROID_SERIAL" wait-for-device
deadline=$((SECONDS + 180))
until [[ "$(adb -s "$ANDROID_SERIAL" shell getprop sys.boot_completed | tr -d '\r')" == 1 ]]; do
  (( SECONDS < deadline )) || { echo 'API 24 did not reboot'; exit 1; }
  sleep 2
done
adb -s "$ANDROID_SERIAL" shell cmd webviewupdate set-webview-implementation org.bromite.webview
adb -s "$ANDROID_SERIAL" shell dumpsys package org.bromite.webview | grep versionName
