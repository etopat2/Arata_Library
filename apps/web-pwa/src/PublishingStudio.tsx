import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  ApiError,
  createApiClient,
  type StudioTree,
  type StudioPublicationDetail,
  type StudioRevisionDetail,
} from '@arata/api-client';

const api = createApiClient();
type Selection = {
  type:
    | 'library'
    | 'collection'
    | 'publication'
    | 'volume'
    | 'edition'
    | 'revision'
    | 'chapter'
    | 'lesson';
  id: string;
  label: string;
  publicationId?: string | undefined;
  editionId?: string | undefined;
  revisionId?: string | undefined;
  chapterId?: string | undefined;
};
const button =
  'rounded-lg bg-[#74233e] px-4 py-2.5 font-semibold text-white hover:bg-[#5d1730] disabled:opacity-50';
const secondary =
  'rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-semibold text-[#173647] hover:bg-slate-50 disabled:opacity-50';
const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-[#173647]';
const field = 'grid gap-1 text-sm font-semibold text-[#173647]';
const statusText = (error: unknown) =>
  error instanceof ApiError
    ? `${error.problem?.title ?? 'Request failed'} (${error.status})`
    : error instanceof Error
      ? error.message
      : 'Request failed';
function FormBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-lg font-bold text-[#173647]">{title}</h3>
      {children}
    </section>
  );
}
const value = (form: FormData, name: string) => String(form.get(name) ?? '').trim();

