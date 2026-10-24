import { Body, Controller, Get, HttpException, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { IdentityService } from '../identity/identity.service.js';
import { StudioImports } from './imports.service.js';
const uuid = z.uuid();
const dto = z.strictObject({
  assetId: uuid,
  editionId: uuid,
  idempotencyKey: z.string().min(16).max(160),
});
function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpException('Invalid import request', 400);
  return result.data;
}
const wrap = (req: Request, data: unknown) => ({ data, requestId: req.id });
@Controller('studio/imports')
export class StudioImportController {
  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(StudioImports) private readonly imports: StudioImports,
  ) {}
  private async auth(req: Request, mutate = false) {
    const context = await this.identity.context(req.headers.cookie);
    if (mutate)
      this.identity.checkCsrf(
        context,
        req.header('origin'),
        req.header('x-csrf-token'),
        req.headers.cookie,
      );
    return context;
  }
  @Post() async start(@Req() req: Request, @Body() body: unknown) {
    return wrap(
      req,
      await this.imports.start(await this.auth(req, true), parse(dto, body), req.id),
    );
  }
  @Get(':id') async status(@Req() req: Request, @Param('id') id: string) {
    return wrap(req, await this.imports.status(await this.auth(req), parse(uuid, id)));
  }
  @Post(':id/confirm') async confirm(@Req() req: Request, @Param('id') id: string) {
    return wrap(
      req,
      await this.imports.confirm(await this.auth(req, true), parse(uuid, id), req.id),
    );
  }
  @Post(':id/retry') async retry(@Req() req: Request, @Param('id') id: string) {
    return wrap(req, await this.imports.retry(await this.auth(req, true), parse(uuid, id), req.id));
  }
}
