import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, createApiClient } from '@arata/api-client';

const api = createApiClient();
const billing = api.billing;
const route = new URLSearchParams(location.search);
const screen = route.get('screen') ?? 'pricing';
const link = (next: string, more: Record<string, string> = {}) =>
  `/?${new URLSearchParams({ screen: next, ...more })}`;
const currency = (minor: number | string, code: string) =>
  new Intl.NumberFormat('en-UG', {
    style: 'currency',
    currency: code,
    maximumFractionDigits: 0,
  }).format(typeof minor === 'string' ? BigInt(minor) : minor);
type Plan = Awaited<ReturnType<typeof billing.plans>>['data']['paid'][number];
type Subscription = Awaited<ReturnType<typeof billing.subscriptions>>['data'][number];
type Invoice = Awaited<ReturnType<typeof billing.invoices>>['data'][number];
type ReconciliationRun = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  examined: number;
  exceptions: number;
};
type ReconciliationDetail = {
  id: string;
  items: { id: string; providerRef: string; outcome: string; detail: { code: string } | null }[];
};
const describe = (error: unknown) =>
  error instanceof ApiError && error.status === 401
    ? 'Sign in with a verified account to continue.'
    : error instanceof ApiError && error.status === 403
      ? 'This action requires the correct role and recent MFA verification.'
      : 'The billing request could not be completed. Please retry or contact support.';

