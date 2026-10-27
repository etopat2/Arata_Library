import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, createApiClient } from '@arata/api-client';

const api = createApiClient();
const screen = new URLSearchParams(location.search).get('screen') ?? 'entitlements';
type Grant = {
  id: string;
  userId: string;
  source: string;
  status: string;
  effectiveStatus?: string;
  scope: string;
  startsAt: string;
  endsAt: string | null;
  reason?: string;
  approvalStatus?: string;
};
type Person = { id: string; email: string; status: string; activeGrants: number };
type Campaign = {
  id: string;
  name: string;
  kind: string;
  status: string;
  scope: string;
  startsAt: string;
  endsAt: string;
  claimCount: number;
  maxClaims: number;
};
type Agreement = {
  id: string;
  institutionId: string;
  status: string;
  scope: string;
  memberLimit: number;
  permittedCategories: string[];
  startsAt: string;
  endsAt: string;
};
type Event = { id: string; action: string; reason: string; occurredAt: string };
const link = (next: string) => `/?screen=${next}`;
const when = (value: string | null) => (value ? new Date(value).toLocaleString() : 'No fixed end');
function failure(error: unknown) {
  if (error instanceof ApiError && error.status === 401) return 'Sign in to manage access.';
  if (error instanceof ApiError && error.status === 403)
    return 'This action needs administrator access, the assigned permission and recent MFA.';
  if (error instanceof ApiError && error.status === 409)
    return 'The access state changed or the current policy does not allow this action. Refresh and retry.';
  return 'The access request could not be completed. Please retry.';
}

