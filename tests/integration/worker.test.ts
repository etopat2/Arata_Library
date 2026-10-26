import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { config, parse } from 'dotenv';
import { resolve } from 'node:path';
import { Queue, QueueEvents } from 'bullmq';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { createDiagnosticWorker, redisConnection } from '../../apps/worker/src/diagnostics.js';
import { pruneReaderLeases } from '../../apps/worker/src/reader-lease-cleanup.js';

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

describe('reader licence retention worker', () => {
  it('purges expired leases in a bounded sweep and preserves active seats', async () => {
    const local = parse(readFileSync(process.env.ARATA_ENV_FILE ?? '.env.local', 'utf8'));
    const url = local.TEST_DATABASE_URL;
    if (!url || new URL(url).pathname !== '/arata_techlibrary_test')
      throw new Error('Isolated test database required');
    const pool = new pg.Pool({ connectionString: url, max: 2 });
    const libraryId = randomUUID();
    const policyId = randomUUID();
    const userId = randomUUID();
    const expiredId = randomUUID();
    const activeId = randomUUID();
    const expiredSession = randomUUID();
    const activeSession = randomUUID();
    try {
      const writer = await pool.connect();
      try {
        await writer.query('BEGIN');
        await writer.query(
          `INSERT INTO app."Library" (id,slug,title) VALUES ($1,$2,'[TEST] Lease cleanup')`,
          [libraryId, `test-lease-cleanup-${libraryId}`],
        );
        await writer.query(
          `INSERT INTO app."ContentPolicy" (id,"libraryId",version,"isActive","approvedAt","allowRead")
           VALUES ($1,$2,1,true,now(),true)`,
          [policyId, libraryId],
        );
        await writer.query(
          `INSERT INTO app."User" (id,email,"privacyVersion","createdAt","updatedAt")
           VALUES ($1,$2,'TEST-ONLY',now(),now())`,
          [userId, `lease-cleanup-${userId}@example.invalid`],
        );
        for (const sessionId of [expiredSession, activeSession])
          await writer.query(
            `INSERT INTO app."AuthSession" (id,"userId","tokenHash","expiresAt")
             VALUES ($1,$2,$3,now()+interval '1 hour')`,
            [sessionId, userId, randomUUID()],
          );
        await writer.query(
          `INSERT INTO app."ReaderLease" (id,"policyId","userId","sessionId","createdAt","expiresAt")
           VALUES ($1,$2,$3,$4,now()-interval '1 hour',now()-interval '1 minute'),
                  ($5,$2,$3,$6,now(),now()+interval '15 minutes')`,
          [expiredId, policyId, userId, expiredSession, activeId, activeSession],
        );
        await writer.query('COMMIT');
      } catch (error) {
        await writer.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        writer.release();
      }
      expect(await pruneReaderLeases(pool)).toBeGreaterThanOrEqual(1);
      const remaining = await pool.query<{ id: string }>(
        `SELECT id FROM app."ReaderLease" WHERE id IN ($1,$2) ORDER BY id`,
        [expiredId, activeId],
      );
      expect(remaining.rows).toEqual([{ id: activeId }]);
    } finally {
      await pool.query(`DELETE FROM app."AuthSession" WHERE id IN ($1,$2)`, [
        expiredSession,
        activeSession,
      ]);
      await pool.query(`DELETE FROM app."ContentPolicy" WHERE id=$1`, [policyId]);
      await pool.query(`DELETE FROM app."Library" WHERE id=$1`, [libraryId]);
      await pool.query(`DELETE FROM app."User" WHERE id=$1`, [userId]);
      await pool.end();
    }
  });
});