export function BillingScreens() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [free, setFree] = useState('Public-free resources need no subscription.');
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [order, setOrder] = useState<{
    id: string;
    status: string;
    paymentStatus: string;
    planVersionId: string;
    checkoutUrl: string | null;
  } | null>(null);
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [reconciliationRuns, setReconciliationRuns] = useState<ReconciliationRun[]>([]);
  const [reconciliationDetail, setReconciliationDetail] = useState<ReconciliationDetail | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [period, setPeriod] = useState<'monthly' | 'quarterly' | 'annual'>('monthly');
  const [scopeKind, setScopeKind] = useState<'LIBRARY' | 'PUBLICATION' | 'VOLUME'>('LIBRARY');
  const [scopeId, setScopeId] = useState('');
  const [planName, setPlanName] = useState('');
  const [amountMinor, setAmountMinor] = useState('');
  const [paymentAttemptId, setPaymentAttemptId] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [reason, setReason] = useState('');
  const [refundId, setRefundId] = useState('');
  const [disputeId, setDisputeId] = useState('');
  const [providerCaseId, setProviderCaseId] = useState('');
  const [reconcileFrom, setReconcileFrom] = useState(
    new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
  );
  const [reconcileTo, setReconcileTo] = useState(new Date().toISOString().slice(0, 10));

  async function load() {
    if (screen === 'pricing' || screen === 'checkout' || screen === 'plans-admin') {
      const result = await billing.plans();
      setPlans(result.data.paid);
      setFree(result.data.free.description);
    }
    if (screen === 'my-subscription') setSubscriptions((await billing.subscriptions()).data);
    if (screen === 'invoices' && !route.get('admin')) setInvoices((await billing.invoices()).data);
    if (screen === 'checkout' || screen === 'payment-result') {
      const id = route.get('order');
      if (id) setOrder((await billing.order(id)).data);
    }
    if (
      [
        'finance-dashboard',
        'transactions',
        'refunds',
        'disputes',
        'plans-admin',
        'invoices',
      ].includes(screen) &&
      (screen !== 'invoices' || route.get('admin'))
    ) {
      setReport(
        (await api.request<{ data: Record<string, unknown> }>('/admin/finance/report')).data,
      );
      if (screen === 'finance-dashboard')
        setReconciliationRuns(
          (await api.request<{ data: ReconciliationRun[] }>('/admin/reconciliation-runs')).data,
        );
      if (screen !== 'plans-admin' && screen !== 'finance-dashboard') {
        const kind =
          screen === 'transactions'
            ? 'payments'
            : screen === 'invoices'
              ? 'invoices'
              : screen === 'disputes'
                ? 'disputes'
                : 'refunds';
        setRecords((await api.request<{ data: Record<string, unknown>[] }>(`/admin/${kind}`)).data);
      }
    }
  }
  useEffect(() => {
    void load()
      .catch((caught) => setError(describe(caught)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (order?.status !== 'PAID') return;
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith(`arata-checkout:${order.planVersionId}:`)) sessionStorage.removeItem(key);
  }, [order]);
  function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    void action()
      .catch((caught) => setError(describe(caught)))
      .finally(() => setBusy(false));
  }
  async function checkout(
    planVersionId: string,
    options: { renewalSubscriptionId?: string; upgradeFromId?: string } = {},
  ) {
    const keyName = `arata-checkout:${planVersionId}:${options.renewalSubscriptionId ?? options.upgradeFromId ?? 'new'}`;
    const key = sessionStorage.getItem(keyName) ?? crypto.randomUUID().replaceAll('-', '');
    sessionStorage.setItem(keyName, key);
    const result = await billing.checkout(planVersionId, key, options);
    if (!result.data.checkoutUrl) {
      location.href = link('payment-result', { order: result.data.id });
      return;
    }
    location.href = result.data.checkoutUrl;
  }
  const input = 'mt-1 w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-slate-950';
  const button = 'rounded-lg bg-[#74233e] px-4 py-2 font-semibold text-white disabled:opacity-50';
  const card = 'rounded-xl border border-slate-200 bg-white p-5 shadow-sm';
  const title = screen.replaceAll('-', ' ').replace(/\b\w/g, (value) => value.toUpperCase());
  return (
    <div className="min-h-screen bg-[#f7f8f6] text-[#173647]">
      <a
        href="#billing-main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-20 focus:bg-white focus:p-3"
      >
        Skip to content
      </a>
      <header className="border-b bg-white px-6 py-4">
        <nav
          aria-label="Billing navigation"
          className="mx-auto flex max-w-6xl flex-wrap items-center gap-4"
        >
          <a className="mr-auto text-lg font-bold" href="/">
            Arata TechLibrary™
          </a>
          <a href={link('pricing')}>Plans</a>
          <a href={link('my-subscription')}>My subscriptions</a>
          <a href={link('invoices')}>Invoices</a>
          <a href={link('finance-dashboard')}>Finance</a>
        </nav>
      </header>
      <main id="billing-main" className="mx-auto max-w-6xl space-y-6 px-6 py-10">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-[#087d78]">
            Subscriptions and billing
          </p>
          <h1 className="mt-2 text-3xl font-black">{title}</h1>
        </div>
        {loading && <p role="status">Loading billing information…</p>}
        {busy && <p role="status">Processing request…</p>}
        {error && (
          <div role="alert" className="rounded-lg border border-red-400 bg-red-50 p-4 text-red-900">
            {error}{' '}
            <a className="underline" href={link('login')}>
              Sign in
            </a>
          </div>
        )}
        {message && (
          <p role="status" className="rounded-lg border border-emerald-500 bg-emerald-50 p-4">
            {message}
          </p>
        )}
        {screen === 'pricing' && !loading && (
          <>
            <p>
              Choose access by volume, series or the entire library. Payments renew manually. Prices
              and access apply only to the named scope.
            </p>
            <div className={`${card} max-w-xl`}>
              <h2 className="text-xl font-bold">Free access</h2>
              <p>{free}</p>
              <a className="mt-3 inline-block underline" href={link('free-library')}>
                Browse free resources
              </a>
            </div>
            {plans.length === 0 ? (
              <p className={card}>
                Paid plans are not available while pricing and terms await approval.
              </p>
            ) : (
              <div className="grid gap-4 md:grid-cols-3">
                {plans.map((plan) => (
                  <article className={card} key={plan.planVersionId}>
                    <h2 className="text-xl font-bold">{plan.name}</h2>
                    <p className="mt-2 text-2xl font-black">
                      {currency(plan.amountMinor, plan.currencyCode)}
                    </p>
                    <p>
                      {plan.periodMonths} calendar month{plan.periodMonths === 1 ? '' : 's'} ·{' '}
                      {plan.scopeKind.toLowerCase()}
                      {` · ${plan.scopeTitle}`}
                    </p>
                    <p className="mt-2 text-sm">
                      Manual renewal. Cancellation preserves paid access through the period end.
                      Refund requests are reviewed within {plan.refundWindowDays} days.
                    </p>
                    <a
                      className="mt-4 inline-block rounded-lg bg-[#74233e] px-4 py-2 font-semibold text-white"
                      href={link('checkout', {
                        plan: plan.planVersionId,
                        ...(route.get('upgrade') ? { upgrade: route.get('upgrade')! } : {}),
                      })}
                    >
                      Review checkout
                    </a>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
        {screen === 'checkout' &&
          !loading &&
          (() => {
            const selected = plans.find((item) => item.planVersionId === route.get('plan'));
            return selected ? (
              <section className={`${card} max-w-2xl space-y-4`}>
                <h2 className="text-xl font-bold">Order review</h2>
                <p>
                  {selected.name} · {selected.scopeTitle} · {selected.periodMonths} month
                  {selected.periodMonths === 1 ? '' : 's'}
                </p>
                <p className="text-2xl font-bold">
                  {currency(selected.amountMinor, selected.currencyCode)}
                </p>
                <p>
                  Checkout is hosted by Flutterwave. Card details and mobile-money PINs are entered
                  only with the provider. Payment may remain pending; access activates after server
                  verification.
                </p>
                <p>
                  Renewal is manual. You can cancel future renewal without shortening an existing
                  paid term. Refund requests are subject to the published policy.
                </p>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      checkout(
                        selected.planVersionId,
                        route.get('renew')
                          ? { renewalSubscriptionId: route.get('renew')! }
                          : route.get('upgrade')
                            ? { upgradeFromId: route.get('upgrade')! }
                            : {},
                      ),
                    )
                  }
                >
                  Continue to secure checkout
                </button>
              </section>
            ) : (
              <p role="alert">
                This plan is not currently available.{' '}
                <a className="underline" href={link('pricing')}>
                  See plans
                </a>
              </p>
            );
          })()}
        {screen === 'payment-result' && (
          <section className={`${card} max-w-2xl space-y-4`}>
            <h2 className="text-xl font-bold">Payment status</h2>
            <p role="status">
              {order
                ? `Order ${order.status.toLowerCase()}; payment ${order.paymentStatus.toLowerCase()}.`
                : 'Checking order…'}
            </p>
            <p>
              Only a verified provider settlement activates access. Mobile-money approvals may take
              time.
            </p>
            {order && order.status !== 'PAID' && (
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await billing.verify(order.id);
                    setOrder((await billing.order(order.id)).data);
                  })
                }
              >
                Check payment again
              </button>
            )}
            {order?.status === 'FAILED' && (
              <button
                className={`${button} ml-3`}
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const next = await billing.retry(
                      order.id,
                      crypto.randomUUID().replaceAll('-', ''),
                    );
                    if (next.data.checkoutUrl) location.href = next.data.checkoutUrl;
                    else location.href = link('payment-result', { order: next.data.id });
                  })
                }
              >
                Retry checkout
              </button>
            )}
            {order?.status === 'PAID' && (
              <a className="underline" href={link('my-subscription')}>
                View your access
              </a>
            )}
          </section>
        )}
        {screen === 'my-subscription' && !loading && (
          <>
            <p>
              Free resources remain available independently of paid access. Your overlapping grants
              may provide additional access.
            </p>
            {subscriptions.length === 0 ? (
              <p className={card}>
                No paid subscriptions yet.{' '}
                <a className="underline" href={link('pricing')}>
                  Explore plans
                </a>
              </p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {subscriptions.map((item) => (
                  <article className={card} key={item.id}>
                    <h2 className="text-lg font-bold">{item.name}</h2>
                    <p>Status: {item.status}</p>
                    <p>
                      Paid through:{' '}
                      {item.currentPeriodEnd
                        ? new Date(item.currentPeriodEnd).toLocaleDateString()
                        : 'Pending payment'}
                    </p>
                    <p>
                      Scope: {item.scopeKind.toLowerCase()}
                      {item.scopeId ? ` ${item.scopeId}` : ''}
                    </p>
                    {item.cancelAtPeriodEnd ? (
                      <p>Future renewal cancelled.</p>
                    ) : (
                      item.status === 'ACTIVE' && (
                        <button
                          className={`${button} mt-3`}
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await billing.cancel(item.id);
                              setMessage(
                                'Future renewal cancelled; paid access continues through the date shown.',
                              );
                              setSubscriptions((await billing.subscriptions()).data);
                            })
                          }
                        >
                          Cancel future renewal
                        </button>
                      )
                    )}
                    {item.status === 'ACTIVE' && (
                      <a className="ml-3 underline" href={link('pricing', { upgrade: item.id })}>
                        Change plan
                      </a>
                    )}
                  </article>
                ))}
              </div>
            )}
          </>
        )}
        {screen === 'invoices' && !route.get('admin') && !loading && (
          <>
            {invoices.length === 0 ? (
              <p className={card}>No paid invoices yet.</p>
            ) : (
              <ul className="space-y-3">
                {invoices.map((invoice) => (
                  <li className={card} key={invoice.id}>
                    <strong>{invoice.invoiceNumber}</strong> ·{' '}
                    {currency(invoice.totalMinor, invoice.currencyCode)} ·{' '}
                    {new Date(invoice.issuedAt).toLocaleDateString()}
                    <a
                      className="ml-4 underline"
                      href={`/api/v1/me/invoices/${invoice.id}/statement`}
                    >
                      Download statement
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {['finance-dashboard', 'transactions', 'refunds', 'disputes', 'plans-admin'].includes(
          screen,
        ) ||
        (screen === 'invoices' && route.get('admin')) ? (
          <>
            <nav aria-label="Finance sections" className="flex flex-wrap gap-4 text-sm underline">
              {[
                'finance-dashboard',
                'plans-admin',
                'transactions',
                'invoices',
                'refunds',
                'disputes',
              ].map((item) => (
                <a key={item} href={link(item, item === 'invoices' ? { admin: '1' } : {})}>
                  {item.replaceAll('-', ' ')}
                </a>
              ))}
            </nav>
            {report && (
              <section className={card}>
                <h2 className="text-xl font-bold">Finance overview</h2>
                <dl className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div>
                    <dt>Paid orders</dt>
                    <dd className="text-2xl font-bold">{String(report.paidOrders)}</dd>
                  </div>
                  <div>
                    <dt>Gross verified receipts</dt>
                    <dd className="text-2xl font-bold">
                      {currency(String(report.grossMinor), String(report.currency))}
                    </dd>
                  </div>
                  <div>
                    <dt>Settled refunds</dt>
                    <dd className="text-2xl font-bold">
                      {currency(String(report.settledRefundMinor), String(report.currency))}
                    </dd>
                  </div>
                  <div>
                    <dt>Pending orders</dt>
                    <dd>{String(report.pendingOrders)}</dd>
                  </div>
                  <div>
                    <dt>Open disputes</dt>
                    <dd>{String(report.openDisputes)}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-sm">
                  Tax treatment and settlement fees require finance review.
                </p>
              </section>
            )}
            {screen === 'finance-dashboard' && (
              <form
                className={`${card} max-w-xl space-y-3`}
                onSubmit={(event) => {
                  event.preventDefault();
                  run(async () => {
                    const result = await api.request<{
                      data: {
                        examined: number;
                        refundsExamined: number;
                        exceptions: number;
                        batchLimited: boolean;
                        id: string;
                      };
                    }>('/admin/payments/reconcile', 'POST', {
                      from: `${reconcileFrom}T00:00:00Z`,
                      to: `${reconcileTo}T23:59:59Z`,
                    });
                    setMessage(
                      `Checked ${result.data.examined} payments and ${result.data.refundsExamined} refunds; ${result.data.exceptions} exceptions.${result.data.batchLimited ? ' More records remain for the next run.' : ''}`,
                    );
                    await load();
                    setReconciliationDetail(
                      (
                        await api.request<{ data: ReconciliationDetail }>(
                          `/admin/reconciliation-runs/${result.data.id}`,
                        )
                      ).data,
                    );
                  });
                }}
              >
                <h2 className="text-lg font-bold">Run reconciliation</h2>
                <p>Rechecks provider settlement. Exceptions remain visible for finance review.</p>
                <label className="block">
                  From date
                  <input
                    className={input}
                    type="date"
                    value={reconcileFrom}
                    onChange={(event) => setReconcileFrom(event.target.value)}
                    required
                  />
                </label>
                <label className="block">
                  To date
                  <input
                    className={input}
                    type="date"
                    value={reconcileTo}
                    onChange={(event) => setReconcileTo(event.target.value)}
                    required
                  />
                </label>
                <button className={button} disabled={busy}>
                  Reconcile
                </button>
              </form>
            )}
            {screen === 'finance-dashboard' && (
              <section className={card}>
                <h2 className="text-lg font-bold">Reconciliation history and exceptions</h2>
                {reconciliationRuns.length === 0 ? (
                  <p>No reconciliation runs yet.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {reconciliationRuns.map((item) => (
                      <li key={item.id}>
                        <button
                          className="text-left underline"
                          disabled={busy}
                          onClick={() =>
                            run(async () =>
                              setReconciliationDetail(
                                (
                                  await api.request<{ data: ReconciliationDetail }>(
                                    `/admin/reconciliation-runs/${item.id}`,
                                  )
                                ).data,
                              ),
                            )
                          }
                        >
                          {new Date(item.startedAt).toLocaleString()} · {item.examined} checked ·{' '}
                          {item.exceptions} exceptions
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {reconciliationDetail && (
                  <div className="mt-5">
                    <h3 className="font-semibold">Run {reconciliationDetail.id}</h3>
                    {reconciliationDetail.items.filter((item) =>
                      ['ERROR', 'REVIEW'].includes(item.outcome),
                    ).length === 0 ? (
                      <p>No exceptions in this run.</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {reconciliationDetail.items
                          .filter((item) => ['ERROR', 'REVIEW'].includes(item.outcome))
                          .map((item) => (
                            <li className="rounded border p-2" key={item.id}>
                              {item.providerRef} · {item.outcome} ·{' '}
                              {item.detail?.code ?? 'Review required'}
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>
            )}
            {screen === 'plans-admin' && (
              <form
                className={`${card} max-w-xl space-y-3`}
                onSubmit={(event: FormEvent) => {
                  event.preventDefault();
                  run(async () => {
                    await api.request('/admin/plans', 'POST', {
                      name: planName,
                      period,
                      scopeKind,
                      ...(scopeKind !== 'LIBRARY' ? { scopeId } : {}),
                      amountMinor: Number(amountMinor),
                    });
                    setMessage('New immutable plan version created.');
                    await load();
                  });
                }}
              >
                <h2 className="text-lg font-bold">Create a plan version</h2>
                <p>
                  Active finance-approved platform settings must enable the selected period. Library
                  pricing must match the active policy.
                </p>
                <label className="block">
                  Plan name
                  <input
                    className={input}
                    value={planName}
                    onChange={(event) => setPlanName(event.target.value)}
                    required
                  />
                </label>
                <label className="block">
                  Billing period
                  <select
                    className={input}
                    value={period}
                    onChange={(event) => setPeriod(event.target.value as typeof period)}
                  >
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annual">Annual</option>
                  </select>
                </label>
                <label className="block">
                  Access scope
                  <select
                    className={input}
                    value={scopeKind}
                    onChange={(event) => setScopeKind(event.target.value as typeof scopeKind)}
                  >
                    <option value="LIBRARY">Entire library</option>
                    <option value="PUBLICATION">Series or book</option>
                    <option value="VOLUME">Single volume</option>
                  </select>
                </label>
                {scopeKind !== 'LIBRARY' && (
                  <label className="block">
                    Publication or volume ID
                    <input
                      className={input}
                      value={scopeId}
                      onChange={(event) => setScopeId(event.target.value)}
                      required
                    />
                  </label>
                )}
                <label className="block">
                  Price in minor units
                  <input
                    className={input}
                    type="number"
                    min="1"
                    value={amountMinor}
                    onChange={(event) => setAmountMinor(event.target.value)}
                    required
                  />
                </label>
                <button className={button} disabled={busy}>
                  Create version
                </button>
              </form>
            )}
            {screen === 'refunds' && (
              <div className="grid gap-4 md:grid-cols-2">
                <form
                  className={card}
                  onSubmit={(event) => {
                    event.preventDefault();
                    run(async () => {
                      const result = await api.request<{ data: { id: string } }>(
                        '/admin/refunds',
                        'POST',
                        { paymentAttemptId, amountMinor: Number(refundAmount), reason },
                        undefined,
                        { 'Idempotency-Key': crypto.randomUUID().replaceAll('-', '') },
                      );
                      setRefundId(result.data.id);
                      setMessage('Refund requested. A different finance officer must approve it.');
                      await load();
                    });
                  }}
                >
                  <h2 className="text-lg font-bold">Request a refund</h2>
                  <label className="block mt-2">
                    Payment ID
                    <input
                      className={input}
                      value={paymentAttemptId}
                      onChange={(event) => setPaymentAttemptId(event.target.value)}
                      required
                    />
                  </label>
                  <label className="block mt-2">
                    Amount in minor units
                    <input
                      className={input}
                      type="number"
                      min="1"
                      value={refundAmount}
                      onChange={(event) => setRefundAmount(event.target.value)}
                      required
                    />
                  </label>
                  <label className="block mt-2">
                    Reason
                    <textarea
                      className={input}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      required
                      minLength={10}
                    />
                  </label>
                  <button className={`${button} mt-3`} disabled={busy}>
                    Request review
                  </button>
                </form>
                <form
                  className={card}
                  onSubmit={(event) => {
                    event.preventDefault();
                    run(async () => {
                      await api.request(`/admin/refunds/${refundId}/approve`, 'POST');
                      setMessage('Refund submitted for provider processing.');
                      await load();
                    });
                  }}
                >
                  <h2 className="text-lg font-bold">Independent approval</h2>
                  <label className="block mt-2">
                    Refund ID
                    <input
                      className={input}
                      value={refundId}
                      onChange={(event) => setRefundId(event.target.value)}
                      required
                    />
                  </label>
                  <button className={`${button} mt-3`} disabled={busy}>
                    Approve and submit
                  </button>
                </form>
                <form
                  className={card}
                  onSubmit={(event) => {
                    event.preventDefault();
                    run(async () => {
                      const result = await api.request<{ data: { id: string } }>(
                        '/admin/disputes',
                        'POST',
                        { paymentAttemptId, providerCaseId, reason },
                      );
                      setDisputeId(result.data.id);
                      setMessage(
                        'Dispute recorded and payment access frozen according to active policy.',
                      );
                      await load();
                    });
                  }}
                >
                  <h2 className="text-lg font-bold">Record a dispute</h2>
                  <label className="block mt-2">
                    Payment ID
                    <input
                      className={input}
                      value={paymentAttemptId}
                      onChange={(event) => setPaymentAttemptId(event.target.value)}
                      required
                    />
                  </label>
                  <label className="block mt-2">
                    Provider case ID
                    <input
                      className={input}
                      value={providerCaseId}
                      onChange={(event) => setProviderCaseId(event.target.value)}
                      required
                    />
                  </label>
                  <label className="block mt-2">
                    Reason
                    <textarea
                      className={input}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      minLength={10}
                      required
                    />
                  </label>
                  <button className={`${button} mt-3`} disabled={busy}>
                    Record dispute
                  </button>
                </form>
                <form
                  className={card}
                  onSubmit={(event) => {
                    event.preventDefault();
                    run(async () => {
                      await api.request(`/admin/disputes/${disputeId}/resolve`, 'POST', {
                        decision: 'WON',
                      });
                      setMessage('Dispute resolved after a new provider verification.');
                      await load();
                    });
                  }}
                >
                  <h2 className="text-lg font-bold">Resolve a dispute</h2>
                  <label className="block mt-2">
                    Dispute ID
                    <input
                      className={input}
                      value={disputeId}
                      onChange={(event) => setDisputeId(event.target.value)}
                      required
                    />
                  </label>
                  <button className={`${button} mt-3`} disabled={busy}>
                    Mark won after verification
                  </button>
                </form>
              </div>
            )}
            {records.length > 0 && (
              <section className={card}>
                <h2 className="text-lg font-bold">Recent records</h2>
                <div className="overflow-x-auto">
                  <table className="mt-3 w-full text-left text-sm">
                    <thead>
                      <tr>
                        <th className="p-2">ID</th>
                        <th className="p-2">Status</th>
                        <th className="p-2">Amount</th>
                        <th className="p-2">Reference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((item) => (
                        <tr className="border-t" key={String(item.id)}>
                          <td className="p-2">{String(item.id)}</td>
                          <td className="p-2">{String(item.status)}</td>
                          <td className="p-2">
                            {(item.amountMinor ?? item.totalMinor)
                              ? String(item.amountMinor ?? item.totalMinor)
                              : '—'}
                          </td>
                          <td className="p-2">
                            {String(item.providerRef ?? item.merchantRef ?? '—')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
