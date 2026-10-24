import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeHTML } from 'entities';
import type { Pool } from 'pg';
import yauzl from 'yauzl';
import mammoth from 'mammoth';

const root = resolve(
  process.env.STUDIO_STORAGE_ROOT ??
    fileURLToPath(new URL('../../../.private-objects/', import.meta.url)),
);
type Lesson = { title: string; bodyMarkdown: string };
type Chapter = { slug: string; title: string; lessons: Lesson[] };
type Preview = { format: string; chapters: Chapter[]; warnings: string[] };
type ImportRow = {
  id: string;
  assetId: string;
  editionId: string;
  actorId: string;
  status: string;
  preview: Preview | null;
  confirmedAt: Date | null;
  storageKey: string;
  mimeType: string;
  sizeBytes: string;
};
const text = (source: string) =>
  decodeHTML(
    source
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
const slug = (value: string, index: number) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 180) || `chapter-${index}`;
const limit = (value: string) => {
  if (value.length > 2_000_000) throw new Error('IMPORT_TEXT_LIMIT');
  return value;
};

async function zipEntries(path: string): Promise<Map<string, Buffer>> {
  return new Promise((resolveEntries, reject) => {
    yauzl.open(
      path,
      { lazyEntries: true, autoClose: true, validateEntrySizes: true },
      (error, archive) => {
        if (error || !archive) {
          reject(error ?? new Error('Invalid ZIP'));
          return;
        }
        const entries = new Map<string, Buffer>();
        let total = 0,
          count = 0,
          settled = false;
        const fail = (cause: Error) => {
          if (settled) return;
          settled = true;
          archive.close();
          reject(cause);
        };
        archive.on('error', fail);
        archive.on('entry', (entry) => {
          count++;
          total += entry.uncompressedSize;
          if (
            count > 10000 ||
            total > 200 * 1024 * 1024 ||
            entry.uncompressedSize > 10 * 1024 * 1024 ||
            entry.fileName.startsWith('/') ||
            entry.fileName.includes('\\') ||
            entry.fileName.split('/').includes('..') ||
            entry.fileName.includes('\0') ||
            entry.generalPurposeBitFlag & 1
          ) {
            fail(new Error('Unsafe import archive'));
            return;
          }
          if (entry.fileName.endsWith('/')) {
            archive.readEntry();
            return;
          }
          archive.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              fail(streamError ?? new Error('Unreadable archive entry'));
              return;
            }
            const chunks: Buffer[] = [];
            let bytes = 0;
            stream.on('data', (part: Buffer) => {
              bytes += part.length;
              if (bytes > 10 * 1024 * 1024) {
                stream.destroy(new Error('Oversized archive entry'));
                return;
              }
              chunks.push(part);
            });
            stream.on('error', fail);
            stream.on('end', () => {
              if (settled) return;
              entries.set(entry.fileName, Buffer.concat(chunks));
              archive.readEntry();
            });
          });
        });
        archive.on('end', () => {
          if (!settled) {
            settled = true;
            resolveEntries(entries);
          }
        });
        archive.readEntry();
      },
    );
  });
}

