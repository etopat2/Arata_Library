import type { Pool } from 'pg';

export async function pruneReaderLeases(pool: Pool): Promise<number> {
  const deleted = await pool.query(
    `DELETE FROM app."ReaderLease" WHERE id IN (
       SELECT id FROM app."ReaderLease"
       WHERE "expiresAt"<=now()
       ORDER BY "expiresAt", id
       LIMIT 1000 FOR UPDATE SKIP LOCKED
     )`,
  );
  return deleted.rowCount ?? 0;
}

export function startReaderLeaseCleanup(pool: Pool): () => void {
  let busy = false;
  const sweep = async () => {
    if (busy) return;
    busy = true;
    try {
      const deleted = await pruneReaderLeases(pool);
      if (deleted) console.info(JSON.stringify({ event: 'reader.lease_cleanup', deleted }));
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'reader.lease_cleanup_error',
          message: error instanceof Error ? error.message : 'unknown',
        }),
      );
    } finally {
      busy = false;
    }
  };
  void sweep();
  const timer = setInterval(() => void sweep(), 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
