import { useEffect, useState } from 'react';
import { createApiClient } from '@arata/api-client';

type Settings = Record<string, Record<string, unknown>>;
type Version = {
  id: string;
  version: number;
  status: string;
  reason: string;
  effectiveAt: string | null;
  createdAt: string;
};
type Change = { path: string; before: unknown; after: unknown };
type PolicyEvent = {
  id: string;
  action: string;
  actorId: string;
  reason: string;
  occurredAt: string;
  correlationId: string;
};
const api = createApiClient();
const base = '/admin/platform-policy';
const titles: Record<string, string> = {
  subscriptions: 'Subscriptions and billing',
  complimentary: 'Complimentary access',
  institutional: 'Institutional access',
  reader: 'Reader and content',
  research: 'Research and disclosure',
  security: 'Security and recovery',
};
const descriptions: Record<string, string> = {
  'subscriptions.plans':
    'Amounts are integer minor units. Plans remain disabled until approved prices and checkout disclosures exist.',
  'subscriptions.automaticRenewalEnabled':
    'Recurring billing requires verified provider capability; this switch is currently blocked.',
  'institutional.benefitsEnabled':
    'Institution agreements, domains, eligibility and capacity require separate verification.',
  'research.collectionEnabled':
    'Collection requires a reviewed lawful basis and user consent controls.',
  'research.publicPublicationEnabled':
    'Public research still requires a reviewed aggregate snapshot and independent approval.',
  'security.recoveryPointHours': 'A recovery objective remains unset until operations approves it.',
  'security.recoveryTimeHours': 'A recovery objective remains unset until operations approves it.',
};
const format = (path: string) =>
  path
    .split('.')
    .slice(-1)[0]!
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase());
const clone = (value: Settings): Settings => structuredClone(value);

function fields(value: Record<string, unknown>, prefix = ''): { path: string; value: unknown }[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === 'object' && !Array.isArray(child)
      ? fields(child as Record<string, unknown>, path)
      : [{ path, value: child }];
  });
}

