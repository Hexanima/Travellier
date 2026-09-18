import { existsSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const minimumJavaVersion = 17;
const maximumJavaVersion = 21;

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
    `No se encontró un JDK ${minimumJavaVersion} a ${maximumJavaVersion} compatible para Android. Configurá ANDROID_JAVA_HOME o JAVA_HOME.`,
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

  if (process.exitCode === undefined) {
    run(
      process.platform === 'win32' ? 'gradlew.bat' : './gradlew',
      ['assembleDebug'],
      environment,
      join(process.cwd(), 'android'),
    );
  }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAndroidBuild();
}
