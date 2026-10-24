import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import yazl from 'yazl';
import { IdentityService, type AuthContext } from '../identity/identity.service.js';
import { StudioService } from './studio.service.js';

const uuid = z.uuid();
const slug = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,199}$/);
const text = (max = 400) => z.string().trim().min(1).max(max);
const positive = z.number().int().min(1).max(100000);
const collection = z.strictObject({ slug, title: text(300), description: text(2000).optional() });
const publication = z.strictObject({
  slug,
  title: text(),
  kind: z.enum(['STANDALONE', 'SERIES']),
  collectionId: uuid.optional(),
  languageCode: z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/),
  licenceCode: text(100),
  sourceRef: text(500),
  copyrightNotice: text(2000),
  description: text(5000).optional(),
});
const publicationPatch = z.strictObject({
  title: text().optional(),
  subtitle: text().nullable().optional(),
  description: text(5000).nullable().optional(),
  languageCode: text(35).optional(),
  licenceCode: text(100).optional(),
  sourceRef: text(500).optional(),
  copyrightNotice: text(2000).optional(),
});
const publicationCollections = z.strictObject({
  collectionIds: z
    .array(uuid)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
});
const contributor = z.strictObject({
  displayName: text(240),
  slug,
  role: z.enum(['AUTHOR', 'EDITOR', 'ILLUSTRATOR', 'TRANSLATOR', 'REVIEWER']),
  ordinal: z.number().int().min(0).max(10000),
});
const volume = z.strictObject({ ordinal: positive, title: text() });
const edition = z.strictObject({
  volumeId: uuid.nullable().optional(),
  editionCode: text(60),
  label: text(200),
  isbn13: z
    .string()
    .regex(/^97[89]\d{10}$/)
    .optional(),
  isDefault: z.boolean().optional(),
});
const revision = z.strictObject({ changeSummary: text(4000), fromRevisionId: uuid.optional() });
const chapter = z.strictObject({
  ordinal: positive,
  slug,
  title: text(),
  previewText: text(8000).optional(),
  summary: text(5000).optional(),
  learningOutcomes: z.array(text(500)).max(50).optional(),
  prerequisites: z.array(text(500)).max(50).optional(),
});
const block = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('paragraph'), text: text(100000) }),
  z.strictObject({
    type: z.literal('heading'),
    level: z.number().int().min(2).max(6),
    text: text(1000),
  }),
  z.strictObject({ type: z.literal('code'), language: text(80), source: text(200000) }),
  z.strictObject({ type: z.literal('image'), assetId: uuid, alt: text(1000) }),
  z.strictObject({ type: z.literal('diagram'), assetId: uuid, alt: text(1000) }),
]);
const lesson = z.strictObject({
  ordinal: positive,
  title: text(),
  bodyMarkdown: z.string().max(1000000).optional(),
  blocks: z.array(block).max(2000).optional(),
});
const lessonPatch = z.strictObject({
  title: text(),
  bodyMarkdown: z.string().max(1000000).optional(),
  blocks: z.array(block).max(2000).optional(),
});
const bibliography = z.strictObject({
  citationKey: text(120),
  citationText: text(4000),
  url: z.url().max(2000).optional(),
  ordinal: positive,
});
const reference = z
  .strictObject({
    label: text(300),
    targetPublicationId: uuid.optional(),
    targetChapterId: uuid.optional(),
    targetLessonId: uuid.optional(),
  })
  .refine(
    (v) =>
      [v.targetPublicationId, v.targetChapterId, v.targetLessonId].filter(Boolean).length === 1,
  );
const resource = z.strictObject({
  title: text(),
  description: text(4000).optional(),
  format: text(40),
  bodyText: z.string().max(2_000_000).optional(),
  assetId: uuid.optional(),
  accessClass: z.enum(['PUBLIC_FREE', 'REGISTERED_FREE', 'PREMIUM', 'RESTRICTED']),
  licenceCode: text(100),
  attribution: text(1000),
  copyrightNotice: text(2000),
});
const review = z.strictObject({
  decision: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REJECTED']),
  comment: text(4000),
});
const rights = z.strictObject({ licenceCode: text(100), sourceRef: text(500) });
const schedule = z
  .strictObject({ at: z.iso.datetime({ offset: true }), reason: text(1000) })
  .refine((v) => new Date(v.at).getTime() > Date.now());
