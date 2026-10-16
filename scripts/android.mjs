import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2];
if (!['sync', 'debug'].includes(mode)) throw new Error('Expected sync or debug.');
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'packages/shared/tsconfig.json']);
run(
  process.execPath,
  [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'android'],
  path.join(root, 'apps/web'),
);
run(process.execPath, ['node_modules/@capacitor/cli/bin/capacitor', 'sync', 'android']);
if (mode === 'debug') {
  if (process.platform === 'win32')
    run('cmd.exe', ['/d', '/c', 'gradlew.bat', 'assembleDebug'], path.join(root, 'android'));
  else run('./gradlew', ['assembleDebug'], path.join(root, 'android'));
}
