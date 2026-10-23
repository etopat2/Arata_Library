import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Queue, QueueEvents } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { createDiagnosticWorker, redisConnection } from '../../apps/worker/src/diagnostics.js';

config({ path: resolve('.env.foundation.local'), quiet: true });

describe('BullMQ diagnostic worker', () => {
  it('processes a real Redis job with a correlation ID', async () => {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error('REDIS_URL is required for worker integration');
    const connection = redisConnection(redisUrl);
    const queue = new Queue('arata-diagnostics', { connection });
    const events = new QueueEvents('arata-diagnostics', { connection });
    const worker = createDiagnosticWorker(redisUrl);
    try {
      await events.waitUntilReady();
      const requestId = randomUUID();
      const job = await queue.add('foundation.ping', { requestId }, { removeOnComplete: true });
      const result: unknown = await job.waitUntilFinished(events, 5000);
      expect(result).toEqual({ received: true, requestId });
    } finally {
      await worker.close();
      await events.close();
      await queue.close();
    }
  });
});
