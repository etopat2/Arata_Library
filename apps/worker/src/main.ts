import { config } from 'dotenv';
import { resolve } from 'node:path';
import { parseEnvironment, workerEnvironment } from '@arata/validation';
import { createDiagnosticWorker } from './diagnostics.js';

config({ path: resolve(process.cwd(), '../../.env.foundation.local'), quiet: true });
const settings = parseEnvironment(workerEnvironment, process.env);
const worker = createDiagnosticWorker(settings.REDIS_URL);
worker.on('completed', (job) =>
  console.info(JSON.stringify({ event: 'worker.completed', jobId: job.id })),
);
worker.on('failed', (job, error) =>
  console.error(JSON.stringify({ event: 'worker.failed', jobId: job?.id, message: error.message })),
);
console.info(JSON.stringify({ event: 'worker.started', queue: 'arata-diagnostics' }));
