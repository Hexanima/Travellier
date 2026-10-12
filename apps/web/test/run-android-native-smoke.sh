#!/usr/bin/env bash
# Emulator Runner executes script lines in separate shells; keep test status and evidence together.
set -euo pipefail
[[ "${ANDROID_SERIAL:-}" == emulator-* ]] || { echo 'Disposable emulator serial required'; exit 2; }
[[ "$(adb -s "$ANDROID_SERIAL" shell getprop ro.kernel.qemu | tr -d '\r')" == 1 ]] || exit 2
[[ "$(adb devices | awk 'NR > 1 && NF { print $1 }')" == "$ANDROID_SERIAL" ]] || { echo 'Only the selected emulator may be attached'; exit 2; }
if [[ "$(adb -s "$ANDROID_SERIAL" shell getprop ro.build.version.sdk | tr -d '\r')" == 24 ]]; then
  bash ../test/prepare-api24-webview.sh
fi
for permission in READ_CALENDAR WRITE_CALENDAR; do
  adb -s "$ANDROID_SERIAL" shell pm revoke com.travellier.app "android.permission.$permission" || true
  adb -s "$ANDROID_SERIAL" shell pm clear-permission-flags com.travellier.app "android.permission.$permission" user-set user-fixed || true
done
status=0
bash ./gradlew :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.travellier.app.NativeCapabilitiesSmokeTest || status=$?
mkdir -p ../android-smoke-results
adb -s "$ANDROID_SERIAL" pull /sdcard/Download/t46-smoke ../android-smoke-results/ || true
exit "$status"
