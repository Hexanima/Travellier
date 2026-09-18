import assert from 'node:assert/strict';
import test from 'node:test';

import { selectAndroidJavaHome } from './android-build-environment.mjs';

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
    /JDK 17 a 21 compatible/,
  );
});
