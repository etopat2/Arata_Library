import type { Pool } from 'pg';
type Schedule = {
  id: string;
  publicationId: string;
  revisionId: string | null;
  requestedById: string;
  action: 'PUBLISH' | 'WITHDRAW';
  reason: string;
};
export async function processNextSchedule(pool: Pool): Promise<boolean> {
  const client = await pool.connect();
  let job: Schedule | undefined;
  try {
    await client.query('BEGIN');
    job = (
      await client.query<Schedule>(
        `SELECT id,"publicationId","revisionId","requestedById",action,reason FROM app."PublicationSchedule" WHERE (status='PENDING' AND "scheduledAt"<=now()) OR (status='RUNNING' AND "leaseUntil"<now()) ORDER BY "scheduledAt" FOR UPDATE SKIP LOCKED LIMIT 1`,
      )
    ).rows[0];
    if (!job) {
      await client.query('COMMIT');
      return false;
    }
    await client.query(
      `UPDATE app."PublicationSchedule" SET status='RUNNING',"leaseUntil"=now()+interval '2 minutes' WHERE id=$1`,
      [job.id],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  const writer = await pool.connect();
  try {
    await writer.query('BEGIN');
    const role = await writer.query(
      `SELECT 1 FROM app."RoleAssignment" a JOIN app."Role" r ON r.id=a."roleId" WHERE a."userId"=$1 AND a."revokedAt" IS NULL AND a."startsAt"<=now() AND (a."endsAt" IS NULL OR a."endsAt">now()) AND r.code='PUBLISHER' AND ((a."scopeType"='PLATFORM' AND a."scopeId" IS NULL) OR (a."scopeType"='PUBLICATION' AND a."scopeId"=$2))`,
      [job.requestedById, job.publicationId],
    );
    if (!role.rowCount) throw new Error('PUBLISHER_AUTHORITY_REVOKED');
    if (job.action === 'PUBLISH' && job.revisionId) {
      const revision = (
        await writer.query<{ editionId: string; status: string; publicationId: string }>(
          `SELECT r."editionId",r.status,e."publicationId" FROM app."Revision" r JOIN app."Edition" e ON e.id=r."editionId" WHERE r.id=$1 FOR UPDATE OF r`,
          [job.revisionId],
        )
      ).rows[0];
      if (
        !revision ||
        revision.status !== 'APPROVED' ||
        revision.publicationId !== job.publicationId
      )
        throw new Error('SCHEDULE_REVISION_CHANGED');
      await writer.query(
        `UPDATE app."Revision" SET status='PUBLISHED',"publishedAt"=now(),"publishedById"=$2 WHERE id=$1`,
        [job.revisionId, job.requestedById],
      );
      await writer.query(`UPDATE app."Edition" SET "currentRevisionId"=$2 WHERE id=$1`, [
        revision.editionId,
        job.revisionId,
      ]);
      await writer.query(
        `UPDATE app."Publication" SET status='PUBLISHED',"updatedAt"=now() WHERE id=$1`,
        [job.publicationId],
      );
    } else if (job.action === 'WITHDRAW') {
      const updated = await writer.query(
        `UPDATE app."Publication" SET status='WITHDRAWN',"updatedAt"=now() WHERE id=$1 AND status='PUBLISHED' RETURNING id`,
        [job.publicationId],
      );
      if (!updated.rowCount) throw new Error('SCHEDULE_PUBLICATION_CHANGED');
    }
    await writer.query(
      `UPDATE app."PublicationSchedule" SET status='COMPLETE',"completedAt"=now(),"leaseUntil"=NULL WHERE id=$1`,
      [job.id],
    );
    await writer.query(
      `INSERT INTO app."AuditEvent" (id,"actorId",action,"objectType","objectId","correlationId",reason) VALUES (gen_random_uuid(),$1,$2,'PublicationSchedule',$3,$3,$4)`,
      [
        job.requestedById,
        job.action === 'PUBLISH'
          ? 'studio.scheduled_publish_completed'
          : 'studio.scheduled_withdraw_completed',
        job.id,
        job.reason,
      ],
    );
    await writer.query('COMMIT');
  } catch (error) {
    await writer.query('ROLLBACK').catch(() => undefined);
    await pool.query(
      `UPDATE app."PublicationSchedule" SET status='FAILED',"failureCode"=$2,"leaseUntil"=NULL WHERE id=$1`,
      [job.id, error instanceof Error ? error.message.slice(0, 100) : 'SCHEDULE_FAILED'],
    );
  } finally {
    writer.release();
  }
  return true;
}
export function startScheduleWorker(pool: Pool) {
  const timer = setInterval(() => {
    void processNextSchedule(pool).catch((error) =>
      console.error(
        JSON.stringify({
          event: 'studio.schedule_worker_error',
          message: error instanceof Error ? error.message : 'unknown',
        }),
      ),
    );
  }, 1000);
  timer.unref();
  return () => clearInterval(timer);
}
