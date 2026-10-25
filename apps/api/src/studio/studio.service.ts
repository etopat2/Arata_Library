import { createHash, randomUUID } from 'node:crypto';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import type { AuthContext } from '../identity/identity.service.js';

type Role = 'AUTHOR' | 'EDITOR' | 'PUBLISHER';
type RevisionScope = {
  id: string;
  editionId: string;
  publicationId: string;
  status: string;
  manifestHash: string | null;
  createdById: string | null;
};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
export class StudioService {
  constructor(@Inject('DB_POOL') private readonly pool: Pool) {}

  private async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof HttpException) throw error;
      const code = (error as { code?: string | undefined }).code;
      if (code === '23505')
        throw new HttpException('A record with this identity or order already exists', 409);
      if (code === '23503' || code === '23514' || code === '23502')
        throw new HttpException('Publishing state or hierarchy conflict', 409);
      throw error;
    } finally {
      client.release();
    }
  }

  private async audit(
    client: PoolClient,
    context: AuthContext,
    action: string,
    type: string,
    id: string,
    requestId: string,
    reason?: string | undefined,
  ) {
    await client.query(
      `INSERT INTO app."AuditEvent" (id,"actorId",action,"objectType","objectId","correlationId",reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), context.user.id, action, type, id, requestId, reason ?? null],
    );
  }

  private async role(
    client: PoolClient,
    context: AuthContext,
    publicationId: string | null,
    accepted: Role[],
  ) {
    const roles = await client.query<{ code: string }>(
      `SELECT DISTINCT r.code FROM app."RoleAssignment" a JOIN app."Role" r ON r.id=a."roleId"
       WHERE a."userId"=$1 AND a."startsAt"<=now() AND (a."endsAt" IS NULL OR a."endsAt">now())
         AND a."revokedAt" IS NULL AND ((a."scopeType"='PLATFORM' AND a."scopeId" IS NULL)
           OR ($2::uuid IS NOT NULL AND a."scopeType"='PUBLICATION' AND a."scopeId"=$2))`,
      [context.user.id, publicationId],
    );
    if (!roles.rows.some((row) => accepted.includes(row.code as Role)))
      throw new HttpException('Publishing authority required for this publication', 403);
  }

  private async revision(client: PoolClient, id: string, lock = false): Promise<RevisionScope> {
    const result = await client.query<RevisionScope>(
      `SELECT r.id,r."editionId",e."publicationId",r.status,r."manifestHash",r."createdById"
       FROM app."Revision" r JOIN app."Edition" e ON e.id=r."editionId" WHERE r.id=$1 ${lock ? 'FOR UPDATE OF r' : ''}`,
      [id],
    );
    if (!result.rows[0]) throw new HttpException('Revision not found', 404);
    return result.rows[0];
  }

  private async editionPublication(client: PoolClient, editionId: string) {
    const result = await client.query<{ publicationId: string }>(
      `SELECT "publicationId" FROM app."Edition" WHERE id=$1`,
      [editionId],
    );
    if (!result.rows[0]) throw new HttpException('Edition not found', 404);
    return result.rows[0].publicationId;
  }

  private async chapterRevision(client: PoolClient, chapterId: string) {
    const result = await client.query<{ revisionId: string }>(
      `SELECT "revisionId" FROM app."Chapter" WHERE id=$1`,
      [chapterId],
    );
    if (!result.rows[0]) throw new HttpException('Chapter not found', 404);
    return result.rows[0].revisionId;
  }

  private async lessonRevision(client: PoolClient, lessonId: string) {
    const result = await client.query<{ revisionId: string }>(
      `SELECT c."revisionId" FROM app."Lesson" l JOIN app."Chapter" c ON c.id=l."chapterId" WHERE l.id=$1`,
      [lessonId],
    );
    if (!result.rows[0]) throw new HttpException('Lesson not found', 404);
    return result.rows[0].revisionId;
  }

  private async manuscript(client: PoolClient, revisionId: string) {
    const chapters = (
      await client.query(
        `SELECT id,ordinal,slug,title,"previewText",summary,"learningOutcomes",prerequisites
       FROM app."Chapter" WHERE "revisionId"=$1 ORDER BY ordinal,id`,
        [revisionId],
      )
    ).rows;
    const lessons = (
      await client.query(
        `SELECT l.id,l."chapterId",l.ordinal,l.title,l."bodyMarkdown",l.blocks,l."contentHash",a.sha256 AS "bodyAssetHash"
       FROM app."Lesson" l JOIN app."Chapter" c ON c.id=l."chapterId"
       LEFT JOIN app."Asset" a ON a.id=l."bodyAssetId"
       WHERE c."revisionId"=$1 ORDER BY c.ordinal,l.ordinal,l.id`,
        [revisionId],
      )
    ).rows;
    const bibliography = (
      await client.query(
        `SELECT "citationKey","citationText",url,ordinal FROM app."BibliographyEntry" WHERE "revisionId"=$1 ORDER BY ordinal,id`,
        [revisionId],
      )
    ).rows;
    const references = (
      await client.query(
        `SELECT x."sourceLessonId",x."targetPublicationId",x."targetChapterId",x."targetLessonId",x.label
       FROM app."CrossReference" x JOIN app."Lesson" l ON l.id=x."sourceLessonId"
       JOIN app."Chapter" c ON c.id=l."chapterId" WHERE c."revisionId"=$1 ORDER BY x.id`,
        [revisionId],
      )
    ).rows;
    const resources = (
      await client.query(
        `SELECT res.id,res.title,res.format,res."accessClass",res."licenceCode",res.attribution,res."copyrightNotice",a.sha256
       FROM app."Resource" res LEFT JOIN app."Chapter" c ON c.id=res."chapterId"
       LEFT JOIN app."Lesson" l ON l.id=res."lessonId" LEFT JOIN app."Chapter" lc ON lc.id=l."chapterId"
       LEFT JOIN app."ResourceAttachment" ra ON ra."resourceId"=res.id
       LEFT JOIN app."Asset" a ON a.id=ra."assetId"
       WHERE COALESCE(res."revisionId",c."revisionId",lc."revisionId")=$1 ORDER BY res.id,ra.ordinal`,
        [revisionId],
      )
    ).rows;
    return { chapters, lessons, bibliography, references, resources };
  }

  private async manifest(client: PoolClient, revisionId: string) {
    const content = await this.manuscript(client, revisionId);
    const metadata = (
      await client.query(
        `SELECT p.title,p.subtitle,p."languageCode",p."licenceCode",p."sourceRef",p."copyrightNotice",e."editionCode",e.label,e.isbn13,v.title AS "volumeTitle"
       FROM app."Revision" r JOIN app."Edition" e ON e.id=r."editionId"
       JOIN app."Publication" p ON p.id=e."publicationId" LEFT JOIN app."Volume" v ON v.id=e."volumeId" WHERE r.id=$1`,
        [revisionId],
      )
    ).rows[0];
    const contributors = (
      await client.query(
        `SELECT co.slug,co."displayName",pc.role,pc.ordinal FROM app."Revision" r JOIN app."Edition" e ON e.id=r."editionId" JOIN app."PublicationContributor" pc ON pc."publicationId"=e."publicationId" JOIN app."Contributor" co ON co.id=pc."contributorId" WHERE r.id=$1 ORDER BY pc.ordinal,co.id`,
        [revisionId],
      )
    ).rows;
    return hash({ metadata, contributors, content });
  }

  private async reorderSiblings(
    client: PoolClient,
    table: 'Volume' | 'Chapter' | 'Lesson',
    parentColumn: 'publicationId' | 'revisionId' | 'chapterId',
    parentId: string,
    ids: string[],
    expectedIds: string[],
  ) {
    const current = (
      await client.query<{ id: string; ordinal: number }>(
        `SELECT id,ordinal FROM app."${table}" WHERE "${parentColumn}"=$1 ORDER BY ordinal,id FOR UPDATE`,
        [parentId],
      )
    ).rows;
    if (
      current.length !== expectedIds.length ||
      current.some((row, index) => row.id !== expectedIds[index])
    )
      throw new HttpException('Order changed; reload the hierarchy and retry', 409);
    if (current.length !== ids.length || ids.some((id) => !current.some((row) => row.id === id)))
      throw new HttpException('Order must include exactly the current siblings', 409);
    if (ids.every((id, index) => id === current[index]?.id)) return;
    const maxOrdinal = Math.max(0, ...current.map((row) => row.ordinal));
    if (maxOrdinal > 1_000_000_000)
      throw new HttpException('Order exceeds the supported range', 409);
    // Move every ordinal above the old range before assigning dense positive positions.
    // This avoids transient unique conflicts during swaps under the database constraints.
    await client.query(`UPDATE app."${table}" SET ordinal=ordinal+$2 WHERE "${parentColumn}"=$1`, [
      parentId,
      maxOrdinal + 1,
    ]);
    for (const [index, id] of ids.entries())
      await client.query(
        `UPDATE app."${table}" SET ordinal=$3 WHERE id=$1 AND "${parentColumn}"=$2`,
        [id, parentId, index + 1],
      );
  }

  async tree(context: AuthContext) {
    return this.transaction(async (client) => {
      const pubs = await client.query<{ id: string }>(
        `SELECT DISTINCT p.id FROM app."Publication" p
         JOIN app."RoleAssignment" a ON a."userId"=$1 AND a."revokedAt" IS NULL
           AND a."startsAt"<=now() AND (a."endsAt" IS NULL OR a."endsAt">now())
           AND ((a."scopeType"='PLATFORM' AND a."scopeId" IS NULL)
              OR (a."scopeType"='PUBLICATION' AND a."scopeId"=p.id))
         JOIN app."Role" r ON r.id=a."roleId" AND r.code IN ('AUTHOR','EDITOR','PUBLISHER')`,
        [context.user.id],
      );
      const ids = pubs.rows.map((p) => p.id);
      const library = (
        await client.query(`SELECT id,slug,title FROM app."Library" WHERE slug='arata-techlibrary'`)
      ).rows[0];
      const collections = (
        await client.query(
          `SELECT c.id,c.slug,c.title FROM app."Collection" c WHERE c."libraryId"=$1 ORDER BY c.title`,
          [library.id],
        )
      ).rows;
      const platform =
        (
          await client.query(
            `SELECT 1 FROM app."RoleAssignment" a JOIN app."Role" r ON r.id=a."roleId" WHERE a."userId"=$1 AND a."scopeType"='PLATFORM' AND a."scopeId" IS NULL AND a."revokedAt" IS NULL AND a."startsAt"<=now() AND (a."endsAt" IS NULL OR a."endsAt">now()) AND r.code IN ('AUTHOR','EDITOR','PUBLISHER') LIMIT 1`,
            [context.user.id],
          )
        ).rowCount !== 0;
      if (!ids.length)
        return {
          library,
          collections: platform ? collections : [],
          publications: [],
          volumes: [],
          editions: [],
          revisions: [],
          chapters: [],
        };
      const publications = (
        await client.query(
          `SELECT p.id,p.slug,p.title,p.kind,p.status,pc."collectionId"
         FROM app."Publication" p LEFT JOIN app."PublicationCollection" pc ON pc."publicationId"=p.id
         WHERE p.id=ANY($1::uuid[]) ORDER BY p.title`,
          [ids],
        )
      ).rows;
      const volumes = (
        await client.query(
          `SELECT id,"publicationId",ordinal,title FROM app."Volume" WHERE "publicationId"=ANY($1::uuid[]) ORDER BY ordinal`,
          [ids],
        )
      ).rows;
      const editions = (
        await client.query(
          `SELECT id,"publicationId","volumeId",ordinal,"editionCode",label,"isDefault","currentRevisionId" FROM app."Edition" WHERE "publicationId"=ANY($1::uuid[]) ORDER BY "volumeId",ordinal,id`,
          [ids],
        )
      ).rows;
      const revisions = (
        await client.query(
          `SELECT r.id,r."editionId",r.number,r.status,r."publishedAt" FROM app."Revision" r JOIN app."Edition" e ON e.id=r."editionId" WHERE e."publicationId"=ANY($1::uuid[]) ORDER BY r.number DESC`,
          [ids],
        )
      ).rows;
      const chapters = (
        await client.query(
          `SELECT c.id,c."revisionId",c.ordinal,c.title FROM app."Chapter" c JOIN app."Revision" r ON r.id=c."revisionId" JOIN app."Edition" e ON e.id=r."editionId" WHERE e."publicationId"=ANY($1::uuid[]) ORDER BY c.ordinal`,
          [ids],
        )
      ).rows;
      return {
        library,
        collections,
        publications,
        volumes,
        editions,
        revisions,
        chapters,
      };
    });
  }

  async detail(context: AuthContext, publicationId: string) {
    return this.transaction(async (client) => {
      await this.role(client, context, publicationId, ['AUTHOR', 'EDITOR', 'PUBLISHER']);
      const publication = (
        await client.query(
          `SELECT id,slug,title,subtitle,description,subject,keywords,kind,status,"ownerId","languageCode","licenceCode","sourceRef","copyrightNotice","releaseAt" FROM app."Publication" WHERE id=$1`,
          [publicationId],
        )
      ).rows[0];
      if (!publication) throw new HttpException('Publication not found', 404);
      const collections = (
        await client.query(
          `SELECT c.id,c.title FROM app."Collection" c JOIN app."PublicationCollection" pc ON pc."collectionId"=c.id WHERE pc."publicationId"=$1`,
          [publicationId],
        )
      ).rows;
      const contributors = (
        await client.query(
          `SELECT co.id,co."displayName",pc.role,pc.ordinal FROM app."PublicationContributor" pc JOIN app."Contributor" co ON co.id=pc."contributorId" WHERE pc."publicationId"=$1 ORDER BY pc.ordinal`,
          [publicationId],
        )
      ).rows;
      const volumes = (
        await client.query(
          `SELECT id,ordinal,title FROM app."Volume" WHERE "publicationId"=$1 ORDER BY ordinal`,
          [publicationId],
        )
      ).rows;
      const editions = (
        await client.query(
          `SELECT id,"publicationId","volumeId",ordinal,"editionCode",label,isbn13,"publicationDate","isDefault","currentRevisionId" FROM app."Edition" WHERE "publicationId"=$1 ORDER BY "volumeId",ordinal,id`,
          [publicationId],
        )
      ).rows;
      const revisions = (
        await client.query(
          `SELECT r.id,r."editionId",r.number,r.status,r."manifestHash",r."changeSummary",r."correctionNotice",r."submittedAt",r."publishedAt" FROM app."Revision" r JOIN app."Edition" e ON e.id=r."editionId" WHERE e."publicationId"=$1 ORDER BY r.number DESC`,
          [publicationId],
        )
      ).rows;
      return { publication, collections, contributors, volumes, editions, revisions };
    });
  }

  async revisionDetail(context: AuthContext, id: string) {
    return this.transaction(async (client) => {
      const revision = await this.revision(client, id);
      await this.role(client, context, revision.publicationId, ['AUTHOR', 'EDITOR', 'PUBLISHER']);
      return {
        revision,
        ...(await this.manuscript(client, id)),
        reviews: (
          await client.query(
            `SELECT decision,"manifestHash",comment,"decidedAt" FROM app."EditorialReview" WHERE "revisionId"=$1 ORDER BY "decidedAt"`,
            [id],
          )
        ).rows,
        errata: (
          await client.query(
            `SELECT notice,"createdAt" FROM app."RevisionErratum" WHERE "revisionId"=$1 ORDER BY "createdAt"`,
            [id],
          )
        ).rows,
      };
    });
  }

  async createCollection(
    context: AuthContext,
    data: { slug: string; title: string; description?: string | undefined },
    requestId: string,
  ) {
    return this.transaction(async (client) => {
      await this.role(client, context, null, ['PUBLISHER']);
      const result = await client.query<{ id: string }>(
        `INSERT INTO app."Collection" (id,"libraryId",slug,title,description)
        VALUES ($1,(SELECT id FROM app."Library" WHERE slug='arata-techlibrary'),$2,$3,$4) RETURNING id`,
        [randomUUID(), data.slug, data.title, data.description ?? null],
      );
      await this.audit(
        client,
        context,
        'studio.collection_created',
        'Collection',
        result.rows[0]!.id,
        requestId,
      );
      return result.rows[0];
    });
  }

  async createPublication(
    context: AuthContext,
    data: {
      slug: string;
      title: string;
      kind: 'STANDALONE' | 'SERIES';
      collectionId?: string | undefined;
      languageCode: string;
      licenceCode: string;
      sourceRef: string;
      copyrightNotice: string;
      description?: string | undefined;
    },
    requestId: string,
  ) {
    return this.transaction(async (client) => {
      await this.role(client, context, null, ['AUTHOR', 'PUBLISHER']);
      if (data.collectionId) {
        const collection = await client.query(`SELECT 1 FROM app."Collection" WHERE id=$1`, [
          data.collectionId,
        ]);
        if (!collection.rowCount) throw new HttpException('Collection not found', 404);
      }
      const id = randomUUID();
      await client.query(
        `INSERT INTO app."Publication" (id,slug,title,kind,status,"ownerId","languageCode","licenceCode","sourceRef","copyrightNotice",description,"createdAt","updatedAt")
        VALUES ($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8,$9,$10,now(),now())`,
        [
          id,
          data.slug,
          data.title,
          data.kind,
          context.user.id,
          data.languageCode,
          data.licenceCode,
          data.sourceRef,
          data.copyrightNotice,
          data.description ?? null,
        ],
      );
      if (data.collectionId)
        await client.query(
          `INSERT INTO app."PublicationCollection" ("publicationId","collectionId") VALUES ($1,$2)`,
          [id, data.collectionId],
        );
      const authorRole = await client.query<{ id: string }>(
        `SELECT id FROM app."Role" WHERE code='AUTHOR'`,
      );
      if (authorRole.rows[0])
        await client.query(
          `INSERT INTO app."RoleAssignment" (id,"userId","roleId","scopeType","scopeId") VALUES ($1,$2,$3,'PUBLICATION',$4)`,
          [randomUUID(), context.user.id, authorRole.rows[0].id, id],
        );
      await this.audit(client, context, 'studio.publication_created', 'Publication', id, requestId);
      return { id };
    });
  }

  async replaceCollections(
    context: AuthContext,
    publicationId: string,
    collectionIds: string[],
    requestId: string,
  ) {
    return this.transaction(async (client) => {
      await this.role(client, context, publicationId, ['AUTHOR', 'EDITOR', 'PUBLISHER']);
      const publication = await client.query<{ status: string }>(
        `SELECT status FROM app."Publication" WHERE id=$1 FOR UPDATE`,
        [publicationId],
      );
      if (!publication.rowCount) throw new HttpException('Publication not found', 404);
      if (publication.rows[0]!.status !== 'DRAFT')
        await this.role(client, context, publicationId, ['PUBLISHER']);
      const matches = await client.query<{ id: string }>(
        `SELECT id FROM app."Collection" WHERE id=ANY($1::uuid[]) AND "libraryId"=(SELECT id FROM app."Library" WHERE slug='arata-techlibrary')`,
        [collectionIds],
      );
      if (matches.rowCount !== collectionIds.length)
        throw new HttpException('Collection outside this library or not found', 400);
      await client.query(`DELETE FROM app."PublicationCollection" WHERE "publicationId"=$1`, [
        publicationId,
      ]);
      for (const collectionId of collectionIds)
        await client.query(
          `INSERT INTO app."PublicationCollection" ("publicationId","collectionId") VALUES ($1,$2)`,
          [publicationId, collectionId],
        );
      await this.audit(
        client,
        context,
        'studio.publication_collections_replaced',
        'Publication',
        publicationId,
        requestId,
      );
      return { id: publicationId, collectionIds };
    });
  }

  async updatePublication(
    context: AuthContext,
    id: string,
    data: {
      title?: string | undefined;
      subtitle?: string | null | undefined;
      description?: string | null | undefined;
      languageCode?: string | undefined;
      licenceCode?: string | undefined;
      sourceRef?: string | undefined;
      copyrightNotice?: string | undefined;
    },
    requestId: string,
  ) {
    return this.transaction(async (client) => {
      await this.role(client, context, id, ['AUTHOR', 'EDITOR', 'PUBLISHER']);
      const record = await client.query<{ status: string }>(
        `SELECT status FROM app."Publication" WHERE id=$1 FOR UPDATE`,
        [id],
      );
      if (!record.rows[0]) throw new HttpException('Publication not found', 404);
      if (record.rows[0].status !== 'DRAFT' && record.rows[0].status !== 'FORTHCOMING')
        throw new HttpException('Published metadata requires a new edition or revision', 409);
      if (
        (
          await client.query(
            `SELECT 1 FROM app."Edition" e JOIN app."Revision" r ON r."editionId"=e.id WHERE e."publicationId"=$1 AND r.status IN ('IN_REVIEW','APPROVED','PUBLISHED') LIMIT 1`,
            [id],
          )
        ).rowCount
      )
        throw new HttpException('Publication has a frozen revision', 409);
      await client.query(
        `UPDATE app."Publication" SET title=COALESCE($2,title),subtitle=COALESCE($3,subtitle),description=COALESCE($4,description),"languageCode"=COALESCE($5,"languageCode"),"licenceCode"=COALESCE($6,"licenceCode"),"sourceRef"=COALESCE($7,"sourceRef"),"copyrightNotice"=COALESCE($8,"copyrightNotice"),"updatedAt"=now() WHERE id=$1`,
        [
          id,
          data.title ?? null,
          data.subtitle ?? null,
          data.description ?? null,
          data.languageCode ?? null,
          data.licenceCode ?? null,
          data.sourceRef ?? null,
          data.copyrightNotice ?? null,
        ],
      );
      await this.audit(client, context, 'studio.publication_updated', 'Publication', id, requestId);
      return { id };
    });
  }

  async addContributor(
    context: AuthContext,
    publicationId: string,
    data: { displayName: string; slug: string; role: string; ordinal: number },
    requestId: string,
  ) {
    return this.transaction(async (client) => {
      await this.role(client, context, publicationId, ['AUTHOR', 'EDITOR', 'PUBLISHER']);
      const pub = await client.query<{ status: string }>(
        `SELECT status FROM app."Publication" WHERE id=$1 FOR UPDATE`,
        [publicationId],
      );
      if (pub.rows[0]?.status !== 'DRAFT' && pub.rows[0]?.status !== 'FORTHCOMING')
        throw new HttpException('Published credit changes require a new edition', 409);
      if (
        (
          await client.query(
            `SELECT 1 FROM app."Edition" e JOIN app."Revision" r ON r."editionId"=e.id WHERE e."publicationId"=$1 AND r.status IN ('IN_REVIEW','APPROVED','PUBLISHED') LIMIT 1`,
            [publicationId],
          )
        ).rowCount
      )
        throw new HttpException('Publication has a frozen revision', 409);
      const contributor = await client.query<{ id: string }>(
        `INSERT INTO app."Contributor" (id,"displayName",slug) VALUES ($1,$2,$3) ON CONFLICT (slug) DO UPDATE SET "displayName"=EXCLUDED."displayName" RETURNING id`,
        [randomUUID(), data.displayName, data.slug],
      );
      await client.query(
        `INSERT INTO app."PublicationContributor" ("publicationId","contributorId",role,ordinal) VALUES ($1,$2,$3,$4)`,
        [publicationId, contributor.rows[0]!.id, data.role, data.ordinal],
      );
      await this.audit(
        client,
        context,
        'studio.contributor_added',
        'Publication',
        publicationId,
        requestId,
      );
      return contributor.rows[0];
    });
  }

  async addVolume(
    context: AuthContext,
    publicationId: string,
    data: { ordinal: number; title: string },
    requestId: string,
  ) {
    return this.transaction(async (client) => {
      await this.role(client, context, publicationId, ['AUTHOR', 'EDITOR', 'PUBLISHER']);
      const pub = await client.query<{ kind: string }>(
        `SELECT kind FROM app."Publication" WHERE id=$1 FOR UPDATE`,
        [publicationId],
      );
      if (pub.rows[0]?.kind !== 'SERIES') throw new HttpException('Volumes require a series', 409);
      const id = randomUUID();
      await client.query(
        `INSERT INTO app."Volume" (id,"publicationId",ordinal,title) VALUES ($1,$2,$3,$4)`,
        [id, publicationId, data.ordinal, data.title],
      );
      await this.audit(client, context, 'studio.volume_created', 'Volume', id, requestId);
      return { id };
    });
  }

  async reorderVolumes(
    context: AuthContext,
    publicationId: string,
    ids: string[],
    expectedIds: string[],
    requestId: string,
  ) {
    return this.transaction(async (client) => {
      await this.role(client, context, publicationId, ['AUTHOR', 'EDITOR', 'PUBLISHER']);
      const publication = await client.query<{ kind: string }>(
        `SELECT kind FROM app."Publication" WHERE id=$1 FOR UPDATE`,
        [publicationId],
      );
      if (!publication.rows[0]) throw new HttpException('Publication not found', 404);
      if (publication.rows[0].kind !== 'SERIES')
        throw new HttpException('Volumes require a series', 409);
      const released = await client.query(
        `SELECT 1 FROM app."Edition" e JOIN app."Revision" r ON r."editionId"=e.id
         WHERE e."publicationId"=$1 AND r.status IN ('IN_REVIEW','APPROVED','PUBLISHED') LIMIT 1`,
        [publicationId],
      );
      if (released.rowCount)
        throw new HttpException('Reviewed volume order cannot be changed', 409);
      await this.reorderSiblings(
        client,
        'Volume',
        'publicationId',
        publicationId,
        ids,
        expectedIds,
      );
      await this.audit(
        client,
        context,
        'studio.volumes_reordered',
        'Publication',
        publicationId,
        requestId,
      );
      return { ids };
    });
  }

  async addEdition(
    context: AuthContext,
    publicationId: string,
    data: {
      volumeId?: string | null | undefined;
      editionCode: string;
      label: string;
      isbn13?: string | undefined;
      isDefault?: boolean | undefined;
    },
    requestId: string,
  ) {
    return this.transaction(async (client) => {
      await this.role(client, context, publicationId, ['AUTHOR', 'EDITOR', 'PUBLISHER']);
      const pub = await client.query<{ kind: string }>(
        `SELECT kind FROM app."Publication" WHERE id=$1 FOR UPDATE`,
        [publicationId],
      );
      if (!pub.rows[0]) throw new HttpException('Publication not found', 404);
      if ((pub.rows[0].kind === 'SERIES') !== !!data.volumeId)
        throw new HttpException('Edition volume does not match publication kind', 409);
      if (data.isDefault)
        await client.query(
          `UPDATE app."Edition" SET "isDefault"=false WHERE "publicationId"=$1 AND "volumeId" IS NOT DISTINCT FROM $2::uuid`,
          [publicationId, data.volumeId ?? null],
        );
      const ordinal = Number(
        (
          await client.query<{ ordinal: number }>(
            `SELECT COALESCE(MAX(ordinal),0)+1 AS ordinal FROM app."Edition"
         WHERE "publicationId"=$1 AND "volumeId" IS NOT DISTINCT FROM $2::uuid`,
            [publicationId, data.volumeId ?? null],
          )
        ).rows[0]!.ordinal,
      );
      const id = randomUUID();
      await client.query(
        `INSERT INTO app."Edition" (id,"publicationId","volumeId",ordinal,"editionCode",label,isbn13,"isDefault") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          publicationId,
          data.volumeId ?? null,
          ordinal,
          data.editionCode,
          data.label,
          data.isbn13 ?? null,
          data.isDefault ?? false,
        ],
      );
      await this.audit(client, context, 'studio.edition_created', 'Edition', id, requestId);
      return { id };
    });
  }

  async reorderEditions(
    context: AuthContext,
    publicationId: string,
    volumeId: string | null,
    ids: string[],
    expectedIds: string[],
    requestId: string,
  ) {
    return this.transaction(async (client) => {
      await this.role(client, context, publicationId, ['AUTHOR', 'EDITOR', 'PUBLISHER']);
      const publication = await client.query<{ kind: string }>(
        `SELECT kind FROM app."Publication" WHERE id=$1 FOR UPDATE`,
        [publicationId],
      );
      if (!publication.rows[0]) throw new HttpException('Publication not found', 404);
      if ((publication.rows[0].kind === 'SERIES') !== !!volumeId)
        throw new HttpException('Edition scope does not match publication kind', 409);
      if (volumeId) {
        const volume = await client.query(
          `SELECT 1 FROM app."Volume" WHERE id=$1 AND "publicationId"=$2`,
          [volumeId, publicationId],
        );
        if (!volume.rowCount) throw new HttpException('Volume outside this publication', 404);
      }
      const current = (
        await client.query<{ id: string; ordinal: number }>(
          `SELECT id,ordinal FROM app."Edition" WHERE "publicationId"=$1
         AND "volumeId" IS NOT DISTINCT FROM $2::uuid ORDER BY ordinal,id FOR UPDATE`,
          [publicationId, volumeId],
        )
      ).rows;
      if (
        current.length !== expectedIds.length ||
        current.some((row, index) => row.id !== expectedIds[index])
      )
        throw new HttpException('Order changed; reload the hierarchy and retry', 409);
      if (current.length !== ids.length || ids.some((id) => !current.some((row) => row.id === id)))
        throw new HttpException('Order must include exactly the current editions', 409);
      const frozen = await client.query(
        `SELECT 1 FROM app."Revision" r JOIN app."Edition" e ON e.id=r."editionId"
         WHERE e."publicationId"=$1 AND e."volumeId" IS NOT DISTINCT FROM $2::uuid
         AND r.status IN ('IN_REVIEW','APPROVED','PUBLISHED') LIMIT 1`,
        [publicationId, volumeId],
      );
      if (frozen.rowCount) throw new HttpException('Reviewed edition order cannot be changed', 409);
      if (ids.some((id, index) => id !== current[index]?.id)) {
        const maxOrdinal = Math.max(0, ...current.map((row) => row.ordinal));
        if (maxOrdinal > 1_000_000_000)
          throw new HttpException('Order exceeds the supported range', 409);
        await client.query(
          `UPDATE app."Edition" SET ordinal=ordinal+$3 WHERE "publicationId"=$1
           AND "volumeId" IS NOT DISTINCT FROM $2::uuid`,
          [publicationId, volumeId, maxOrdinal + 1],
        );
        for (const [index, id] of ids.entries())
          await client.query(`UPDATE app."Edition" SET ordinal=$2 WHERE id=$1`, [id, index + 1]);
      }
      await this.audit(
        client,
        context,
        'studio.editions_reordered',
        'Publication',
        publicationId,
        requestId,
      );
      return { ids };
    });
  }

  async addRevision(
    context: AuthContext,
    editionId: string,
    data: { changeSummary: string; fromRevisionId?: string | undefined },
    requestId: string,
  ) {
    return this.transaction(async (client) => {
      const publicationId = await this.editionPublication(client, editionId);
      await this.role(client, context, publicationId, ['AUTHOR', 'EDITOR', 'PUBLISHER']);
      await client.query(`SELECT id FROM app."Edition" WHERE id=$1 FOR UPDATE`, [editionId]);
      const id = randomUUID();
      const number = Number(
        (
          await client.query<{ number: number }>(
            `SELECT COALESCE(MAX(number),0)+1 AS number FROM app."Revision" WHERE "editionId"=$1`,
            [editionId],
          )
        ).rows[0]!.number,
      );
      if (data.fromRevisionId) {
        const source = await this.revision(client, data.fromRevisionId);
        if (source.editionId !== editionId || source.status !== 'PUBLISHED')
          throw new HttpException('Clone source must be a published revision of this edition', 409);
      }
      await client.query(
        `INSERT INTO app."Revision" (id,"editionId",number,status,"changeSummary","createdById") VALUES ($1,$2,$3,'DRAFT',$4,$5)`,
        [id, editionId, number, data.changeSummary, context.user.id],
      );
      if (data.fromRevisionId) {
        const chapterIds = new Map<string, string>();
        const lessonIds = new Map<string, string>();
        const resourceIds = new Map<string, string>();
        const oldChapters = await client.query<{
          id: string;
          ordinal: number;
          slug: string;
          title: string;
          previewText: string | null;
          summary: string | null;
          learningOutcomes: string[];
          prerequisites: string[];
        }>(
          `SELECT id,ordinal,slug,title,"previewText",summary,"learningOutcomes",prerequisites FROM app."Chapter" WHERE "revisionId"=$1 ORDER BY ordinal`,
          [data.fromRevisionId],
        );
        for (const chapter of oldChapters.rows) {
          const chapterId = randomUUID();
          chapterIds.set(chapter.id, chapterId);
          await client.query(
            `INSERT INTO app."Chapter" (id,"revisionId",ordinal,slug,title,"previewText",summary,"learningOutcomes",prerequisites) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              chapterId,
              id,
              chapter.ordinal,
              chapter.slug,
              chapter.title,
              chapter.previewText,
              chapter.summary,
              chapter.learningOutcomes,
              chapter.prerequisites,
            ],
          );
          const lessons = await client.query<{ id: string }>(
            `SELECT id FROM app."Lesson" WHERE "chapterId"=$1 ORDER BY ordinal`,
            [chapter.id],
          );
          for (const lesson of lessons.rows) {
            const lessonId = randomUUID();
            lessonIds.set(lesson.id, lessonId);
            await client.query(
              `INSERT INTO app."Lesson" (id,"chapterId",ordinal,title,"bodyMarkdown",blocks,"bodyAssetId","contentHash") SELECT $1,$2,ordinal,title,"bodyMarkdown",blocks,"bodyAssetId","contentHash" FROM app."Lesson" WHERE id=$3`,
              [lessonId, chapterId, lesson.id],
            );
          }
        }
        await client.query(
          `INSERT INTO app."BibliographyEntry" (id,"revisionId","citationKey","citationText",url,ordinal) SELECT gen_random_uuid(),$1,"citationKey","citationText",url,ordinal FROM app."BibliographyEntry" WHERE "revisionId"=$2`,
          [id, data.fromRevisionId],
        );
        const references = await client.query<{
          sourceLessonId: string;
          targetPublicationId: string | null;
          targetChapterId: string | null;
          targetLessonId: string | null;
          label: string;
        }>(
          `SELECT x."sourceLessonId",x."targetPublicationId",x."targetChapterId",x."targetLessonId",x.label FROM app."CrossReference" x JOIN app."Lesson" l ON l.id=x."sourceLessonId" JOIN app."Chapter" c ON c.id=l."chapterId" WHERE c."revisionId"=$1`,
          [data.fromRevisionId],
        );
        for (const reference of references.rows)
          await client.query(
            `INSERT INTO app."CrossReference" (id,"sourceLessonId","targetPublicationId","targetChapterId","targetLessonId",label) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5)`,
            [
              lessonIds.get(reference.sourceLessonId),
              reference.targetPublicationId,
              reference.targetChapterId
                ? (chapterIds.get(reference.targetChapterId) ?? reference.targetChapterId)
                : null,
              reference.targetLessonId
                ? (lessonIds.get(reference.targetLessonId) ?? reference.targetLessonId)
                : null,
              reference.label,
            ],
          );
        const resources = await client.query<{
          id: string;
          chapterId: string | null;
          lessonId: string | null;
        }>(
          `SELECT id,"chapterId","lessonId" FROM app."Resource" WHERE "revisionId"=$1 ORDER BY id`,
          [data.fromRevisionId],
        );
        for (const resource of resources.rows) {
          const resourceId = randomUUID();
          resourceIds.set(resource.id, resourceId);
          await client.query(
            `INSERT INTO app."Resource" (id,title,description,format,"bodyText",attribution,"copyrightNotice","accessClass","licenceCode","publishedAt","withdrawnAt","publicationId","volumeId","editionId","revisionId","chapterId","lessonId") SELECT $1,title,description,format,"bodyText",attribution,"copyrightNotice","accessClass","licenceCode","publishedAt","withdrawnAt","publicationId","volumeId","editionId",$2,$3,$4 FROM app."Resource" WHERE id=$5`,
            [
              resourceId,
              id,
              resource.chapterId
                ? (chapterIds.get(resource.chapterId) ?? resource.chapterId)
                : null,
              resource.lessonId ? (lessonIds.get(resource.lessonId) ?? resource.lessonId) : null,
              resource.id,
            ],
          );
          await client.query(
            `INSERT INTO app."ResourceAttachment" ("resourceId","assetId",ordinal) SELECT $1,"assetId",ordinal FROM app."ResourceAttachment" WHERE "resourceId"=$2`,
            [resourceId, resource.id],
          );
        }
        const policies = await client.query<{
          id: string;
          revisionId: string | null;
          chapterId: string | null;
          lessonId: string | null;
          resourceId: string | null;
        }>(
          `SELECT id,"revisionId","chapterId","lessonId","resourceId" FROM app."ContentPolicy" WHERE "revisionId"=$1 OR "chapterId"=ANY($2::uuid[]) OR "lessonId"=ANY($3::uuid[]) OR "resourceId"=ANY($4::uuid[])`,
          [
            data.fromRevisionId,
            [...chapterIds.keys()],
            [...lessonIds.keys()],
            [...resourceIds.keys()],
          ],
        );
        for (const policy of policies.rows)
          await client.query(
            `INSERT INTO app."ContentPolicy" (id,"publicationId","volumeId","editionId","revisionId","chapterId","lessonId","resourceId","accessClass","allowRead","allowDownload","allowCopy","allowPrint","allowOffline","allowShare",watermark,version,"isActive","approvedAt") SELECT gen_random_uuid(),"publicationId","volumeId","editionId",$1,$2,$3,$4,"accessClass","allowRead","allowDownload","allowCopy","allowPrint","allowOffline","allowShare",watermark,version,"isActive","approvedAt" FROM app."ContentPolicy" WHERE id=$5`,
            [
              policy.revisionId ? id : null,
              policy.chapterId ? (chapterIds.get(policy.chapterId) ?? policy.chapterId) : null,
              policy.lessonId ? (lessonIds.get(policy.lessonId) ?? policy.lessonId) : null,
              policy.resourceId ? (resourceIds.get(policy.resourceId) ?? policy.resourceId) : null,
              policy.id,
            ],
          );
      }
      await this.audit(
        client,
        context,
        data.fromRevisionId ? 'studio.revision_cloned' : 'studio.revision_created',
        'Revision',
        id,
        requestId,
      );
      return { id, number };
    });
  }

  async addChapter(
    context: AuthContext,
    revisionId: string,
    data: {
      ordinal: number;
      slug: string;
      title: string;
      previewText?: string | undefined;
      summary?: string | undefined;
      learningOutcomes?: string[] | undefined;
      prerequisites?: string[] | undefined;
    },
    requestId: string,
  ) {
    return this.transaction(async (client) => {
      const revision = await this.revision(client, revisionId, true);
      await this.role(client, context, revision.publicationId, ['AUTHOR', 'EDITOR']);
      if (revision.status !== 'DRAFT')
        throw new HttpException('Only draft revisions can be edited', 409);
      const id = randomUUID();
      await client.query(
        `INSERT INTO app."Chapter" (id,"revisionId",ordinal,slug,title,"previewText",summary,"learningOutcomes",prerequisites) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          id,
          revisionId,
          data.ordinal,
          data.slug,
          data.title,
          data.previewText ?? null,
          data.summary ?? null,
          data.learningOutcomes ?? [],
          data.prerequisites ?? [],
        ],
      );
      await this.audit(client, context, 'studio.chapter_created', 'Chapter', id, requestId);
      return { id };
    });
  }

  async reorderChapters(
    context: AuthContext,
    revisionId: string,
    ids: string[],
    expectedIds: string[],
    requestId: string,
  ) {
    return this.transaction(async (client) => {
      const revision = await this.revision(client, revisionId, true);
      await this.role(client, context, revision.publicationId, ['AUTHOR', 'EDITOR']);
      if (revision.status !== 'DRAFT')
        throw new HttpException('Only draft revisions can be edited', 409);
      await this.reorderSiblings(client, 'Chapter', 'revisionId', revisionId, ids, expectedIds);
      await this.audit(
        client,
        context,
        'studio.chapters_reordered',
        'Revision',
        revisionId,
        requestId,
      );
      return { ids };
    });
  }

  async addLesson(
    context: AuthContext,
    chapterId: string,
    data: { ordinal: number; title: string; bodyMarkdown?: string | undefined; blocks?: unknown },
    requestId: string,
  ) {
    return this.transaction(async (client) => {
      const revision = await this.revision(
        client,
        await this.chapterRevision(client, chapterId),
        true,
      );
      await this.role(client, context, revision.publicationId, ['AUTHOR', 'EDITOR']);
      if (revision.status !== 'DRAFT')
        throw new HttpException('Only draft revisions can be edited', 409);
      const id = randomUUID();
      await client.query(
        `INSERT INTO app."Lesson" (id,"chapterId",ordinal,title,"bodyMarkdown",blocks,"contentHash") VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          id,
          chapterId,
          data.ordinal,
          data.title,
          data.bodyMarkdown ?? null,
          data.blocks === undefined ? null : JSON.stringify(data.blocks),
          hash({ markdown: data.bodyMarkdown ?? null, blocks: data.blocks ?? null }),
        ],
      );
      await this.audit(client, context, 'studio.lesson_created', 'Lesson', id, requestId);
      return { id };
    });
  }

  async reorderLessons(
    context: AuthContext,
    chapterId: string,
    ids: string[],
    expectedIds: string[],
    requestId: string,
  ) {
    return this.transaction(async (client) => {
      const revision = await this.revision(
        client,
        await this.chapterRevision(client, chapterId),
        true,
      );
      await this.role(client, context, revision.publicationId, ['AUTHOR', 'EDITOR']);
      if (revision.status !== 'DRAFT')
        throw new HttpException('Only draft revisions can be edited', 409);
      await this.reorderSiblings(client, 'Lesson', 'chapterId', chapterId, ids, expectedIds);
      await this.audit(
        client,
        context,
        'studio.lessons_reordered',
        'Chapter',
        chapterId,
        requestId,
      );
      return { ids };
    });
  }

  async updateLesson(
    context: AuthContext,
    lessonId: string,
    data: { title: string; bodyMarkdown?: string | undefined; blocks?: unknown },
    requestId: string,
  ) {
    return this.transaction(async (client) => {
      const revision = await this.revision(
        client,
        await this.lessonRevision(client, lessonId),
        true,
      );
      await this.role(client, context, revision.publicationId, ['AUTHOR', 'EDITOR']);
      if (revision.status !== 'DRAFT')
        throw new HttpException('Only draft revisions can be edited', 409);
      await client.query(
        `UPDATE app."Lesson" SET title=$2,"bodyMarkdown"=$3,blocks=$4,"contentHash"=$5,"updatedAt"=now() WHERE id=$1`,
        [
          lessonId,
          data.title,
          data.bodyMarkdown ?? null,
          data.blocks === undefined ? null : JSON.stringify(data.blocks),
          hash({ markdown: data.bodyMarkdown ?? null, blocks: data.blocks ?? null }),
        ],
      );
      await this.audit(client, context, 'studio.lesson_updated', 'Lesson', lessonId, requestId);
      return { id: lessonId };
    });
  }

  async addBibliography(
    context: AuthContext,
    revisionId: string,
    data: { citationKey: string; citationText: string; url?: string | undefined; ordinal: number },
    requestId: string,
  ) {
    return this.transaction(async (client) => {
      const revision = await this.revision(client, revisionId, true);
      await this.role(client, context, revision.publicationId, ['AUTHOR', 'EDITOR']);
      if (revision.status !== 'DRAFT')
        throw new HttpException('Only draft revisions can be edited', 409);
      const id = randomUUID();
      await client.query(
        `INSERT INTO app."BibliographyEntry" (id,"revisionId","citationKey","citationText",url,ordinal) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, revisionId, data.citationKey, data.citationText, data.url ?? null, data.ordinal],
      );
      await this.audit(
        client,
        context,
        'studio.bibliography_added',
        'BibliographyEntry',
        id,
        requestId,
      );
      return { id };
    });
  }

  async addReference(
    context: AuthContext,
    lessonId: string,
    data: {
      label: string;
      targetPublicationId?: string | undefined;
      targetChapterId?: string | undefined;
      targetLessonId?: string | undefined;
    },
    requestId: string,
  ) {
    return this.transaction(async (client) => {
      const revision = await this.revision(
        client,
        await this.lessonRevision(client, lessonId),
        true,
      );
      await this.role(client, context, revision.publicationId, ['AUTHOR', 'EDITOR']);
      if (revision.status !== 'DRAFT')
        throw new HttpException('Only draft revisions can be edited', 409);
      const id = randomUUID();
      await client.query(
        `INSERT INTO app."CrossReference" (id,"sourceLessonId","targetPublicationId","targetChapterId","targetLessonId",label) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          id,
          lessonId,
          data.targetPublicationId ?? null,
          data.targetChapterId ?? null,
          data.targetLessonId ?? null,
          data.label,
        ],
      );
      await this.audit(
        client,
        context,
        'studio.cross_reference_added',
        'CrossReference',
        id,
        requestId,
      );
      return { id };
    });
  }

  async addResource(
    context: AuthContext,
    revisionId: string,
    data: {
      title: string;
      description?: string | undefined;
      format: string;
      bodyText?: string | undefined;
      assetId?: string | undefined;
      accessClass: 'PUBLIC_FREE' | 'REGISTERED_FREE' | 'PREMIUM' | 'RESTRICTED';
      licenceCode: string;
      attribution: string;
      copyrightNotice: string;
    },
    requestId: string,
  ) {
    return this.transaction(async (client) => {
      const revision = await this.revision(client, revisionId, true);
      await this.role(client, context, revision.publicationId, ['AUTHOR', 'EDITOR']);
      if (revision.status !== 'DRAFT')
        throw new HttpException('Only draft revisions can be edited', 409);
      if (!data.bodyText && !data.assetId)
        throw new HttpException('Text or approved asset required', 400);
      if (data.assetId) {
        const asset = await client.query(
          `SELECT 1 FROM app."Asset" a JOIN app."UploadSession" u ON u."assetId"=a.id WHERE a.id=$1 AND a.status='APPROVED' AND u."publicationId"=$2`,
          [data.assetId, revision.publicationId],
        );
        if (!asset.rowCount)
          throw new HttpException('Approved asset from this publication required', 409);
      }
      const id = randomUUID();
      await client.query(
        `INSERT INTO app."Resource" (id,title,description,format,"bodyText",attribution,"copyrightNotice","accessClass","licenceCode","revisionId","publishedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`,
        [
          id,
          data.title,
          data.description ?? null,
          data.format,
          data.bodyText ?? null,
          data.attribution,
          data.copyrightNotice,
          data.accessClass,
          data.licenceCode,
          revisionId,
        ],
      );
      if (data.assetId)
        await client.query(
          `INSERT INTO app."ResourceAttachment" ("resourceId","assetId",ordinal) VALUES ($1,$2,0)`,
          [id, data.assetId],
        );
      await client.query(
        `INSERT INTO app."ContentPolicy" (id,"resourceId","accessClass","allowRead","allowDownload",version,"isActive","approvedAt") VALUES (gen_random_uuid(),$1,$2,$3,false,1,true,now())`,
        [id, data.accessClass, data.accessClass !== 'RESTRICTED'],
      );
      await this.audit(client, context, 'studio.resource_created', 'Resource', id, requestId);
      return { id };
    });
  }

  async submit(context: AuthContext, revisionId: string, requestId: string) {
    return this.transaction(async (client) => {
      const revision = await this.revision(client, revisionId, true);
      await this.role(client, context, revision.publicationId, ['AUTHOR', 'EDITOR']);
      if (revision.status !== 'DRAFT') throw new HttpException('Only drafts may be submitted', 409);
      const chapterCount = (
        await client.query<{ count: string }>(
          `SELECT count(*) FROM app."Chapter" WHERE "revisionId"=$1`,
          [revisionId],
        )
      ).rows[0]!.count;
      if (Number(chapterCount) === 0)
        throw new HttpException('Add at least one chapter before review', 409);
      const manifestHash = await this.manifest(client, revisionId);
      await client.query(
        `UPDATE app."Revision" SET status='IN_REVIEW',"manifestHash"=$2,"submittedAt"=now() WHERE id=$1`,
        [revisionId, manifestHash],
      );
      await this.audit(
        client,
        context,
        'studio.revision_submitted',
        'Revision',
        revisionId,
        requestId,
      );
      return { id: revisionId, status: 'IN_REVIEW', manifestHash };
    });
  }

  async review(
    context: AuthContext,
    revisionId: string,
    data: { decision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED'; comment: string },
    requestId: string,
  ) {
    return this.transaction(async (client) => {
      const revision = await this.revision(client, revisionId, true);
      await this.role(client, context, revision.publicationId, ['EDITOR']);
      if (revision.status !== 'IN_REVIEW')
        throw new HttpException('Revision is not under review', 409);
      if (revision.createdById === context.user.id)
        throw new HttpException('A different editor must review this revision', 403);
      if (revision.manifestHash !== (await this.manifest(client, revisionId)))
        throw new HttpException('Review manifest no longer matches content', 409);
      await client.query(
        `INSERT INTO app."EditorialReview" (id,"revisionId","reviewerId",decision,"manifestHash",comment) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          randomUUID(),
          revisionId,
          context.user.id,
          data.decision,
          revision.manifestHash,
          data.comment,
        ],
      );
      const status =
        data.decision === 'APPROVED'
          ? 'APPROVED'
          : data.decision === 'REJECTED'
            ? 'REJECTED'
            : 'DRAFT';
      await client.query(`UPDATE app."Revision" SET status=$2 WHERE id=$1`, [revisionId, status]);
      await this.audit(
        client,
        context,
        'studio.revision_reviewed',
        'Revision',
        revisionId,
        requestId,
        data.decision,
      );
      return { id: revisionId, status };
    });
  }

  async attestRights(
    context: AuthContext,
    revisionId: string,
    data: { licenceCode: string; sourceRef: string },
    requestId: string,
  ) {
    return this.transaction(async (client) => {
      const revision = await this.revision(client, revisionId, true);
      await this.role(client, context, revision.publicationId, ['EDITOR', 'PUBLISHER']);
      if (revision.status !== 'APPROVED' || !revision.manifestHash)
        throw new HttpException('Approved exact revision required', 409);
      if (revision.manifestHash !== (await this.manifest(client, revisionId)))
        throw new HttpException('Rights manifest mismatch', 409);
      const pub = (
        await client.query<{ licenceCode: string | null; sourceRef: string | null }>(
          `SELECT "licenceCode","sourceRef" FROM app."Publication" WHERE id=$1`,
          [revision.publicationId],
        )
      ).rows[0]!;
      if (pub.licenceCode !== data.licenceCode || pub.sourceRef !== data.sourceRef)
        throw new HttpException('Rights evidence must match publication metadata', 409);
      const id = randomUUID();
      await client.query(
        `INSERT INTO app."RightsAttestation" (id,"publicationId","revisionId","actorId","manifestHash","licenceCode","sourceRef") VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          id,
          revision.publicationId,
          revisionId,
          context.user.id,
          revision.manifestHash,
          data.licenceCode,
          data.sourceRef,
        ],
      );
      await this.audit(
        client,
        context,
        'studio.rights_attested',
        'RightsAttestation',
        id,
        requestId,
      );
      return { id };
    });
  }

  async publish(context: AuthContext, revisionId: string, requestId: string) {
    return this.transaction(async (client) => {
      const revision = await this.revision(client, revisionId, true);
      await this.role(client, context, revision.publicationId, ['PUBLISHER']);
      if (
        revision.status !== 'APPROVED' ||
        revision.manifestHash !== (await this.manifest(client, revisionId))
      )
        throw new HttpException('Approved exact content manifest required', 409);
      await client.query(
        `UPDATE app."Revision" SET status='PUBLISHED',"publishedAt"=now(),"publishedById"=$2 WHERE id=$1`,
        [revisionId, context.user.id],
      );
      await client.query(`UPDATE app."Edition" SET "currentRevisionId"=$2 WHERE id=$1`, [
        revision.editionId,
        revisionId,
      ]);
      await client.query(
        `UPDATE app."Publication" SET status='PUBLISHED',"updatedAt"=now() WHERE id=$1`,
        [revision.publicationId],
      );
      await this.audit(
        client,
        context,
        'studio.revision_published',
        'Revision',
        revisionId,
        requestId,
      );
      return { id: revisionId, status: 'PUBLISHED' };
    });
  }

  async schedule(
    context: AuthContext,
    revisionId: string,
    at: string,
    reason: string,
    requestId: string,
  ) {
    return this.transaction(async (client) => {
      const revision = await this.revision(client, revisionId, true);
      await this.role(client, context, revision.publicationId, ['PUBLISHER']);
      if (
        revision.status !== 'APPROVED' ||
        revision.manifestHash !== (await this.manifest(client, revisionId))
      )
        throw new HttpException('Approved exact content required', 409);
      const id = randomUUID();
      await client.query(
        `INSERT INTO app."PublicationSchedule" (id,"publicationId","revisionId","requestedById",action,"scheduledAt",reason) VALUES ($1,$2,$3,$4,'PUBLISH',$5,$6)`,
        [id, revision.publicationId, revisionId, context.user.id, new Date(at), reason],
      );
      await this.audit(
        client,
        context,
        'studio.publish_scheduled',
        'PublicationSchedule',
        id,
        requestId,
        reason,
      );
      return { id, status: 'PENDING' };
    });
  }

  async withdraw(context: AuthContext, publicationId: string, reason: string, requestId: string) {
    return this.transaction(async (client) => {
      await this.role(client, context, publicationId, ['PUBLISHER']);
      const result = await client.query(
        `UPDATE app."Publication" SET status='WITHDRAWN',"updatedAt"=now() WHERE id=$1 AND status='PUBLISHED' RETURNING id`,
        [publicationId],
      );
      if (!result.rowCount) throw new HttpException('Published publication required', 409);
      await this.audit(
        client,
        context,
        'studio.publication_withdrawn',
        'Publication',
        publicationId,
        requestId,
        reason,
      );
      return { id: publicationId, status: 'WITHDRAWN' };
    });
  }

  async erratum(context: AuthContext, revisionId: string, notice: string, requestId: string) {
    return this.transaction(async (client) => {
      const revision = await this.revision(client, revisionId);
      await this.role(client, context, revision.publicationId, ['EDITOR', 'PUBLISHER']);
      if (revision.status !== 'PUBLISHED')
        throw new HttpException('Published revision required', 409);
      const id = randomUUID();
      await client.query(
        `INSERT INTO app."RevisionErratum" (id,"revisionId","authorId",notice) VALUES ($1,$2,$3,$4)`,
        [id, revisionId, context.user.id, notice],
      );
      await this.audit(client, context, 'studio.erratum_added', 'RevisionErratum', id, requestId);
      return { id };
    });
  }

  async compare(context: AuthContext, id: string, fromId: string) {
    return this.transaction(async (client) => {
      const target = await this.revision(client, id);
      const source = await this.revision(client, fromId);
      if (target.editionId !== source.editionId)
        throw new HttpException('Revisions must belong to the same edition', 409);
      await this.role(client, context, target.publicationId, ['AUTHOR', 'EDITOR', 'PUBLISHER']);
      const [before, after] = await Promise.all([
        this.manuscript(client, fromId),
        this.manuscript(client, id),
      ]);
      return { from: fromId, to: id, before, after };
    });
  }

  async exportRevision(context: AuthContext, id: string) {
    return this.transaction(async (client) => {
      const revision = await this.revision(client, id);
      await this.role(client, context, revision.publicationId, ['AUTHOR', 'EDITOR', 'PUBLISHER']);
      return {
        format: 'arata-revision-v1',
        revisionId: id,
        editionId: revision.editionId,
        manifest: await this.manifest(client, id),
        content: await this.manuscript(client, id),
      };
    });
  }
}
