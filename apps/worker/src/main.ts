import { config } from 'dotenv';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { parseEnvironment, workerEnvironment } from '@arata/validation';
import { createDiagnosticWorker } from './diagnostics.js';
import { startAssetWorker } from './asset-worker.js';
import { startImportWorker } from './import-worker.js';
import { startScheduleWorker } from './schedule-worker.js';
import { startReaderLeaseCleanup } from './reader-lease-cleanup.js';

config({ path: resolve(process.cwd(), '../../.env.foundation.local'), quiet: true });
if (!process.env.DATABASE_URL) {
  try {
    const local = Object.fromEntries(
      readFileSync(resolve(process.cwd(), '../../.env.local'), 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.startsWith('DATABASE_URL='))
        .map((line) => ['DATABASE_URL', line.slice('DATABASE_URL='.length)]),
    );
    process.env.DATABASE_URL = local.DATABASE_URL;
  } catch {
    /* Container supplies DATABASE_URL. */
  }
}
const settings = parseEnvironment(workerEnvironment, process.env);
if (!process.env.DATABASE_URL) throw new Error('Worker requires least privilege DATABASE_URL');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  connectionTimeoutMillis: 3000,
});
const stopAssetWorker = startAssetWorker(
  pool,
  process.env.CLAMD_HOST ?? '127.0.0.1',
  Number(process.env.CLAMD_PORT ?? '3310'),
);
const stopImportWorker = startImportWorker(pool);
const stopScheduleWorker = startScheduleWorker(pool);
const stopReaderLeaseCleanup = startReaderLeaseCleanup(pool);
const worker = createDiagnosticWorker(settings.REDIS_URL);
worker.on('completed', (job) =>
  console.info(JSON.stringify({ event: 'worker.completed', jobId: job.id })),
);
worker.on('failed', (job, error) =>
  console.error(JSON.stringify({ event: 'worker.failed', jobId: job?.id, message: error.message })),
);
console.info(JSON.stringify({ event: 'worker.started', queue: 'arata-diagnostics' }));
console.info(JSON.stringify({ event: 'worker.started', queue: 'studio-assets' }));
process.once('SIGTERM', () => {
  stopAssetWorker();
  stopImportWorker();
  stopScheduleWorker();
  stopReaderLeaseCleanup();
  void pool.end();
  void worker.close();
});
