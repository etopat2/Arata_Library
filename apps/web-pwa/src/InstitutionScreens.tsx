import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, createApiClient } from '@arata/api-client';

const api = createApiClient();
const params = new URLSearchParams(location.search);
const screen = params.get('screen') ?? 'eligibility';
type Institution = { id: string; legalName: string; kind: string; status: string };
type Membership = {
  id: string;
  institutionId: string;
  legalName?: string;
  email?: string;
  userId?: string;
  category: string;
  status: string;
  effectiveStatus?: string;
  verificationMethod: string;
  expiresAt: string | null;
};
type Domain = {
  id: string;
  domain: string;
  verifiedAt: string | null;
  approvedAt: string | null;
  suspendedAt: string | null;
  reviewDueAt: string | null;
};
type Policy = {
  id: string;
  category: string;
  scope: string;
  verificationMode: string;
  validityDays: number;
  approvalStatus: string;
  active: boolean;
};
type Cohort = { id: string; name: string; active: boolean; memberCount: number };
type Sso = { id: string; issuerUrl: string; status: string };
type Dashboard = {
  legalName: string;
  status: string;
  activeMembers: number;
  pendingMembers: number;
  activeCohorts: number;
  engagement: { uniqueReaders30d: number } | null;
  engagementReason: string | null;
};
const categories = [
  'STUDENT',
  'ACADEMIC_STAFF',
  'ORGANIZATION_MEMBER',
  'SCHOLARSHIP',
  'SPONSORED_COHORT',
];
const link = (name: string, id = '') =>
  `/?screen=${name}${id ? `&institutionId=${encodeURIComponent(id)}` : ''}`;
const when = (value: string | null) => (value ? new Date(value).toLocaleDateString() : 'Pending');
function failure(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Sign in with a verified account to continue.';
    if (error.status === 403)
      return 'Your institution role, proof, approval or recent MFA does not permit this action.';
    if (error.status === 409)
      return 'This record changed or conflicts with the current institution policy. Refresh and retry.';
    if (error.status === 400) return 'Check the required fields and try again.';
  }
  return 'The institution request could not be completed. Please retry.';
}

