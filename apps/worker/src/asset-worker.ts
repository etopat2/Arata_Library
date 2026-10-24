import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import yauzl from 'yauzl';

const root = resolve(
  process.env.STUDIO_STORAGE_ROOT ??
    fileURLToPath(new URL('../../../.private-objects/', import.meta.url)),
);
export function classifyClamdReply(reply: string): 'CLEAN' | 'MALWARE' {
  if (/: OK\0$/.test(reply)) return 'CLEAN';
  if (/: .+ FOUND\0$/.test(reply)) return 'MALWARE';
  throw new Error('ClamAV scan failed');
}
type Job = {
  id: string;
  assetId: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: string;
  attempts: number;
};

export async function validateArchive(
  path: string,
  mimeType: string,
): Promise<{ entries: number; uncompressedBytes: number }> {
  return new Promise((resolveResult, reject) => {
    yauzl.open(
      path,
      { lazyEntries: true, autoClose: true, validateEntrySizes: true },
      (error, archive) => {
        if (error || !archive) {
          reject(error ?? new Error('Invalid ZIP archive'));
          return;
        }
        let entries = 0,
          total = 0;
        const names = new Set<string>();
        archive.on('error', reject);
        archive.on('entry', (entry) => {
          entries++;
          total += entry.uncompressedSize;
          names.add(entry.fileName);
          if (
            entries > 10000 ||
            total > 1024 * 1024 * 1024 ||
            entry.uncompressedSize > 512 * 1024 * 1024 ||
            (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > 100) ||
            entry.fileName.startsWith('/') ||
            entry.fileName.includes('\\') ||
            entry.fileName.split('/').includes('..') ||
            /^[A-Za-z]:/.test(entry.fileName) ||
            entry.fileName.includes('\0')
          ) {
            archive.close();
            reject(new Error('Unsafe archive member'));
            return;
          }
          archive.readEntry();
        });
        archive.on('end', () => {
          if (
            mimeType.includes('wordprocessingml') &&
            (!names.has('[Content_Types].xml') || !names.has('word/document.xml'))
          )
            reject(new Error('DOCX structure missing'));
          else if (
            mimeType === 'application/epub+zip' &&
            (!names.has('mimetype') || !names.has('META-INF/container.xml'))
          )
            reject(new Error('EPUB structure missing'));
          else resolveResult({ entries, uncompressedBytes: total });
        });
        archive.readEntry();
      },
    );
  });
}

export async function scanWithClamd(
  path: string,
  host: string,
  port: number,
): Promise<'CLEAN' | 'MALWARE'> {
  return new Promise((resolveScan, reject) => {
    const socket = connect({ host, port });
    let reply = '';
    let done = false;
    const finish = (error?: Error, result?: 'CLEAN' | 'MALWARE') => {
      if (done) return;
      done = true;
      socket.destroy();
      if (error) reject(error);
      else resolveScan(result!);
    };
    socket.setTimeout(120000, () => finish(new Error('ClamAV timeout')));
    socket.on('error', (error) => finish(error));
    socket.on('data', (data) => {
      reply += data.toString('utf8');
      if (reply.length > 2048) {
        finish(new Error('Invalid ClamAV reply'));
        return;
      }
      if (reply.includes('\0')) {
        try {
          finish(undefined, classifyClamdReply(reply));
        } catch (error) {
          finish(error as Error);
        }
      }
    });
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      const file = createReadStream(path, { highWaterMark: 64 * 1024 });
      file.on('error', (error) => finish(error));
      file.on('data', (chunk) => {
        if (done) {
          file.destroy();
          return;
        }
        const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(part.length);
        if (!socket.write(Buffer.concat([length, part]))) file.pause();
      });
      socket.on('drain', () => file.resume());
      file.on('end', () => {
        if (!done) socket.write(Buffer.alloc(4));
      });
    });
  });
}

