import 'reflect-metadata';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Controller, Get, HttpException, HttpStatus, Inject, Module, Req } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { Pool } from 'pg';
import { mayAccess } from '@arata/access-policy';
import { apiEnvironment, parseEnvironment } from '@arata/validation';
import type { HealthResponse, ApiProblem } from '@arata/shared-types';
import type { Request, Response } from 'express';
import {
  AuthController,
  AccountController,
  IdentityAdminController,
} from './identity/identity.controller.js';
import { IdentityMailer, IdentityService } from './identity/identity.service.js';
import {
  CatalogueController,
  PublicResourceController,
  PublicationShareController,
} from './catalogue/catalogue.controller.js';
import { CatalogueService } from './catalogue/catalogue.service.js';

export type ApiConfig = ReturnType<typeof loadConfig>;
export function loadConfig() {
  return parseEnvironment(apiEnvironment, process.env);
}

@Controller('health')
class HealthController {
  constructor(
    @Inject('DB_POOL') private readonly pool: Pool,
    @Inject('APP_CONFIG') private readonly config: ApiConfig,
  ) {}

  @Get('live')
  live(@Req() request: Request): HealthResponse {
    if (!mayAccess({ kind: 'anonymous' }, 'health.live')) throw new HttpException('Forbidden', 403);
    return { data: { status: 'ok', checkedAt: new Date().toISOString() }, requestId: request.id };
  }

  @Get('ready')
  async ready(@Req() request: Request): Promise<HealthResponse> {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
    const expected = Buffer.from(this.config.HEALTH_TOKEN);
    const received = Buffer.from(token ?? '');
    const authenticated =
      expected.length === received.length && timingSafeEqual(expected, received);
    if (!mayAccess({ kind: authenticated ? 'service' : 'anonymous' }, 'health.ready')) {
      throw new HttpException('Authentication required', HttpStatus.UNAUTHORIZED);
    }
    try {
      await this.pool.query('SELECT 1');
    } catch {
      throw new HttpException('Database unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return {
      data: {
        status: 'ok',
        checkedAt: new Date().toISOString(),
        components: [{ name: 'database', status: 'ok' }],
      },
      requestId: request.id,
    };
  }
}

@Module({
  controllers: [
    HealthController,
    AuthController,
    AccountController,
    IdentityAdminController,
    CatalogueController,
    PublicResourceController,
    PublicationShareController,
  ],
  providers: [
    { provide: 'APP_CONFIG', useFactory: loadConfig },
    {
      provide: 'DB_POOL',
      inject: ['APP_CONFIG'],
      useFactory: (config: ApiConfig) =>
        new Pool({ connectionString: config.DATABASE_URL, max: 5, connectionTimeoutMillis: 3000 }),
    },
    IdentityMailer,
    IdentityService,
    CatalogueService,
  ],
})
class AppModule {}

declare module 'express-serve-static-core' {
  interface Request {
    id: string;
  }
}

export async function createApp() {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.use(helmet());
  app.enableCors({
    origin: config.WEB_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Authorization', 'X-Request-Id', 'X-CSRF-Token', 'Content-Type'],
  });
  app.use((request: Request, response: Response, next: () => void) => {
    const started = performance.now();
    const proposed = request.header('X-Request-Id');
    request.id = proposed && /^[a-zA-Z0-9_-]{1,80}$/.test(proposed) ? proposed : randomUUID();
    response.setHeader('X-Request-Id', request.id);
    response.on('finish', () =>
      console.info(
        JSON.stringify({
          event: 'http.request',
          requestId: request.id,
          method: request.method,
          path: request.path,
          status: response.statusCode,
          durationMs: Math.round(performance.now() - started),
        }),
      ),
    );
    next();
  });
  app.useGlobalFilters({
    catch(error: unknown, host: import('@nestjs/common').ArgumentsHost) {
      const context = host.switchToHttp();
      const response = context.getResponse<Response>();
      const request = context.getRequest<Request>();
      const status = error instanceof HttpException ? error.getStatus() : 500;
      if (status >= 500)
        console.error(
          JSON.stringify({
            event: 'api.unhandled_error',
            requestId: request.id,
            errorName: error instanceof Error ? error.name : 'UnknownError',
            ...(config.NODE_ENV === 'development' && error instanceof Error
              ? { message: error.message }
              : {}),
          }),
        );
      const title =
        status >= 500
          ? 'Service unavailable'
          : status === 401
            ? 'Authentication required'
            : status === 403
              ? 'Access denied'
              : status === 404
                ? 'Not found'
                : status === 429
                  ? 'Too many requests'
                  : status === 409
                    ? 'State conflict'
                    : 'Invalid request';
      const problem: ApiProblem = {
        type: `https://api.arata.example/problems/${status}`,
        title,
        status,
        code:
          status === 401
            ? 'AUTHENTICATION_REQUIRED'
            : status === 403
              ? 'ACCESS_DENIED'
              : status === 429
                ? 'RATE_LIMITED'
                : status >= 500
                  ? 'SERVICE_UNAVAILABLE'
                  : 'REQUEST_ERROR',
        requestId: request.id ?? randomUUID(),
      };
      response.status(status).type('application/problem+json').json(problem);
    },
  });
  app.setGlobalPrefix('api/v1');
  return app;
}