export function InstitutionScreens() {
  const reader = screen === 'eligibility' || screen === 'eligibility-status';
  const [institutionId, setInstitutionId] = useState(params.get('institutionId') ?? '');
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [eligible, setEligible] = useState<Institution[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [ssoProviders, setSsoProviders] = useState<Sso[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [legalName, setLegalName] = useState('');
  const [kind, setKind] = useState<'EDUCATIONAL' | 'ORGANIZATION'>('EDUCATIONAL');
  const [registrationRef, setRegistrationRef] = useState('');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [category, setCategory] = useState('STUDENT');
  const [mode, setMode] = useState('MANUAL');
  const [scope, setScope] = useState('LIBRARY');
  const [scopeId, setScopeId] = useState('');
  const [days, setDays] = useState('30');
  const [domain, setDomain] = useState('');
  const [domainId, setDomainId] = useState('');
  const [dnsValue, setDnsValue] = useState('');
  const [dnsName, setDnsName] = useState('');
  const [dnsToken, setDnsToken] = useState('');
  const [reason, setReason] = useState('');
  const [roster, setRoster] = useState('email,category,action\n');
  const [rosterReport, setRosterReport] = useState<{
    rowCount: number;
    acceptedCount: number;
    rejectedCount: number;
    errors: { row: number; code: string }[];
  } | null>(null);
  const [cohortName, setCohortName] = useState('');
  const [cohortId, setCohortId] = useState('');
  const [userId, setUserId] = useState('');
  const [issuerUrl, setIssuerUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const base = `/admin/institutions/${institutionId}`;

  async function load() {
    if (reader) {
      const [a, b] = await Promise.all([
        api.request<{ data: Membership[] }>('/institutional/memberships'),
        api.request<{ data: Institution[] }>('/institutional/eligible-institutions'),
      ]);
      setMembers(a.data);
      setEligible(b.data);
      return;
    }
    if (screen === 'institution-portal') {
      try {
        setInstitutions((await api.request<{ data: Institution[] }>('/admin/institutions')).data);
      } catch (caught) {
        if (!(caught instanceof ApiError && caught.status === 403)) throw caught;
      }
    }
    if (!institutionId) return;
    if (screen === 'institution-portal')
      setDashboard((await api.request<{ data: Dashboard }>(`${base}/dashboard`)).data);
    if (screen === 'institution-roster')
      setMembers((await api.request<{ data: Membership[] }>(`${base}/memberships`)).data);
    if (screen === 'institution-policies') {
      const [a, b, c] = await Promise.all([
        api.request<{ data: Domain[] }>(`${base}/domains`),
        api.request<{ data: Policy[] }>(`${base}/eligibility-policies`),
        api.request<{ data: Sso[] }>(`${base}/sso-providers`),
      ]);
      setDomains(a.data);
      setPolicies(b.data);
      setSsoProviders(c.data);
    }
    if (screen === 'cohort-manager')
      setCohorts((await api.request<{ data: Cohort[] }>(`${base}/cohorts`)).data);
  }
  useEffect(() => {
    setLoading(true);
    void load()
      .catch((caught: unknown) => setError(failure(caught)))
      .finally(() => setLoading(false));
    // The URL selects one institution; actions call load after saving.
  }, [institutionId]);
  async function perform(run: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await run();
      await load();
    } catch (caught) {
      setError(failure(caught));
    } finally {
      setBusy(false);
    }
  }
  function submit(run: () => Promise<void>) {
    return (event: FormEvent) => {
      event.preventDefault();
      void perform(run);
    };
  }
  const action = (path: string, body?: unknown) => api.request(path, 'POST', body);
  const decision = { reason };
  const nav = [
    'eligibility',
    'eligibility-status',
    'institution-portal',
    'institution-roster',
    'institution-policies',
    'cohort-manager',
  ];

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-6 text-slate-50 sm:px-8">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:z-10 focus:bg-white focus:p-3 focus:text-slate-950"
        href="#main"
      >
        Skip to content
      </a>
      <header className="mx-auto max-w-6xl">
        <a href="/" className="text-cyan-300 underline">
          Arata TechLibrary
        </a>
        <h1 className="mt-3 text-3xl font-bold">
          {
            (
              {
                eligibility: 'Institution eligibility',
                'eligibility-status': 'Eligibility status',
                'institution-portal': 'Institution workspace',
                'institution-roster': 'Approved member roster',
                'institution-policies': 'Institution policies',
                'cohort-manager': 'Sponsored cohorts',
              } as Record<string, string>
            )[screen]
          }
        </h1>
        <nav aria-label="Institution screens" className="mt-4 flex flex-wrap gap-3">
          {nav.map((name) => (
            <a
              key={name}
              href={link(name, institutionId)}
              className="rounded border border-slate-600 px-3 py-2 text-cyan-300 hover:bg-slate-800"
            >
              {name.replaceAll('-', ' ')}
            </a>
          ))}
        </nav>
      </header>
      <main id="main" className="mx-auto mt-8 max-w-6xl space-y-6">
        {loading && <p role="status">Loading institution records…</p>}
        {error && (
          <p role="alert" className="rounded border border-red-500 p-3 text-red-200">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded border border-emerald-500 p-3 text-emerald-200">
            {notice}
          </p>
        )}
        {reader ? (
          <>
            <section className="rounded-xl border border-slate-700 p-5">
              <h2 className="text-xl font-semibold">Request eligibility</h2>
              <p className="mt-2 text-slate-300">
                Your account email must be confirmed and match an approved domain. Student or staff
                status also requires the institution’s approved verification method and review.
              </p>
              <form
                className="mt-4 grid gap-3 sm:grid-cols-2"
                onSubmit={submit(async () => {
                  await action('/institutional/memberships', {
                    institutionId,
                    category,
                    ...(evidenceRef ? { evidenceRef } : {}),
                  });
                  setNotice(
                    'Request submitted for institutional review. No premium access is granted yet.',
                  );
                })}
              >
                <label>
                  Institution
                  <select
                    value={institutionId}
                    onChange={(e) => setInstitutionId(e.target.value)}
                    required
                    className="mt-1 block w-full rounded bg-slate-800 p-2"
                  >
                    <option value="">Select an eligible institution</option>
                    {eligible.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.legalName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Benefit category
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="mt-1 block w-full rounded bg-slate-800 p-2"
                  >
                    {categories.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label className="sm:col-span-2">
                  Opaque evidence reference, if requested by the institution
                  <input
                    value={evidenceRef}
                    onChange={(e) => setEvidenceRef(e.target.value)}
                    maxLength={160}
                    className="mt-1 block w-full rounded bg-slate-800 p-2"
                  />
                </label>
                <button
                  disabled={busy || !institutionId}
                  className="rounded bg-cyan-700 px-4 py-2 font-semibold disabled:opacity-50"
                >
                  Submit for review
                </button>
              </form>
            </section>
            <section className="rounded-xl border border-slate-700 p-5">
              <h2 className="text-xl font-semibold">Your institution benefits</h2>
              <ul className="mt-3 space-y-3">
                {members.map((item) => (
                  <li key={item.id} className="border-b border-slate-700 pb-3">
                    <strong>{item.legalName}</strong> · {item.category} ·{' '}
                    {item.effectiveStatus ?? item.status} · valid until {when(item.expiresAt)}
                    {['PENDING', 'VERIFIED'].includes(item.status) && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            await action(`/institutional/memberships/${item.id}/opt-out`);
                            setNotice(
                              'Institution eligibility withdrawn. Any separate paid access remains independent.',
                            );
                          })
                        }
                        className="ml-3 underline"
                      >
                        Opt out
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {!members.length && (
                <p className="mt-3 text-slate-300">No institution membership request yet.</p>
              )}
            </section>
          </>
        ) : (
          <>
            <section className="rounded-xl border border-slate-700 p-5">
              <label>
                Institution ID for your assigned scope
                <input
                  value={institutionId}
                  onChange={(e) => setInstitutionId(e.target.value)}
                  className="mt-1 block w-full rounded bg-slate-800 p-2 sm:max-w-lg"
                  placeholder="Choose from the directory or enter your assigned ID"
                />
              </label>
              {institutions.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {institutions.map((item) => (
                    <li key={item.id}>
                      <button
                        onClick={() => setInstitutionId(item.id)}
                        className="rounded border border-slate-600 px-3 py-2 text-cyan-300"
                      >
                        {item.legalName} · {item.status}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {screen === 'institution-portal' && (
              <>
                <section className="rounded-xl border border-slate-700 p-5">
                  <h2 className="text-xl font-semibold">Central registration</h2>
                  <p className="mt-1 text-slate-300">
                    Registration creates a pending record. A different central administrator must
                    review the legal identity evidence.
                  </p>
                  <form
                    className="mt-3 grid gap-3 sm:grid-cols-2"
                    onSubmit={submit(async () => {
                      const result = (await action('/admin/institutions', {
                        legalName,
                        kind,
                        registrationRef,
                        evidenceRef,
                      })) as { data: { id: string } };
                      setInstitutionId(result.data.id);
                      setNotice('Institution submitted for independent approval.');
                    })}
                  >
                    <label>
                      Legal name
                      <input
                        required
                        value={legalName}
                        onChange={(e) => setLegalName(e.target.value)}
                        className="mt-1 block w-full rounded bg-slate-800 p-2"
                      />
                    </label>
                    <label>
                      Institution type
                      <select
                        value={kind}
                        onChange={(e) => setKind(e.target.value as typeof kind)}
                        className="mt-1 block w-full rounded bg-slate-800 p-2"
                      >
                        <option value="EDUCATIONAL">Educational</option>
                        <option value="ORGANIZATION">Approved organization</option>
                      </select>
                    </label>
                    <label>
                      Legal registration reference
                      <input
                        required
                        value={registrationRef}
                        onChange={(e) => setRegistrationRef(e.target.value)}
                        className="mt-1 block w-full rounded bg-slate-800 p-2"
                      />
                    </label>
                    <label>
                      Private evidence case reference
                      <input
                        required
                        value={evidenceRef}
                        onChange={(e) => setEvidenceRef(e.target.value)}
                        className="mt-1 block w-full rounded bg-slate-800 p-2"
                      />
                    </label>
                    <button disabled={busy} className="rounded bg-cyan-700 px-4 py-2">
                      Register for review
                    </button>
                  </form>
                  {institutionId && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        disabled={busy || reason.length < 10}
                        onClick={() =>
                          void perform(async () => {
                            await action(`${base}/approve`, decision);
                            setNotice('Institution approved.');
                          })
                        }
                        className="rounded border border-slate-500 px-3 py-2"
                      >
                        Approve independently
                      </button>
                      <button
                        disabled={busy || reason.length < 10}
                        onClick={() =>
                          void perform(async () => {
                            await action(`${base}/suspend`, decision);
                            setNotice('Institution suspended.');
                          })
                        }
                        className="rounded border border-slate-500 px-3 py-2"
                      >
                        Suspend institution
                      </button>
                      <button
                        disabled={busy || reason.length < 10 || !userId}
                        onClick={() =>
                          void perform(async () => {
                            await action(`${base}/managers`, { userId });
                            setNotice('Scoped manager assigned.');
                          })
                        }
                        className="rounded border border-slate-500 px-3 py-2"
                      >
                        Assign manager
                      </button>
                      <label>
                        Verified manager user ID
                        <input
                          value={userId}
                          onChange={(e) => setUserId(e.target.value)}
                          className="mt-1 block w-full rounded bg-slate-800 p-2"
                        />
                      </label>
                    </div>
                  )}
                </section>
                {dashboard && (
                  <section className="rounded-xl border border-slate-700 p-5">
                    <h2 className="text-xl font-semibold">{dashboard.legalName} dashboard</h2>
                    <p className="mt-2">
                      Status {dashboard.status} · {dashboard.activeMembers} active members ·{' '}
                      {dashboard.pendingMembers} pending reviews · {dashboard.activeCohorts} cohorts
                    </p>
                    <p className="mt-2">
                      Engagement:{' '}
                      {dashboard.engagement
                        ? `${dashboard.engagement.uniqueReaders30d} distinct readers in 30 days`
                        : dashboard.engagementReason}
                    </p>
                    <p className="mt-2 text-slate-300">
                      Personal reading progress and notes are never shown here.
                    </p>
                  </section>
                )}
              </>
            )}
            {institutionId && screen === 'institution-policies' && (
              <>
                <section className="rounded-xl border border-slate-700 p-5">
                  <h2 className="text-xl font-semibold">Approved domains and DNS proof</h2>
                  <form
                    className="mt-3 flex flex-wrap gap-3"
                    onSubmit={submit(async () => {
                      const result = (await action(`${base}/domains`, { domain })) as {
                        data: { id: string; dnsName: string; dnsValue: string };
                      };
                      setDomainId(result.data.id);
                      setDnsName(result.data.dnsName);
                      setDnsValue(result.data.dnsValue);
                      setNotice(
                        'Publish the exact DNS TXT value, verify it, then request independent central approval.',
                      );
                    })}
                  >
                    <label>
                      Domain
                      <input
                        required
                        value={domain}
                        onChange={(e) => setDomain(e.target.value)}
                        placeholder="university.example"
                        className="mt-1 block w-full rounded bg-slate-800 p-2"
                      />
                    </label>
                    <button disabled={busy} className="self-end rounded bg-cyan-700 px-4 py-2">
                      Request DNS challenge
                    </button>
                  </form>
                  {dnsValue && (
                    <p className="mt-3 break-all rounded bg-slate-800 p-3">
                      One-time DNS TXT at <strong>{dnsName}</strong>: <code>{dnsValue}</code>
                    </p>
                  )}
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label>
                      Domain ID
                      <input
                        value={domainId}
                        onChange={(e) => setDomainId(e.target.value)}
                        className="mt-1 block w-full rounded bg-slate-800 p-2"
                      />
                    </label>
                    <label>
                      Original challenge token
                      <input
                        value={dnsToken}
                        onChange={(e) => setDnsToken(e.target.value)}
                        className="mt-1 block w-full rounded bg-slate-800 p-2"
                      />
                    </label>
                    <button
                      disabled={busy || !domainId || !dnsToken}
                      onClick={() =>
                        void perform(async () => {
                          await action(`${base}/domains/${domainId}/verify`, { token: dnsToken });
                          setNotice('DNS ownership verified. Central approval is still required.');
                        })
                      }
                      className="rounded border border-slate-500 px-3 py-2"
                    >
                      Verify published DNS
                    </button>
                    <button
                      disabled={busy || !domainId || reason.length < 10}
                      onClick={() =>
                        void perform(async () => {
                          await action(`${base}/domains/${domainId}/approve`, decision);
                          setNotice('Domain approved for the configured review period.');
                        })
                      }
                      className="rounded border border-slate-500 px-3 py-2"
                    >
                      Approve domain independently
                    </button>
                  </div>
                  <ul className="mt-4 space-y-2">
                    {domains.map((item) => (
                      <li key={item.id}>
                        {item.domain} ·{' '}
                        {item.suspendedAt
                          ? 'Suspended'
                          : item.approvedAt
                            ? 'Approved'
                            : item.verifiedAt
                              ? 'Proof verified'
                              : 'Pending proof'}{' '}
                        · review by {when(item.reviewDueAt)}{' '}
                        <button onClick={() => setDomainId(item.id)} className="ml-2 underline">
                          Select
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="rounded-xl border border-slate-700 p-5">
                  <h2 className="text-xl font-semibold">Eligibility policy</h2>
                  <p className="mt-1 text-slate-300">
                    A domain alone never proves student status. Domain-only review is permitted only
                    after an independent central approval of that exact category policy.
                  </p>
                  <form
                    className="mt-3 grid gap-3 sm:grid-cols-2"
                    onSubmit={submit(async () => {
                      await action(`${base}/eligibility-policies`, {
                        category,
                        scope,
                        ...(scope === 'LIBRARY' ? {} : { scopeId }),
                        verificationMode: mode,
                        validityDays: Number(days),
                      });
                      setNotice('Policy requested for central approval.');
                    })}
                  >
                    <label>
                      Category
                      <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="mt-1 block w-full rounded bg-slate-800 p-2"
                      >
                        {categories.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Verification mode
                      <select
                        value={mode}
                        onChange={(e) => setMode(e.target.value)}
                        className="mt-1 block w-full rounded bg-slate-800 p-2"
                      >
                        {['MANUAL', 'ROSTER', 'DOMAIN_ONLY'].map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Content scope
                      <select
                        value={scope}
                        onChange={(e) => setScope(e.target.value)}
                        className="mt-1 block w-full rounded bg-slate-800 p-2"
                      >
                        {['LIBRARY', 'PUBLICATION', 'VOLUME'].map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                    {scope !== 'LIBRARY' && (
                      <label>
                        Scope ID
                        <input
                          required
                          value={scopeId}
                          onChange={(e) => setScopeId(e.target.value)}
                          className="mt-1 block w-full rounded bg-slate-800 p-2"
                        />
                      </label>
                    )}
                    <label>
                      Validity days
                      <input
                        type="number"
                        min="1"
                        value={days}
                        onChange={(e) => setDays(e.target.value)}
                        className="mt-1 block w-full rounded bg-slate-800 p-2"
                      />
                    </label>
                    <button disabled={busy} className="rounded bg-cyan-700 px-4 py-2">
                      Request policy review
                    </button>
                  </form>
                  <ul className="mt-4 space-y-2">
                    {policies.map((item) => (
                      <li key={item.id}>
                        {item.category} · {item.verificationMode} · {item.scope} ·{' '}
                        {item.validityDays} days · {item.approvalStatus}
                        {item.approvalStatus === 'PENDING' && (
                          <button
                            disabled={busy || reason.length < 10}
                            onClick={() =>
                              void perform(async () => {
                                await action(
                                  `${base}/eligibility-policies/${item.id}/approve`,
                                  decision,
                                );
                                setNotice('Policy approved and active.');
                              })
                            }
                            className="ml-2 underline"
                          >
                            Approve independently
                          </button>
                        )}
                        {item.active && (
                          <button
                            disabled={busy || reason.length < 10}
                            onClick={() =>
                              void perform(async () => {
                                await action(
                                  `${base}/eligibility-policies/${item.id}/suspend`,
                                  decision,
                                );
                                setNotice(
                                  'Policy suspended; dependent grants are no longer effective.',
                                );
                              })
                            }
                            className="ml-2 underline"
                          >
                            Suspend
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="rounded-xl border border-slate-700 p-5">
                  <h2 className="text-xl font-semibold">Institutional SSO architecture</h2>
                  <p className="mt-1 text-slate-300">
                    Issuer metadata may be reviewed here. Federated sign-in and SSO-based membership
                    verification remain disabled until an identity provider integration is security
                    tested.
                  </p>
                  <form
                    className="mt-3 grid gap-3 sm:grid-cols-2"
                    onSubmit={submit(async () => {
                      await action(`${base}/sso-providers`, { issuerUrl, clientId });
                      setNotice('SSO metadata submitted; authentication remains disabled.');
                    })}
                  >
                    <label>
                      Public HTTPS issuer URL
                      <input
                        required
                        type="url"
                        value={issuerUrl}
                        onChange={(e) => setIssuerUrl(e.target.value)}
                        className="mt-1 block w-full rounded bg-slate-800 p-2"
                      />
                    </label>
                    <label>
                      Client ID
                      <input
                        required
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        className="mt-1 block w-full rounded bg-slate-800 p-2"
                      />
                    </label>
                    <button disabled={busy} className="rounded bg-cyan-700 px-4 py-2">
                      Submit metadata
                    </button>
                  </form>
                  <ul className="mt-3">
                    {ssoProviders.map((item) => (
                      <li key={item.id}>
                        {item.issuerUrl} · {item.status} · sign-in disabled
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            )}
            {institutionId && screen === 'institution-roster' && (
              <>
                <section className="rounded-xl border border-slate-700 p-5">
                  <h2 className="text-xl font-semibold">Roster import</h2>
                  <p className="mt-1 text-slate-300">
                    CSV header: email,category,action. Existing verified accounts only. Preview
                    reports row numbers and error codes; raw roster content is never stored. Applied
                    entries remain pending until reviewed.
                  </p>
                  <label className="mt-3 block">
                    Roster CSV
                    <textarea
                      value={roster}
                      onChange={(e) => setRoster(e.target.value)}
                      rows={7}
                      className="mt-1 block w-full rounded bg-slate-800 p-2 font-mono"
                    />
                  </label>
                  <div className="mt-3 flex gap-3">
                    {([false, true] as const).map((apply) => (
                      <button
                        key={String(apply)}
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            const result = (await action(`${base}/roster-imports`, {
                              csv: roster,
                              apply,
                            })) as { data: typeof rosterReport };
                            setRosterReport(result.data);
                            setNotice(
                              apply
                                ? 'Roster applied; review pending memberships.'
                                : 'Roster preview ready.',
                            );
                          })
                        }
                        className="rounded border border-slate-500 px-3 py-2"
                      >
                        {apply ? 'Apply validated roster' : 'Preview roster'}
                      </button>
                    ))}
                  </div>
                  {rosterReport && (
                    <div className="mt-3" role="status">
                      {rosterReport.acceptedCount} accepted, {rosterReport.rejectedCount} rejected
                      of {rosterReport.rowCount} rows.
                      <ul>
                        {rosterReport.errors.map((item) => (
                          <li key={item.row}>
                            Row {item.row}: {item.code}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
                <section className="rounded-xl border border-slate-700 p-5">
                  <h2 className="text-xl font-semibold">Membership review</h2>
                  <ul className="mt-3 space-y-3">
                    {members.map((item) => (
                      <li key={item.id} className="border-b border-slate-700 pb-3">
                        <strong>{item.email}</strong> · {item.category} · {item.status} ·{' '}
                        {item.verificationMethod} · ends {when(item.expiresAt)}
                        {item.status === 'PENDING' && (
                          <button
                            disabled={busy || reason.length < 10}
                            onClick={() =>
                              void perform(async () => {
                                await action(`${base}/memberships/${item.id}/review`, {
                                  decision: 'APPROVED',
                                  reason,
                                  ...(evidenceRef ? { evidenceRef } : {}),
                                });
                                setNotice(
                                  'Membership verified within the approved agreement and policy.',
                                );
                              })
                            }
                            className="ml-3 underline"
                          >
                            Approve review
                          </button>
                        )}
                        {['PENDING', 'VERIFIED'].includes(item.status) && (
                          <button
                            disabled={busy || reason.length < 10}
                            onClick={() =>
                              void perform(async () => {
                                await action(`${base}/memberships/${item.id}/review`, {
                                  decision: item.status === 'PENDING' ? 'REJECTED' : 'SUSPENDED',
                                  reason,
                                });
                                setNotice(
                                  'Membership access removed without changing separate paid access.',
                                );
                              })
                            }
                            className="ml-3 underline"
                          >
                            {item.status === 'PENDING' ? 'Reject' : 'Suspend'}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {!members.length && (
                    <p className="mt-3 text-slate-300">No roster members in this institution.</p>
                  )}
                  <label className="mt-3 block">
                    Opaque manual evidence case ID
                    <input
                      value={evidenceRef}
                      onChange={(e) => setEvidenceRef(e.target.value)}
                      className="mt-1 block w-full rounded bg-slate-800 p-2"
                    />
                  </label>
                </section>
              </>
            )}
            {institutionId && screen === 'cohort-manager' && (
              <section className="rounded-xl border border-slate-700 p-5">
                <h2 className="text-xl font-semibold">Sponsored cohorts</h2>
                <form
                  className="mt-3 flex flex-wrap gap-3"
                  onSubmit={submit(async () => {
                    await action(`${base}/cohorts`, { name: cohortName });
                    setNotice('Cohort created. Only verified members can join.');
                  })}
                >
                  <label>
                    Cohort name
                    <input
                      required
                      value={cohortName}
                      onChange={(e) => setCohortName(e.target.value)}
                      className="mt-1 block w-full rounded bg-slate-800 p-2"
                    />
                  </label>
                  <button disabled={busy} className="self-end rounded bg-cyan-700 px-4 py-2">
                    Create cohort
                  </button>
                </form>
                <ul className="mt-4">
                  {cohorts.map((item) => (
                    <li key={item.id}>
                      {item.name} · {item.memberCount} members ·{' '}
                      {item.active ? 'Active' : 'Suspended'}{' '}
                      <button onClick={() => setCohortId(item.id)} className="ml-2 underline">
                        Select
                      </button>
                      {item.active && (
                        <button
                          disabled={busy || reason.length < 10}
                          onClick={() =>
                            void perform(async () => {
                              await action(`${base}/cohorts/${item.id}/suspend`, decision);
                              setNotice('Cohort suspended.');
                            })
                          }
                          className="ml-2 underline"
                        >
                          Suspend
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label>
                    Cohort ID
                    <input
                      value={cohortId}
                      onChange={(e) => setCohortId(e.target.value)}
                      className="mt-1 block w-full rounded bg-slate-800 p-2"
                    />
                  </label>
                  <label>
                    Verified member user ID
                    <input
                      value={userId}
                      onChange={(e) => setUserId(e.target.value)}
                      className="mt-1 block w-full rounded bg-slate-800 p-2"
                    />
                  </label>
                  {([true, false] as const).map((join) => (
                    <button
                      key={String(join)}
                      disabled={busy || !cohortId || !userId}
                      onClick={() =>
                        void perform(async () => {
                          await action(`${base}/cohorts/${cohortId}/members`, { userId, join });
                          setNotice(
                            join ? 'Member added to cohort.' : 'Member removed from cohort.',
                          );
                        })
                      }
                      className="rounded border border-slate-500 px-3 py-2"
                    >
                      {join ? 'Add verified member' : 'Remove member'}
                    </button>
                  ))}
                </div>
              </section>
            )}
            <label className="block">
              Decision reason for approvals and changes
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                minLength={10}
                rows={2}
                className="mt-1 block w-full rounded bg-slate-800 p-2"
              />
            </label>
          </>
        )}
      </main>
    </div>
  );
}
