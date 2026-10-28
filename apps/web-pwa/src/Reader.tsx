import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ApiError,
  createApiClient,
  type CatalogueEditionSummary,
  type ReaderLesson,
  type ReaderManifest,
  type ReaderSettings,
} from '@arata/api-client';
import { ReaderBlocks, ReaderContent } from './ReaderContent.js';
import {
  getDeviceId,
  listOfflinePackages,
  listPendingChanges,
  offlinePackageValidity,
  queueOfflineChange,
  readOfflineLesson,
  readOfflineAsset,
  readOfflineReaderState,
  removeOfflinePackage,
  removePendingChanges,
  saveOfflinePackage,
  storeOfflineReaderState,
  type OfflinePackage,
  type PendingChange,
} from './offline-store.js';
import { downloadEdition } from './offline-download.js';

const api = createApiClient().reader;
const catalogue = createApiClient().catalogue;
const route = new URLSearchParams(location.search);
const initialEdition = route.get('edition') ?? '';
const initialLesson = route.get('lesson') ?? '';
const link = (edition: string, lesson?: string) =>
  `/?${new URLSearchParams({ screen: 'reader', edition, ...(lesson ? { lesson } : {}) })}`;
const fontFamilies = {
  system: 'ui-sans-serif, system-ui, sans-serif',
  serif: 'Georgia, Times New Roman, serif',
  mono: 'ui-monospace, Menlo, Consolas, monospace',
} as const;
type FontFamily = keyof typeof fontFamilies;