export async function processNextAsset(
  pool: Pool,
  host: string,
  port: number,
  targetAssetId?: string,
): Promise<boolean> {
  const client = await pool.connect();
  let job: Job | undefined;
  try {
    await client.query('BEGIN');
    job = (
      await client.query<Job>(
        `SELECT j.id,j."assetId",a."storageKey",a."mimeType",a."sizeBytes",j.attempts
      FROM app."AssetProcessingJob" j JOIN app."Asset" a ON a.id=j."assetId"
      WHERE ((j.status IN ('QUEUED','RETRY') AND j."nextAttemptAt"<=now()) OR (j.status='RUNNING' AND j."leaseUntil"<now()))
        AND ($1::uuid IS NULL OR j."assetId"=$1)
      ORDER BY j."createdAt" FOR UPDATE OF j SKIP LOCKED LIMIT 1`,
        [targetAssetId ?? null],
      )
    ).rows[0];
    if (!job) {
      await client.query('COMMIT');
      return false;
    }
    await client.query(
      `UPDATE app."AssetProcessingJob" SET status='RUNNING',attempts=attempts+1,progress=5,"leaseUntil"=now()+interval '5 minutes',"updatedAt"=now() WHERE id=$1`,
      [job.id],
    );
    await client.query(
      `UPDATE app."Asset" SET status='SCANNING' WHERE id=$1 AND status IN ('QUARANTINED','SCANNING')`,
      [job.assetId],
    );
    await client.query(
      `UPDATE app."UploadSession" SET status='PROCESSING',"updatedAt"=now() WHERE "assetId"=$1`,
      [job.assetId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  const path = join(root, job.storageKey);
  try {
    if ((await stat(path)).size !== Number(job.sizeBytes)) throw new Error('ASSET_SIZE_MISMATCH');
    if (
      [
        'application/zip',
        'application/epub+zip',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ].includes(job.mimeType)
    )
      await validateArchive(path, job.mimeType);
    const scan = await scanWithClamd(path, host, port);
    if (scan === 'MALWARE') {
      await pool.query(
        `UPDATE app."Asset" SET status='REJECTED',"scannedAt"=now(),"scanEvidence"=$2 WHERE id=$1`,
        [job.assetId, JSON.stringify({ scanner: 'clamd', result: 'MALWARE' })],
      );
      await pool.query(
        `UPDATE app."AssetProcessingJob" SET status='FAILED',progress=100,"failureCode"='MALWARE',"leaseUntil"=NULL,"updatedAt"=now() WHERE id=$1`,
        [job.id],
      );
      await pool.query(
        `UPDATE app."UploadSession" SET status='REJECTED',"failureCode"='MALWARE',"updatedAt"=now() WHERE "assetId"=$1`,
        [job.assetId],
      );
      return true;
    }
    await pool.query(
      `UPDATE app."Asset" SET status='CLEAN',"scannedAt"=now(),"scanEvidence"=$2 WHERE id=$1`,
      [job.assetId, JSON.stringify({ scanner: 'clamd', result: 'CLEAN' })],
    );
    await pool.query(
      `UPDATE app."AssetProcessingJob" SET status='COMPLETE',progress=100,"leaseUntil"=NULL,"updatedAt"=now() WHERE id=$1`,
      [job.id],
    );
    await pool.query(
      `UPDATE app."UploadSession" SET status='CLEAN',"updatedAt"=now() WHERE "assetId"=$1`,
      [job.assetId],
    );
  } catch (error) {
    const attempts = job.attempts + 1;
    const failure =
      error instanceof Error && error.message === 'ASSET_SIZE_MISMATCH'
        ? 'ASSET_SIZE_MISMATCH'
        : 'SCAN_UNAVAILABLE_OR_INVALID';
    await pool.query(
      `UPDATE app."AssetProcessingJob" SET status=$2,progress=0,"failureCode"=$3,"leaseUntil"=NULL,"nextAttemptAt"=now()+($4::int*interval '1 minute'),"updatedAt"=now() WHERE id=$1`,
      [job.id, attempts >= 5 ? 'FAILED' : 'RETRY', failure, Math.min(2 ** attempts, 60)],
    );
    await pool.query(
      `UPDATE app."Asset" SET status='QUARANTINED' WHERE id=$1 AND status='SCANNING'`,
      [job.assetId],
    );
    await pool.query(
      `UPDATE app."UploadSession" SET status='QUEUED',"failureCode"=$2,"updatedAt"=now() WHERE "assetId"=$1`,
      [job.assetId, failure],
    );
  }
  return true;
}

export function startAssetWorker(pool: Pool, host: string, port: number) {
  const timer = setInterval(() => {
    void processNextAsset(pool, host, port).catch((error) =>
      console.error(
        JSON.stringify({
          event: 'studio.asset_worker_error',
          message: error instanceof Error ? error.message : 'unknown',
        }),
      ),
    );
  }, 1000);
  timer.unref();
  return () => clearInterval(timer);
}