export function PublishingStudio() {
  const [tree, setTree] = useState<StudioTree | null>(null);
  const [selected, select] = useState<Selection | null>(null);
  const [detail, setDetail] = useState<StudioPublicationDetail | null>(null);
  const [revision, setRevision] = useState<StudioRevisionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [comparison, setComparison] = useState('');
  const [upload, setUpload] = useState<{
    id: string;
    assetId?: string | undefined;
    state: string;
    progress: number;
  } | null>(null);
  const [importJob, setImportJob] = useState<{
    id: string;
    status: string;
    preview: unknown;
    revisionId: string | null;
    failureCode: string | null;
  } | null>(null);
  const [lessonText, setLessonText] = useState('');
  const [lessonTitle, setLessonTitle] = useState('');
  const [blocksText, setBlocksText] = useState('');

  async function refresh() {
    try {
      const result = await api.studio.tree();
      setTree(result.data);
      setError('');
    } catch (cause) {
      setError(statusText(cause));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    setDetail(null);
    setRevision(null);
    setComparison('');
    if (!selected) return;
    let active = true;
    if (selected.publicationId)
      void api.studio
        .publication(selected.publicationId)
        .then((result) => {
          if (active) setDetail(result.data);
        })
        .catch((cause) => {
          if (active) setError(statusText(cause));
        });
    if (selected.revisionId)
      void api.studio
        .revision(selected.revisionId)
        .then((result) => {
          if (active) setRevision(result.data);
        })
        .catch((cause) => {
          if (active) setError(statusText(cause));
        });
    return () => {
      active = false;
    };
  }, [selected]);
  useEffect(() => {
    if (selected?.type !== 'lesson' || !revision) return;
    const lesson = revision.lessons.find((item) => item.id === selected.id);
    setLessonTitle(lesson?.title ?? '');
    setLessonText(lesson?.bodyMarkdown ?? '');
    setBlocksText(lesson?.blocks ? JSON.stringify(lesson.blocks, null, 2) : '');
  }, [selected, revision]);
  useEffect(() => {
    if (!upload || !['QUEUED', 'PROCESSING', 'RECEIVING'].includes(upload.state)) return;
    const timer = setInterval(() => {
      void api.studio
        .uploadStatus(upload.id)
        .then((result) =>
          setUpload({
            id: upload.id,
            assetId: result.data.assetId ?? undefined,
            state: result.data.processing?.status ?? result.data.status,
            progress: result.data.processing?.progress ?? 0,
          }),
        )
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [upload]);
  useEffect(() => {
    if (!importJob || !['PREVIEWING', 'CONFIRMED', 'PROCESSING'].includes(importJob.status)) return;
    const timer = setInterval(() => {
      void api.studio
        .importStatus(importJob.id)
        .then((result) =>
          setImportJob({
            id: importJob.id,
            status: result.data.status,
            preview: result.data.preview,
            revisionId: result.data.revisionId,
            failureCode: result.data.failureCode,
          }),
        )
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [importJob]);
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
      await refresh();
      if (selected?.publicationId) {
        const response = await api.studio.publication(selected.publicationId);
        setDetail(response.data);
      }
      if (selected?.revisionId) {
        const response = await api.studio.revision(selected.revisionId);
        setRevision(response.data);
      }
    } catch (cause) {
      setError(statusText(cause));
    } finally {
      setBusy(false);
    }
  }
  function submit(
    event: FormEvent<HTMLFormElement>,
    action: (data: FormData) => Promise<unknown>,
    success: string,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    void run(() => action(new FormData(form)), success).then(() => form.reset());
  }
  const publicationId = selected?.publicationId;
  const editionId = selected?.editionId;
  const revisionId = selected?.revisionId;
  const chapterId = selected?.chapterId;

  function ReorderList({
    title,
    items,
    path,
    volumeId,
  }: {
    title: string;
    items: { id: string; ordinal: number; title: string }[];
    path: string;
    volumeId?: string | null;
  }) {
    const ordered = [...items].sort((a, b) => a.ordinal - b.ordinal);
    if (ordered.length < 2) return null;
    return (
      <FormBox title={title}>
        <ol className="space-y-2">
          {ordered.map((item, index) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-2"
            >
              <span>
                {index + 1}. {item.title}
              </span>
              <span className="flex shrink-0 gap-1">
                {([-1, 1] as const).map((direction) => (
                  <button
                    key={direction}
                    type="button"
                    className={secondary}
                    disabled={busy || index + direction < 0 || index + direction >= ordered.length}
                    aria-label={`Move ${item.title} ${direction < 0 ? 'up' : 'down'}`}
                    onClick={() => {
                      const expectedIds = ordered.map((entry) => entry.id);
                      const ids = [...expectedIds];
                      [ids[index], ids[index + direction]] = [ids[index + direction]!, ids[index]!];
                      void run(
                        () =>
                          api.studio.replace(path, {
                            ids,
                            expectedIds,
                            ...(volumeId === undefined ? {} : { volumeId }),
                          }),
                        `${title} saved`,
                      );
                    }}
                  >
                    {direction < 0 ? '↑' : '↓'}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ol>
      </FormBox>
    );
  }

  function TreeButton({ item, depth = 0 }: { item: Selection; depth?: number }) {
    return (
      <button
        type="button"
        data-testid={`studio-${item.type}-${item.id}`}
        aria-current={selected?.id === item.id ? 'page' : undefined}
        className={`block w-full rounded-lg py-2 pr-3 text-left text-sm hover:bg-[#f2e8ec] focus-visible:bg-[#f2e8ec] ${selected?.id === item.id ? 'bg-[#f2e8ec] font-bold text-[#74233e]' : 'text-[#173647]'}`}
        style={{ paddingLeft: `${12 + depth * 15}px` }}
        onClick={() => {
          setDetail(null);
          setRevision(null);
          setComparison('');
          select(item);
        }}
      >
        <span className="mr-2" aria-hidden="true">
          {item.type === 'library'
            ? '▣'
            : item.type === 'collection'
              ? '▦'
              : item.type === 'publication'
                ? '▤'
                : item.type === 'volume'
                  ? '▧'
                  : item.type === 'edition'
                    ? '◈'
                    : item.type === 'revision'
                      ? '↺'
                      : item.type === 'chapter'
                        ? '≡'
                        : '•'}
        </span>
        {item.label}
      </button>
    );
  }
  function PublicationTree({
    pub,
    depth,
  }: {
    pub: StudioTree['publications'][number];
    depth: number;
  }) {
    return (
      <div>
        <TreeButton
          depth={depth}
          item={{ type: 'publication', id: pub.id, label: pub.title, publicationId: pub.id }}
        />
        {tree?.volumes
          .filter((v) => v.publicationId === pub.id)
          .map((volume) => (
            <div key={volume.id}>
              <TreeButton
                depth={depth + 1}
                item={{
                  type: 'volume',
                  id: volume.id,
                  label: `Volume ${volume.ordinal}: ${volume.title}`,
                  publicationId: pub.id,
                }}
              />
              {tree.editions
                .filter((ed) => ed.volumeId === volume.id)
                .map((edition) => (
                  <EditionTree
                    key={edition.id}
                    edition={edition}
                    publicationId={pub.id}
                    depth={depth + 2}
                  />
                ))}
            </div>
          ))}
        {tree?.editions
          .filter((ed) => ed.publicationId === pub.id && !ed.volumeId)
          .map((edition) => (
            <EditionTree
              key={edition.id}
              edition={edition}
              publicationId={pub.id}
              depth={depth + 1}
            />
          ))}
      </div>
    );
  }
  const treeView = tree ? (
    <div className="space-y-1">
      <TreeButton item={{ type: 'library', id: tree.library.id, label: tree.library.title }} />
      {tree.collections.map((collection) => (
        <div key={collection.id}>
          <TreeButton
            depth={1}
            item={{ type: 'collection', id: collection.id, label: collection.title }}
          />
          {tree.publications
            .filter((pub) => pub.collectionId === collection.id)
            .map((pub) => (
              <PublicationTree key={pub.id} pub={pub} depth={2} />
            ))}
        </div>
      ))}
      {tree.publications.some((pub) => pub.collectionId === null) && (
        <div>
          <p className="px-3 pt-3 text-xs font-bold uppercase tracking-wide text-slate-500">
            Uncategorised
          </p>
          {tree.publications
            .filter((pub) => pub.collectionId === null)
            .map((pub) => (
              <PublicationTree key={pub.id} pub={pub} depth={1} />
            ))}
        </div>
      )}
    </div>
  ) : null;
  function EditionTree({
    edition,
    publicationId,
    depth,
  }: {
    edition: StudioTree['editions'][number];
    publicationId: string;
    depth: number;
  }) {
    return (
      <div>
        <TreeButton
          depth={depth}
          item={{
            type: 'edition',
            id: edition.id,
            label: `${edition.ordinal}. ${edition.label}${edition.isDefault ? ' ★' : ''}`,
            publicationId,
            editionId: edition.id,
          }}
        />
        {tree?.revisions
          .filter((rev) => rev.editionId === edition.id)
          .map((rev) => (
            <div key={rev.id}>
              <TreeButton
                depth={depth + 1}
                item={{
                  type: 'revision',
                  id: rev.id,
                  label: `Revision ${rev.number} · ${rev.status}`,
                  publicationId,
                  editionId: edition.id,
                  revisionId: rev.id,
                }}
              />
              {tree.chapters
                .filter((ch) => ch.revisionId === rev.id)
                .map((ch) => (
                  <TreeButton
                    key={ch.id}
                    depth={depth + 2}
                    item={{
                      type: 'chapter',
                      id: ch.id,
                      label: `${ch.ordinal}. ${ch.title}`,
                      publicationId,
                      editionId: edition.id,
                      revisionId: rev.id,
                      chapterId: ch.id,
                    }}
                  />
                ))}
            </div>
          ))}
      </div>
    );
  }

  async function uploadFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!publicationId) return;
    const form = new FormData(event.currentTarget);
    const file = form.get('file');
    if (!(file instanceof File) || !file.size) {
      setError('Choose a non-empty file.');
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setError('Browser upload is limited to 100 MB.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      const started = await api.studio.create<{
        publicationId: string;
        originalName: string;
        mimeType: string;
        sizeBytes: number;
        sha256: string;
        idempotencyKey: string;
      }>('uploads', {
        publicationId,
        originalName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        sha256,
        idempotencyKey: crypto.randomUUID(),
      });
      const id = started.data.id;
      setUpload({ id, state: 'RECEIVING', progress: 0 });
      let offset = 0;
      while (offset < file.size) {
        const blob = file.slice(offset, Math.min(offset + 8 * 1024 * 1024, file.size));
        const csrf = document.cookie
          .split('; ')
          .find((part) => part.startsWith('arata_csrf=') || part.startsWith('__Host-arata_csrf='))
          ?.split('=')[1];
        const response = await fetch(`/api/v1/studio/uploads/${id}/chunk`, {
          method: 'PUT',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Upload-Offset': String(offset),
            ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
          },
          body: blob,
        });
        if (!response.ok) throw new Error(`Chunk upload failed (${response.status})`);
        offset += blob.size;
        setUpload({ id, state: 'RECEIVING', progress: Math.round((offset / file.size) * 100) });
      }
      const completed = await api.studio.action(`uploads/${id}/complete`);
      setUpload({
        id,
        assetId: (completed.data as { assetId?: string }).assetId,
        state: 'QUEUED',
        progress: 0,
      });
      setMessage('Upload queued for validation and malware scanning.');
    } catch (cause) {
      setError(statusText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f8fa] text-[#173647]">
      <a
        href="#studio-main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-20 focus:bg-white focus:p-3"
      >
        Skip to Studio content
      </a>
      <header className="border-b border-slate-200 bg-white px-5 py-4">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3">
          <div>
            <a href="/" className="font-bold text-[#74233e]">
              Arata TechLibrary
            </a>
            <span className="mx-3 text-slate-300">/</span>
            <strong>Publishing Studio</strong>
          </div>
          <nav aria-label="Account">
            <a className="rounded px-3 py-2 underline" href="/?screen=profile">
              Account
            </a>
            <a className="rounded px-3 py-2 underline" href="/">
              Public library
            </a>
          </nav>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1500px] gap-6 p-4 md:grid-cols-[300px_1fr] md:p-6">
        <aside
          aria-label="Publication hierarchy"
          className="self-start rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:sticky md:top-4"
        >
          <h1 className="mb-1 text-xl font-extrabold">Publishing Studio</h1>
          <p className="mb-4 text-sm text-slate-600">
            Library → collection → book → edition → revision
          </p>
          <div className="max-h-[70vh] overflow-auto">
            {loading ? 'Loading publication tree…' : treeView}
            {!loading && tree && !tree.publications.length && (
              <p className="p-3 text-sm">No publications assigned to your editorial role.</p>
            )}
          </div>
          <button
            type="button"
            className={`${secondary} mt-5 w-full`}
            onClick={() => void refresh()}
          >
            Refresh hierarchy
          </button>
        </aside>
        <main id="studio-main" className="min-w-0 space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#74233e]">
              Editorial workspace
            </p>
            <h2 className="mt-1 text-2xl font-extrabold">
              {selected?.label ?? 'Select a publication or collection'}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Only authorized publication roles can view drafts or change content. Published
              revisions remain immutable.
            </p>
          </div>
          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-900"
            >
              {error}
              {error.includes('401') && (
                <a className="ml-2 underline" href="/?screen=login">
                  Sign in
                </a>
              )}
            </div>
          )}
          {message && (
            <div
              role="status"
              className="rounded-xl border border-teal-300 bg-teal-50 p-4 text-teal-900"
            >
              {message}
            </div>
          )}
          {!selected && (
            <p className="rounded-xl border border-slate-200 bg-white p-6">
              Choose a node in the hierarchy to create, edit, review or publish content.
            </p>
          )}
          {selected?.type === 'library' && (
            <FormBox title="New collection">
              <form
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={(event) =>
                  submit(
                    event,
                    (form) =>
                      api.studio.create('collections', {
                        slug: value(form, 'slug'),
                        title: value(form, 'title'),
                        description: value(form, 'description') || undefined,
                      }),
                    'Collection created',
                  )
                }
              >
                <label className={field}>
                  Slug
                  <input className={input} name="slug" required pattern="[a-z0-9][a-z0-9-]*" />
                </label>
                <label className={field}>
                  Title
                  <input className={input} name="title" required />
                </label>
                <label className={`${field} sm:col-span-2`}>
                  Description
                  <textarea className={input} name="description" rows={3} />
                </label>
                <button disabled={busy} className={button}>
                  Create collection
                </button>
              </form>
            </FormBox>
          )}
          {(selected?.type === 'collection' || selected?.type === 'library') && (
            <FormBox
              title={
                selected.type === 'library' ? 'New uncategorised publication' : 'New publication'
              }
            >
              <form
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={(event) =>
                  submit(
                    event,
                    (form) =>
                      api.studio.create('publications', {
                        collectionId: selected.type === 'collection' ? selected.id : undefined,
                        slug: value(form, 'slug'),
                        title: value(form, 'title'),
                        kind: value(form, 'kind'),
                        languageCode: value(form, 'languageCode'),
                        licenceCode: value(form, 'licenceCode'),
                        sourceRef: value(form, 'sourceRef'),
                        copyrightNotice: value(form, 'copyrightNotice'),
                        description: value(form, 'description') || undefined,
                      }),
                    'Draft publication created',
                  )
                }
              >
                <label className={field}>
                  Title
                  <input className={input} name="title" required />
                </label>
                <label className={field}>
                  Slug
                  <input className={input} name="slug" required pattern="[a-z0-9][a-z0-9-]*" />
                </label>
                <label className={field}>
                  Type
                  <select className={input} name="kind">
                    <option value="STANDALONE">Standalone book</option>
                    <option value="SERIES">Multi-volume series</option>
                  </select>
                </label>
                <label className={field}>
                  Language code
                  <input className={input} name="languageCode" defaultValue="en" required />
                </label>
                <label className={field}>
                  Licence code
                  <input className={input} name="licenceCode" required />
                </label>
                <label className={field}>
                  Content source reference
                  <input className={input} name="sourceRef" required />
                </label>
                <label className={`${field} sm:col-span-2`}>
                  Copyright notice
                  <input className={input} name="copyrightNotice" required />
                </label>
                <label className={`${field} sm:col-span-2`}>
                  Description
                  <textarea className={input} name="description" rows={3} />
                </label>
                <button disabled={busy} className={button}>
                  Create draft
                </button>
              </form>
            </FormBox>
          )}
          {selected?.type === 'publication' && detail && (
            <div className="grid gap-5 xl:grid-cols-2">
              {detail.publication.kind === 'SERIES' &&
                !detail.revisions.some((item) =>
                  ['IN_REVIEW', 'APPROVED', 'PUBLISHED'].includes(item.status),
                ) && (
                  <ReorderList
                    title="Volume order"
                    items={detail.volumes}
                    path={`publications/${publicationId}/volumes/order`}
                  />
                )}
              {detail.publication.kind === 'STANDALONE' &&
                !detail.revisions.some((item) =>
                  ['IN_REVIEW', 'APPROVED', 'PUBLISHED'].includes(item.status),
                ) && (
                  <ReorderList
                    title="Edition order"
                    items={detail.editions
                      .filter((item) => !item.volumeId)
                      .map((item) => ({ ...item, title: item.label }))}
                    path={`publications/${publicationId}/editions/order`}
                    volumeId={null}
                  />
                )}
              <FormBox title="Publication metadata">
                <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt>Status</dt>
                  <dd className="font-bold">{detail.publication.status}</dd>
                  <dt>Type</dt>
                  <dd>{detail.publication.kind}</dd>
                  <dt>Language</dt>
                  <dd>{detail.publication.languageCode ?? 'Missing'}</dd>
                  <dt>Licence</dt>
                  <dd>{detail.publication.licenceCode ?? 'Missing'}</dd>
                  <dt>Source</dt>
                  <dd>{detail.publication.sourceRef ?? 'Missing'}</dd>
                  <dt>Copyright</dt>
                  <dd>{detail.publication.copyrightNotice ?? 'Missing'}</dd>
                  <dt>Authors</dt>
                  <dd>
                    {detail.contributors
                      .filter((c) => c.role === 'AUTHOR')
                      .map((c) => c.displayName)
                      .join(', ') || 'Add an author before publishing'}
                  </dd>
                </dl>
                {['DRAFT', 'FORTHCOMING'].includes(detail.publication.status) &&
                  !detail.revisions.some((item) =>
                    ['IN_REVIEW', 'APPROVED', 'PUBLISHED'].includes(item.status),
                  ) && (
                    <form
                      key={JSON.stringify(detail.publication)}
                      className="mt-5 grid gap-3 border-t border-slate-200 pt-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        const title = value(form, 'title');
                        void run(async () => {
                          const result = await api.studio.change(`publications/${publicationId}`, {
                            title,
                            subtitle: value(form, 'subtitle') || null,
                            description: value(form, 'description') || null,
                            subject: value(form, 'subject') || null,
                            keywords: value(form, 'keywords')
                              .split(',')
                              .map((keyword) => keyword.trim())
                              .filter(Boolean),
                            languageCode: value(form, 'languageCode'),
                            licenceCode: value(form, 'licenceCode'),
                            sourceRef: value(form, 'sourceRef'),
                            copyrightNotice: value(form, 'copyrightNotice'),
                          });
                          select({ ...selected, label: title });
                          return result;
                        }, 'Publication metadata saved');
                      }}
                    >
                      <h4 className="font-bold">Edit draft metadata</h4>
                      <label className={field}>
                        Title
                        <input
                          className={input}
                          name="title"
                          defaultValue={detail.publication.title}
                          required
                        />
                      </label>
                      <label className={field}>
                        Subtitle
                        <input
                          className={input}
                          name="subtitle"
                          defaultValue={detail.publication.subtitle ?? ''}
                        />
                      </label>
                      <label className={field}>
                        Description
                        <textarea
                          className={input}
                          name="description"
                          defaultValue={detail.publication.description ?? ''}
                          rows={3}
                        />
                      </label>
                      <label className={field}>
                        Subject
                        <input
                          className={input}
                          name="subject"
                          defaultValue={detail.publication.subject ?? ''}
                        />
                      </label>
                      <label className={field}>
                        Keywords (comma separated)
                        <input
                          className={input}
                          name="keywords"
                          defaultValue={detail.publication.keywords.join(', ')}
                        />
                      </label>
                      <label className={field}>
                        Language code
                        <input
                          className={input}
                          name="languageCode"
                          defaultValue={detail.publication.languageCode ?? ''}
                          required
                        />
                      </label>
                      <label className={field}>
                        Licence code
                        <input
                          className={input}
                          name="licenceCode"
                          defaultValue={detail.publication.licenceCode ?? ''}
                          required
                        />
                      </label>
                      <label className={field}>
                        Content source reference
                        <input
                          className={input}
                          name="sourceRef"
                          defaultValue={detail.publication.sourceRef ?? ''}
                          required
                        />
                      </label>
                      <label className={field}>
                        Copyright notice
                        <input
                          className={input}
                          name="copyrightNotice"
                          defaultValue={detail.publication.copyrightNotice ?? ''}
                          required
                        />
                      </label>
                      <button disabled={busy} className={button}>
                        Save metadata
                      </button>
                    </form>
                  )}
                <form
                  key={detail.collections
                    .map((collection) => collection.id)
                    .sort()
                    .join(',')}
                  className="mt-5 grid gap-3 border-t border-slate-200 pt-4"
                  onSubmit={(event) =>
                    submit(
                      event,
                      (form) =>
                        api.studio.replace(`publications/${publicationId}/collections`, {
                          collectionIds: form.getAll('collectionIds').map(String),
                        }),
                      'Publication collections updated',
                    )
                  }
                >
                  <fieldset className="grid gap-2">
                    <legend className="mb-2 font-semibold">Collections</legend>
                    {tree?.collections.map((collection) => (
                      <label key={collection.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="collectionIds"
                          value={collection.id}
                          defaultChecked={detail.collections.some(
                            (item) => item.id === collection.id,
                          )}
                        />
                        {collection.title}
                      </label>
                    ))}
                    {!tree?.collections.length && (
                      <span className="text-sm text-slate-600">No collections exist yet.</span>
                    )}
                  </fieldset>
                  <button disabled={busy} className={secondary}>
                    Save collections
                  </button>
                </form>
                {detail.publication.status === 'PUBLISHED' && (
                  <form
                    className="mt-5 grid gap-3"
                    onSubmit={(event) =>
                      submit(
                        event,
                        (form) =>
                          api.studio.action(`publications/${publicationId}/withdraw`, {
                            reason: value(form, 'reason'),
                            confirm: true,
                          }),
                        'Publication withdrawn',
                      )
                    }
                  >
                    <label className={field}>
                      Withdrawal reason
                      <input className={input} name="reason" required />
                    </label>
                    <button disabled={busy} className={secondary}>
                      Withdraw publication
                    </button>
                  </form>
                )}
              </FormBox>
              <FormBox title="Author and contributor credits">
                <form
                  className="grid gap-3"
                  onSubmit={(event) =>
                    submit(
                      event,
                      (form) =>
                        api.studio.create(`publications/${publicationId}/contributors`, {
                          displayName: value(form, 'displayName'),
                          slug: value(form, 'slug'),
                          role: value(form, 'role'),
                          ordinal: 0,
                        }),
                      'Contributor added',
                    )
                  }
                >
                  <label className={field}>
                    Display name
                    <input className={input} name="displayName" required />
                  </label>
                  <label className={field}>
                    Contributor slug
                    <input className={input} name="slug" required pattern="[a-z0-9][a-z0-9-]*" />
                  </label>
                  <label className={field}>
                    Role
                    <select className={input} name="role">
                      <option>AUTHOR</option>
                      <option>EDITOR</option>
                      <option>ILLUSTRATOR</option>
                      <option>TRANSLATOR</option>
                      <option>REVIEWER</option>
                    </select>
                  </label>
                  <button disabled={busy} className={button}>
                    Add credit
                  </button>
                </form>
              </FormBox>
              <FormBox
                title={detail.publication.kind === 'SERIES' ? 'Add a volume' : 'Add an edition'}
              >
                {detail.publication.kind === 'SERIES' ? (
                  <form
                    className="grid gap-3"
                    onSubmit={(event) =>
                      submit(
                        event,
                        (form) =>
                          api.studio.create(`publications/${publicationId}/volumes`, {
                            ordinal: Number(value(form, 'ordinal')),
                            title: value(form, 'title'),
                          }),
                        'Volume created',
                      )
                    }
                  >
                    <label className={field}>
                      Volume number
                      <input className={input} name="ordinal" type="number" min="1" required />
                    </label>
                    <label className={field}>
                      Title
                      <input className={input} name="title" required />
                    </label>
                    <button disabled={busy} className={button}>
                      Create volume
                    </button>
                  </form>
                ) : (
                  <EditionForm
                    publicationId={publicationId!}
                    busy={busy}
                    submit={submit}
                    allowInitialDefault={
                      detail.publication.status === 'DRAFT' &&
                      !detail.editions.some((edition) => !edition.volumeId && edition.isDefault)
                    }
                  />
                )}
              </FormBox>
              <FormBox title="Upload and import">
                <p className="mb-3 text-sm text-slate-600">
                  Files stay in quarantine until a malware scan and rights approval finish.
                  Originals are private.
                </p>
                <form className="grid gap-3" onSubmit={(event) => void uploadFile(event)}>
                  <label className={field}>
                    PDF, DOCX, EPUB, ZIP or learning file
                    <input
                      className={input}
                      name="file"
                      type="file"
                      required
                      accept=".pdf,.docx,.epub,.zip,.pptx,.md,.txt,.png,.jpg,.jpeg,.webp,.mp3,.mp4"
                    />
                  </label>
                  <button disabled={busy} className={button}>
                    Upload file
                  </button>
                </form>
                {upload && (
                  <div className="mt-4 text-sm" role="status">
                    Upload {upload.state} · {upload.progress}%
                    {upload.assetId && <span> · Asset {upload.assetId}</span>}
                    {upload.state === 'FAILED' && upload.assetId && (
                      <button
                        className={`${secondary} ml-2`}
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => api.studio.action(`assets/${upload.assetId}/retry`),
                            'Processing retry queued',
                          )
                        }
                      >
                        Retry scan
                      </button>
                    )}
                  </div>
                )}
                {upload?.assetId && upload.state === 'COMPLETE' && (
                  <form
                    className="mt-4 grid gap-2"
                    onSubmit={(event) =>
                      submit(
                        event,
                        (form) =>
                          api.studio.action(`assets/${upload.assetId}/approve`, {
                            licenceCode: value(form, 'licenceCode'),
                            provenanceRef: value(form, 'provenanceRef'),
                            copyrightNotice: value(form, 'copyrightNotice'),
                            attribution: value(form, 'attribution'),
                          }),
                        'Asset rights approved',
                      )
                    }
                  >
                    <strong>Approve scanned asset rights</strong>
                    {['licenceCode', 'provenanceRef', 'copyrightNotice', 'attribution'].map(
                      (name) => (
                        <label key={name} className={field}>
                          {name}
                          <input className={input} name={name} required />
                        </label>
                      ),
                    )}
                    <button disabled={busy} className={button}>
                      Approve asset
                    </button>
                  </form>
                )}
              </FormBox>
            </div>
          )}
          {selected?.type === 'volume' && publicationId && (
            <div className="space-y-5">
              {detail &&
                !detail.revisions.some(
                  (item) =>
                    detail.editions.some(
                      (edition) =>
                        edition.id === item.editionId && edition.volumeId === selected.id,
                    ) && ['IN_REVIEW', 'APPROVED', 'PUBLISHED'].includes(item.status),
                ) && (
                  <FormBox title="Edit volume title">
                    <form
                      key={selected.id}
                      className="grid gap-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        void run(
                          () =>
                            api.studio.change(`volumes/${selected.id}`, {
                              title: value(form, 'title'),
                            }),
                          'Volume title saved',
                        );
                      }}
                    >
                      <label className={field}>
                        Volume title
                        <input
                          className={input}
                          name="title"
                          defaultValue={
                            detail.volumes.find((item) => item.id === selected.id)?.title ?? ''
                          }
                          required
                        />
                      </label>
                      <button disabled={busy} className={button}>
                        Save volume
                      </button>
                    </form>
                  </FormBox>
                )}
              <FormBox title="Add an edition to this volume">
                <EditionForm
                  publicationId={publicationId}
                  volumeId={selected.id}
                  busy={busy}
                  submit={submit}
                  allowInitialDefault={
                    detail?.publication.status === 'DRAFT' &&
                    !detail.editions.some(
                      (edition) => edition.volumeId === selected.id && edition.isDefault,
                    )
                  }
                />
              </FormBox>
              {detail &&
                !detail.revisions.some(
                  (item) =>
                    detail.editions.some(
                      (edition) =>
                        edition.id === item.editionId && edition.volumeId === selected.id,
                    ) && ['IN_REVIEW', 'APPROVED', 'PUBLISHED'].includes(item.status),
                ) && (
                  <ReorderList
                    title="Edition order"
                    items={detail.editions
                      .filter((item) => item.volumeId === selected.id)
                      .map((item) => ({ ...item, title: item.label }))}
                    path={`publications/${publicationId}/editions/order`}
                    volumeId={selected.id}
                  />
                )}
            </div>
          )}
          {selected?.type === 'edition' && editionId && (
            <div className="grid gap-5 xl:grid-cols-2">
              {detail &&
                !detail.revisions.some(
                  (item) =>
                    item.editionId === editionId &&
                    ['IN_REVIEW', 'APPROVED', 'PUBLISHED'].includes(item.status),
                ) && (
                  <FormBox title="Edit edition metadata">
                    <form
                      key={editionId}
                      className="grid gap-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        const date = value(form, 'publicationDate');
                        void run(
                          () =>
                            api.studio.change(`editions/${editionId}`, {
                              editionCode: value(form, 'editionCode'),
                              label: value(form, 'label'),
                              isbn13: value(form, 'isbn13') || null,
                              publicationDate: date ? `${date}T00:00:00.000Z` : null,
                            }),
                          'Edition metadata saved',
                        );
                      }}
                    >
                      <label className={field}>
                        Edition code
                        <input
                          className={input}
                          name="editionCode"
                          defaultValue={
                            detail.editions.find((item) => item.id === editionId)?.editionCode ?? ''
                          }
                          required
                        />
                      </label>
                      <label className={field}>
                        Edition label
                        <input
                          className={input}
                          name="label"
                          defaultValue={
                            detail.editions.find((item) => item.id === editionId)?.label ?? ''
                          }
                          required
                        />
                      </label>
                      <label className={field}>
                        ISBN-13 (optional)
                        <input
                          className={input}
                          name="isbn13"
                          pattern="97[89][0-9]{10}"
                          defaultValue={
                            detail.editions.find((item) => item.id === editionId)?.isbn13 ?? ''
                          }
                        />
                      </label>
                      <label className={field}>
                        Publication date in UTC (optional)
                        <input
                          className={input}
                          name="publicationDate"
                          type="date"
                          defaultValue={
                            detail.editions
                              .find((item) => item.id === editionId)
                              ?.publicationDate?.slice(0, 10) ?? ''
                          }
                        />
                      </label>
                      <button disabled={busy} className={button}>
                        Save edition
                      </button>
                    </form>
                  </FormBox>
                )}
              <FormBox title="New draft revision">
                <form
                  className="grid gap-3"
                  onSubmit={(event) =>
                    submit(
                      event,
                      (form) =>
                        api.studio.create(`editions/${editionId}/revisions`, {
                          changeSummary: value(form, 'changeSummary'),
                          fromRevisionId: value(form, 'fromRevisionId') || undefined,
                        }),
                      'Draft revision created',
                    )
                  }
                >
                  <label className={field}>
                    Change summary
                    <input className={input} name="changeSummary" required />
                  </label>
                  <label className={field}>
                    Clone published revision (optional)
                    <select className={input} name="fromRevisionId">
                      <option value="">Start empty</option>
                      {detail?.revisions
                        .filter((rev) => rev.editionId === editionId && rev.status === 'PUBLISHED')
                        .map((rev) => (
                          <option key={rev.id} value={rev.id}>
                            Revision {rev.number}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button disabled={busy} className={button}>
                    Create draft
                  </button>
                </form>
              </FormBox>
              {detail && !detail.editions.find((item) => item.id === editionId)?.isDefault && (
                <FormBox title="Set default edition">
                  {detail.publication.status === 'PUBLISHED' &&
                  !detail.editions.find((item) => item.id === editionId)?.currentRevisionId ? (
                    <p className="text-sm text-slate-600">
                      Publish this edition before making it the public default.
                    </p>
                  ) : (
                    <form
                      className="grid gap-3"
                      onSubmit={(event) =>
                        submit(
                          event,
                          (form) =>
                            api.studio.replace(`editions/${editionId}/default`, {
                              reason: value(form, 'reason'),
                              confirm: form.get('confirm') === 'on',
                            }),
                          'Default edition changed',
                        )
                      }
                    >
                      <p className="text-sm text-slate-600">
                        A publisher must confirm this change. For a published book, the target
                        edition must already be published.
                      </p>
                      <label className={field}>
                        Reason
                        <input className={input} name="reason" required />
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input name="confirm" type="checkbox" required />
                        Confirm default edition change
                      </label>
                      <button disabled={busy} className={button}>
                        Set as default
                      </button>
                    </form>
                  )}
                </FormBox>
              )}
              {upload?.assetId && (
                <FormBox title="Import approved document">
                  <form
                    className="grid gap-3"
                    onSubmit={(event) =>
                      submit(
                        event,
                        async () => {
                          const started = await api.studio.create('imports', {
                            assetId: upload.assetId,
                            editionId,
                            idempotencyKey: crypto.randomUUID(),
                          });
                          setImportJob({
                            id: started.data.id,
                            status: 'PREVIEWING',
                            preview: null,
                            revisionId: null,
                            failureCode: null,
                          });
                          return started;
                        },
                        'Import preview queued',
                      )
                    }
                  >
                    <p className="text-sm">Asset {upload.assetId}</p>
                    <button disabled={busy} className={button}>
                      Preview import
                    </button>
                  </form>
                </FormBox>
              )}
            </div>
          )}
          {revisionId && revision && (
            <div className="space-y-5">
              {selected?.type === 'chapter' &&
                chapterId &&
                revision.revision.status === 'DRAFT' && (
                  <FormBox title="Edit chapter metadata">
                    <form
                      key={chapterId}
                      className="grid gap-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        const lines = (name: string) =>
                          value(form, name)
                            .split(/\r?\n/)
                            .map((line) => line.trim())
                            .filter(Boolean);
                        void run(
                          () =>
                            api.studio.change(`chapters/${chapterId}`, {
                              slug: value(form, 'slug'),
                              title: value(form, 'title'),
                              summary: value(form, 'summary') || null,
                              previewText: value(form, 'previewText') || null,
                              learningOutcomes: lines('learningOutcomes'),
                              prerequisites: lines('prerequisites'),
                            }),
                          'Chapter metadata saved',
                        );
                      }}
                    >
                      <label className={field}>
                        Chapter slug
                        <input
                          className={input}
                          name="slug"
                          defaultValue={
                            revision.chapters.find((item) => item.id === chapterId)?.slug ?? ''
                          }
                          required
                          pattern="[a-z0-9][a-z0-9-]*"
                        />
                      </label>
                      <label className={field}>
                        Chapter title
                        <input
                          className={input}
                          name="title"
                          defaultValue={
                            revision.chapters.find((item) => item.id === chapterId)?.title ?? ''
                          }
                          required
                        />
                      </label>
                      <label className={field}>
                        Chapter summary (optional)
                        <textarea
                          className={input}
                          name="summary"
                          defaultValue={
                            revision.chapters.find((item) => item.id === chapterId)?.summary ?? ''
                          }
                        />
                      </label>
                      <label className={field}>
                        Public sample preview (optional)
                        <textarea
                          className={input}
                          name="previewText"
                          defaultValue={
                            revision.chapters.find((item) => item.id === chapterId)?.previewText ??
                            ''
                          }
                        />
                      </label>
                      <label className={field}>
                        Learning outcomes (one per line)
                        <textarea
                          className={input}
                          name="learningOutcomes"
                          defaultValue={
                            revision.chapters
                              .find((item) => item.id === chapterId)
                              ?.learningOutcomes.join('\n') ?? ''
                          }
                        />
                      </label>
                      <label className={field}>
                        Prerequisites (one per line)
                        <textarea
                          className={input}
                          name="prerequisites"
                          defaultValue={
                            revision.chapters
                              .find((item) => item.id === chapterId)
                              ?.prerequisites.join('\n') ?? ''
                          }
                        />
                      </label>
                      <button disabled={busy} className={button}>
                        Save chapter
                      </button>
                    </form>
                  </FormBox>
                )}
              {selected?.type === 'revision' && revision.revision.status === 'DRAFT' && (
                <ReorderList
                  title="Chapter order"
                  items={revision.chapters}
                  path={`revisions/${revisionId}/chapters/order`}
                />
              )}
              {selected?.type === 'chapter' &&
                chapterId &&
                revision.revision.status === 'DRAFT' && (
                  <ReorderList
                    title="Lesson order"
                    items={revision.lessons.filter((item) => item.chapterId === chapterId)}
                    path={`chapters/${chapterId}/lessons/order`}
                  />
                )}
              <FormBox
                title={`Revision ${tree?.revisions.find((item) => item.id === revisionId)?.number ?? ''} · ${revision.revision.status}`}
              >
                <div className="flex flex-wrap gap-2">
                  <button
                    disabled={busy}
                    className={secondary}
                    onClick={() =>
                      void run(async () => {
                        const result = await api.request<{ data: unknown }>(
                          `/studio/revisions/${revisionId}/export`,
                        );
                        const blob = new Blob([JSON.stringify(result.data, null, 2)], {
                          type: 'application/json',
                        });
                        const href = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = href;
                        link.download = `revision-${revisionId}.json`;
                        link.click();
                        URL.revokeObjectURL(href);
                      }, 'Revision exported')
                    }
                  >
                    Export snapshot
                  </button>
                  <a
                    className={secondary}
                    href={`/api/v1/studio/revisions/${revisionId}/export.zip`}
                    download
                  >
                    Export structured ZIP
                  </a>
                  {revision.revision.status === 'DRAFT' && (
                    <button
                      disabled={busy}
                      className={button}
                      onClick={() =>
                        void run(
                          () => api.studio.action(`revisions/${revisionId}/submit`),
                          'Revision submitted for review',
                        )
                      }
                    >
                      Submit for review
                    </button>
                  )}
                  {revision.revision.status === 'APPROVED' && (
                    <button
                      disabled={busy}
                      className={button}
                      onClick={() =>
                        void run(
                          () => api.studio.action(`revisions/${revisionId}/publish`),
                          'Approved revision published',
                        )
                      }
                    >
                      Publish revision
                    </button>
                  )}
                </div>
                <p className="mt-3 break-all text-xs text-slate-500">
                  Manifest: {revision.revision.manifestHash ?? 'Created when submitted'}
                </p>
              </FormBox>
              {selected?.type === 'revision' && revision.revision.status === 'DRAFT' && (
                <div className="grid gap-5 xl:grid-cols-2">
                  <FormBox title="Add chapter">
                    <form
                      className="grid gap-3"
                      onSubmit={(event) =>
                        submit(
                          event,
                          (form) =>
                            api.studio.create(`revisions/${revisionId}/chapters`, {
                              ordinal: Number(value(form, 'ordinal')),
                              slug: value(form, 'slug'),
                              title: value(form, 'title'),
                              summary: value(form, 'summary') || undefined,
                              previewText: value(form, 'previewText') || undefined,
                            }),
                          'Chapter created',
                        )
                      }
                    >
                      <label className={field}>
                        Order
                        <input className={input} name="ordinal" type="number" min="1" required />
                      </label>
                      <label className={field}>
                        Slug
                        <input className={input} name="slug" required />
                      </label>
                      <label className={field}>
                        Title
                        <input className={input} name="title" required />
                      </label>
                      <label className={field}>
                        Summary
                        <textarea className={input} name="summary" />
                      </label>
                      <label className={field}>
                        Public sample preview (optional)
                        <textarea className={input} name="previewText" />
                      </label>
                      <button disabled={busy} className={button}>
                        Add chapter
                      </button>
                    </form>
                  </FormBox>
                  <FormBox title="Bibliography">
                    <form
                      className="grid gap-3"
                      onSubmit={(event) =>
                        submit(
                          event,
                          (form) =>
                            api.studio.create(`revisions/${revisionId}/bibliography`, {
                              citationKey: value(form, 'citationKey'),
                              citationText: value(form, 'citationText'),
                              url: value(form, 'url') || undefined,
                              ordinal: Number(value(form, 'ordinal')),
                            }),
                          'Citation added',
                        )
                      }
                    >
                      <label className={field}>
                        Order
                        <input className={input} name="ordinal" type="number" min="1" required />
                      </label>
                      <label className={field}>
                        Citation key
                        <input className={input} name="citationKey" required />
                      </label>
                      <label className={field}>
                        Citation text
                        <textarea className={input} name="citationText" required />
                      </label>
                      <label className={field}>
                        URL (optional)
                        <input className={input} name="url" type="url" />
                      </label>
                      <button disabled={busy} className={button}>
                        Add citation
                      </button>
                    </form>
                  </FormBox>
                </div>
              )}
              {selected?.type === 'revision' && revision.revision.status === 'DRAFT' && (
                <FormBox title="Supplementary learning resource">
                  <form
                    className="grid gap-3 sm:grid-cols-2"
                    onSubmit={(event) =>
                      submit(
                        event,
                        (form) =>
                          api.studio.create(`revisions/${revisionId}/resources`, {
                            title: value(form, 'title'),
                            description: value(form, 'description') || undefined,
                            format: value(form, 'format'),
                            bodyText: value(form, 'bodyText') || undefined,
                            assetId: value(form, 'assetId') || undefined,
                            accessClass: value(form, 'accessClass'),
                            licenceCode: value(form, 'licenceCode'),
                            attribution: value(form, 'attribution'),
                            copyrightNotice: value(form, 'copyrightNotice'),
                          }),
                        'Resource attached to draft revision',
                      )
                    }
                  >
                    <label className={field}>
                      Title
                      <input className={input} name="title" required />
                    </label>
                    <label className={field}>
                      Format
                      <input
                        className={input}
                        name="format"
                        placeholder="TEXT, PDF, CODE_ZIP…"
                        required
                      />
                    </label>
                    <label className={field}>
                      Access class
                      <select className={input} name="accessClass">
                        <option>RESTRICTED</option>
                        <option>PUBLIC_FREE</option>
                        <option>REGISTERED_FREE</option>
                        <option>PREMIUM</option>
                      </select>
                    </label>
                    <label className={field}>
                      Approved asset ID (optional)
                      <input
                        className={input}
                        name="assetId"
                        defaultValue={upload?.assetId ?? ''}
                      />
                    </label>
                    <label className={`${field} sm:col-span-2`}>
                      Text content (or attach an asset)
                      <textarea className={input} name="bodyText" rows={4} />
                    </label>
                    <label className={field}>
                      Licence code
                      <input
                        className={input}
                        name="licenceCode"
                        defaultValue={detail?.publication.licenceCode ?? ''}
                        required
                      />
                    </label>
                    <label className={field}>
                      Attribution
                      <input className={input} name="attribution" required />
                    </label>
                    <label className={`${field} sm:col-span-2`}>
                      Copyright notice
                      <input
                        className={input}
                        name="copyrightNotice"
                        defaultValue={detail?.publication.copyrightNotice ?? ''}
                        required
                      />
                    </label>
                    <label className={`${field} sm:col-span-2`}>
                      Description
                      <textarea className={input} name="description" />
                    </label>
                    <button disabled={busy} className={button}>
                      Attach resource
                    </button>
                  </form>
                </FormBox>
              )}
              {selected?.type === 'chapter' &&
                chapterId &&
                revision.revision.status === 'DRAFT' && (
                  <FormBox title="Add lesson">
                    <form
                      className="grid gap-3"
                      onSubmit={(event) =>
                        submit(
                          event,
                          (form) =>
                            api.studio.create(`chapters/${chapterId}/lessons`, {
                              ordinal: Number(value(form, 'ordinal')),
                              title: value(form, 'title'),
                              bodyMarkdown: value(form, 'bodyMarkdown'),
                            }),
                          'Lesson created',
                        )
                      }
                    >
                      <label className={field}>
                        Order
                        <input className={input} name="ordinal" type="number" min="1" required />
                      </label>
                      <label className={field}>
                        Title
                        <input className={input} name="title" required />
                      </label>
                      <label className={field}>
                        Markdown
                        <textarea className={`${input} min-h-40 font-mono`} name="bodyMarkdown" />
                      </label>
                      <button disabled={busy} className={button}>
                        Add lesson
                      </button>
                    </form>
                  </FormBox>
                )}
              {revision.lessons.length > 0 && (
                <FormBox title="Lessons">
                  <ul className="space-y-2">
                    {revision.lessons.map((lesson) => (
                      <li key={lesson.id}>
                        <button
                          type="button"
                          className="text-left font-semibold underline"
                          onClick={() =>
                            select({
                              type: 'lesson',
                              id: lesson.id,
                              label: lesson.title,
                              publicationId,
                              editionId,
                              revisionId,
                              chapterId: lesson.chapterId,
                            })
                          }
                        >
                          {lesson.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </FormBox>
              )}
              {selected?.type === 'lesson' && revision.revision.status === 'DRAFT' && (
                <FormBox title="Edit lesson">
                  <form
                    className="grid gap-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      let blocks: unknown;
                      try {
                        blocks = blocksText.trim() ? JSON.parse(blocksText) : undefined;
                      } catch {
                        setError('Rich blocks must be valid JSON.');
                        return;
                      }
                      void run(
                        () =>
                          api.studio.change(`lessons/${selected.id}`, {
                            title: lessonTitle,
                            bodyMarkdown: lessonText,
                            blocks,
                          }),
                        'Lesson saved',
                      );
                    }}
                  >
                    <label className={field}>
                      Title
                      <input
                        className={input}
                        value={lessonTitle}
                        onChange={(event) => setLessonTitle(event.target.value)}
                        required
                      />
                    </label>
                    <label className={field}>
                      Markdown
                      <textarea
                        className={`${input} min-h-64 font-mono`}
                        value={lessonText}
                        onChange={(event) => setLessonText(event.target.value)}
                      />
                    </label>
                    <label className={field}>
                      Rich blocks JSON (paragraph, heading, code, image, diagram)
                      <textarea
                        className={`${input} min-h-32 font-mono`}
                        value={blocksText}
                        onChange={(event) => setBlocksText(event.target.value)}
                      />
                    </label>
                    <button disabled={busy} className={button}>
                      Save lesson
                    </button>
                  </form>
                </FormBox>
              )}
              {revision.revision.status === 'IN_REVIEW' && (
                <FormBox title="Editorial review">
                  <form
                    className="grid gap-3"
                    onSubmit={(event) =>
                      submit(
                        event,
                        (form) =>
                          api.studio.action(`revisions/${revisionId}/review`, {
                            decision: value(form, 'decision'),
                            comment: value(form, 'comment'),
                          }),
                        'Review recorded',
                      )
                    }
                  >
                    <label className={field}>
                      Decision
                      <select className={input} name="decision">
                        <option>APPROVED</option>
                        <option>CHANGES_REQUESTED</option>
                        <option>REJECTED</option>
                      </select>
                    </label>
                    <label className={field}>
                      Review comment
                      <textarea className={input} name="comment" required />
                    </label>
                    <button disabled={busy} className={button}>
                      Record review
                    </button>
                  </form>
                </FormBox>
              )}
              {revision.revision.status === 'APPROVED' && (
                <div className="grid gap-5 xl:grid-cols-2">
                  <FormBox title="Rights attestation">
                    <form
                      className="grid gap-3"
                      onSubmit={(event) =>
                        submit(
                          event,
                          (form) =>
                            api.studio.action(`revisions/${revisionId}/rights`, {
                              licenceCode: value(form, 'licenceCode'),
                              sourceRef: value(form, 'sourceRef'),
                            }),
                          'Exact manifest rights attested',
                        )
                      }
                    >
                      <label className={field}>
                        Licence code
                        <input
                          className={input}
                          name="licenceCode"
                          defaultValue={detail?.publication.licenceCode ?? ''}
                          required
                        />
                      </label>
                      <label className={field}>
                        Content source reference
                        <input
                          className={input}
                          name="sourceRef"
                          defaultValue={detail?.publication.sourceRef ?? ''}
                          required
                        />
                      </label>
                      <button disabled={busy} className={button}>
                        Attest rights
                      </button>
                    </form>
                  </FormBox>
                  <FormBox title="Schedule release">
                    <form
                      className="grid gap-3"
                      onSubmit={(event) =>
                        submit(
                          event,
                          (form) =>
                            api.studio.action(`revisions/${revisionId}/schedule`, {
                              at: new Date(value(form, 'at')).toISOString(),
                              reason: value(form, 'reason'),
                            }),
                          'Release scheduled',
                        )
                      }
                    >
                      <label className={field}>
                        Release time
                        <input className={input} name="at" type="datetime-local" required />
                      </label>
                      <label className={field}>
                        Reason
                        <input className={input} name="reason" required />
                      </label>
                      <button disabled={busy} className={button}>
                        Schedule release
                      </button>
                    </form>
                  </FormBox>
                </div>
              )}
              {revision.revision.status === 'PUBLISHED' && (
                <FormBox title="Correction notice">
                  <form
                    className="grid gap-3"
                    onSubmit={(event) =>
                      submit(
                        event,
                        (form) =>
                          api.studio.action(`revisions/${revisionId}/errata`, {
                            notice: value(form, 'notice'),
                          }),
                        'Correction notice recorded',
                      )
                    }
                  >
                    <label className={field}>
                      Notice
                      <textarea className={input} name="notice" required />
                    </label>
                    <button disabled={busy} className={button}>
                      Add notice
                    </button>
                  </form>
                </FormBox>
              )}
              <FormBox title="Compare revisions">
                <div className="flex flex-wrap gap-2">
                  <select className={input} aria-label="Revision to compare" id="comparison-source">
                    <option value="">Select earlier revision</option>
                    {detail?.revisions
                      .filter((item) => item.editionId === editionId && item.id !== revisionId)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          Revision {item.number}
                        </option>
                      ))}
                  </select>
                  <button
                    className={secondary}
                    onClick={() => {
                      const from = (
                        document.getElementById('comparison-source') as HTMLSelectElement
                      ).value;
                      if (!from) return;
                      void run(async () => {
                        const result = await api.request<{ data: unknown }>(
                          `/studio/revisions/${revisionId}/compare?from=${from}`,
                        );
                        setComparison(JSON.stringify(result.data, null, 2));
                      }, 'Comparison ready');
                    }}
                  >
                    Compare
                  </button>
                </div>
                {comparison && (
                  <pre className="mt-3 max-h-96 overflow-auto rounded bg-slate-950 p-4 text-xs text-white">
                    {comparison}
                  </pre>
                )}
              </FormBox>
            </div>
          )}
          {importJob && (
            <FormBox title="Import job">
              <p role="status">
                Status: <strong>{importJob.status}</strong>
                {importJob.failureCode && ` · ${importJob.failureCode}`}
                {importJob.revisionId && ` · Draft revision ${importJob.revisionId}`}
              </p>
              {importJob.preview !== null && (
                <details className="mt-3">
                  <summary className="cursor-pointer font-semibold">
                    Review extracted chapters
                  </summary>
                  <pre className="max-h-64 overflow-auto rounded bg-slate-100 p-3 text-xs">
                    {JSON.stringify(importJob.preview, null, 2)}
                  </pre>
                </details>
              )}
              {importJob.status === 'READY' && (
                <button
                  disabled={busy}
                  className={`${button} mt-3`}
                  onClick={() =>
                    void run(
                      () => api.studio.action(`imports/${importJob.id}/confirm`),
                      'Import confirmed; creating draft revision',
                    )
                  }
                >
                  Confirm destination and create draft
                </button>
              )}
              {importJob.status === 'FAILED' && (
                <button
                  disabled={busy}
                  className={`${secondary} mt-3`}
                  onClick={() =>
                    void run(
                      () => api.studio.action(`imports/${importJob.id}/retry`),
                      'Import retry queued',
                    )
                  }
                >
                  Retry import
                </button>
              )}
            </FormBox>
          )}
        </main>
      </div>
    </div>
  );
}