export async function previewImport(path: string, mimeType: string): Promise<Preview> {
  const info = await stat(path);
  if (info.size > 200 * 1024 * 1024) throw new Error('IMPORT_SOURCE_LIMIT');
  if (mimeType === 'application/pdf') {
    const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const document = await pdf.getDocument({
      data: new Uint8Array(await readFile(path)),
      useSystemFonts: true,
    }).promise;
    if (document.numPages > 500) throw new Error('PDF_PAGE_LIMIT');
    const chapters: Chapter[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const contents = await page.getTextContent();
      const body = limit(
        contents.items.map((item) => ('str' in item ? String(item.str) : '')).join(' '),
      );
      chapters.push({
        slug: `page-${pageNumber}`,
        title: `Page ${pageNumber}`,
        lessons: [{ title: `Page ${pageNumber} text`, bodyMarkdown: body }],
      });
    }
    return {
      format: 'PDF',
      chapters,
      warnings: [
        'PDF layout, figures, links and reading order require editorial review before release.',
      ],
    };
  }
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const document = await mammoth.extractRawText({ path });
    return {
      format: 'DOCX',
      chapters: [
        {
          slug: 'imported-document',
          title: 'Imported document',
          lessons: [{ title: 'Document text', bodyMarkdown: limit(document.value) }],
        },
      ],
      warnings: [
        ...document.messages.map((m) => m.message),
        'Formatting, figures and links require editorial review before release.',
      ],
    };
  }
  const entries = await zipEntries(path);
  if (mimeType === 'application/epub+zip') {
    if (
      entries.get('mimetype')?.toString('utf8').trim() !== 'application/epub+zip' ||
      !entries.has('META-INF/container.xml')
    )
      throw new Error('EPUB_STRUCTURE_INVALID');
    const docs = [...entries.entries()]
      .filter(([name]) => /\.(xhtml|html|htm)$/i.test(name) && !name.startsWith('META-INF/'))
      .sort(([a], [b]) => a.localeCompare(b));
    if (!docs.length || docs.length > 500) throw new Error('EPUB_CHAPTER_LIMIT');
    return {
      format: 'EPUB',
      chapters: docs.map(([name, bytes], index) => ({
        slug: slug(name, index + 1),
        title: name.split('/').at(-1) ?? `Chapter ${index + 1}`,
        lessons: [{ title: 'Imported text', bodyMarkdown: limit(text(bytes.toString('utf8'))) }],
      })),
      warnings: [
        'EPUB XHTML files are ordered by filename; confirm their order and review figures and links.',
      ],
    };
  }
  if (mimeType === 'application/zip') {
    const manifestBuffer = entries.get('manifest.json');
    if (!manifestBuffer) throw new Error('STRUCTURED_MANIFEST_REQUIRED');
    const manifest = JSON.parse(manifestBuffer.toString('utf8')) as {
      format?: unknown;
      chapters?: unknown;
    };
    if (
      manifest.format !== 'arata-structured-v1' ||
      !Array.isArray(manifest.chapters) ||
      manifest.chapters.length < 1 ||
      manifest.chapters.length > 500
    )
      throw new Error('STRUCTURED_MANIFEST_INVALID');
    const chapters: Chapter[] = [];
    const slugs = new Set<string>();
    for (const [index, raw] of manifest.chapters.entries()) {
      if (!raw || typeof raw !== 'object') throw new Error('STRUCTURED_CHAPTER_INVALID');
      const item = raw as { slug?: unknown; title?: unknown; lessons?: unknown };
      if (
        typeof item.slug !== 'string' ||
        !/^[a-z0-9][a-z0-9-]{0,199}$/.test(item.slug) ||
        slugs.has(item.slug) ||
        typeof item.title !== 'string' ||
        !item.title.trim() ||
        !Array.isArray(item.lessons) ||
        !item.lessons.length ||
        item.lessons.length > 100
      )
        throw new Error('STRUCTURED_CHAPTER_INVALID');
      slugs.add(item.slug);
      const lessons: Lesson[] = [];
      for (const rawLesson of item.lessons) {
        if (!rawLesson || typeof rawLesson !== 'object')
          throw new Error('STRUCTURED_LESSON_INVALID');
        const lesson = rawLesson as { title?: unknown; file?: unknown };
        if (
          typeof lesson.title !== 'string' ||
          !lesson.title.trim() ||
          typeof lesson.file !== 'string' ||
          !/^content\/[a-zA-Z0-9._/-]+\.md$/.test(lesson.file) ||
          lesson.file.split('/').includes('..')
        )
          throw new Error('STRUCTURED_LESSON_INVALID');
        const bytes = entries.get(lesson.file);
        if (!bytes) throw new Error('STRUCTURED_FILE_MISSING');
        lessons.push({
          title: lesson.title.slice(0, 400),
          bodyMarkdown: limit(bytes.toString('utf8')),
        });
      }
      chapters.push({ slug: item.slug, title: item.title.slice(0, 400), lessons });
      if (index > 500) throw new Error('STRUCTURED_CHAPTER_LIMIT');
    }
    return {
      format: 'ARATA_ZIP',
      chapters,
      warnings: ['Preview and confirm the destination edition before creating a draft.'],
    };
  }
  throw new Error('UNSUPPORTED_IMPORT_TYPE');
}

