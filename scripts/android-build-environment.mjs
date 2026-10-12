import { existsSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const minimumJavaVersion = 21;
const maximumJavaVersion = 21;

export const selectAndroidGradleTask = (arguments_) => {
  if (arguments_.some((argument) => argument !== '--test')) {
    throw new Error('Unknown Android build option. Use --test for device instrumentation.');
  }
  return arguments_.includes('--test') ? ':app:connectedDebugAndroidTest' : 'assembleDebug';
};

export const assertAndroidTestDevice = (serial, devices, emulatorFlag) => {
  const attached = devices.split(/\r?\n/).filter((line) => /^\S+\s+(device|offline|unauthorized)\b/.test(line));
  if (!/^emulator-\d+$/.test(serial ?? '') || attached.length !== 1 ||
      !attached[0].startsWith(`${serial}\tdevice`) || emulatorFlag.trim() !== '1') {
    throw new Error('Android tests require a single disposable emulator selected with ANDROID_SERIAL.');
  }
};

export const selectAndroidJavaHome = ({ candidates, readMajorVersion }) => {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const majorVersion = readMajorVersion(candidate);

    if (
      majorVersion !== undefined &&
      majorVersion >= minimumJavaVersion &&
      majorVersion <= maximumJavaVersion
    ) {
      return candidate;
    }
  }

  throw new Error(
    `No se encontró un JDK 21 compatible para Android. Configurá ANDROID_JAVA_HOME o JAVA_HOME.`,
  );
};

const getJavaMajorVersion = (javaHome) => {
  const executable = join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');

  if (!existsSync(executable)) {
    return undefined;
  }

  const result = spawnSync(executable, ['-version'], { encoding: 'utf8' });
  const output = `${result.stdout}\n${result.stderr}`;
  const match = output.match(/version "(?:1\.)?(\d+)/);

  return match ? Number(match[1]) : undefined;
};

const getCandidates = () => {
  const androidStudioJbr =
    process.platform === 'win32'
      ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Android', 'Android Studio', 'jbr')
      : undefined;

  return [...new Set([process.env.ANDROID_JAVA_HOME, process.env.JAVA_HOME, androidStudioJbr])];
};

const run = (command, arguments_, environment, cwd = process.cwd()) => {
  const result = spawnSync(command, arguments_, {
    cwd,
    env: environment,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
};

const runAndroidBuild = () => {
  const task = selectAndroidGradleTask(process.argv.slice(2));
  if (task === ':app:connectedDebugAndroidTest') {
    const sdkRoot = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
    const adb = sdkRoot ? join(sdkRoot, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : 'adb';
    const serial = process.env.ANDROID_SERIAL;
    const devices = spawnSync(adb, ['devices'], { encoding: 'utf8' });
    const emulator = serial ? spawnSync(adb, ['-s', serial, 'shell', 'getprop', 'ro.kernel.qemu'], { encoding: 'utf8' }) : undefined;
    if (devices.status !== 0 || emulator?.status !== 0) throw new Error('ADB could not validate the disposable emulator.');
    assertAndroidTestDevice(serial, devices.stdout, emulator.stdout);
  }
  const javaHome = selectAndroidJavaHome({
    candidates: getCandidates(),
    readMajorVersion: getJavaMajorVersion,
  });
  const environment = {
    ...process.env,
    JAVA_HOME: javaHome,
    PATH: `${join(javaHome, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
  };
  const yarn = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';

  run(yarn, ['cap:sync:android'], environment);

  if (task === ':app:connectedDebugAndroidTest' && process.exitCode === undefined) {
    run(yarn, ['cap:smoke:bundle'], environment);
  }

  if (process.exitCode === undefined) {
    run(
      process.platform === 'win32' ? 'gradlew.bat' : 'bash',
      process.platform === 'win32' ? [task] : ['./gradlew', task],
      environment,
      join(process.cwd(), 'android'),
    );
  }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAndroidBuild();
}