export function EntitlementScreens() {
  const [records, setRecords] = useState<Grant[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [upcoming, setUpcoming] = useState<Grant[]>([]);
  const [query, setQuery] = useState('');
  const [userId, setUserId] = useState('');
  const [filterUserId, setFilterUserId] = useState('');
  const [scope, setScope] = useState('LIBRARY');
  const [scopeId, setScopeId] = useState('');
  const [durationDays, setDurationDays] = useState('7');
  const [reason, setReason] = useState('');
  const [source, setSource] = useState<'COMPLIMENTARY' | 'INSTITUTION' | 'SPONSORED'>(
    'COMPLIMENTARY',
  );
  const [membershipId, setMembershipId] = useState('');
  const [cohortId, setCohortId] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [institutionId, setInstitutionId] = useState('');
  const [memberLimit, setMemberLimit] = useState('100');
  const [institutionCategory, setInstitutionCategory] = useState('STUDENT');
  const [campaignKind, setCampaignKind] = useState<'BULK' | 'PROMOTION'>('BULK');
  const [recipients, setRecipients] = useState('');
  const [code, setCode] = useState('');
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const mine = screen === 'entitlements';
  const trialAdmin = screen === 'trial-admin';
  const institutionAdmin = screen === 'institution-access';

  async function load() {
    if (mine) {
      setRecords((await api.request<{ data: Grant[] }>('/me/entitlements')).data);
      return;
    }
    const [grants, expiry, allCampaigns, allAgreements] = await Promise.all([
      api.request<{ data: Grant[] }>(
        `/admin/entitlements${filterUserId ? `?userId=${encodeURIComponent(filterUserId)}` : ''}`,
      ),
      api.request<{ data: Grant[] }>('/admin/entitlements/upcoming'),
      api.request<{ data: Campaign[] }>('/admin/grant-campaigns'),
      api.request<{ data: Agreement[] }>('/admin/institution-agreements'),
    ]);
    setRecords(grants.data);
    setUpcoming(expiry.data);
    setCampaigns(allCampaigns.data);
    setAgreements(allAgreements.data);
  }
  useEffect(() => {
    void load()
      .catch((caught) => setError(failure(caught)))
      .finally(() => setLoading(false));
  }, [filterUserId]);
  function perform(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    void task()
      .then(() => load())
      .catch((caught) => setError(failure(caught)))
      .finally(() => setBusy(false));
  }
  async function search(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      setPeople(
        (
          await api.request<{ data: Person[] }>(
            `/admin/entitlement-users?q=${encodeURIComponent(query)}`,
          )
        ).data,
      );
    } catch (caught) {
      setError(failure(caught));
    }
  }
  async function grant(event: FormEvent) {
    event.preventDefault();
    perform(async () => {
      await api.request('/admin/entitlements', 'POST', {
        userId,
        scope,
        ...(scope === 'LIBRARY' ? {} : { scopeId }),
        durationDays: Number(durationDays),
        reason,
        source,
        ...(source === 'COMPLIMENTARY' ? {} : { membershipId }),
        ...(source === 'SPONSORED' ? { cohortId } : {}),
      });
      setNotice('Grant requested. Another administrator must approve it.');
    });
  }
  async function campaign(event: FormEvent) {
    event.preventDefault();
    perform(async () => {
      const start = new Date();
      const result = await api.request<{ data: { code: string | null } }>(
        '/admin/grant-campaigns',
        'POST',
        {
          kind: campaignKind,
          name: campaignName,
          reason,
          scope,
          ...(scope === 'LIBRARY' ? {} : { scopeId }),
          startsAt: start.toISOString(),
          endsAt: new Date(start.getTime() + Number(durationDays) * 86_400_000).toISOString(),
          maxClaims:
            campaignKind === 'BULK' ? recipients.split(/[\s,]+/).filter(Boolean).length : 100,
          ...(campaignKind === 'BULK'
            ? { userIds: recipients.split(/[\s,]+/).filter(Boolean) }
            : {}),
        },
      );
      setCode(result.data.code ?? '');
      setNotice('Campaign requested. Another administrator must approve it.');
    });
  }
  async function agreement(event: FormEvent) {
    event.preventDefault();
    perform(async () => {
      const start = new Date();
      await api.request('/admin/institution-agreements', 'POST', {
        institutionId,
        reason,
        scope: scope === 'COLLECTION' || scope === 'EDITION' ? 'LIBRARY' : scope,
        ...(scope === 'PUBLICATION' || scope === 'VOLUME' ? { scopeId } : {}),
        memberLimit: Number(memberLimit),
        permittedCategories: [institutionCategory],
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + Number(durationDays) * 86_400_000).toISOString(),
      });
      setNotice(
        'Agreement requested. A second administrator must approve it after institution evidence is reviewed.',
      );
    });
  }
  async function history(id: string) {
    setSelected(id);
    setError('');
    try {
      setEvents(
        (await api.request<{ data: { events: Event[] } }>(`/admin/entitlements/${id}/history`)).data
          .events,
      );
    } catch (caught) {
      setError(failure(caught));
    }
  }
  function action(id: string, kind: 'approve' | 'extend' | 'suspend' | 'resume' | 'revoke') {
    perform(async () => {
      await api.request(
        `/admin/entitlements/${id}/${kind}`,
        'POST',
        kind === 'extend' ? { durationDays: Number(durationDays), reason } : { reason },
      );
      setNotice(`Access ${kind} request completed.`);
      if (selected === id) await history(id);
    });
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:z-20 focus:bg-white focus:p-3 focus:text-slate-950"
        href="#main"
      >
        Skip to access management
      </a>
      <header className="border-b border-slate-700 px-5 py-5">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <a href="/" className="text-xl font-bold">
            Arata <span className="text-cyan-400">TechLibrary</span>
          </a>
          <nav aria-label="Access navigation" className="flex flex-wrap gap-4 text-sm">
            <a className="underline" href={link('entitlements')}>
              My access
            </a>
            <a className="underline" href={link('access-grants')}>
              Access grants
            </a>
            <a className="underline" href={link('trial-admin')}>
              Campaigns and expiry
            </a>
            <a className="underline" href={link('institution-access')}>
              Institution access
            </a>
            <a className="underline" href={link('platform-settings')}>
              Policy settings
            </a>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl space-y-8 px-5 py-10">
        <h1 className="text-3xl font-bold">
          {mine
            ? 'My library access'
            : trialAdmin
              ? 'Campaigns and upcoming expiry'
              : institutionAdmin
                ? 'Institution access'
                : 'Access grants'}
        </h1>
        <p className="max-w-3xl text-slate-300">
          Independent access sources stay valid until their own end date or revocation. Public and
          registered-free material follows its content policy.
        </p>
        {loading && <p role="status">Loading access records…</p>}
        {error && (
          <p role="alert" className="rounded border border-red-400 p-3 text-red-200">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded border border-green-400 p-3 text-green-200">
            {notice}
          </p>
        )}
        {mine && (
          <section
            className="rounded-xl border border-slate-700 p-5"
            aria-labelledby="trial-heading"
          >
            <h2 id="trial-heading" className="text-xl font-semibold">
              Free trial
            </h2>
            <p className="my-3 text-slate-300">
              Trials require a verified account and are available only when enabled in platform
              policy.
            </p>
            <button
              disabled={busy}
              className="rounded bg-cyan-700 px-4 py-2 disabled:opacity-50"
              onClick={() =>
                perform(async () => {
                  await api.request('/me/trials', 'POST');
                  setNotice('Your trial is active.');
                })
              }
            >
              Start eligible trial
            </button>
            <form
              className="mt-5 flex flex-wrap gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                const input = event.currentTarget.elements.namedItem('code') as HTMLInputElement;
                perform(async () => {
                  await api.request('/me/promotion-redemptions', 'POST', {
                    code: input.value.trim(),
                  });
                  setNotice('Promotional access is active.');
                });
              }}
            >
              <label className="flex flex-col gap-1">
                Promotional code
                <input name="code" required minLength={40} className="rounded bg-slate-800 p-2" />
              </label>
              <button
                disabled={busy}
                className="self-end rounded border border-cyan-400 px-4 py-2 disabled:opacity-50"
              >
                Redeem
              </button>
            </form>
          </section>
        )}
        {!mine && (
          <section
            className="rounded-xl border border-slate-700 p-5"
            aria-labelledby="search-heading"
          >
            <h2 id="search-heading" className="mb-3 text-xl font-semibold">
              Find a recipient
            </h2>
            <form className="flex flex-wrap gap-3" onSubmit={(event) => void search(event)}>
              <label className="flex flex-col gap-1">
                Email search
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  minLength={3}
                  required
                  className="rounded bg-slate-800 p-2"
                />
              </label>
              <button className="self-end rounded border border-cyan-400 px-4 py-2">Search</button>
            </form>
            <ul className="mt-4 space-y-2">
              {people.map((person) => (
                <li
                  key={person.id}
                  className="flex flex-wrap justify-between gap-3 border-b border-slate-700 pb-2"
                >
                  <span>
                    {person.email} · {person.status} · {person.activeGrants} active grants
                  </span>
                  <button
                    className="underline"
                    onClick={() => {
                      setUserId(person.id);
                      setFilterUserId(person.id);
                    }}
                  >
                    Select recipient
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!mine && !trialAdmin && !institutionAdmin && (
          <section
            className="rounded-xl border border-slate-700 p-5"
            aria-labelledby="grant-heading"
          >
            <h2 id="grant-heading" className="mb-3 text-xl font-semibold">
              Request a grant
            </h2>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void grant(event)}>
              <label>
                Recipient ID
                <input
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                  required
                  className="mt-1 block w-full rounded bg-slate-800 p-2"
                />
              </label>
              <label>
                Source
                <select
                  value={source}
                  onChange={(event) => setSource(event.target.value as typeof source)}
                  className="mt-1 block w-full rounded bg-slate-800 p-2"
                >
                  <option>COMPLIMENTARY</option>
                  <option>INSTITUTION</option>
                  <option>SPONSORED</option>
                </select>
              </label>
              <label>
                Scope
                <select
                  value={scope}
                  onChange={(event) => setScope(event.target.value)}
                  className="mt-1 block w-full rounded bg-slate-800 p-2"
                >
                  {['LIBRARY', 'COLLECTION', 'PUBLICATION', 'VOLUME', 'EDITION'].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              {scope !== 'LIBRARY' && (
                <label>
                  Scope ID
                  <input
                    value={scopeId}
                    onChange={(event) => setScopeId(event.target.value)}
                    required
                    className="mt-1 block w-full rounded bg-slate-800 p-2"
                  />
                </label>
              )}
              <label>
                Duration in days
                <input
                  type="number"
                  min="1"
                  value={durationDays}
                  onChange={(event) => setDurationDays(event.target.value)}
                  required
                  className="mt-1 block w-full rounded bg-slate-800 p-2"
                />
              </label>
              {source !== 'COMPLIMENTARY' && (
                <label>
                  Verified membership ID
                  <input
                    value={membershipId}
                    onChange={(event) => setMembershipId(event.target.value)}
                    required
                    className="mt-1 block w-full rounded bg-slate-800 p-2"
                  />
                </label>
              )}
              {source === 'SPONSORED' && (
                <label>
                  Cohort ID
                  <input
                    value={cohortId}
                    onChange={(event) => setCohortId(event.target.value)}
                    required
                    className="mt-1 block w-full rounded bg-slate-800 p-2"
                  />
                </label>
              )}
              <label className="sm:col-span-2">
                Reason
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  required
                  minLength={10}
                  className="mt-1 block w-full rounded bg-slate-800 p-2"
                />
              </label>
              <button disabled={busy} className="rounded bg-cyan-700 px-4 py-2 disabled:opacity-50">
                Request independent approval
              </button>
            </form>
          </section>
        )}
        {trialAdmin && (
          <section
            className="rounded-xl border border-slate-700 p-5"
            aria-labelledby="campaign-heading"
          >
            <h2 id="campaign-heading" className="mb-3 text-xl font-semibold">
              Create a bulk or promotional campaign
            </h2>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void campaign(event)}>
              <label>
                Name
                <input
                  value={campaignName}
                  onChange={(event) => setCampaignName(event.target.value)}
                  required
                  className="mt-1 block w-full rounded bg-slate-800 p-2"
                />
              </label>
              <label>
                Type
                <select
                  value={campaignKind}
                  onChange={(event) => setCampaignKind(event.target.value as typeof campaignKind)}
                  className="mt-1 block w-full rounded bg-slate-800 p-2"
                >
                  <option value="BULK">Bulk grants</option>
                  <option value="PROMOTION">Promotional code</option>
                </select>
              </label>
              <label>
                Scope
                <select
                  value={scope}
                  onChange={(event) => setScope(event.target.value)}
                  className="mt-1 block w-full rounded bg-slate-800 p-2"
                >
                  {['LIBRARY', 'COLLECTION', 'PUBLICATION', 'VOLUME', 'EDITION'].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              {scope !== 'LIBRARY' && (
                <label>
                  Scope ID
                  <input
                    value={scopeId}
                    onChange={(event) => setScopeId(event.target.value)}
                    required
                    className="mt-1 block w-full rounded bg-slate-800 p-2"
                  />
                </label>
              )}
              <label>
                Duration in days
                <input
                  type="number"
                  min="1"
                  value={durationDays}
                  onChange={(event) => setDurationDays(event.target.value)}
                  required
                  className="mt-1 block w-full rounded bg-slate-800 p-2"
                />
              </label>
              {campaignKind === 'BULK' && (
                <label className="sm:col-span-2">
                  Recipient IDs, separated by commas or spaces
                  <textarea
                    value={recipients}
                    onChange={(event) => setRecipients(event.target.value)}
                    required
                    className="mt-1 block w-full rounded bg-slate-800 p-2"
                  />
                </label>
              )}
              <label className="sm:col-span-2">
                Reason
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  required
                  minLength={10}
                  className="mt-1 block w-full rounded bg-slate-800 p-2"
                />
              </label>
              <button disabled={busy} className="rounded bg-cyan-700 px-4 py-2 disabled:opacity-50">
                Request campaign approval
              </button>
            </form>
            {code && (
              <p className="mt-4 rounded border border-amber-400 p-3">
                Save this code now; it is shown only once: <code className="break-all">{code}</code>
              </p>
            )}
            <ul className="mt-5 space-y-3">
              {campaigns.map((item) => (
                <li key={item.id} className="border-b border-slate-700 pb-3">
                  <strong>{item.name}</strong> · {item.kind} · {item.status} · {item.claimCount}/
                  {item.maxClaims} claims · ends {when(item.endsAt)}
                  {item.status === 'PENDING' && (
                    <button
                      disabled={busy || reason.length < 10}
                      className="ml-3 underline disabled:opacity-50"
                      onClick={() =>
                        perform(async () => {
                          await api.request(`/admin/grant-campaigns/${item.id}/approve`, 'POST', {
                            reason,
                          });
                          setNotice('Campaign approved.');
                        })
                      }
                    >
                      Approve as independent administrator
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {institutionAdmin && (
          <section
            className="rounded-xl border border-slate-700 p-5"
            aria-labelledby="agreement-heading"
          >
            <h2 id="agreement-heading" className="mb-3 text-xl font-semibold">
              Institution benefit agreements
            </h2>
            <p className="mb-4 text-slate-300">
              Only already approved institutions can receive a benefit agreement. Activation also
              requires verified domains, reviewed memberships and an enabled institutional policy.
            </p>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void agreement(event)}>
              <label>
                Approved institution ID
                <input
                  value={institutionId}
                  onChange={(event) => setInstitutionId(event.target.value)}
                  required
                  className="mt-1 block w-full rounded bg-slate-800 p-2"
                />
              </label>
              <label>
                Member limit
                <input
                  type="number"
                  min="1"
                  value={memberLimit}
                  onChange={(event) => setMemberLimit(event.target.value)}
                  required
                  className="mt-1 block w-full rounded bg-slate-800 p-2"
                />
              </label>
              <label>
                Category
                <select
                  value={institutionCategory}
                  onChange={(event) => setInstitutionCategory(event.target.value)}
                  className="mt-1 block w-full rounded bg-slate-800 p-2"
                >
                  {[
                    'STUDENT',
                    'ACADEMIC_STAFF',
                    'ORGANIZATION_MEMBER',
                    'SCHOLARSHIP',
                    'SPONSORED_COHORT',
                  ].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
                Scope
                <select
                  value={scope === 'COLLECTION' || scope === 'EDITION' ? 'LIBRARY' : scope}
                  onChange={(event) => setScope(event.target.value)}
                  className="mt-1 block w-full rounded bg-slate-800 p-2"
                >
                  {['LIBRARY', 'PUBLICATION', 'VOLUME'].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              {(scope === 'PUBLICATION' || scope === 'VOLUME') && (
                <label>
                  Scope ID
                  <input
                    value={scopeId}
                    onChange={(event) => setScopeId(event.target.value)}
                    required
                    className="mt-1 block w-full rounded bg-slate-800 p-2"
                  />
                </label>
              )}
              <label>
                Agreement duration in days
                <input
                  type="number"
                  min="1"
                  value={durationDays}
                  onChange={(event) => setDurationDays(event.target.value)}
                  required
                  className="mt-1 block w-full rounded bg-slate-800 p-2"
                />
              </label>
              <label className="sm:col-span-2">
                Decision reason
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  required
                  minLength={10}
                  className="mt-1 block w-full rounded bg-slate-800 p-2"
                />
              </label>
              <button disabled={busy} className="rounded bg-cyan-700 px-4 py-2 disabled:opacity-50">
                Request independent review
              </button>
            </form>
            <ul className="mt-5 space-y-3">
              {agreements.map((item) => (
                <li key={item.id} className="border-b border-slate-700 pb-3">
                  <strong>{item.institutionId}</strong> · {item.status} · {item.scope} ·{' '}
                  {item.permittedCategories.join(', ')} · limit {item.memberLimit} · ends{' '}
                  {when(item.endsAt)}
                  {item.status === 'PENDING' && (
                    <button
                      disabled={busy || reason.length < 10}
                      className="ml-3 underline disabled:opacity-50"
                      onClick={() =>
                        perform(async () => {
                          await api.request(
                            `/admin/institution-agreements/${item.id}/approve`,
                            'POST',
                            { reason },
                          );
                          setNotice('Agreement approved.');
                        })
                      }
                    >
                      Approve independently
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {trialAdmin && (
          <section className="rounded-xl border border-slate-700 p-5">
            <h2 className="mb-3 text-xl font-semibold">Upcoming expirations</h2>
            <ul className="space-y-2">
              {upcoming.map((item) => (
                <li key={item.id}>
                  {item.userId} · {item.source} · {when(item.endsAt)}
                </li>
              ))}
            </ul>
            {!upcoming.length && <p>No expirations in the current notice window.</p>}
          </section>
        )}
        <section
          className="rounded-xl border border-slate-700 p-5"
          aria-labelledby="records-heading"
        >
          <h2 id="records-heading" className="mb-3 text-xl font-semibold">
            {mine ? 'Your access sources' : 'Grant history'}
          </h2>
          <ul className="space-y-3">
            {records.map((item) => (
              <li key={item.id} className="rounded border border-slate-700 p-4">
                <div className="flex flex-wrap justify-between gap-3">
                  <strong>
                    {item.source} · {item.scope}
                  </strong>
                  <span>{item.effectiveStatus ?? item.status}</span>
                </div>
                <p className="text-sm text-slate-300">
                  {when(item.startsAt)} to {when(item.endsAt)}
                  {!mine && <> · recipient {item.userId}</>}
                </p>
                {!mine && (
                  <div className="mt-2 flex flex-wrap gap-3 text-sm">
                    <button className="underline" onClick={() => void history(item.id)}>
                      History
                    </button>
                    {item.status === 'PENDING' && (
                      <button
                        disabled={busy || reason.length < 10}
                        className="underline disabled:opacity-50"
                        onClick={() => action(item.id, 'approve')}
                      >
                        Approve
                      </button>
                    )}
                    {item.status === 'ACTIVE' && (
                      <button
                        disabled={busy || reason.length < 10}
                        className="underline disabled:opacity-50"
                        onClick={() => action(item.id, 'suspend')}
                      >
                        Suspend
                      </button>
                    )}
                    {item.status === 'SUSPENDED' && (
                      <button
                        disabled={busy || reason.length < 10}
                        className="underline disabled:opacity-50"
                        onClick={() => action(item.id, 'resume')}
                      >
                        Resume
                      </button>
                    )}
                    {item.status !== 'REVOKED' && (
                      <button
                        disabled={busy || reason.length < 10}
                        className="underline disabled:opacity-50"
                        onClick={() => action(item.id, 'revoke')}
                      >
                        Revoke
                      </button>
                    )}
                    {item.endsAt && item.status !== 'REVOKED' && (
                      <button
                        disabled={busy || reason.length < 10}
                        className="underline disabled:opacity-50"
                        onClick={() => action(item.id, 'extend')}
                      >
                        Request extension
                      </button>
                    )}
                  </div>
                )}
                {selected === item.id && (
                  <ol className="mt-3 space-y-1 text-sm">
                    {events.map((event) => (
                      <li key={event.id}>
                        {when(event.occurredAt)} · {event.action} · {event.reason}
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ul>
          {!loading && !records.length && <p>No access records found.</p>}
        </section>
      </main>
    </div>
  );
}
