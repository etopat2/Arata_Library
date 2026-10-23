import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const mode = process.argv[2];
if (!['api', 'worker'].includes(mode)) throw new Error('Expected api or worker');
if (process.env.DATABASE_URL) {
  const url = new URL(process.env.DATABASE_URL);
  url.hostname = 'postgres';
  url.port = '5432';
  process.env.DATABASE_URL = url.toString();
}
if (mode === 'worker') process.env.REDIS_URL = 'redis://redis:6379';
const entry = resolve(mode === 'api' ? 'apps/api/dist/main.js' : 'apps/worker/dist/main.js');
const child = spawn(process.execPath, [entry], { stdio: 'inherit', env: process.env });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
