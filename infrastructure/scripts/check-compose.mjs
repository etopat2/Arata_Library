import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { Queue, QueueEvents } from 'bullmq';

const { HEALTH_TOKEN: token } = dotenv.parse(readFileSync('.env.foundation.local', 'utf8'));
if (!token || token.length < 32) throw new Error('Missing generated health token');

async function check(name, url, headers = {}) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(3000) });
      if (response.ok) {
        if (name === 'database readiness') {
          const body = await response.json();
          if (body.data?.components?.some((item) => item.name === 'database' && item.status === 'ok')) return;
        } else if (name === 'web shell') {
          if ((await response.text()).includes('Arata TechLibrary')) return;
        } else {
          const body = await response.json();
          if (body.data?.status === 'ok' && body.requestId) return;
        }
      }
    } catch { /* service may still be starting */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${name} did not become ready`);
}

await check('API liveness', 'http://127.0.0.1:3000/api/v1/health/live');
await check('database readiness', 'http://127.0.0.1:3000/api/v1/health/ready', { Authorization: `Bearer ${token}` });
await check('web shell', 'http://127.0.0.1:5173/');
await check('web API proxy', 'http://127.0.0.1:5173/api/v1/health/live');
const connection = { host: '127.0.0.1', port: 6379 };
const queue = new Queue('arata-diagnostics', { connection });
const events = new QueueEvents('arata-diagnostics', { connection });
try {
  await events.waitUntilReady();
  const requestId = randomUUID();
  const job = await queue.add('foundation.ping', { requestId }, { removeOnComplete: true });
  const result = await job.waitUntilFinished(events, 5000);
  if (!result?.received || result.requestId !== requestId) throw new Error('Container worker result mismatch');
} finally {
  await events.close();
  await queue.close();
}
console.info('Compose API, PostgreSQL readiness, web shell, API proxy, and worker passed.');