const reason = z.strictObject({ reason: text(1000), confirm: z.literal(true) });
const notice = z.strictObject({ notice: text(4000) });
const compare = z.strictObject({ from: uuid });

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpException('Invalid publishing request', 400);
  return parsed.data;
}
const wrap = (request: Request, data: unknown) => ({ data, requestId: request.id });

@Controller('studio')
export class StudioController {
  constructor(
    @Inject(StudioService) private readonly studio: StudioService,
    @Inject(IdentityService) private readonly identity: IdentityService,
  ) {}
  private async auth(request: Request, mutate = false): Promise<AuthContext> {
    const context = await this.identity.context(request.headers.cookie);
    if (mutate)
      this.identity.checkCsrf(
        context,
        request.header('origin'),
        request.header('x-csrf-token'),
        request.headers.cookie,
      );
    return context;
  }
  @Get('tree') async tree(@Req() req: Request) {
    return wrap(req, await this.studio.tree(await this.auth(req)));
  }
  @Get('publications/:id') async detail(@Req() req: Request, @Param('id') id: string) {
    return wrap(req, await this.studio.detail(await this.auth(req), parse(uuid, id)));
  }
  @Get('revisions/:id') async revisionDetail(@Req() req: Request, @Param('id') id: string) {
    return wrap(req, await this.studio.revisionDetail(await this.auth(req), parse(uuid, id)));
  }
  @Get('revisions/:id/compare') async compare(
    @Req() req: Request,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return wrap(
      req,
      await this.studio.compare(await this.auth(req), parse(uuid, id), parse(compare, query).from),
    );
  }
  @Get('revisions/:id/export') async exportRevision(@Req() req: Request, @Param('id') id: string) {
    return wrap(req, await this.studio.exportRevision(await this.auth(req), parse(uuid, id)));
  }
  @Get('revisions/:id/export.zip')
  async exportZip(@Req() req: Request, @Param('id') id: string, @Res() res: Response) {
    const data = await this.studio.exportRevision(await this.auth(req), parse(uuid, id));
    if (
      !data.content.chapters.length ||
      data.content.chapters.some(
        (chapter) => !data.content.lessons.some((lesson) => lesson.chapterId === chapter.id),
      )
    )
      throw new HttpException('Structured ZIP requires a lesson in every chapter', 409);
    const zip = new yazl.ZipFile();
    const chapters = data.content.chapters.map((chapter, index) => ({
      slug: chapter.slug,
      title: chapter.title,
      lessons: data.content.lessons
        .filter((lesson) => lesson.chapterId === chapter.id)
        .map((lesson, lessonIndex) => {
          const file = `content/${index + 1}-${lessonIndex + 1}.md`;
          zip.addBuffer(Buffer.from(String(lesson.bodyMarkdown ?? ''), 'utf8'), file);
          return { title: lesson.title, file };
        }),
    }));
    zip.addBuffer(
      Buffer.from(JSON.stringify({ format: 'arata-structured-v1', chapters }, null, 2), 'utf8'),
      'manifest.json',
    );
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="revision-${id}.zip"`);
    res.setHeader('Cache-Control', 'private, no-store');
    zip.outputStream.on('error', () => res.destroy());
    zip.outputStream.pipe(res);
    zip.end();
  }
  @Post('collections') async createCollection(@Req() req: Request, @Body() body: unknown) {
    return wrap(
      req,
      await this.studio.createCollection(
        await this.auth(req, true),
        parse(collection, body),
        req.id,
      ),
    );
  }
  @Post('publications') async createPublication(@Req() req: Request, @Body() body: unknown) {
    return wrap(
      req,
      await this.studio.createPublication(
        await this.auth(req, true),
        parse(publication, body),
        req.id,
      ),
    );
  }
  @Patch('publications/:id') async updatePublication(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return wrap(
      req,
      await this.studio.updatePublication(
        await this.auth(req, true),
        parse(uuid, id),
        parse(publicationPatch, body),
        req.id,
      ),
    );
  }
  @Put('publications/:id/collections') async replaceCollections(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return wrap(
      req,
      await this.studio.replaceCollections(
        await this.auth(req, true),
        parse(uuid, id),
        parse(publicationCollections, body).collectionIds,
        req.id,
      ),
    );
  }
  @Post('publications/:id/contributors') async addContributor(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return wrap(
      req,
      await this.studio.addContributor(
        await this.auth(req, true),
        parse(uuid, id),
        parse(contributor, body),
        req.id,
      ),
    );
  }
  @Post('publications/:id/volumes') async addVolume(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return wrap(
      req,
      await this.studio.addVolume(
        await this.auth(req, true),
        parse(uuid, id),
        parse(volume, body),
        req.id,
      ),
    );
  }
  @Post('publications/:id/editions') async addEdition(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return wrap(
      req,
      await this.studio.addEdition(
        await this.auth(req, true),
        parse(uuid, id),
        parse(edition, body),
        req.id,
      ),
    );
  }
  @Post('editions/:id/revisions') async addRevision(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return wrap(
      req,
      await this.studio.addRevision(
        await this.auth(req, true),
        parse(uuid, id),
        parse(revision, body),
        req.id,
      ),
    );
  }
  @Post('revisions/:id/chapters') async addChapter(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return wrap(
      req,
      await this.studio.addChapter(
        await this.auth(req, true),
        parse(uuid, id),
        parse(chapter, body),
        req.id,
      ),
    );
  }
  @Post('chapters/:id/lessons') async addLesson(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return wrap(
      req,
      await this.studio.addLesson(
        await this.auth(req, true),
        parse(uuid, id),
        parse(lesson, body),
        req.id,
      ),
    );
  }
  @Patch('lessons/:id') async updateLesson(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return wrap(
      req,
      await this.studio.updateLesson(
        await this.auth(req, true),
        parse(uuid, id),
        parse(lessonPatch, body),
        req.id,
      ),
    );
  }
  @Post('revisions/:id/bibliography') async addBibliography(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return wrap(
      req,
      await this.studio.addBibliography(
        await this.auth(req, true),
        parse(uuid, id),
        parse(bibliography, body),
        req.id,
      ),
    );
  }
  @Post('lessons/:id/references') async addReference(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return wrap(
      req,
      await this.studio.addReference(
        await this.auth(req, true),
        parse(uuid, id),
        parse(reference, body),
        req.id,
      ),
    );
  }
  @Post('revisions/:id/resources') async addResource(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return wrap(
      req,
      await this.studio.addResource(
        await this.auth(req, true),
        parse(uuid, id),
        parse(resource, body),
        req.id,
      ),
    );
  }
  @Post('revisions/:id/submit') async submit(@Req() req: Request, @Param('id') id: string) {
    return wrap(req, await this.studio.submit(await this.auth(req, true), parse(uuid, id), req.id));
  }
  @Post('revisions/:id/review') async review(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return wrap(
      req,
      await this.studio.review(
        await this.auth(req, true),
        parse(uuid, id),
        parse(review, body),
        req.id,
      ),
    );
  }
  @Post('revisions/:id/rights') async attest(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return wrap(
      req,
      await this.studio.attestRights(
        await this.auth(req, true),
        parse(uuid, id),
        parse(rights, body),
        req.id,
      ),
    );
  }
  @Post('revisions/:id/publish') async publish(@Req() req: Request, @Param('id') id: string) {
    return wrap(
      req,
      await this.studio.publish(await this.auth(req, true), parse(uuid, id), req.id),
    );
  }
  @Post('revisions/:id/schedule') async schedule(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = parse(schedule, body);
    return wrap(
      req,
      await this.studio.schedule(
        await this.auth(req, true),
        parse(uuid, id),
        data.at,
        data.reason,
        req.id,
      ),
    );
  }
  @Post('publications/:id/withdraw') async withdraw(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = parse(reason, body);
    return wrap(
      req,
      await this.studio.withdraw(await this.auth(req, true), parse(uuid, id), data.reason, req.id),
    );
  }
  @Post('revisions/:id/errata') async erratum(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return wrap(
      req,
      await this.studio.erratum(
        await this.auth(req, true),
        parse(uuid, id),
        parse(notice, body).notice,
        req.id,
      ),
    );
  }
}