function EditionForm({
  publicationId,
  volumeId,
  busy,
  submit,
  allowInitialDefault,
}: {
  publicationId: string;
  volumeId?: string;
  busy: boolean;
  allowInitialDefault: boolean;
  submit: (
    event: FormEvent<HTMLFormElement>,
    action: (data: FormData) => Promise<unknown>,
    success: string,
  ) => void;
}) {
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) =>
        submit(
          event,
          (form) =>
            api.studio.create(`publications/${publicationId}/editions`, {
              volumeId: volumeId ?? null,
              editionCode: value(form, 'editionCode'),
              label: value(form, 'label'),
              isbn13: value(form, 'isbn13') || undefined,
              isDefault: form.get('isDefault') === 'on',
            }),
          'Edition created',
        )
      }
    >
      <label className={field}>
        Edition code
        <input className={input} name="editionCode" required />
      </label>
      <label className={field}>
        Edition label
        <input className={input} name="label" required />
      </label>
      <label className={field}>
        ISBN-13, if assigned
        <input className={input} name="isbn13" pattern="97[89][0-9]{10}" />
      </label>
      {allowInitialDefault && (
        <label className="flex items-center gap-2 text-sm">
          <input name="isDefault" type="checkbox" />
          Make initial default edition
        </label>
      )}
      <button disabled={busy} className={button}>
        Create edition
      </button>
    </form>
  );
}
