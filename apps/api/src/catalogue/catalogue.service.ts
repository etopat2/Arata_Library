import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

export type CatalogueQuery = {
  q?: string | undefined;
  kind?: 'STANDALONE' | 'SERIES' | undefined;
  status?: 'PUBLISHED' | 'FORTHCOMING' | undefined;
  access?: 'PUBLIC_FREE' | 'REGISTERED_FREE' | 'PREMIUM' | undefined;
  subject?: string | undefined;
  author?: string | undefined;
  collection?: string | undefined;
  volume?: string | undefined;
  edition?: string | undefined;
  featured?: 'true' | undefined;
  sort?: 'newest' | 'oldest' | 'title' | 'title-desc' | undefined;
  page: number;
  limit: number;
};

const publicPublication = `(
  (p.status='PUBLISHED' AND EXISTS (
    SELECT 1 FROM app."Edition" x JOIN app."Revision" xr ON xr.id=x."currentRevisionId"
    WHERE x."publicationId"=p.id AND xr.status='PUBLISHED' AND xr."publishedAt"<=now()
  )) OR (p.status='FORTHCOMING' AND p."releaseAt" IS NOT NULL)
)`;

const publicationFields = `p.id,p.slug,p.title,p.subtitle,p.description,p.subject,p.keywords,
  p.kind,p.status,p."licenceCode",p."copyrightNotice",p."releaseAt",
  (SELECT min(rv."publishedAt") FROM app."Edition" ed JOIN app."Revision" rv ON rv.id=ed."currentRevisionId"
   WHERE ed."publicationId"=p.id AND rv.status='PUBLISHED') AS "publishedAt",
  COALESCE((SELECT jsonb_agg(jsonb_build_object('name',co."displayName",'slug',co.slug,'role',pc.role)
    ORDER BY pc.ordinal,co."displayName") FROM app."PublicationContributor" pc
    JOIN app."Contributor" co ON co.id=pc."contributorId" WHERE pc."publicationId"=p.id),'[]'::jsonb) AS contributors,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('slug',c.slug,'title',c.title) ORDER BY c.title)
    FROM app."PublicationCollection" cp JOIN app."Collection" c ON c.id=cp."collectionId"
    WHERE cp."publicationId"=p.id),'[]'::jsonb) AS collections,
  CASE WHEN p.status='FORTHCOMING' THEN 'UPCOMING'
       WHEN pol."accessClass"='PUBLIC_FREE' AND pol."allowRead"=true THEN 'FREE'
       WHEN pol."accessClass"='REGISTERED_FREE' AND pol."allowRead"=true THEN 'SIGN_IN'
       ELSE 'LOCKED' END AS "accessState",
  COALESCE(pol."accessClass"::text,'RESTRICTED') AS "accessClass"`;

const publicationJoin = `LEFT JOIN app."ContentPolicy" pol ON pol."publicationId"=p.id
  AND pol."isActive"=true AND pol."approvedAt" IS NOT NULL`;

const resourceVisible = `r."publishedAt" IS NOT NULL AND r."publishedAt"<=now()
  AND (r."withdrawnAt" IS NULL OR r."withdrawnAt">now())
  AND ((r."publicationId" IS NULL AND r."volumeId" IS NULL AND r."editionId" IS NULL
    AND r."revisionId" IS NULL AND r."chapterId" IS NULL AND r."lessonId" IS NULL)
    OR (p.status='PUBLISHED' AND EXISTS (
      SELECT 1 FROM app."Edition" ed JOIN app."Revision" rv ON rv.id=ed."currentRevisionId"
      WHERE ed."publicationId"=p.id AND rv.status='PUBLISHED'
    )))
  AND pol."isActive"=true AND pol."approvedAt" IS NOT NULL
  AND pol."accessClass"=r."accessClass"`;

const resourceFields = `r.id,r.title,r.description,r.format,r."licenceCode",r.attribution,
  r."copyrightNotice",r."publishedAt",r."accessClass",p.slug AS "publicationSlug",
  CASE WHEN r."accessClass"='PUBLIC_FREE' AND pol."allowRead"=true THEN 'FREE'
       WHEN r."accessClass"='REGISTERED_FREE' AND pol."allowRead"=true THEN 'SIGN_IN'
       ELSE 'LOCKED' END AS "accessState",
  (r."bodyText" IS NOT NULL AND pol."allowRead"=true AND r."accessClass" IN ('PUBLIC_FREE','REGISTERED_FREE')) AS "hasReadableText"`;

