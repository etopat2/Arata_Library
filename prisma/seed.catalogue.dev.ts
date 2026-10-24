import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import pg from 'pg';

if (process.env.ARATA_ENABLE_DEV_SEED !== '1')
  throw new Error('Explicit development seed opt-in required');
const local = dotenv.parse(readFileSync(process.env.ARATA_ENV_FILE ?? '.env.local', 'utf8'));
const url = process.env.MIGRATION_DATABASE_URL ?? local.MIGRATION_DATABASE_URL;
if (!url || new URL(url).pathname !== '/arata_techlibrary_dev')
  throw new Error('Refusing non-development database');
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  await client.query('BEGIN');
  const owner = await client.query<{ id: string }>(
    `SELECT id FROM app."User" WHERE email='dev-reader@example.invalid'`,
  );
  if (!owner.rows[0]) throw new Error('Run npm run db:seed:dev first');
  const userId = owner.rows[0].id;
  const collection = await client.query<{ id: string }>(
    `INSERT INTO app."Collection" (id,slug,title,description)
     VALUES (gen_random_uuid(),'dev-public-learning','[DEV SAMPLE] Web and software learning','Synthetic catalogue for local development only')
     ON CONFLICT (slug) DO UPDATE SET title=EXCLUDED.title RETURNING id`,
  );
  const author = await client.query<{ id: string }>(
    `INSERT INTO app."Contributor" (id,"displayName",slug,biography)
     VALUES (gen_random_uuid(),'[DEV SAMPLE] Arata Author','dev-sample-author','Fictional development contributor')
     ON CONFLICT (slug) DO UPDATE SET "displayName"=EXCLUDED."displayName" RETURNING id`,
  );
  for (const item of [
    {
      slug: 'dev-published-series',
      title: '[DEV SAMPLE] Web Engineering Series',
      kind: 'SERIES',
      access: 'PREMIUM',
      featured: true,
    },
    {
      slug: 'dev-standalone-book',
      title: '[DEV SAMPLE] Accessible Web Basics',
      kind: 'STANDALONE',
      access: 'PUBLIC_FREE',
      featured: false,
    },
  ] as const) {
    const existing = await client.query('SELECT id FROM app."Publication" WHERE slug=$1', [
      item.slug,
    ]);
    if (existing.rowCount) continue;
    const publication = await client.query<{ id: string }>(
      `INSERT INTO app."Publication" (id,slug,title,subtitle,description,subject,keywords,"licenceCode","featuredAt",kind,status,"ownerId","copyrightNotice","createdAt","updatedAt")
       VALUES (gen_random_uuid(),$1,$2,'Synthetic technology learning','[DEV SAMPLE] Fictional approved catalogue record for local UI and API testing.','Web development',ARRAY['web','accessibility','typescript']::text[],'DEV-SAMPLE',CASE WHEN $3 THEN now() ELSE NULL END,$4,'DRAFT',$5,'[DEV SAMPLE] No production rights implied.',now(),now()) RETURNING id`,
      [item.slug, item.title, item.featured, item.kind, userId],
    );
    const id = publication.rows[0]!.id;
    await client.query(
      `INSERT INTO app."PublicationCollection" ("publicationId","collectionId") VALUES ($1,$2)`,
      [id, collection.rows[0]!.id],
    );
    await client.query(
      `INSERT INTO app."PublicationContributor" ("publicationId","contributorId",role,ordinal) VALUES ($1,$2,'AUTHOR',0)`,
      [id, author.rows[0]!.id],
    );
    let volumeId: string | null = null;
    if (item.kind === 'SERIES') {
      const volume = await client.query<{ id: string }>(
        `INSERT INTO app."Volume" (id,"publicationId",ordinal,title) VALUES (gen_random_uuid(),$1,1,'[DEV SAMPLE] Volume One') RETURNING id`,
        [id],
      );
      volumeId = volume.rows[0]!.id;
    }
    const edition = await client.query<{ id: string }>(
      `INSERT INTO app."Edition" (id,"publicationId","volumeId","editionCode",label,"isDefault") VALUES (gen_random_uuid(),$1,$2,'DEV-1','[DEV SAMPLE] First edition',true) RETURNING id`,
      [id, volumeId],
    );
    const revision = await client.query<{ id: string }>(
      `INSERT INTO app."Revision" (id,"editionId",number,status,"manifestHash","changeSummary") VALUES (gen_random_uuid(),$1,1,'DRAFT',$2,'[DEV SAMPLE] Synthetic reviewed revision') RETURNING id`,
      [edition.rows[0]!.id, item.kind === 'SERIES' ? 'a'.repeat(64) : 'b'.repeat(64)],
    );
    const chapter = await client.query<{ id: string }>(
      `INSERT INTO app."Chapter" (id,"revisionId",ordinal,slug,title,"previewText") VALUES (gen_random_uuid(),$1,1,'sample-introduction','[DEV SAMPLE] Introduction','[DEV SAMPLE] This synthetic chapter preview contains no production manuscript.') RETURNING id`,
      [revision.rows[0]!.id],
    );
    await client.query(
      `INSERT INTO app."ContentPolicy" (id,"chapterId","accessClass","allowRead",version,"isActive","approvedAt") VALUES (gen_random_uuid(),$1,'PUBLIC_FREE',true,1,true,now())`,
      [chapter.rows[0]!.id],
    );
    await client.query(
      `INSERT INTO app."ContentPolicy" (id,"publicationId","accessClass","allowRead",version,"isActive","approvedAt") VALUES (gen_random_uuid(),$1,$2,true,1,true,now())`,
      [id, item.access],
    );
    await client.query(
      `INSERT INTO app."EditorialReview" (id,"revisionId","reviewerId",decision,"manifestHash",comment) VALUES (gen_random_uuid(),$1,$2,'APPROVED',$3,'[DEV SAMPLE] Synthetic test review')`,
      [revision.rows[0]!.id, userId, item.kind === 'SERIES' ? 'a'.repeat(64) : 'b'.repeat(64)],
    );
    await client.query(
      `UPDATE app."Revision" SET status='PUBLISHED',"publishedAt"=now() WHERE id=$1`,
      [revision.rows[0]!.id],
    );
    await client.query(`UPDATE app."Edition" SET "currentRevisionId"=$1 WHERE id=$2`, [
      revision.rows[0]!.id,
      edition.rows[0]!.id,
    ]);
    await client.query(`UPDATE app."Publication" SET status='PUBLISHED' WHERE id=$1`, [id]);
  }
  if (
    !(await client.query(`SELECT 1 FROM app."Publication" WHERE slug='dev-forthcoming-book'`))
      .rowCount
  ) {
    await client.query(
      `INSERT INTO app."Publication" (id,slug,title,description,subject,keywords,"releaseAt",kind,status,"ownerId","createdAt","updatedAt")
       VALUES (gen_random_uuid(),'dev-forthcoming-book','[DEV SAMPLE] Future Technology Book','[DEV SAMPLE] Fictional forthcoming title.','Technology',ARRAY['future']::text[],now()+interval '30 days','STANDALONE','FORTHCOMING',$1,now(),now())`,
      [userId],
    );
  }
  for (const item of [
    {
      title: '[DEV SAMPLE] Open Web Checklist',
      access: 'PUBLIC_FREE',
      text: '[DEV SAMPLE] Check headings, labels, keyboard focus and color contrast.',
    },
    {
      title: '[DEV SAMPLE] Registered Study Notes',
      access: 'REGISTERED_FREE',
      text: '[DEV SAMPLE] Sign in to read these synthetic notes.',
    },
    {
      title: '[DEV SAMPLE] Premium Exercise Guide',
      access: 'PREMIUM',
      text: 'DEV_PREMIUM_SECRET_EXERCISE_CONTENT',
    },
  ] as const) {
    const existing = await client.query(`SELECT 1 FROM app."Resource" WHERE title=$1`, [
      item.title,
    ]);
    if (existing.rowCount) continue;
    const resource = await client.query<{ id: string }>(
      `INSERT INTO app."Resource" (id,title,description,format,"bodyText","accessClass","licenceCode",attribution,"copyrightNotice","publishedAt")
       VALUES (gen_random_uuid(),$1,'[DEV SAMPLE] Synthetic text resource for local testing.','TEXT',$2,$3,'DEV-SAMPLE','[DEV SAMPLE] Arata author','[DEV SAMPLE] No production rights implied.',now()) RETURNING id`,
      [item.title, item.text, item.access],
    );
    await client.query(
      `INSERT INTO app."ContentPolicy" (id,"resourceId","accessClass","allowRead",version,"isActive","approvedAt") VALUES (gen_random_uuid(),$1,$2,true,1,true,now())`,
      [resource.rows[0]!.id, item.access],
    );
  }
  await client.query('COMMIT');
  console.info(
    'Seeded labelled synthetic published, forthcoming and resource records in development only.',
  );
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error(error instanceof Error ? error.message : 'Development seed failed');
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
