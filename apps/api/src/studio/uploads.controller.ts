import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { IdentityService } from '../identity/identity.service.js';
import { StudioUploads } from './uploads.service.js';

const uuid = z.uuid();
const initiate = z.strictObject({
  publicationId: uuid,
  originalName: z.string().min(1).max(400),
  mimeType: z.string().min(1).max(160),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(200 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.string().min(16).max(160),
});
const approve = z.strictObject({
  licenceCode: z.string().trim().min(1).max(100),
  provenanceRef: z.string().trim().min(1).max(500),
  copyrightNotice: z.string().trim().min(1).max(2000),
  attribution: z.string().trim().min(1).max(1000),
});
function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpException('Invalid upload request', 400);
  return result.data;
}
const wrap = (req: Request, data: unknown) => ({ data, requestId: req.id });
@Controller('studio')
export class StudioUploadController {
  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(StudioUploads) private readonly uploads: StudioUploads,
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
  @Post('uploads') async initiate(@Req() req: Request, @Body() body: unknown) {
    return wrap(
      req,
      await this.uploads.initiate(await this.auth(req, true), parse(initiate, body), req.id),
    );
  }
  @Get('uploads/:id') async status(@Req() req: Request, @Param('id') id: string) {
    return wrap(req, await this.uploads.status(await this.auth(req), parse(uuid, id)));
  }
  @Put('uploads/:id/chunk') async chunk(@Req() req: Request, @Param('id') id: string) {
    const offset = Number(req.header('x-upload-offset'));
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new HttpException('Upload offset required', 400);
    return wrap(
      req,
      await this.uploads.chunk(await this.auth(req, true), parse(uuid, id), offset, req),
    );
  }
  @Post('uploads/:id/complete') async complete(@Req() req: Request, @Param('id') id: string) {
    return wrap(
      req,
      await this.uploads.complete(await this.auth(req, true), parse(uuid, id), req.id),
    );
  }
  @Post('assets/:id/retry') async retry(@Req() req: Request, @Param('id') id: string) {
    return wrap(req, await this.uploads.retry(await this.auth(req, true), parse(uuid, id), req.id));
  }
  @Post('assets/:id/approve') async approve(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return wrap(
      req,
      await this.uploads.approve(
        await this.auth(req, true),
        parse(uuid, id),
        parse(approve, body),
        req.id,
      ),
    );
  }
  @Get('assets/:id/download') async download(
    @Req() req: Request,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    await this.uploads.download(await this.auth(req), parse(uuid, id), res);
  }
}
