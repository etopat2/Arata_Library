import { z } from 'zod';

const localUrl = z
  .url()
  .refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol));

export const apiEnvironment = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: localUrl,
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_HOST: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  HEALTH_TOKEN: z.string().min(32),
});

export const workerEnvironment = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  REDIS_URL: z.url().refine((value) => ['redis:', 'rediss:'].includes(new URL(value).protocol)),
});

export function parseEnvironment<T extends z.ZodType>(
  schema: T,
  values: NodeJS.ProcessEnv,
): z.output<T> {
  const result = schema.safeParse(values);
  if (!result.success) {
    throw new Error(
      `Invalid environment: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  }
  return result.data;
}