@Injectable()
export class CatalogueService {
  constructor(@Inject('DB_POOL') private readonly pool: Pool) {}

  async collections() {
    const result = await this.pool.query(
      `SELECT c.slug,c.title,c.description,count(DISTINCT p.id)::int AS "publicationCount"
       FROM app."Collection" c JOIN app."PublicationCollection" pc ON pc."collectionId"=c.id
       JOIN app."Publication" p ON p.id=pc."publicationId" AND ${publicPublication}
       GROUP BY c.id ORDER BY c.title`,
    );
    return result.rows;
  }

  async facets() {
    const [subjects, authors, volumes, editions, formats] = await Promise.all([
      this.pool.query<{ value: string }>(
        `SELECT DISTINCT p.subject AS value FROM app."Publication" p WHERE ${publicPublication} AND p.subject IS NOT NULL ORDER BY value`,
      ),
      this.pool.query<{ slug: string; name: string }>(
        `SELECT DISTINCT co.slug,co."displayName" AS name FROM app."Contributor" co JOIN app."PublicationContributor" pc ON pc."contributorId"=co.id JOIN app."Publication" p ON p.id=pc."publicationId" WHERE ${publicPublication} ORDER BY name`,
      ),
      this.pool.query<{ id: string; title: string }>(
        `SELECT DISTINCT v.id,v.title FROM app."Volume" v JOIN app."Publication" p ON p.id=v."publicationId" JOIN app."Edition" ed ON ed."volumeId"=v.id JOIN app."Revision" rv ON rv.id=ed."currentRevisionId" WHERE p.status='PUBLISHED' AND rv.status='PUBLISHED' ORDER BY v.title`,
      ),
      this.pool.query<{ id: string; label: string }>(
        `SELECT DISTINCT ed.id,ed.label FROM app."Edition" ed JOIN app."Publication" p ON p.id=ed."publicationId" JOIN app."Revision" rv ON rv.id=ed."currentRevisionId" WHERE p.status='PUBLISHED' AND rv.status='PUBLISHED' ORDER BY ed.label`,
      ),
      this.pool.query<{ value: string }>(
        `SELECT DISTINCT r.format AS value FROM app."Resource" r LEFT JOIN app."Publication" p ON p.id=r."publicationId" JOIN app."ContentPolicy" pol ON pol."resourceId"=r.id WHERE ${resourceVisible} AND r.format IS NOT NULL ORDER BY value`,
      ),
    ]);
    return {
      subjects: subjects.rows.map((row) => row.value),
      authors: authors.rows,
      volumes: volumes.rows,
      editions: editions.rows,
      formats: formats.rows.map((row) => row.value),
    };
  }

