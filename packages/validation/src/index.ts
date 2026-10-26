import { z } from 'zod';
export * from './platform-policy.js';

const localUrl = z
  .url()
  .refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol));

export const apiEnvironment = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: localUrl,
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    API_HOST: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
    WEB_ORIGIN: z.url().default('http://localhost:5173'),
    HEALTH_TOKEN: z.string().min(32),
    AUTH_SESSION_SECRET: z.string().regex(/^[0-9a-f]{64}$/i),
    AUTH_DATA_KEY: z.string().regex(/^[0-9a-f]{64}$/i),
    AUTH_SMTP_HOST: z.string().min(1).optional(),
    AUTH_SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
    AUTH_SMTP_USER: z.string().optional(),
    AUTH_SMTP_PASSWORD: z.string().optional(),
    AUTH_MAIL_FROM: z.email().default('accounts@arata.invalid'),
    AUTH_TERMS_VERSION: z.string().min(1).max(64).optional(),
    AUTH_PRIVACY_VERSION: z.string().min(1).max(64).optional(),
    AUTH_TERMS_URL: z
      .url()
      .refine((value) => new URL(value).protocol === 'https:')
      .optional(),
    AUTH_PRIVACY_URL: z
      .url()
      .refine((value) => new URL(value).protocol === 'https:')
      .optional(),
    AUTH_RATE_PREFIX: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,64}$/)
      .default('arata'),
    REDIS_URL: z.url().refine((value) => ['redis:', 'rediss:'].includes(new URL(value).protocol)),
  })
  .superRefine((values, context) => {
    if (values.NODE_ENV !== 'production') return;
    if (!values.WEB_ORIGIN.startsWith('https://'))
      context.addIssue({ code: 'custom', path: ['WEB_ORIGIN'], message: 'HTTPS is required' });
    if (!values.AUTH_SMTP_HOST)
      context.addIssue({ code: 'custom', path: ['AUTH_SMTP_HOST'], message: 'SMTP is required' });
    if (values.AUTH_MAIL_FROM.endsWith('.invalid'))
      context.addIssue({
        code: 'custom',
        path: ['AUTH_MAIL_FROM'],
        message: 'Verified sender required',
      });
    for (const field of [
      'AUTH_TERMS_VERSION',
      'AUTH_PRIVACY_VERSION',
      'AUTH_TERMS_URL',
      'AUTH_PRIVACY_URL',
    ] as const)
      if (!values[field])
        context.addIssue({
          code: 'custom',
          path: [field],
          message: 'Approved legal policy required',
        });
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
