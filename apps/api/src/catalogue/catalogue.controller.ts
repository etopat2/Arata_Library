import { Controller, Get, HttpException, Param, Query, Req, Res } from '@nestjs/common';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { IdentityService } from '../identity/identity.service.js';
import { CatalogueService } from './catalogue.service.js';
import { Inject } from '@nestjs/common';

const uuid = z.uuid();
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,199}$/);
const page = z.coerce.number().int().min(1).max(100000).default(1);
const limit = z.coerce.number().int().min(1).max(48).default(12);
const catalogueQuery = z.strictObject({
  q: z.string().trim().min(2).max(160).optional(),
  kind: z.enum(['STANDALONE', 'SERIES']).optional(),
  status: z.enum(['PUBLISHED', 'FORTHCOMING']).optional(),
  access: z.enum(['PUBLIC_FREE', 'REGISTERED_FREE', 'PREMIUM']).optional(),
  subject: z.string().max(160).optional(),
  author: slug.optional(),
  collection: slug.optional(),
  volume: uuid.optional(),
  edition: uuid.optional(),
  format: z.string().max(40).optional(),
  featured: z.literal('true').optional(),
  sort: z.enum(['newest', 'oldest', 'title', 'title-desc']).optional(),
  page,
  limit,
});
const resourceQuery = z.strictObject({
  q: z.string().trim().min(2).max(160).optional(),
  access: z.enum(['PUBLIC_FREE', 'REGISTERED_FREE', 'PREMIUM']).optional(),
  format: z.string().max(40).optional(),
  sort: z.enum(['newest', 'oldest', 'title', 'title-desc']).optional(),
  page,
  limit,
});
function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const prepared =
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== ''))
      : value;
  const parsed = schema.safeParse(prepared);
  if (!parsed.success) throw new HttpException('Invalid catalogue request', 400);
  return parsed.data;
}
const wrap = (request: Request, data: unknown) => ({ data, requestId: request.id });
const html = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );

@Controller('catalogue')
export class CatalogueController {
  constructor(@Inject(CatalogueService) private readonly catalogue: CatalogueService) {}

  @Get('collections')
  async collections(@Req() request: Request) {
    return wrap(request, await this.catalogue.collections());
  }

  @Get('facets')
  async facets(@Req() request: Request) {
    return wrap(request, await this.catalogue.facets());
  }

  @Get('publications')
  async publications(@Req() request: Request, @Query() query: unknown) {
    return wrap(request, await this.catalogue.publications(parse(catalogueQuery, query)));
  }

  @Get('search')
  async search(@Req() request: Request, @Query() query: unknown) {
    const parsed = parse(catalogueQuery, query);
    if (!parsed.q) throw new HttpException('Search term required', 400);
    const [publications, resources] = await Promise.all([
      this.catalogue.publications(parsed),
      this.catalogue.resources({
        q: parsed.q,
        format: parsed.format,
        sort: parsed.sort,
        page: parsed.page,
        limit: parsed.limit,
      }),
    ]);
    return wrap(request, { publications, resources });
  }

  @Get('publications/:slug')
  async publication(@Req() request: Request, @Param('slug') value: string) {
    return wrap(request, await this.catalogue.publication(parse(slug, value)));
  }

  @Get('publications/:slug/volumes')
  async volumes(@Req() request: Request, @Param('slug') value: string) {
    const publication = await this.catalogue.publication(parse(slug, value));
    return wrap(request, publication.editions);
  }

  @Get('publications/:slug/toc')
  async toc(@Req() request: Request, @Param('slug') value: string) {
    const publication = await this.catalogue.publication(parse(slug, value));
    const editions = await Promise.all(
      publication.editions.map((edition: { id: string }) => this.catalogue.edition(edition.id)),
    );
    return wrap(request, editions);
  }

  @Get('editions/:id')
  async edition(@Req() request: Request, @Param('id') value: string) {
    return wrap(request, await this.catalogue.edition(parse(uuid, value)));
  }

  @Get('chapters/:id/preview')
  async preview(@Req() request: Request, @Param('id') value: string) {
    return wrap(request, await this.catalogue.chapterPreview(parse(uuid, value)));
  }
}

@Controller('resources')
export class PublicResourceController {
  constructor(
    @Inject(CatalogueService) private readonly catalogue: CatalogueService,
    @Inject(IdentityService) private readonly identity: IdentityService,
  ) {}

  @Get()
  async list(@Req() request: Request, @Query() query: unknown) {
    return wrap(request, await this.catalogue.resources(parse(resourceQuery, query)));
  }

  @Get(':id')
  async detail(@Req() request: Request, @Param('id') value: string) {
    const publicData = { ...(await this.catalogue.resource(parse(uuid, value))) };
    delete publicData.allowRead;
    delete publicData.textAvailable;
    return wrap(request, publicData);
  }

  @Get(':id/open')
  async open(@Req() request: Request, @Param('id') value: string) {
    const id = parse(uuid, value);
    const resource = await this.catalogue.resource(id);
    const authenticated =
      resource.accessClass === 'REGISTERED_FREE'
        ? !!(await this.identity.context(request.headers.cookie))
        : false;
    return wrap(request, await this.catalogue.openResource(id, authenticated));
  }
}

@Controller('share/publications')
export class PublicationShareController {
  constructor(
    @Inject(CatalogueService) private readonly catalogue: CatalogueService,
    @Inject('APP_CONFIG') private readonly config: { WEB_ORIGIN: string },
  ) {}

  @Get(':slug')
  async share(@Param('slug') value: string, @Res() response: Response) {
    const publication = await this.catalogue.publication(parse(slug, value));
    const title = html(`${publication.title} | Arata TechLibrary`);
    const description = html(
      (publication.description ?? 'Explore technology books at Arata TechLibrary').slice(0, 220),
    );
    const destination = `${this.config.WEB_ORIGIN}/?screen=series-detail&slug=${encodeURIComponent(publication.slug)}`;
    const shareUrl = `${this.config.WEB_ORIGIN}/api/v1/share/publications/${publication.slug}`;
    response.setHeader('Cache-Control', 'public, max-age=300');
    response
      .type('text/html; charset=utf-8')
      .send(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="${description}"><meta property="og:type" content="book"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${html(shareUrl)}"><meta name="twitter:card" content="summary"><link rel="canonical" href="${html(destination)}"><meta http-equiv="refresh" content="0;url=${html(destination)}"></head><body><main><h1>${html(publication.title)}</h1><p>${description}</p><a href="${html(destination)}">View publication</a></main></body></html>`,
      );
  }
}
