import { useState, type FormEvent } from 'react';
import { createApiClient } from '@arata/api-client';

const api = createApiClient().policies;
const scopes = [
  'libraryId',
  'publicationId',
  'volumeId',
  'editionId',
  'revisionId',
  'chapterId',
  'lessonId',
  'resourceId',
] as const;
const flags = [
  ['allowRead', 'Reading'],
  ['allowPreview', 'Public preview'],
  ['allowSelect', 'Text selection'],
  ['allowCopy', 'Copying'],
  ['allowPrint', 'Printing'],
  ['allowDownload', 'Original download'],
  ['allowExportPdf', 'PDF export'],
  ['allowExportEpub', 'EPUB export'],
  ['allowOffline', 'Offline reading'],
  ['allowShare', 'External sharing'],
  ['watermark', 'Watermark'],
] as const;
type Values = Record<string, string>;

export function ContentPolicyAdmin() {
  const [scope, setScope] = useState<(typeof scopes)[number]>('publicationId');
  const [id, setId] = useState('');
  const [reason, setReason] = useState('');
  const [values, setValues] = useState<Values>({});
  const [history, setHistory] = useState<Record<string, unknown>[]>([]);
  const [effective, setEffective] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState('');
  async function load() {
    try {
      const path = new URLSearchParams({ [scope]: id });
      const [revisions, result] = await Promise.all([api.history(scope, id), api.effective(path)]);
      setHistory(revisions.data);
      setEffective(result.data as unknown as Record<string, unknown>);
      setStatus('Current policy and history loaded.');
    } catch {
      setStatus('Could not load the policy. Administrator access and MFA are required.');
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    const changes: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(values)) {
      if (value === '') continue;
      changes[name] =
        value === 'inherit'
          ? null
          : value === 'yes'
            ? true
            : value === 'no'
              ? false
              : ['maxCopyChars', 'maxConcurrentSessions'].includes(name)
                ? Number(value)
                : value;
    }
    if (!Object.keys(changes).length) {
      setStatus('Choose at least one setting to change.');
      return;
    }
    try {
      const result = await api.replace({ scope, scopeId: id, reason, ...changes });
      await load();
      setStatus(`Policy version ${result.data.version} approved and recorded.`);
    } catch {
      setStatus('Policy update failed. Check your authority, recent MFA, values, and reason.');
    }
  }
  const select = (name: string, label: string) => (
    <div key={name} className="rounded border border-slate-300 p-3">
      <label className="block font-semibold" htmlFor={`policy-${name}`}>
        {label}
      </label>
      <select
        id={`policy-${name}`}
        className="mt-1 w-full rounded border border-slate-400 p-2"
        value={values[name] ?? ''}
        onChange={(event) => setValues({ ...values, [name]: event.target.value })}
      >
        <option value="">Keep current</option>
        <option value="inherit">Inherit from parent</option>
        <option value="yes">Allow</option>
        <option value="no">Restrict</option>
      </select>
    </div>
  );
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <a className="sr-only focus:not-sr-only" href="#policy-main">
        Skip to policy editor
      </a>
      <header className="border-b bg-white px-5 py-4">
        <a className="font-bold underline" href="/">
          Arata TechLibrary
        </a>{' '}
        / Content permissions
      </header>
      <main id="policy-main" className="mx-auto max-w-5xl px-5 py-8">
        <h1 className="text-3xl font-bold">Content permission management</h1>
        <p className="mt-2">
          Only platform administrators with the content policy permission and MFA may approve
          changes. Each change creates a new version and audit record.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <label>
            Policy scope
            <select
              className="mt-1 block w-full rounded border border-slate-400 p-2"
              value={scope}
              onChange={(event) => setScope(event.target.value as typeof scope)}
            >
              {scopes.map((item) => (
                <option key={item} value={item}>
                  {item.replace('Id', '')}
                </option>
              ))}
            </select>
          </label>
          <label>
            Target ID
            <input
              className="mt-1 block w-full rounded border border-slate-400 p-2"
              value={id}
              onChange={(event) => setId(event.target.value)}
              required
            />
          </label>
        </div>
        <button
          className="mt-4 rounded bg-[#173647] px-4 py-2 text-white"
          onClick={() => void load()}
        >
          Load effective policy
        </button>
        {status && (
          <p role="status" className="mt-4 rounded border border-slate-300 bg-white p-3">
            {status}
          </p>
        )}
        {effective && (
          <section className="mt-6 rounded border border-slate-300 bg-white p-4">
            <h2 className="text-xl font-bold">Effective permissions</h2>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              {Object.entries(effective)
                .filter(([key]) => key !== 'sources' && key !== 'sessionLimits')
                .map(([key, value]) => (
                  <div key={key}>
                    <dt className="font-semibold">{key}</dt>
                    <dd>{String(value)}</dd>
                  </div>
                ))}
            </dl>
            <p className="mt-3 text-sm">Inherited sources: {JSON.stringify(effective.sources)}</p>
          </section>
        )}
        <form className="mt-8" onSubmit={(event) => void save(event)}>
          <h2 className="text-xl font-bold">Approve a new policy version</h2>
          <p className="mt-1 text-sm">
            Unchanged values carry forward. Choose Inherit to remove a local override.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {flags.map(([name, label]) => select(name, label))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label>
              Access class
              <select
                className="mt-1 block w-full rounded border p-2"
                value={values.accessClass ?? ''}
                onChange={(event) => setValues({ ...values, accessClass: event.target.value })}
              >
                <option value="">Keep current</option>
                <option value="inherit">Inherit</option>
                <option value="PUBLIC_FREE">Public free</option>
                <option value="REGISTERED_FREE">Registered free</option>
                <option value="PREMIUM">Premium</option>
                <option value="RESTRICTED">Restricted</option>
              </select>
            </label>
            <label>
              Screenshot notice
              <select
                className="mt-1 block w-full rounded border p-2"
                value={values.screenshotMode ?? ''}
                onChange={(event) => setValues({ ...values, screenshotMode: event.target.value })}
              >
                <option value="">Keep current</option>
                <option value="inherit">Inherit</option>
                <option value="ALLOW">Allow</option>
                <option value="WATERMARK">Watermark</option>
                <option value="RESTRICTED_NOTICE">Restricted notice</option>
              </select>
            </label>
            <label>
              Maximum copy characters
              <input
                inputMode="numeric"
                pattern="inherit|[0-9]{1,6}"
                placeholder="0–100000 or inherit"
                className="mt-1 block w-full rounded border p-2"
                value={values.maxCopyChars ?? ''}
                onChange={(event) => setValues({ ...values, maxCopyChars: event.target.value })}
              />
            </label>
            <label>
              Maximum concurrent sessions
              <input
                inputMode="numeric"
                pattern="inherit|[0-9]{1,3}"
                placeholder="1–100 or inherit"
                className="mt-1 block w-full rounded border p-2"
                value={values.maxConcurrentSessions ?? ''}
                onChange={(event) =>
                  setValues({ ...values, maxConcurrentSessions: event.target.value })
                }
              />
            </label>
            <label>
              Watermark label
              <input
                maxLength={160}
                placeholder="Text or inherit"
                className="mt-1 block w-full rounded border p-2"
                value={values.watermarkLabel ?? ''}
                onChange={(event) => setValues({ ...values, watermarkLabel: event.target.value })}
              />
            </label>
            <label>
              Licence ends at (ISO 8601 with UTC offset)
              <input
                type="text"
                placeholder="2027-01-01T00:00:00Z or inherit"
                className="mt-1 block w-full rounded border p-2"
                value={values.licenceEndsAt ?? ''}
                onChange={(event) => setValues({ ...values, licenceEndsAt: event.target.value })}
              />
            </label>
          </div>
          <label className="mt-4 block">
            Reason for change
            <textarea
              required
              minLength={10}
              maxLength={1000}
              className="mt-1 block w-full rounded border p-2"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button className="mt-4 rounded bg-[#74233e] px-5 py-3 font-semibold text-white">
            Approve version
          </button>
        </form>
        <section className="mt-8">
          <h2 className="text-xl font-bold">Version history</h2>
          <ol className="mt-3 space-y-2">
            {history.map((item) => (
              <li className="rounded border bg-white p-3" key={String(item.id)}>
                Version {String(item.version)} · {item.isActive ? 'Active' : 'Superseded'} ·{' '}
                {String(item.approvedAt ?? 'Unapproved')}
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}
