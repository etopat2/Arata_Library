import { Worker, type Job } from 'bullmq';

export async function processDiagnosticJob(job: Job) {
  if (job.name !== 'foundation.ping') throw new Error('Unknown diagnostic job');
  return { received: true, requestId: String(job.data.requestId ?? '') };
}

export function redisConnection(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: url.password } : {}),
    maxRetriesPerRequest: null,
  };
}

export function createDiagnosticWorker(redisUrl: string) {
  return new Worker('arata-diagnostics', processDiagnosticJob, {
    connection: redisConnection(redisUrl),
  });
}
