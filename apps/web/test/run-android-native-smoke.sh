#!/usr/bin/env bash
# Emulator Runner executes script lines in separate shells; keep test status and evidence together.
set -euo pipefail
[[ "${ANDROID_SERIAL:-}" == emulator-* ]] || { echo 'Disposable emulator serial required'; exit 2; }
[[ "$(adb -s "$ANDROID_SERIAL" shell getprop ro.kernel.qemu | tr -d '\r')" == 1 ]] || exit 2
[[ "$(adb devices | awk 'NR > 1 && NF { print $1 }')" == "$ANDROID_SERIAL" ]] || { echo 'Only the selected emulator may be attached'; exit 2; }
adb -s "$ANDROID_SERIAL" wait-for-device
boot_deadline=$((SECONDS + 600))
booted() { [[ "$(adb -s "$ANDROID_SERIAL" shell getprop "$1" | tr -d '\r')" == "$2" ]]; }
until booted sys.boot_completed 1 && booted init.svc.bootanim stopped; do
  (( SECONDS < boot_deadline )) || { echo 'Emulator did not finish booting'; exit 1; }
  sleep 2
done
# System dialogs steal the focus from the instrumentation; API 24 lacks some of these commands.
adb -s "$ANDROID_SERIAL" shell settings put global hide_error_dialogs 1 || true
adb -s "$ANDROID_SERIAL" shell settings put secure immersive_mode_confirmations confirmed || true
adb -s "$ANDROID_SERIAL" shell wm dismiss-keyguard || true
adb -s "$ANDROID_SERIAL" shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS || true
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
