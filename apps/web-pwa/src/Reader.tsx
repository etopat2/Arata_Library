import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  ApiError,
  createApiClient,
  type CatalogueEditionSummary,
  type ReaderLesson,
  type ReaderManifest,
} from '@arata/api-client';

const api = createApiClient().reader;
const catalogue = createApiClient().catalogue;
const route = new URLSearchParams(location.search);
const initialEdition = route.get('edition') ?? '';
const initialLesson = route.get('lesson') ?? '';
const link = (edition: string, lesson?: string) =>
  `/?${new URLSearchParams({ screen: 'reader', edition, ...(lesson ? { lesson } : {}) })}`;

function highlighted(value: string, quotes: string[]): ReactNode {
  const matches = quotes.filter(Boolean);
  if (!matches.length) return value;
  const escaped = matches.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = value.split(new RegExp(`(${escaped.join('|')})`, 'g'));
  return parts.map((part, index) =>
    matches.includes(part) ? (
      <mark key={index} className="bg-yellow-200 text-slate-900">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function Content({ markdown, quotes }: { markdown: string; quotes: string[] }) {
  const lines = markdown.split(/\r?\n/);
  const result: ReactNode[] = [];
  let code: string[] = [];
  let text: string[] = [];
  let inCode = false;
  const flushText = () => {
    if (text.length)
      result.push(
        <p key={`p-${result.length}`} className="my-5 whitespace-pre-wrap leading-relaxed">
          {highlighted(text.join('\n'), quotes)}
        </p>,
      );
    text = [];
  };
  for (const line of lines) {
    if (line.startsWith('```')) {
      flushText();
      if (inCode) {
        result.push(
          <pre
            key={`c-${result.length}`}
            className="my-5 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-50"
          >
            <code>{code.join('\n')}</code>
          </pre>,
        );
        code = [];
      }
      inCode = !inCode;
    } else if (inCode) code.push(line);
    else if (/^#{1,4} /.test(line)) {
      flushText();
      const level = line.match(/^#+/)![0].length;
      const title = line.slice(level + 1);
      result.push(
        level <= 2 ? (
          <h2 key={`h-${result.length}`} className="mt-8 text-2xl font-bold">
            {title}
          </h2>
        ) : (
          <h3 key={`h-${result.length}`} className="mt-6 text-xl font-semibold">
            {title}
          </h3>
        ),
      );
    } else if (line.trim() === '') flushText();
    else text.push(line);
  }
  flushText();
  if (code.length)
    result.push(
      <pre key="trailing-code">
        <code>{code.join('\n')}</code>
      </pre>,
    );
  return <>{result}</>;
}

export function Reader() {
  const [manifest, setManifest] = useState<ReaderManifest | null>(null);
  const [lesson, setLesson] = useState<ReaderLesson | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState<{ id: string; title: string; snippet: string }[]>([]);
  const [annotations, setAnnotations] = useState<
    { id: string; anchor: string; kind: string; quote: string; note: string }[]
  >([]);
  const [editions, setEditions] = useState<CatalogueEditionSummary[]>([]);
  const [completed, setCompleted] = useState<string[]>([]);
  const [bookmarks, setBookmarks] = useState<{ id: string; anchor: string }[]>([]);
  const [selected, setSelected] = useState('');
  const [note, setNote] = useState('');
  const [fontSize, setFontSize] = useState(() =>
    Number(localStorage.getItem('arata-reader-font') ?? 18),
  );
  const [theme, setTheme] = useState(() => localStorage.getItem('arata-reader-theme') ?? 'paper');

  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      try {
        if (!initialEdition) throw new Error('Choose an edition from the catalogue.');
        const toc = (await api.manifest(initialEdition, abort.signal)).data;
        setManifest(toc);
        const target = initialLesson || toc.lessons.find((item) => item.available)?.id;
        if (target) {
          const opened = (await api.lesson(target, abort.signal)).data;
          setLesson(opened);
          try {
            setEditions(
              (await catalogue.publication(opened.publicationSlug, abort.signal)).data.editions ??
                [],
            );
          } catch {
            /* optional catalogue metadata */
          }
          try {
            setAnnotations((await api.annotations(target)).data);
          } catch {
            /* anonymous reading */
          }
          try {
            setCompleted(
              (await api.editionProgress(initialEdition)).data
                .filter((item) => item.completedAt)
                .map((item) => item.lessonId),
            );
            setBookmarks((await api.bookmarks(initialEdition)).data);
          } catch {
            /* anonymous reading */
          }
        }
      } catch (reason) {
        if (abort.signal.aborted) return;
        setError(
          reason instanceof ApiError
            ? reason.status === 401
              ? 'Sign in to read this lesson.'
              : reason.status === 403
                ? 'Your current access does not include this lesson.'
                : 'This lesson is unavailable.'
            : reason instanceof Error
              ? reason.message
              : 'Reader could not load.',
        );
      } finally {
        if (!abort.signal.aborted) setBusy(false);
      }
    }
    void load();
    return () => abort.abort();
  }, []);

  async function find(event: FormEvent) {
    event.preventDefault();
    try {
      setMatches((await api.search(initialEdition, search)).data);
      setStatus('Search results include content you can currently read.');
    } catch {
      setStatus('Search is unavailable. Try again.');
    }
  }
  async function save(kind: 'bookmark' | 'complete') {
    if (!lesson) return;
    try {
      if (kind === 'bookmark') await api.bookmark(lesson.id, 'start');
      else await api.progress(lesson.id, { completed: true, percent: 100 });
      if (kind === 'complete') setCompleted((current) => [...new Set([...current, lesson.id])]);
      else setBookmarks((current) => [...current, { id: lesson.id, anchor: `${lesson.id}:start` }]);
      setStatus(kind === 'bookmark' ? 'Bookmark saved.' : 'Lesson marked complete.');
    } catch (reason) {
      setStatus(
        reason instanceof ApiError && reason.status === 401
          ? 'Sign in to save your reading.'
          : 'Could not save your reading.',
      );
    }
  }
  async function copyExcerpt() {
    if (!lesson?.policy.allowCopy) return;
    const selection = window.getSelection()?.toString() ?? '';
    if (!selection) {
      setStatus('Select an excerpt first.');
      return;
    }
    if (selection.length > lesson.policy.maxCopyChars) {
      setStatus(`Select at most ${lesson.policy.maxCopyChars} characters.`);
      return;
    }
    try {
      await navigator.clipboard.writeText(selection);
      setStatus('Permitted excerpt copied.');
    } catch {
      setStatus('Clipboard unavailable in this browser.');
    }
  }
  function captureSelection() {
    const value = window.getSelection()?.toString().trim() ?? '';
    if (value && value.length <= 100) setSelected(value);
    else setStatus('Select no more than 100 characters for a highlight.');
  }
  async function annotate(kind: 'NOTE' | 'HIGHLIGHT') {
    if (!lesson || !selected) return;
    try {
      await api.annotate(lesson.id, {
        anchor: `quote:${selected}`,
        kind,
        quote: selected,
        ...(note ? { note } : {}),
      });
      setAnnotations((await api.annotations(lesson.id)).data);
      setNote('');
      setSelected('');
      setStatus('Private annotation saved.');
    } catch {
      setStatus('Sign in to save a private annotation, then try again.');
    }
  }
  async function downloadAsset() {
    if (!lesson) return;
    try {
      const grant = (await api.assetGrant(lesson.id)).data;
      location.href = `/api/v1/reader/assets/${encodeURIComponent(grant.assetId)}?grant=${encodeURIComponent(grant.token)}`;
    } catch {
      setStatus('The licensed file is unavailable for download.');
    }
  }
  const palette =
    theme === 'night'
      ? 'bg-slate-950 text-slate-100'
      : theme === 'sepia'
        ? 'bg-amber-50 text-stone-900'
        : 'bg-white text-slate-900';
  return (
    <div className={`min-h-screen ${palette}`}>
      <a
        href="#reader-main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-3 focus:text-black"
      >
        Skip to reading
      </a>
      <header className="border-b border-current/20 px-4 py-4">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <a href="/" className="font-bold underline">
            Arata TechLibrary
          </a>
          <span className="text-sm">{lesson?.publicationTitle ?? 'Digital reader'}</span>
          <a href="/?screen=catalogue" className="underline">
            Browse library
          </a>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <nav
          aria-label="Table of contents"
          className="rounded-xl border border-current/20 p-4 lg:self-start"
        >
          <h2 className="text-lg font-bold">Contents</h2>
          {busy && <p role="status">Loading contents…</p>}
          <ol className="mt-4 space-y-2">
            {manifest?.lessons.map((item) => (
              <li key={item.id}>
                <a
                  aria-current={item.id === lesson?.id ? 'page' : undefined}
                  className={`block rounded p-2 underline-offset-2 hover:underline focus-visible:outline ${item.id === lesson?.id ? 'font-bold' : ''}`}
                  href={link(initialEdition, item.id)}
                >
                  <span className="block text-xs opacity-70">
                    {item.chapterOrdinal}. {item.chapterTitle}
                  </span>
                  {item.title}{' '}
                  {completed.includes(item.id) && <span className="text-xs">(complete)</span>}{' '}
                  {!item.available && <span className="text-xs">(restricted)</span>}
                </a>
              </li>
            ))}
          </ol>
          <form className="mt-8" onSubmit={(event) => void find(event)}>
            <label className="block text-sm font-semibold" htmlFor="reader-search">
              Search this edition
            </label>
            <input
              id="reader-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              minLength={2}
              maxLength={160}
              required
              className="mt-2 w-full rounded border border-slate-500 bg-white p-2 text-slate-900"
            />
            <button className="mt-2 rounded border border-current px-3 py-2">Search</button>
          </form>
          <ul className="mt-3 space-y-2" aria-label="Accessible search results">
            {matches.map((item) => (
              <li key={item.id}>
                <a className="underline" href={link(initialEdition, item.id)}>
                  {item.title}
                </a>
                <p className="text-xs">{item.snippet}</p>
              </li>
            ))}
          </ul>
        </nav>
        <main id="reader-main" className="min-w-0">
          {!busy && !error && manifest?.lessons.length === 0 && (
            <p role="status" className="rounded border border-current/20 p-4">
              This edition has no published lessons yet. Browse its chapter previews in the
              catalogue.
            </p>
          )}
          {!busy && !error && manifest && manifest.lessons.length > 0 && !lesson && (
            <p role="status" className="rounded border border-current/20 p-4">
              Select an available lesson from the table of contents to begin reading.
            </p>
          )}
          {error && (
            <div role="alert" className="rounded border border-red-500 p-4">
              {error}
            </div>
          )}
          {status && (
            <p role="status" className="mb-4 rounded border border-current/30 p-3">
              {status}
            </p>
          )}
          {lesson && (
            <>
              <p className="text-sm opacity-70">
                {lesson.editionLabel} · Revision {lesson.revisionNumber} · {lesson.chapterTitle}
              </p>
              {editions.length > 1 && (
                <div className="mt-3 rounded border border-current/20 p-3 text-sm">
                  <p className="font-semibold">Other editions</p>
                  <p>
                    Changing editions may change your access and content anchors. Notes remain with
                    their original revision.
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-3">
                    {editions
                      .filter((item) => item.id !== lesson.editionId)
                      .map((item) => (
                        <li key={item.id}>
                          <a className="underline" href={link(item.id)}>
                            {item.label}
                          </a>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
              <h1 className="mt-3 text-3xl font-bold">{lesson.title}</h1>
              <div
                className="my-6 flex flex-wrap items-end gap-3 rounded-xl border border-current/20 p-4"
                aria-label="Reading preferences and actions"
              >
                <label>
                  Theme{' '}
                  <select
                    value={theme}
                    onChange={(event) => {
                      setTheme(event.target.value);
                      localStorage.setItem('arata-reader-theme', event.target.value);
                    }}
                    className="ml-2 rounded border border-slate-500 bg-white p-2 text-slate-900"
                  >
                    <option value="paper">Paper</option>
                    <option value="sepia">Sepia</option>
                    <option value="night">Night</option>
                  </select>
                </label>
                <label>
                  Text size{' '}
                  <select
                    value={fontSize}
                    onChange={(event) => {
                      const size = Number(event.target.value);
                      setFontSize(size);
                      localStorage.setItem('arata-reader-font', String(size));
                    }}
                    className="ml-2 rounded border border-slate-500 bg-white p-2 text-slate-900"
                  >
                    <option value="16">Small</option>
                    <option value="18">Medium</option>
                    <option value="21">Large</option>
                    <option value="24">Extra large</option>
                  </select>
                </label>
                <button
                  className="rounded border border-current px-3 py-2"
                  onClick={() => void save('bookmark')}
                >
                  Bookmark
                </button>
                <button
                  className="rounded border border-current px-3 py-2"
                  onClick={() => void save('complete')}
                >
                  Mark complete
                </button>
                {lesson.policy.allowSelect && (
                  <button
                    className="rounded border border-current px-3 py-2"
                    onClick={captureSelection}
                  >
                    Highlight selection
                  </button>
                )}
                {lesson.policy.allowCopy && (
                  <button
                    className="rounded border border-current px-3 py-2"
                    onClick={() => void copyExcerpt()}
                  >
                    Copy selected excerpt
                  </button>
                )}
                {lesson.policy.allowPrint && (
                  <button
                    className="rounded border border-current px-3 py-2"
                    onClick={() => window.print()}
                  >
                    Print
                  </button>
                )}
                {lesson.policy.allowDownload && lesson.hasBodyAsset && (
                  <button
                    className="rounded border border-current px-3 py-2"
                    onClick={() => void downloadAsset()}
                  >
                    Download licensed file
                  </button>
                )}
              </div>
              <details className="mb-6 rounded border border-current/20 p-3">
                <summary className="cursor-pointer font-semibold">Content permissions</summary>
                <ul className="mt-2 list-inside list-disc text-sm">
                  <li>
                    Selection: {lesson.policy.allowSelect ? 'permitted' : 'restricted by licence'}
                  </li>
                  <li>
                    Copying:{' '}
                    {lesson.policy.allowCopy
                      ? `up to ${lesson.policy.maxCopyChars} characters`
                      : 'restricted by licence'}
                  </li>
                  <li>
                    Printing: {lesson.policy.allowPrint ? 'permitted' : 'restricted by licence'}
                  </li>
                  <li>
                    Download:{' '}
                    {lesson.policy.allowDownload
                      ? 'permitted when a licensed file is offered'
                      : 'unavailable'}
                  </li>
                  <li>
                    Offline:{' '}
                    {lesson.policy.allowOffline
                      ? 'permitted when an offline licence is issued'
                      : 'unavailable'}
                  </li>
                  <li>
                    Screenshot notice:{' '}
                    {lesson.policy.screenshotMode.replaceAll('_', ' ').toLowerCase()}
                  </li>
                </ul>
                <p className="mt-2 text-sm">
                  Browser controls cannot block operating system screenshots or copying of content
                  already displayed.
                </p>
              </details>
              {lesson.screenshotNotice && (
                <p className="mb-6 rounded border border-current/20 p-3 text-sm">
                  {lesson.screenshotNotice}
                </p>
              )}
              <article
                className="prose max-w-3xl"
                style={{ fontSize, lineHeight: 1.75 }}
                aria-label="Lesson content"
              >
                {lesson.bodyMarkdown ? (
                  <Content
                    markdown={lesson.bodyMarkdown}
                    quotes={annotations
                      .filter((item) => item.kind === 'HIGHLIGHT')
                      .map((item) => item.quote)}
                  />
                ) : (
                  <p>
                    No inline lesson text is available.{' '}
                    {lesson.hasBodyAsset ? 'A licensed asset may be available separately.' : ''}
                  </p>
                )}
              </article>
              {selected && (
                <section
                  aria-label="Save selected text"
                  className="mt-6 max-w-3xl rounded border border-current/30 p-4"
                >
                  <p className="font-semibold">Selected excerpt</p>
                  <blockquote className="my-2 border-l-4 border-current pl-3">
                    {selected}
                  </blockquote>
                  <label className="block">
                    Private note (optional)
                    <textarea
                      maxLength={160}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      className="mt-1 block w-full rounded border border-slate-500 bg-white p-2 text-slate-900"
                    />
                  </label>
                  <div className="mt-3 flex gap-3">
                    <button
                      className="rounded border border-current px-3 py-2"
                      onClick={() => void annotate('HIGHLIGHT')}
                    >
                      Save highlight
                    </button>
                    <button
                      className="rounded border border-current px-3 py-2"
                      onClick={() => void annotate('NOTE')}
                    >
                      Save note
                    </button>
                  </div>
                </section>
              )}
              <section className="mt-8 max-w-3xl" aria-label="Private notes and highlights">
                <h2 className="text-xl font-semibold">Your private notes and highlights</h2>
                <ol className="mt-3 space-y-3">
                  {annotations.map((item) => (
                    <li className="rounded border border-current/30 p-3" key={item.id}>
                      <p className="text-xs font-bold">
                        {item.kind === 'NOTE' ? 'Note' : 'Highlight'}
                      </p>
                      <blockquote className="mt-1 border-l-2 border-current pl-2">
                        {item.quote}
                      </blockquote>
                      {item.note && <p className="mt-2">{item.note}</p>}
                      <button
                        className="mt-2 text-sm underline"
                        onClick={() => {
                          void api
                            .deleteAnnotation(item.id)
                            .then(() => setAnnotations(annotations.filter((a) => a.id !== item.id)))
                            .catch(() => setStatus('Could not remove annotation.'));
                        }}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
              {bookmarks.length > 0 && (
                <section className="mt-7 max-w-3xl" aria-label="Your bookmarks">
                  <h2 className="text-xl font-semibold">Bookmarks</h2>
                  <p>
                    {bookmarks.length} saved place{bookmarks.length === 1 ? '' : 's'} in this
                    edition.
                  </p>
                </section>
              )}
              {lesson.watermark && (
                <p className="mt-8 border-t border-current/20 pt-3 text-xs opacity-70">
                  Licensed reader reference: {lesson.watermark}
                </p>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
