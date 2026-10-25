import { afterEach, describe, expect, it } from 'vitest';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import yazl from 'yazl';
import { previewImport } from '../../apps/worker/src/import-worker.js';
import { classifyClamdReply, validateArchive } from '../../apps/worker/src/asset-worker.js';

const paths: string[] = [];
afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('malware scan evidence', () => {
  it('accepts only explicit clean and infected ClamAV replies', () => {
    expect(classifyClamdReply('stream: OK\0')).toBe('CLEAN');
    expect(classifyClamdReply('stream: Test-Signature FOUND\0')).toBe('MALWARE');
    expect(() => classifyClamdReply('stream: ERROR\0')).toThrow('ClamAV scan failed');
    expect(() => classifyClamdReply('stream: OK')).toThrow('ClamAV scan failed');
  });
});

async function zip(entries: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), 'arata-studio-test-'));
  paths.push(directory);
  const path = join(directory, 'source.zip');
  const archive = new yazl.ZipFile();
  for (const [name, body] of Object.entries(entries)) archive.addBuffer(Buffer.from(body), name);
  const output = createWriteStream(path);
  archive.outputStream.pipe(output);
  archive.end();
  await once(output, 'close');
  return path;
}

describe('structured document ingestion', () => {
  it('previews valid ordered chapters and lesson contents without publishing them', async () => {
    const path = await zip({
      'manifest.json': JSON.stringify({
        format: 'arata-structured-v1',
        chapters: [
          {
            slug: 'intro',
            title: 'Introduction',
            lessons: [{ title: 'First lesson', file: 'content/intro.md' }],
          },
          {
            slug: 'next',
            title: 'Next',
            lessons: [{ title: 'Second lesson', file: 'content/next.md' }],
          },
        ],
      }),
      'content/intro.md': '# Welcome\nSynthetic source',
      'content/next.md': 'More content',
    });
    expect((await validateArchive(path, 'application/zip')).entries).toBe(3);
    const preview = await previewImport(path, 'application/zip');
    expect(preview.chapters.map((chapter) => chapter.slug)).toEqual(['intro', 'next']);
    expect(preview.chapters[0]?.lessons[0]?.bodyMarkdown).toContain('Synthetic source');
  });

  it('rejects missing referenced files and unsupported archive manifests', async () => {
    const path = await zip({
      'manifest.json': JSON.stringify({
        format: 'arata-structured-v1',
        chapters: [
          {
            slug: 'intro',
            title: 'Introduction',
            lessons: [{ title: 'Lesson', file: 'content/missing.md' }],
          },
        ],
      }),
    });
    await expect(previewImport(path, 'application/zip')).rejects.toThrow('STRUCTURED_FILE_MISSING');
    await expect(previewImport(path, 'application/epub+zip')).rejects.toThrow(
      'EPUB_STRUCTURE_INVALID',
    );
  });

  it('extracts EPUB text as plain text and warns about editorial ordering', async () => {
    const path = await zip({
      mimetype: 'application/epub+zip',
      'META-INF/container.xml': '<container/>',
      'OEBPS/01.xhtml':
        '<html><body><h1>Safe</h1><p>Lesson &amp; practice</p><script>bad()</script></body></html>',
    });
    const preview = await previewImport(path, 'application/epub+zip');
    expect(preview.format).toBe('EPUB');
    expect(preview.chapters[0]?.lessons[0]?.bodyMarkdown).toContain('Lesson & practice');
    expect(preview.chapters[0]?.lessons[0]?.bodyMarkdown).not.toContain('bad()');
    expect(preview.warnings[0]).toContain('ordered by filename');
  });

  it('extracts DOCX text without treating document markup as trusted HTML', async () => {
    const path = await zip({
      '[Content_Types].xml':
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      '_rels/.rels':
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/document.xml':
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Synthetic DOCX lesson</w:t></w:r></w:p></w:body></w:document>',
    });
    const preview = await previewImport(
      path,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(preview.format).toBe('DOCX');
    expect(preview.chapters[0]?.lessons[0]?.bodyMarkdown).toContain('Synthetic DOCX lesson');
    expect(preview.warnings.at(-1)).toContain('editorial review');
  });

  it('extracts PDF text into a non-published editorial preview', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arata-studio-pdf-'));
    paths.push(directory);
    const path = join(directory, 'synthetic.pdf');
    const content = 'BT /F1 12 Tf 72 720 Td (Synthetic PDF lesson) Tj ET';
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (const [index, object] of objects.entries()) {
      offsets.push(Buffer.byteLength(pdf));
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    }
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
    for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    await writeFile(path, pdf);
    const preview = await previewImport(path, 'application/pdf');
    expect(preview.format).toBe('PDF');
    expect(preview.chapters[0]?.lessons[0]?.bodyMarkdown).toContain('Synthetic PDF lesson');
    expect(preview.warnings[0]).toContain('editorial review');
  }, 30000);
});