export function PlatformPolicyAdmin() {
  const [effective, setEffective] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [version, setVersion] = useState(0);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [history, setHistory] = useState<Version[]>([]);
  const [events, setEvents] = useState<PolicyEvent[]>([]);
  const [reason, setReason] = useState('');
  const [effectiveAt, setEffectiveAt] = useState('');
  const [preview, setPreview] = useState<{ changes: Change[]; warnings: string[] } | null>(null);
  const [arrayTexts, setArrayTexts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function load(resetEditor = true) {
    const [current, versions] = await Promise.all([
      api.request<{ data: { version: number; settings: Settings } }>(`${base}/effective`),
      api.request<{ data: Version[] }>(`${base}/history`),
    ]);
    setEffective(current.data.settings);
    setVersion(current.data.version);
    if (resetEditor) {
      setDraft(clone(current.data.settings));
      setArrayTexts({});
    }
    setHistory(versions.data);
  }
  useEffect(() => {
    void load().catch(() =>
      setNotice('Administrator access and MFA are required to view settings.'),
    );
  }, []);

  function change(path: string, value: unknown) {
    if (!draft) return;
    const next = clone(draft);
    const keys = path.split('.');
    let target: Record<string, unknown> = next;
    for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
    target[keys[keys.length - 1]!] = value;
    setDraft(next);
    setPreview(null);
  }

  async function action<T>(work: () => Promise<T>, success: string) {
    setBusy(true);
    setNotice('');
    try {
      const result = await work();
      setNotice(success);
      await load(false);
      return result;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Policy action failed');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!draft) return;
    const path = draftId ? `${base}/drafts/${draftId}` : `${base}/drafts`;
    const result = await action(
      () =>
        api.request<{ data: { id: string } }>(path, draftId ? 'PATCH' : 'POST', {
          settings: draft,
          reason,
        }),
      'Draft saved and audited.',
    );
    if (result) {
      setDraftId(result.data.id);
      setSelectedStatus('DRAFT');
    }
  }

  async function transition(path: string, success: string, extra: Record<string, unknown> = {}) {
    if (!draftId) return;
    const result = await action(
      () => api.request(`${base}/${path.replace('{id}', draftId)}`, 'POST', { reason, ...extra }),
      success,
    );
    if (result)
      setSelectedStatus(
        path.includes('/submit')
          ? 'PENDING'
          : path.includes('/approve')
            ? 'APPROVED'
            : path.includes('/activate')
              ? 'ACTIVE'
              : 'REJECTED',
      );
  }

  function exportConfig() {
    if (!effective) return;
    const blob = new Blob(
      [
        JSON.stringify(
          { format: 'arata-platform-policy/v1', version, settings: effective },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `arata-platform-policy-v${version}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function importConfig(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 100_000) throw new Error('Configuration file is too large');
      const parsed: unknown = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object' || !('settings' in parsed))
        throw new Error('Invalid export format');
      const imported = parsed as { format?: string; settings: Settings };
      if (imported.format !== 'arata-platform-policy/v1')
        throw new Error('Unsupported export format');
      setDraft(imported.settings);
      setDraftId(null);
      setSelectedStatus(null);
      setPreview(null);
      setArrayTexts({});
      setNotice('Imported into the editor. Preview and save it as a new draft before approval.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Import failed');
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <a className="sr-only focus:not-sr-only" href="#platform-policy-main">
        Skip to policy settings
      </a>
      <header className="border-b bg-white px-5 py-4">
        <a className="font-bold underline" href="/">
          Arata TechLibrary
        </a>{' '}
        / Settings and Policy Management
      </header>
      <main id="platform-policy-main" className="mx-auto max-w-6xl px-5 py-8">
        <h1 className="text-3xl font-bold">Platform settings and policies</h1>
        <p className="mt-2 max-w-3xl text-slate-700">
          Proposed defaults are conservative. Financial, institutional, research and legal release
          decisions require separate review. Changes use a draft, independent approval and
          activation.
        </p>
        <p className="mt-3">
          Active version: <strong>{version || 'initial proposal'}</strong>
        </p>
        {notice && (
          <p role="status" className="mt-4 rounded border border-slate-400 bg-white p-3">
            {notice}
          </p>
        )}
        {draft && (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="font-semibold">
                Change reason (at least 10 characters)
                <textarea
                  className="mt-1 block w-full rounded border p-2"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={2}
                />
              </label>
              <label className="font-semibold">
                Effective date and time (UTC)
                <input
                  className="mt-1 block w-full rounded border p-2"
                  type="datetime-local"
                  value={effectiveAt}
                  onChange={(event) => setEffectiveAt(event.target.value)}
                />
              </label>
            </div>
            <nav aria-label="Policy categories" className="mt-6 flex flex-wrap gap-3">
              {Object.entries(titles).map(([id, title]) => (
                <a key={id} className="rounded border bg-white px-3 py-2 underline" href={`#${id}`}>
                  {title}
                </a>
              ))}
            </nav>
            {Object.entries(titles).map(([category, title]) => (
              <section
                key={category}
                id={category}
                className="mt-7 rounded-xl border border-slate-300 bg-white p-5"
              >
                <h2 className="text-xl font-bold">{title}</h2>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {fields(draft[category] ?? {}, category).map(({ path, value }) => (
                    <label key={path} className="block text-sm font-medium">
                      {format(path)}
                      {descriptions[path] && (
                        <span className="mt-1 block text-xs font-normal text-slate-600">
                          {descriptions[path]}
                        </span>
                      )}
                      {typeof value === 'boolean' ? (
                        <select
                          className="mt-1 block w-full rounded border p-2"
                          value={String(value)}
                          onChange={(event) => change(path, event.target.value === 'true')}
                        >
                          <option value="true">Enabled</option>
                          <option value="false">Disabled</option>
                        </select>
                      ) : typeof value === 'number' || value === null ? (
                        <input
                          className="mt-1 block w-full rounded border p-2"
                          type="number"
                          min="0"
                          value={value === null ? '' : value}
                          placeholder="Unset"
                          onChange={(event) =>
                            change(
                              path,
                              event.target.value === '' ? null : Number(event.target.value),
                            )
                          }
                        />
                      ) : Array.isArray(value) ? (
                        <input
                          className="mt-1 block w-full rounded border p-2"
                          value={arrayTexts[path] ?? JSON.stringify(value)}
                          onChange={(event) =>
                            setArrayTexts({ ...arrayTexts, [path]: event.target.value })
                          }
                          onBlur={() => {
                            try {
                              const parsed: unknown = JSON.parse(
                                arrayTexts[path] ?? JSON.stringify(value),
                              );
                              if (!Array.isArray(parsed)) throw new Error('Array required');
                              change(path, parsed);
                              setArrayTexts((current) => {
                                const next = { ...current };
                                delete next[path];
                                return next;
                              });
                            } catch {
                              setNotice(`Invalid JSON array for ${path}`);
                            }
                          }}
                        />
                      ) : (
                        <input
                          className="mt-1 block w-full rounded border p-2"
                          value={String(value)}
                          onChange={(event) => change(path, event.target.value)}
                        />
                      )}
                    </label>
                  ))}
                </div>
              </section>
            ))}
            <section className="mt-7 rounded-xl border border-slate-300 bg-white p-5">
              <h2 className="text-xl font-bold">Review and workflow</h2>
              <p className="mt-2">Selected version state: {selectedStatus ?? 'new draft'}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="rounded border px-4 py-2"
                  onClick={() => {
                    if (effective) setDraft(clone(effective));
                    setDraftId(null);
                    setSelectedStatus(null);
                    setPreview(null);
                    setArrayTexts({});
                  }}
                >
                  Start new draft
                </button>
                <button
                  disabled={busy}
                  className="rounded bg-slate-800 px-4 py-2 text-white disabled:opacity-50"
                  onClick={() => {
                    setBusy(true);
                    void api
                      .request<{ data: { changes: Change[]; warnings: string[] } }>(
                        `${base}/preview`,
                        'POST',
                        draft,
                      )
                      .then((result) => {
                        setPreview(result.data);
                        setNotice('Effect preview ready.');
                      })
                      .catch((error: unknown) =>
                        setNotice(error instanceof Error ? error.message : 'Preview failed'),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  Preview effects
                </button>
                <button
                  disabled={
                    busy ||
                    (selectedStatus !== null && selectedStatus !== 'DRAFT') ||
                    reason.trim().length < 10
                  }
                  className="rounded bg-cyan-800 px-4 py-2 text-white disabled:opacity-50"
                  onClick={() => void saveDraft()}
                >
                  Save draft
                </button>
                <button
                  disabled={
                    busy || !draftId || selectedStatus !== 'DRAFT' || reason.trim().length < 10
                  }
                  className="rounded bg-indigo-800 px-4 py-2 text-white disabled:opacity-50"
                  onClick={() =>
                    void transition(
                      'drafts/{id}/submit',
                      'Draft submitted for independent approval.',
                    )
                  }
                >
                  Submit for approval
                </button>
                <button
                  disabled={
                    busy ||
                    !draftId ||
                    selectedStatus !== 'PENDING' ||
                    !effectiveAt ||
                    reason.trim().length < 10
                  }
                  className="rounded bg-emerald-800 px-4 py-2 text-white disabled:opacity-50"
                  onClick={() =>
                    void transition(
                      '{id}/approve',
                      'Policy approved. Activate on or after its effective date.',
                      { effectiveAt: new Date(`${effectiveAt}:00Z`).toISOString() },
                    )
                  }
                >
                  Approve
                </button>
                <button
                  disabled={
                    busy || !draftId || selectedStatus !== 'APPROVED' || reason.trim().length < 10
                  }
                  className="rounded bg-emerald-900 px-4 py-2 text-white disabled:opacity-50"
                  onClick={() => void transition('{id}/activate', 'Policy activated.')}
                >
                  Activate
                </button>
                <button
                  disabled={
                    busy || !draftId || selectedStatus !== 'PENDING' || reason.trim().length < 10
                  }
                  className="rounded bg-red-800 px-4 py-2 text-white disabled:opacity-50"
                  onClick={() => void transition('{id}/reject', 'Policy rejected.')}
                >
                  Reject
                </button>
                <button className="rounded border px-4 py-2" onClick={exportConfig}>
                  Export current
                </button>
                <label className="rounded border px-4 py-2">
                  Import to editor
                  <input
                    aria-label="Import configuration JSON"
                    className="ml-2 max-w-44"
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) => void importConfig(event.target.files?.[0])}
                  />
                </label>
              </div>
              {preview && (
                <div className="mt-4" role="status">
                  <p>{preview.changes.length} setting changes proposed.</p>
                  <ul className="mt-2 list-disc pl-5">
                    {preview.changes.map((item) => (
                      <li key={item.path}>
                        {item.path}: {JSON.stringify(item.before)} → {JSON.stringify(item.after)}
                      </li>
                    ))}
                  </ul>
                  {preview.warnings.map((warning) => (
                    <p key={warning} className="mt-2 text-amber-900">
                      {warning}
                    </p>
                  ))}
                </div>
              )}
            </section>
            <section className="mt-7 rounded-xl border border-slate-300 bg-white p-5">
              <h2 className="text-xl font-bold">Version history</h2>
              <ul className="mt-3 space-y-3">
                {history.map((item) => (
                  <li key={item.id} className="rounded border p-3">
                    <strong>
                      v{item.version} · {item.status}
                    </strong>{' '}
                    · {item.reason} · {new Date(item.createdAt).toLocaleString()}
                    <button
                      className="ml-3 underline"
                      onClick={() =>
                        void Promise.all([
                          api.request<{ data: { settings: Settings } }>(`${base}/${item.id}`),
                          api.request<{ data: PolicyEvent[] }>(`${base}/${item.id}/events`),
                        ])
                          .then(([result, audit]) => {
                            setDraft(clone(result.data.settings));
                            setArrayTexts({});
                            setEvents(audit.data);
                            setDraftId(
                              item.status === 'DRAFT' ||
                                item.status === 'PENDING' ||
                                item.status === 'APPROVED'
                                ? item.id
                                : null,
                            );
                            setSelectedStatus(item.status);
                            setPreview(null);
                            setNotice(`Loaded version ${item.version}.`);
                          })
                          .catch(() => setNotice('Could not load policy version.'))
                      }
                    >
                      Inspect/edit
                    </button>
                    {['ACTIVE', 'SUPERSEDED'].includes(item.status) && (
                      <button
                        disabled={busy || reason.trim().length < 10}
                        className="ml-3 underline disabled:opacity-50"
                        onClick={() =>
                          void action(
                            () =>
                              api.request<{ data: { id: string } }>(
                                `${base}/${item.id}/rollback`,
                                'POST',
                                { reason },
                              ),
                            'A restoration draft was created; approval is still required.',
                          ).then(async (result) => {
                            if (result) {
                              const restored = await api.request<{ data: { settings: Settings } }>(
                                `${base}/${result.data.id}`,
                              );
                              setDraft(clone(restored.data.settings));
                              setDraftId(result.data.id);
                              setSelectedStatus('DRAFT');
                            }
                          })
                        }
                      >
                        Restore as new draft
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {events.length > 0 && (
                <div className="mt-5">
                  <h3 className="font-semibold">Audit history for selected version</h3>
                  <ol className="mt-2 space-y-1 text-sm">
                    {events.map((event) => (
                      <li key={event.id}>
                        {new Date(event.occurredAt).toLocaleString()} · {event.action} ·{' '}
                        {event.reason} · request {event.correlationId}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
