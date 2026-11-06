import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const [check, ...args] = process.argv.slice(2);
const allowed = new Set(['test', 'test:e2e', 'build', 'typecheck', 'lint', 'format:check', 'release:smoke']);
if (!allowed.has(check) || !process.env.npm_execpath) {
  throw new Error('Use npm run check:logged -- <npm check> [arguments].');
}
const directory = path.resolve('.check-logs');
await mkdir(directory, { recursive: true });
const logPath = path.join(directory, `${check.replaceAll(':', '-')}-${Date.now()}.log`);
const log = createWriteStream(logPath);
const command = check === 'test' ? ['test'] : ['run', check];
const workspace = args.find((argument) => argument.startsWith('--workspace='));
if (workspace) command.push(workspace);
const forwarded = args.filter((argument) => argument !== workspace);
const child = spawn(process.execPath, [process.env.npm_execpath, ...command, '--', ...forwarded], {
  stdio: ['inherit', 'pipe', 'pipe'],
});
let tail = '';
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    log.write(chunk);
    tail = (tail + chunk).slice(-18000);
  });
}
const code = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('close', (status) => resolve(status ?? 1));
});
await new Promise((resolve) => log.end(resolve));
console.log(
  tail
    .split(/\r?\n/)
    .slice(code === 0 ? -14 : -65)
    .join('\n'),
);
console.log(`Log: ${logPath}`);
process.exitCode = code;