export async function processNextImport(pool: Pool, targetImportId?: string): Promise<boolean> {
  const client = await pool.connect();
  let row: ImportRow | undefined;
  try {
    await client.query('BEGIN');
    row = (
      await client.query<ImportRow>(
        `SELECT j.id,j."assetId",j."editionId",j."actorId",j.status,j.preview,j."confirmedAt",a."storageKey",a."mimeType",a."sizeBytes" FROM app."ImportJob" j JOIN app."Asset" a ON a.id=j."assetId" WHERE (j.status IN ('PREVIEWING','CONFIRMED') OR (j.status='PROCESSING' AND j."leaseUntil"<now())) AND ($1::uuid IS NULL OR j.id=$1) ORDER BY j."createdAt" FOR UPDATE OF j SKIP LOCKED LIMIT 1`,
        [targetImportId ?? null],
      )
    ).rows[0];
    if (!row) {
      await client.query('COMMIT');
      return false;
    }
    await client.query(
      `UPDATE app."ImportJob" SET status='PROCESSING',progress=5,attempts=attempts+1,"leaseUntil"=now()+interval '5 minutes',"updatedAt"=now() WHERE id=$1`,
      [row.id],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  try {
    const preview =
      row.confirmedAt && row.preview
        ? row.preview
        : await previewImport(join(root, row.storageKey), row.mimeType);
    if (!row.confirmedAt) {
      await pool.query(
        `UPDATE app."ImportJob" SET status='READY',preview=$2,progress=100,"leaseUntil"=NULL,"updatedAt"=now() WHERE id=$1`,
        [row.id, JSON.stringify(preview)],
      );
      return true;
    }
    const writer = await pool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query(`SELECT id FROM app."Edition" WHERE id=$1 FOR UPDATE`, [row.editionId]);
      const number = Number(
        (
          await writer.query<{ number: number }>(
            `SELECT COALESCE(MAX(number),0)+1 AS number FROM app."Revision" WHERE "editionId"=$1`,
            [row.editionId],
          )
        ).rows[0]!.number,
      );
      const revisionId = randomUUID();
      await writer.query(
        `INSERT INTO app."Revision" (id,"editionId",number,status,"changeSummary","createdById") VALUES ($1,$2,$3,'DRAFT',$4,$5)`,
        [
          revisionId,
          row.editionId,
          number,
          `Imported ${preview.format} source; editorial review required`,
          row.actorId,
        ],
      );
      for (const [chapterIndex, chapter] of preview.chapters.entries()) {
        const chapterId = randomUUID();
        await writer.query(
          `INSERT INTO app."Chapter" (id,"revisionId",ordinal,slug,title) VALUES ($1,$2,$3,$4,$5)`,
          [chapterId, revisionId, chapterIndex + 1, chapter.slug, chapter.title],
        );
        for (const [lessonIndex, lesson] of chapter.lessons.entries())
          await writer.query(
            `INSERT INTO app."Lesson" (id,"chapterId",ordinal,title,"bodyMarkdown","contentHash") VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              randomUUID(),
              chapterId,
              lessonIndex + 1,
              lesson.title,
              lesson.bodyMarkdown,
              createHash('sha256').update(lesson.bodyMarkdown).digest('hex'),
            ],
          );
      }
      await writer.query(
        `UPDATE app."ImportJob" SET status='COMPLETE',progress=100,"revisionId"=$2,"leaseUntil"=NULL,"updatedAt"=now() WHERE id=$1`,
        [row.id, revisionId],
      );
      await writer.query(
        `INSERT INTO app."AuditEvent" (id,"actorId",action,"objectType","objectId","correlationId") VALUES (gen_random_uuid(),$1,'studio.import_completed','Revision',$2,$3)`,
        [row.actorId, revisionId, row.id],
      );
      await writer.query('COMMIT');
    } catch (error) {
      await writer.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      writer.release();
    }
  } catch (error) {
    const failure = error instanceof Error ? error.message.slice(0, 100) : 'IMPORT_FAILED';
    await pool.query(
      `UPDATE app."ImportJob" SET status='FAILED',"failureCode"=$2,"leaseUntil"=NULL,"updatedAt"=now() WHERE id=$1`,
      [row.id, failure],
    );
  }
  return true;
}

export function startImportWorker(pool: Pool) {
  const timer = setInterval(() => {
    void processNextImport(pool).catch((error) =>
      console.error(
        JSON.stringify({
          event: 'studio.import_worker_error',
          message: error instanceof Error ? error.message : 'unknown',
        }),
      ),
    );
  }, 1000);
  timer.unref();
  return () => clearInterval(timer);
}