export function Reader({
  updateReady = false,
  onUpdate,
}: {
  updateReady?: boolean;
  onUpdate?: () => void;
}) {
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
  const [fontSize, setFontSize] = useState<ReaderSettings['fontSize']>(() => {
    const stored = Number(localStorage.getItem('arata-reader-font') ?? 18);
    return ([16, 18, 21, 24].includes(stored) ? stored : 18) as ReaderSettings['fontSize'];
  });
  const [theme, setTheme] = useState<ReaderSettings['theme']>(() => {
    const stored = localStorage.getItem('arata-reader-theme');
    return stored === 'night' || stored === 'sepia' ? stored : 'paper';
  });
  const [fontFamily, setFontFamily] = useState<FontFamily>(() => {
    const stored = localStorage.getItem('arata-reader-family');
    return stored === 'serif' || stored === 'mono' ? stored : 'system';
  });
  const [lineSpacing, setLineSpacing] = useState<ReaderSettings['lineSpacing']>(() => {
    const stored = Number(localStorage.getItem('arata-reader-spacing') ?? 1.75);
    return ([1.5, 1.75, 2].includes(stored) ? stored : 1.75) as ReaderSettings['lineSpacing'];
  });
  const [reducedMotion, setReducedMotion] = useState(() => {
    const stored = localStorage.getItem('arata-reader-reduced-motion');
    return stored === null
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : stored === 'true';
  });
  const [accountSync, setAccountSync] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [offlinePackage, setOfflinePackage] = useState<OfflinePackage | null>(null);
  const [offlinePackages, setOfflinePackages] = useState<OfflinePackage[]>([]);
  const [pendingRemoval, setPendingRemoval] = useState<{ id: string; count: number } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState('');
  const [offlineActionBusy, setOfflineActionBusy] = useState(false);
  const [syncConflicts, setSyncConflicts] = useState<
    {
      change: PendingChange;
      serverUpdatedAt: string;
      serverCompletedAt: string | null;
    }[]
  >([]);
  const settingsQueue = useRef<Promise<void>>(Promise.resolve());
  const currentSettings: ReaderSettings = {
    theme,
    fontSize,
    fontFamily,
    lineSpacing,
    reducedMotion,
  };
  const settingsRef = useRef(currentSettings);
  settingsRef.current = currentSettings;

  function applySettings(value: ReaderSettings) {
    settingsRef.current = value;
    setTheme(value.theme);
    setFontSize(value.fontSize);
    setFontFamily(value.fontFamily);
    setLineSpacing(value.lineSpacing);
    setReducedMotion(value.reducedMotion);
    localStorage.setItem('arata-reader-theme', value.theme);
    localStorage.setItem('arata-reader-font', String(value.fontSize));
    localStorage.setItem('arata-reader-family', value.fontFamily);
    localStorage.setItem('arata-reader-spacing', String(value.lineSpacing));
    localStorage.setItem('arata-reader-reduced-motion', String(value.reducedMotion));
  }

  function changeSettings(value: Partial<ReaderSettings>) {
    const next = { ...settingsRef.current, ...value };
    applySettings(next);
    if (accountSync) {
      settingsQueue.current = settingsQueue.current
        .then(async () => {
          await api.saveSettings(next);
        })
        .catch(() => {
          setStatus('Your display settings remain on this device; account sync failed.');
        });
    }
  }

  useEffect(() => {
    const abort = new AbortController();
    const onlineChanged = () => setOnline(navigator.onLine);
    const migrationFailed = () =>
      setStatus(
        'Older offline changes could not be encrypted on this device. Free device storage and reconnect before using offline notes or progress.',
      );
    window.addEventListener('online', onlineChanged);
    window.addEventListener('offline', onlineChanged);
    window.addEventListener('arata-offline-migration-failed', migrationFailed);
    async function load() {
      try {
        if (!initialEdition) throw new Error('Choose an edition from the catalogue.');
        try {
          const accountSettings = (await api.settings(abort.signal)).data;
          if (!abort.signal.aborted) {
            if (accountSettings) applySettings(accountSettings);
            setAccountSync(true);
          }
        } catch (reason) {
          if (!(reason instanceof ApiError && reason.status === 401) && !abort.signal.aborted)
            setStatus('Account settings could not load; device settings remain available.');
        }
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
          const cached = (await listOfflinePackages()).find(
            (item) => item.editionId === initialEdition && item.status === 'ready',
          );
          if (cached) {
            setOfflinePackage(cached);
            const state = await readOfflineReaderState<{
              completed: string[];
              bookmarks: { id: string; anchor: string }[];
              annotations: {
                id: string;
                anchor: string;
                kind: string;
                quote: string;
                note: string;
              }[];
            }>(cached.id);
            if (state) {
              setCompleted(state.completed);
              setBookmarks(state.bookmarks);
              setAnnotations(state.annotations);
            }
            await storeOfflineReaderState(cached.id, {
              completed: [],
              bookmarks: [],
              annotations: [],
              ...(state ?? {}),
            });
          }
        }
      } catch (reason) {
        if (abort.signal.aborted) return;
        const cached =
          reason instanceof ApiError
            ? undefined
            : (await listOfflinePackages()).find(
                (item) => item.editionId === initialEdition && item.status === 'ready',
              );
        if (cached) {
          const validity = await offlinePackageValidity(cached);
          if (!validity.valid) {
            if (validity.reason.includes('expired')) {
              cached.status = 'expired';
              await saveOfflinePackage(cached);
            }
            setStatus(validity.reason);
          } else {
            const target =
              initialLesson && cached.licence.lessonIds.includes(initialLesson)
                ? initialLesson
                : cached.licence.lessonIds[0];
            const opened = target ? await readOfflineLesson(cached.id, target) : undefined;
            if (opened) {
              const saved = await readOfflineReaderState<{
                completed: string[];
                bookmarks: { id: string; anchor: string }[];
                annotations: {
                  id: string;
                  anchor: string;
                  kind: string;
                  quote: string;
                  note: string;
                }[];
              }>(cached.id);
              setOfflinePackage(cached);
              setLesson(opened);
              setManifest({
                editionId: cached.editionId,
                lessons: (
                  await Promise.all(
                    cached.licence.lessonIds.map(async (id: string) => {
                      const item = await readOfflineLesson(cached.id, id);
                      return item
                        ? {
                            id,
                            title: item.title,
                            chapterId: item.chapterId,
                            chapterTitle: item.chapterTitle,
                            chapterOrdinal: item.chapterOrdinal,
                            ordinal: item.ordinal,
                            available: true,
                            preview: false,
                          }
                        : null;
                    }),
                  )
                ).filter((item): item is NonNullable<typeof item> => item !== null),
              });
              setCompleted(saved?.completed ?? []);
              setBookmarks(saved?.bookmarks ?? []);
              setAnnotations(saved?.annotations ?? []);
              setStatus(
                'Offline reading is active. Its expiry is checked on this device; changes will sync when you reconnect.',
              );
              setError('');
              return;
            }
          }
        }
        setError(
          reason instanceof ApiError
            ? reason.status === 401
              ? 'Sign in to read this lesson.'
              : reason.status === 403
                ? reason.problem?.code === 'LICENSED_SESSION_LIMIT'
                  ? 'Your licensed reading seats are in use on other devices. Close another session or try again in 15 minutes.'
                  : 'Your current access does not include this lesson.'
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
    return () => {
      abort.abort();
      window.removeEventListener('online', onlineChanged);
      window.removeEventListener('offline', onlineChanged);
      window.removeEventListener('arata-offline-migration-failed', migrationFailed);
    };
  }, []);

  useEffect(() => {
    void listOfflinePackages().then(setOfflinePackages);
  }, [offlinePackage, downloadProgress]);

  useEffect(() => {
    if (offlinePackage)
      void storeOfflineReaderState(offlinePackage.id, { completed, bookmarks, annotations });
  }, [offlinePackage, completed, bookmarks, annotations]);

  useEffect(() => {
    if (!online || !offlinePackage) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const deviceId = await getDeviceId();
        const changes = await listPendingChanges(deviceId, offlinePackage.id);
        if (!changes.length || cancelled) return;
        try {
          const result = (
            await api.syncOffline({ licenseId: offlinePackage.id, deviceId, changes })
          ).data;
          const accepted = result.outcomes.flatMap((item, index) =>
            item && typeof item === 'object' && 'accepted' in item && item.accepted === false
              ? []
              : [changes[index]?.id].filter((id): id is string => !!id),
          );
          if (accepted.length) await removePendingChanges(accepted);
          const conflicts = result.outcomes.flatMap((item, index) => {
            if (
              !item ||
              typeof item !== 'object' ||
              !('conflict' in item) ||
              item.conflict !== true
            )
              return [];
            const change = changes[index];
            if (!change) return [];
            return [
              {
                change,
                serverUpdatedAt: String('serverUpdatedAt' in item ? item.serverUpdatedAt : ''),
                serverCompletedAt:
                  'serverCompletedAt' in item && typeof item.serverCompletedAt === 'string'
                    ? item.serverCompletedAt
                    : null,
              },
            ];
          });
          setSyncConflicts(conflicts);
          if (conflicts.length)
            setStatus('Reading progress changed on another device. Choose which version to keep.');
          else if (accepted.length) setStatus('Offline reading changes synced.');
        } catch {
          // The durable queue retries on the next connection or reader visit.
        }
      })();
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [online, offlinePackage]);

  async function downloadOffline() {
    setOfflineActionBusy(true);
    setDownloadProgress('Preparing secure offline package…');
    try {
      const item = await downloadEdition(api, initialEdition, (done, total) =>
        setDownloadProgress(`Downloading lessons ${done} of ${total}…`),
      );
      setOfflinePackage(item);
      setOfflinePackages(await listOfflinePackages());
      setStatus('Offline package is ready. Licence expiry is checked whenever it is opened.');
      setDownloadProgress('');
    } catch (cause) {
      setDownloadProgress(cause instanceof Error ? cause.message : 'Package download failed.');
    } finally {
      setOfflineActionBusy(false);
    }
  }

  async function removeOffline(id: string, discardPending = false) {
    const pending = await listPendingChanges(await getDeviceId(), id);
    if (pending.length && !discardPending) {
      setPendingRemoval({ id, count: pending.length });
      setStatus('This package has unsynced reader changes. Sync them or confirm discarding them.');
      return;
    }
    if (pending.length) await removePendingChanges(pending.map((item) => item.id));
    if (navigator.onLine) await api.revokeOfflineLicence(id).catch(() => undefined);
    await removeOfflinePackage(id);
    setOfflinePackages(await listOfflinePackages());
    setPendingRemoval(null);
    if (offlinePackage?.id === id) setOfflinePackage(null);
    setStatus(
      pending.length && discardPending
        ? 'Offline package and unsynced reader changes removed from this device.'
        : 'Offline package removed from this device.',
    );
  }

  async function saveOfflineAsset(
    packageId: string,
    file: NonNullable<OfflinePackage['files']>[number],
  ) {
    const content = await readOfflineAsset(packageId, file);
    if (!content) {
      setStatus('That offline file is no longer available.');
      return;
    }
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.fileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async function queueChange(value: {
    kind: 'progress' | 'bookmark' | 'annotation';
    entityId: string;
    content?: Record<string, unknown>;
    percent?: number;
  }) {
    if (!offlinePackage) return false;
    await queueOfflineChange({
      id: crypto.randomUUID(),
      deviceId: await getDeviceId(),
      licenseId: offlinePackage.id,
      clientUpdatedAt: new Date().toISOString(),
      operation: 'upsert',
      ...value,
    });
    setStatus('Saved on this device. It will sync when you reconnect.');
    return true;
  }

  async function resolveSyncConflict(operationId: string, keepDeviceVersion: boolean) {
    const conflict = syncConflicts.find((item) => item.change.id === operationId);
    if (!conflict) return;
    await removePendingChanges([operationId]);
    if (keepDeviceVersion) {
      await queueOfflineChange({
        ...conflict.change,
        id: crypto.randomUUID(),
        clientUpdatedAt: new Date().toISOString(),
      });
    } else {
      setCompleted((current) =>
        conflict.serverCompletedAt
          ? [...new Set([...current, conflict.change.entityId ?? ''])].filter(Boolean)
          : current.filter((id) => id !== conflict.change.entityId),
      );
    }
    setSyncConflicts((items) => items.filter((item) => item.change.id !== operationId));
    setStatus(
      keepDeviceVersion ? 'Your device version will be retried.' : 'The server version was kept.',
    );
  }

  async function find(event: FormEvent) {
    event.preventDefault();
    try {
      setMatches((await api.search(initialEdition, search)).data);
      setStatus('Search results include content you can currently read.');
    } catch {
      if (!offlinePackage) {
        setStatus('Search is unavailable. Try again.');
      } else {
        const term = search.trim().toLocaleLowerCase();
        const local = await Promise.all(
          offlinePackage.licence.lessonIds.map(async (id) => {
            const item = await readOfflineLesson(offlinePackage.id, id);
            const text = item?.bodyMarkdown ?? '';
            const index = text.toLocaleLowerCase().indexOf(term);
            return item && index >= 0
              ? {
                  id,
                  title: item.title,
                  snippet: text.slice(Math.max(0, index - 40), index + term.length + 80),
                }
              : null;
          }),
        );
        setMatches(local.filter((item): item is NonNullable<typeof item> => item !== null));
        setStatus('Search results use only the encrypted offline lessons on this device.');
      }
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
      if (!navigator.onLine && offlinePackage) {
        if (kind === 'bookmark') {
          const saved = await queueChange({
            kind: 'bookmark',
            entityId: lesson.id,
            content: { anchor: 'start' },
          });
          if (saved)
            setBookmarks((current) => [
              ...current,
              { id: crypto.randomUUID(), anchor: `${lesson.id}:start` },
            ]);
        } else {
          const saved = await queueChange({
            kind: 'progress',
            entityId: lesson.id,
            content: { position: { anchor: 'end' } },
            percent: 100,
          });
          if (saved) setCompleted((current) => [...new Set([...current, lesson.id])]);
        }
        return;
      }
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
      if (!navigator.onLine && offlinePackage) {
        const saved = await queueChange({
          kind: 'annotation',
          entityId: lesson.id,
          content: { anchor: `quote:${selected}`, kind, quote: selected, note },
        });
        if (saved) {
          setAnnotations((current) => [
            ...current,
            { id: crypto.randomUUID(), anchor: `quote:${selected}`, kind, quote: selected, note },
          ]);
          setNote('');
          setSelected('');
        }
        return;
      }
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
  const highlightQuotes = annotations
    .filter((item) => item.kind === 'HIGHLIGHT')
    .map((item) => item.quote);
  return (
    <div className={`min-h-screen ${palette} ${reducedMotion ? 'reader-reduced-motion' : ''}`}>
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
          <span
            role="status"
            aria-live="polite"
            className="rounded border border-current/30 px-2 py-1 text-xs"
          >
            {online ? 'Online' : 'Offline'}
            {offlinePackage
              ? ` · licence ends ${new Date(offlinePackage.licence.expiresAt).toLocaleString()}`
              : ''}
          </span>
          <a href="/?screen=catalogue" className="underline">
            Browse library
          </a>
        </div>
      </header>
      {updateReady && (
        <div role="status" className="mx-auto max-w-7xl border-b border-current/20 px-4 py-3">
          A reader update is ready.{' '}
          <button className="ml-2 underline" onClick={onUpdate}>
            Apply update
          </button>
        </div>
      )}
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
          <section
            aria-labelledby="offline-heading"
            className="mt-6 rounded-lg border border-current/20 p-3"
          >
            <h3 id="offline-heading" className="font-semibold">
              Offline reading
            </h3>
            <p className="mt-1 text-xs opacity-80">
              Only lessons with an active offline permission are saved. Local encryption helps
              protect storage but is not copy-proof DRM. If this device is offline, remote
              revocation takes effect when it reconnects.
            </p>
            {lesson?.policy.allowOffline &&
              online &&
              !offlinePackages.some(
                (item) => item.editionId === initialEdition && item.status === 'ready',
              ) && (
                <button
                  className="mt-3 rounded border border-current px-3 py-2"
                  onClick={() => void downloadOffline()}
                  disabled={offlineActionBusy}
                >
                  {offlineActionBusy
                    ? 'Preparing…'
                    : offlinePackages.some(
                          (item) =>
                            item.editionId === initialEdition &&
                            (item.status === 'downloading' || item.status === 'quota'),
                        )
                      ? 'Resume offline download'
                      : 'Download for offline reading'}
                </button>
              )}
            {downloadProgress && (
              <p role="status" className="mt-2 text-sm">
                {downloadProgress}
              </p>
            )}
            {offlinePackages.map((item) => (
              <div
                key={item.id}
                className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span>
                  {item.status === 'ready'
                    ? 'Available offline'
                    : item.status === 'expired'
                      ? 'Licence expired'
                      : `Download ${item.downloaded}/${item.total}`}{' '}
                  · {Math.round(item.bytes / 1024)} KB
                </span>
                <button className="underline" onClick={() => void removeOffline(item.id)}>
                  Remove
                </button>
                {pendingRemoval?.id === item.id && (
                  <div
                    role="group"
                    aria-label="Confirm removal of unsynced changes"
                    className="basis-full rounded border border-current/20 p-2"
                  >
                    <p>
                      {pendingRemoval.count} unsynced change(s) will be discarded if you remove this
                      package.
                    </p>
                    <button className="mr-3 underline" onClick={() => setPendingRemoval(null)}>
                      Keep package
                    </button>
                    <button className="underline" onClick={() => void removeOffline(item.id, true)}>
                      Discard changes and remove
                    </button>
                  </div>
                )}
                {!!item.files?.length && (
                  <ul className="basis-full space-y-1">
                    {item.files.map((file) => (
                      <li key={file.id} className="flex justify-between gap-2">
                        <span>
                          {file.fileName} · {Math.ceil(file.bytes / 1024)} KB
                        </span>
                        <button
                          className="underline"
                          onClick={() => void saveOfflineAsset(item.id, file)}
                        >
                          Save file
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {item.deferredFiles?.map((file) => (
                  <p key={`${item.id}:${file.lessonId}`} className="basis-full text-xs opacity-70">
                    Media not saved offline: {file.reason}
                  </p>
                ))}
              </div>
            ))}
          </section>
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
          {syncConflicts.map((item) => (
            <section
              key={item.change.id}
              className="mb-4 rounded border border-amber-500 p-4"
              aria-label="Reading sync conflict"
            >
              <h2 className="font-semibold">Progress changed elsewhere</h2>
              <p className="mt-1 text-sm">
                Server version updated {new Date(item.serverUpdatedAt).toLocaleString()}.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="rounded border border-current px-3 py-2"
                  onClick={() => void resolveSyncConflict(item.change.id, false)}
                >
                  Keep server version
                </button>
                <button
                  className="rounded border border-current px-3 py-2"
                  onClick={() => void resolveSyncConflict(item.change.id, true)}
                >
                  Keep this device version
                </button>
              </div>
            </section>
          ))}
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
                      changeSettings({ theme: event.target.value as ReaderSettings['theme'] });
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
                      changeSettings({
                        fontSize: Number(event.target.value) as ReaderSettings['fontSize'],
                      });
                    }}
                    className="ml-2 rounded border border-slate-500 bg-white p-2 text-slate-900"
                  >
                    <option value="16">Small</option>
                    <option value="18">Medium</option>
                    <option value="21">Large</option>
                    <option value="24">Extra large</option>
                  </select>
                </label>
                <label>
                  Font family{' '}
                  <select
                    value={fontFamily}
                    onChange={(event) => {
                      const value = event.target.value as FontFamily;
                      changeSettings({ fontFamily: value });
                    }}
                    className="ml-2 rounded border border-slate-500 bg-white p-2 text-slate-900"
                  >
                    <option value="system">System</option>
                    <option value="serif">Serif</option>
                    <option value="mono">Monospace</option>
                  </select>
                </label>
                <label>
                  Line spacing{' '}
                  <select
                    value={lineSpacing}
                    onChange={(event) => {
                      changeSettings({
                        lineSpacing: Number(event.target.value) as ReaderSettings['lineSpacing'],
                      });
                    }}
                    className="ml-2 rounded border border-slate-500 bg-white p-2 text-slate-900"
                  >
                    <option value="1.5">Compact</option>
                    <option value="1.75">Comfortable</option>
                    <option value="2">Spacious</option>
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={reducedMotion}
                    onChange={(event) => {
                      changeSettings({ reducedMotion: event.target.checked });
                    }}
                  />
                  Reduce motion
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
                className="reader-content prose max-w-3xl"
                style={{ fontSize, fontFamily: fontFamilies[fontFamily], lineHeight: lineSpacing }}
                aria-label="Lesson content"
              >
                {lesson.bodyMarkdown ? (
                  <ReaderContent markdown={lesson.bodyMarkdown} quotes={highlightQuotes} />
                ) : !Array.isArray(lesson.blocks) || !lesson.blocks.length ? (
                  <p>
                    No inline lesson text is available.{' '}
                    {lesson.hasBodyAsset ? 'A licensed asset may be available separately.' : ''}
                  </p>
                ) : null}
                <ReaderBlocks blocks={lesson.blocks} quotes={highlightQuotes} />
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
