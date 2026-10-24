import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import type { HealthResponse, ApiProblem } from '@arata/shared-types';
import { createApp } from '../../apps/api/src/app.js';

config({ path: resolve(process.env.ARATA_ENV_FILE ?? '.env.local'), quiet: true });
config({ path: resolve('.env.foundation.local'), quiet: true });
config({ path: resolve('.env.redis.local'), quiet: true, override: true });

let app: INestApplication;
let base: string;

beforeAll(async () => {
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});

afterAll(async () => {
  await app.get<Pool>('DB_POOL').end();
  await app.close();
});

describe('versioned health contract', () => {
  it('returns live status with correlation ID', async () => {
    const response = await fetch(`${base}/api/v1/health/live`, {
      headers: { 'X-Request-Id': 'test-correlation-1' },
    });
    const body = (await response.json()) as HealthResponse;
    expect(response.status).toBe(200);
    expect(body.requestId).toBe('test-correlation-1');
    expect(body.data.status).toBe('ok');
    expect(Date.parse(body.data.checkedAt)).not.toBeNaN();
  });

  it('denies anonymous readiness with a problem response', async () => {
    const response = await fetch(`${base}/api/v1/health/ready`);
    const body = (await response.json()) as ApiProblem;
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(body.requestId).toBeTruthy();
  });

  it('checks the real PostgreSQL connection for service readiness', async () => {
    const response = await fetch(`${base}/api/v1/health/ready`, {
      headers: { Authorization: `Bearer ${process.env.HEALTH_TOKEN}` },
    });
    const body = (await response.json()) as HealthResponse;
    expect(response.status).toBe(200);
    expect(body.data.components).toContainEqual({ name: 'database', status: 'ok' });
  });
});
