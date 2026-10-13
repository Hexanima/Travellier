import assert from 'node:assert/strict';
import test from 'node:test';

import { selectAndroidJavaHome } from './android-build-environment.mjs';
import * as androidEnvironment from './android-build-environment.mjs';

test('selects a compatible Android JDK before an incompatible JAVA_HOME', () => {
  const selected = selectAndroidJavaHome({
    candidates: [
      'C:\\Program Files\\Eclipse Adoptium\\jdk-25',
      'C:\\Program Files\\Android\\Android Studio\\jbr',
    ],
    readMajorVersion: (javaHome) => (javaHome.includes('jdk-25') ? 25 : 21),
  });

  assert.equal(selected, 'C:\\Program Files\\Android\\Android Studio\\jbr');
});

test('rejects the build when no compatible Android JDK is available', () => {
  assert.throws(
    () =>
      selectAndroidJavaHome({
        candidates: ['C:\\Program Files\\Eclipse Adoptium\\jdk-25'],
        readMajorVersion: () => 25,
      }),
    /JDK 21 compatible/,
  );
});

test('skips JDK 17 because Capacitor 8 compiles Java 21 sources', () => {
  const selected = selectAndroidJavaHome({
    candidates: ['jdk-17', 'jdk-21'],
    readMajorVersion: (javaHome) => Number(javaHome.slice(4)),
  });
  assert.equal(selected, 'jdk-21');
});

test('test mode executes device instrumentation instead of reporting build-only success', () => {
  assert.equal(typeof androidEnvironment.selectAndroidGradleTask, 'function');
  assert.equal(androidEnvironment.selectAndroidGradleTask(['--test']), ':app:connectedDebugAndroidTest');
  assert.equal(androidEnvironment.selectAndroidGradleTask([]), 'assembleDebug');
});

test('rejects unknown Android build flags before starting Gradle', () => {
  assert.equal(typeof androidEnvironment.selectAndroidGradleTask, 'function');
  assert.throws(() => androidEnvironment.selectAndroidGradleTask(['--tes']), /Unknown Android build option/);
});

test('allows instrumentation only on the explicitly selected single emulator', () => {
  assert.equal(typeof androidEnvironment.assertAndroidTestDevice, 'function');
  assert.doesNotThrow(() => androidEnvironment.assertAndroidTestDevice('emulator-5554', 'List of devices attached\nemulator-5554\tdevice\n', '1\n'));
});

test('refuses physical or additional devices before instrumented APK installation', () => {
  assert.equal(typeof androidEnvironment.assertAndroidTestDevice, 'function');
  assert.throws(() => androidEnvironment.assertAndroidTestDevice('physical', 'physical\tdevice', '0'), /single disposable emulator/);
  assert.throws(() => androidEnvironment.assertAndroidTestDevice('emulator-5554', 'emulator-5554\tdevice\nphysical\tdevice', '1'), /single disposable emulator/);
  assert.throws(() => androidEnvironment.assertAndroidTestDevice('emulator-5554', 'emulator-5554\tdevice', '0'), /single disposable emulator/);
});