  async publications(query: CatalogueQuery) {
    const values: unknown[] = [];
    const conditions = [publicPublication];
    const add = (condition: string, value: unknown) => {
      values.push(value);
      conditions.push(condition.replace('?', `$${values.length}`));
    };
    if (query.q) {
      add(
        `(to_tsvector('english',coalesce(p.title,'')||' '||coalesce(p.subtitle,'')||' '||coalesce(p.description,'')||' '||coalesce(p.subject,'')) @@ websearch_to_tsquery('english',?)
          OR EXISTS(SELECT 1 FROM unnest(p.keywords) keyword WHERE keyword ILIKE '%'||?||'%')
          OR EXISTS(SELECT 1 FROM app."PublicationContributor" pc JOIN app."Contributor" co ON co.id=pc."contributorId"
            WHERE pc."publicationId"=p.id AND co."displayName" ILIKE '%'||?||'%'))`,
        query.q,
      );
      // Keywords and contributor names use the same bound text as the full-text query.
      conditions[conditions.length - 1] = conditions[conditions.length - 1]!.replaceAll(
        '?',
        `$${values.length}`,
      );
    }
    if (query.kind) add('p.kind=?', query.kind);
    if (query.status) add('p.status=?', query.status);
    if (query.access)
      add(
        'pol."accessClass"=? AND pol."isActive"=true AND pol."approvedAt" IS NOT NULL',
        query.access,
      );
    if (query.subject) add('p.subject=?', query.subject);
    if (query.author)
      add(
        `EXISTS(SELECT 1 FROM app."PublicationContributor" pc JOIN app."Contributor" co ON co.id=pc."contributorId" WHERE pc."publicationId"=p.id AND co.slug=?)`,
        query.author,
      );
    if (query.collection)
      add(
        `EXISTS(SELECT 1 FROM app."PublicationCollection" pc JOIN app."Collection" c ON c.id=pc."collectionId" WHERE pc."publicationId"=p.id AND c.slug=?)`,
        query.collection,
      );
    if (query.volume)
      add(
        `EXISTS(SELECT 1 FROM app."Edition" ed JOIN app."Revision" rv ON rv.id=ed."currentRevisionId" WHERE ed."publicationId"=p.id AND ed."volumeId"=? AND rv.status='PUBLISHED')`,
        query.volume,
      );
    if (query.edition)
      add(
        `EXISTS(SELECT 1 FROM app."Edition" ed JOIN app."Revision" rv ON rv.id=ed."currentRevisionId" WHERE ed."publicationId"=p.id AND ed.id=? AND rv.status='PUBLISHED')`,
        query.edition,
      );
    if (query.featured) conditions.push('p."featuredAt" IS NOT NULL AND p.status=\'PUBLISHED\'');
    const order = {
      newest: 'COALESCE(p."releaseAt",p."createdAt") DESC,p.id',
      oldest: 'COALESCE(p."releaseAt",p."createdAt") ASC,p.id',
      title: 'p.title ASC,p.id',
      'title-desc': 'p.title DESC,p.id',
    }[query.sort ?? 'newest'];
    const ordered = query.featured ? 'p."featuredAt" DESC,p.id' : order;
    const result = await this.pool.query(
      `SELECT ${publicationFields},count(*) OVER()::int AS "totalCount"
       FROM app."Publication" p ${publicationJoin}
       WHERE ${conditions.join(' AND ')} ORDER BY ${ordered}
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, query.limit, (query.page - 1) * query.limit],
    );
    const total = result.rows[0]?.totalCount ?? 0;
    return {
      items: result.rows.map((row) => {
        const item = { ...row };
        delete item.totalCount;
        return item;
      }),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async publication(slug: string) {
    const result = await this.pool.query(
      `SELECT ${publicationFields} FROM app."Publication" p ${publicationJoin}
       WHERE p.slug=$1 AND ${publicPublication}`,
      [slug],
    );
    if (!result.rows[0]) throw new HttpException('Publication not found', 404);
    const publication = result.rows[0];
    const editions = await this.pool.query(
      `SELECT ed.id,ed."editionCode",ed.label,ed."isDefault",ed."volumeId",rv."publishedAt",
         rv.number AS "revisionNumber",v.ordinal AS "volumeOrdinal",v.title AS "volumeTitle"
       FROM app."Edition" ed JOIN app."Revision" rv ON rv.id=ed."currentRevisionId"
       LEFT JOIN app."Volume" v ON v.id=ed."volumeId"
       WHERE ed."publicationId"=$1 AND rv.status='PUBLISHED' AND rv."publishedAt"<=now()
       ORDER BY v.ordinal NULLS FIRST,ed."isDefault" DESC,rv."publishedAt" DESC`,
      [publication.id],
    );
    return { ...publication, editions: editions.rows };
  }

  async edition(id: string) {
    const result = await this.pool.query(
      `SELECT ed.id,ed.label,ed."editionCode",ed."isDefault",rv.number AS "revisionNumber",
        rv."publishedAt",p.slug AS "publicationSlug",p.title AS "publicationTitle",
        v.id AS "volumeId",v.ordinal AS "volumeOrdinal",v.title AS "volumeTitle"
       FROM app."Edition" ed JOIN app."Publication" p ON p.id=ed."publicationId"
       JOIN app."Revision" rv ON rv.id=ed."currentRevisionId" LEFT JOIN app."Volume" v ON v.id=ed."volumeId"
       WHERE ed.id=$1 AND p.status='PUBLISHED' AND rv.status='PUBLISHED' AND rv."publishedAt"<=now()`,
      [id],
    );
    if (!result.rows[0]) throw new HttpException('Edition not found', 404);
    const chapters = await this.pool.query(
      `SELECT ch.id,ch.ordinal,ch.slug,ch.title,
        (ch."previewText" IS NOT NULL AND cp."isActive"=true AND cp."approvedAt" IS NOT NULL
          AND cp."accessClass"='PUBLIC_FREE' AND cp."allowRead"=true) AS "previewAvailable"
       FROM app."Chapter" ch JOIN app."Edition" ed ON ed."currentRevisionId"=ch."revisionId"
       LEFT JOIN app."ContentPolicy" cp ON cp."chapterId"=ch.id AND cp."isActive"=true
       WHERE ed.id=$1 ORDER BY ch.ordinal`,
      [id],
    );
    return { ...result.rows[0], chapters: chapters.rows };
  }

  async chapterPreview(id: string) {
    const result = await this.pool.query(
      `SELECT ch.title,ch."previewText" AS text,ed.id AS "editionId",p.slug AS "publicationSlug"
       FROM app."Chapter" ch JOIN app."Edition" ed ON ed."currentRevisionId"=ch."revisionId"
       JOIN app."Publication" p ON p.id=ed."publicationId"
       JOIN app."Revision" rv ON rv.id=ch."revisionId"
       JOIN app."ContentPolicy" cp ON cp."chapterId"=ch.id
       WHERE ch.id=$1 AND p.status='PUBLISHED' AND rv.status='PUBLISHED'
         AND ch."previewText" IS NOT NULL AND cp."isActive"=true AND cp."approvedAt" IS NOT NULL
         AND cp."accessClass"='PUBLIC_FREE' AND cp."allowRead"=true`,
      [id],
    );
    if (!result.rows[0]) throw new HttpException('Preview not found', 404);
    return result.rows[0];
  }

  async resources(query: {
    q?: string | undefined;
    access?: string | undefined;
    format?: string | undefined;
    sort?: 'newest' | 'oldest' | 'title' | 'title-desc' | undefined;
    page: number;
    limit: number;
  }) {
    const values: unknown[] = [];
    const conditions = [resourceVisible];
    if (query.access) {
      values.push(query.access);
      conditions.push(`r."accessClass"=$${values.length}`);
    }
    if (query.format) {
      values.push(query.format);
      conditions.push(`r.format=$${values.length}`);
    }
    if (query.q) {
      values.push(query.q);
      conditions.push(`to_tsvector('english',coalesce(r.title,'')||' '||coalesce(r.description,'')||' '||
        CASE WHEN r."accessClass"='PUBLIC_FREE' AND pol."allowRead"=true THEN coalesce(r."bodyText",'') ELSE '' END)
        @@ websearch_to_tsquery('english',$${values.length})`);
    }
    const order = {
      newest: 'r."publishedAt" DESC,r.id',
      oldest: 'r."publishedAt" ASC,r.id',
      title: 'r.title ASC,r.id',
      'title-desc': 'r.title DESC,r.id',
    }[query.sort ?? 'newest'];
    const result = await this.pool.query(
      `SELECT ${resourceFields},count(*) OVER()::int AS "totalCount"
       FROM app."Resource" r LEFT JOIN app."Publication" p ON p.id=r."publicationId"
       JOIN app."ContentPolicy" pol ON pol."resourceId"=r.id
       WHERE ${conditions.join(' AND ')} ORDER BY ${order}
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, query.limit, (query.page - 1) * query.limit],
    );
    const total = result.rows[0]?.totalCount ?? 0;
    return {
      items: result.rows.map((row) => {
        const item = { ...row };
        delete item.totalCount;
        return item;
      }),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async resource(id: string) {
    const result = await this.pool.query(
      `SELECT ${resourceFields},pol."allowRead",r."bodyText" IS NOT NULL AS "textAvailable"
       FROM app."Resource" r LEFT JOIN app."Publication" p ON p.id=r."publicationId"
       JOIN app."ContentPolicy" pol ON pol."resourceId"=r.id
       WHERE r.id=$1 AND ${resourceVisible}`,
      [id],
    );
    if (!result.rows[0]) throw new HttpException('Resource not found', 404);
    return result.rows[0];
  }

  async openResource(id: string, authenticated: boolean) {
    const result = await this.pool.query<{
      id: string;
      title: string;
      bodyText: string;
      licenceCode: string | null;
    }>(
      `SELECT r.id,r.title,r."bodyText",r."licenceCode"
       FROM app."Resource" r LEFT JOIN app."Publication" p ON p.id=r."publicationId"
       JOIN app."ContentPolicy" pol ON pol."resourceId"=r.id
       WHERE r.id=$1 AND ${resourceVisible} AND pol."allowRead"=true
         AND r."bodyText" IS NOT NULL
         AND (r."accessClass"='PUBLIC_FREE' OR (r."accessClass"='REGISTERED_FREE' AND $2::boolean))`,
      [id, authenticated],
    );
    const resource = result.rows[0];
    if (!resource) {
      await this.resource(id);
      throw new HttpException(
        authenticated ? 'Access denied' : 'Authentication required',
        authenticated ? 403 : 401,
      );
    }
    return {
      id,
      title: resource.title,
      text: resource.bodyText,
      licenceCode: resource.licenceCode,
    };
  }
}
