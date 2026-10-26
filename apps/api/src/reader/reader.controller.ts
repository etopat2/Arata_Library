import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { IdentityService, type AuthContext } from '../identity/identity.service.js';
import { ReaderService } from './reader.service.js';

const uuid = z.uuid();
const writeProgress = z.strictObject({
  anchor: z.string().max(500).optional(),
  percent: z.number().min(0).max(100).optional(),
  completed: z.boolean().default(false),
});
const bookmark = z.strictObject({ anchor: z.string().min(1).max(450) });
const annotation = z.strictObject({
  anchor: z.string().min(1).max(300),
  kind: z.enum(['NOTE', 'HIGHLIGHT']),
  quote: z.string().max(100).optional(),
  note: z.string().max(160).optional(),
});
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpException('Invalid reader request', 400);
  return result.data;
}
const wrap = (request: Request, data: unknown) => ({ data, requestId: request.id });

@Controller('reader')
export class ReaderController {
  constructor(
    @Inject(ReaderService) private readonly reader: ReaderService,
    @Inject(IdentityService) private readonly identity: IdentityService,
  ) {}

  private async optional(request: Request): Promise<AuthContext | null> {
    try {
      return await this.identity.context(request.headers.cookie);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 401) return null;
      throw error;
    }
  }

  private async member(request: Request): Promise<AuthContext> {
    const context = await this.identity.context(request.headers.cookie);
    this.identity.checkCsrf(
      context,
      request.headers.origin,
      request.header('X-CSRF-Token'),
      request.headers.cookie,
    );
    return context;
  }

  @Get('editions/:id/manifest')
  async manifest(@Req() request: Request, @Param('id') id: string) {
    return wrap(request, await this.reader.manifest(parse(uuid, id), await this.optional(request)));
  }

  @Get('editions/:id/search')
  async search(@Req() request: Request, @Param('id') id: string, @Query('q') q: string) {
    return wrap(
      request,
      await this.reader.search(
        parse(uuid, id),
        parse(z.string().trim().min(2).max(160), q),
        await this.optional(request),
      ),
    );
  }

  @Get('lessons/:id')
  async lesson(@Req() request: Request, @Param('id') id: string) {
    return wrap(
      request,
      await this.reader.openLesson(parse(uuid, id), await this.optional(request)),
    );
  }

  @Get('lessons/:id/asset-grant')
  async assetGrant(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param('id') id: string,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return wrap(
      request,
      await this.reader.lessonAssetGrant(parse(uuid, id), await this.optional(request)),
    );
  }

  @Get('resources/:id/assets/:assetId/grant')
  async resourceAssetGrant(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param('id') id: string,
    @Param('assetId') assetId: string,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return wrap(
      request,
      await this.reader.resourceAssetGrant(
        parse(uuid, id),
        parse(uuid, assetId),
        await this.optional(request),
      ),
    );
  }

  @Get('assets/:id')
  async asset(
    @Req() request: Request,
    @Res() response: Response,
    @Param('id') id: string,
    @Query('grant') grant: string,
  ) {
    if (!grant || grant.length > 1800) throw new HttpException('Download grant invalid', 403);
    await this.reader.deliverLessonAsset(
      parse(uuid, id),
      grant,
      await this.optional(request),
      response,
      request.id,
    );
  }

  @Post('lessons/:id/progress')
  async progress(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const context = await this.member(request);
    const input = parse(writeProgress, body);
    return wrap(
      request,
      await this.reader.saveProgress(
        parse(uuid, id),
        context,
        {
          ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
          ...(input.percent === undefined ? {} : { percent: input.percent }),
        },
        input.completed,
      ),
    );
  }

  @Post('lessons/:id/bookmarks')
  async bookmark(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const context = await this.member(request);
    return wrap(
      request,
      await this.reader.bookmark(parse(uuid, id), context, parse(bookmark, body).anchor),
    );
  }

  @Get('editions/:id/bookmarks')
  async bookmarks(@Req() request: Request, @Param('id') id: string) {
    const context = await this.identity.context(request.headers.cookie);
    return wrap(request, await this.reader.bookmarks(context, parse(uuid, id)));
  }

  @Get('editions/:id/progress')
  async editionProgress(@Req() request: Request, @Param('id') id: string) {
    const context = await this.identity.context(request.headers.cookie);
    return wrap(request, await this.reader.progress(context, parse(uuid, id)));
  }

  @Get('lessons/:id/annotations')
  async annotations(@Req() request: Request, @Param('id') id: string) {
    const context = await this.identity.context(request.headers.cookie);
    return wrap(request, await this.reader.annotations(parse(uuid, id), context));
  }

  @Post('lessons/:id/annotations')
  async annotation(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const context = await this.member(request);
    return wrap(
      request,
      await this.reader.addAnnotation(parse(uuid, id), context, parse(annotation, body)),
    );
  }

  @Delete('annotations/:id')
  async deleteAnnotation(@Req() request: Request, @Param('id') id: string) {
    const context = await this.member(request);
    return wrap(request, await this.reader.deleteAnnotation(parse(uuid, id), context));
  }
}
