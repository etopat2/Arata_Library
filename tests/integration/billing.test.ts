import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import pg from 'pg';
import { BillingService } from '../../apps/api/src/billing/billing.service.js';
import type { BillingGateway, GatewaySettlement } from '../../apps/api/src/billing/gateway.js';
import type { PlatformPolicyService } from '../../apps/api/src/platform-policy/platform-policy.service.js';
import {
  initialPlatformSettings,
  platformSettingsSchema,
} from '../../packages/validation/src/platform-policy.js';

const local = dotenv.parse(readFileSync(process.env.ARATA_ENV_FILE ?? '.env.local', 'utf8'));
if (
  !local.TEST_DATABASE_URL ||
  new URL(local.TEST_DATABASE_URL).pathname !== '/arata_techlibrary_test'
)
  throw new Error('Isolated test database required');
const pool = new pg.Pool({ connectionString: local.TEST_DATABASE_URL, max: 5 });
const settings = platformSettingsSchema.parse({
  ...initialPlatformSettings,
  subscriptions: {
    ...initialPlatformSettings.subscriptions,
    plans: {
      monthly: {
        ...initialPlatformSettings.subscriptions.plans.monthly,
        enabled: true,
        priceMinor: 2000,
      },
      quarterly: {
        ...initialPlatformSettings.subscriptions.plans.quarterly,
        enabled: true,
        priceMinor: 5500,
      },
      annual: {
        ...initialPlatformSettings.subscriptions.plans.annual,
        enabled: true,
        priceMinor: 20000,
      },
    },
  },
});
const policy = {
  current: async () => ({ version: 1, status: 'ACTIVE', settings }),
} as unknown as PlatformPolicyService;
class FakeSandboxGateway implements BillingGateway {
  code = 'FLUTTERWAVE_V3';
  referencePrefix = 'ATL-TEST' as const;
  payments = new Map<string, GatewaySettlement>();
  refundState = new Map<string, { status: string; amountMinor: number; transactionId: string }>();
  refundCalls = 0;
  checkoutCalls = 0;
  lastRefundId = '';
  async checkout(input: Parameters<BillingGateway['checkout']>[0]) {
    this.checkoutCalls++;
    return `https://checkout.flutterwave.com/v3/test/${input.reference}`;
  }
  async verify(reference: string) {
    return this.payments.get(reference) ?? null;
  }
  ownsMerchant(accountId: string) {
    return accountId === 'TEST-MERCHANT';
  }
  verifyWebhook(signature: string | undefined) {
    return signature === 'TEST-ONLY-SIGNATURE';
  }
  async refund(transactionId: string, amountMinor: number) {
    this.refundCalls++;
    const id = String(Date.now() * 1000 + this.refundCalls);
    this.lastRefundId = id;
    this.refundState.set(id, { status: 'pending', amountMinor, transactionId });
    return { id, status: 'pending', amountMinor, transactionId, accountId: 'TEST-MERCHANT' };
  }
  async refundStatus(_transactionId: string, id: string) {
    const row = this.refundState.get(id);
    return row ? { id, ...row, accountId: 'TEST-MERCHANT' } : null;
  }
  set(
    reference: string,
    amountMinor: number,
    status: GatewaySettlement['status'] = 'successful',
    overrides: Partial<GatewaySettlement> = {},
  ) {
    this.payments.set(reference, {
      reference,
      transactionId:
        this.payments.get(reference)?.transactionId ?? String(randomBytes(6).readUIntBE(0, 6)),
      accountId: 'TEST-MERCHANT',
      amountMinor,
      currency: 'UGX',
      status,
      ...overrides,
    });
  }
}
const gateway = new FakeSandboxGateway();
const billing = new BillingService(pool, policy, gateway);
let userId: string;
let planId: string;
let quarterlyId: string;
async function create(
  planVersionId = planId,
  options: { renewalSubscriptionId?: string; upgradeFromId?: string } = {},
) {
  const result = await billing.createOrder(
    userId,
    { planVersionId, ...options },
    randomUUID(),
    randomUUID(),
  );
  const detail = await pool.query<{ merchantRef: string; paymentAttemptId: string }>(
    `SELECT o."merchantRef",a.id AS "paymentAttemptId"
    FROM app."Order" o JOIN app."PaymentAttempt" a ON a."orderId"=o.id WHERE o.id=$1`,
    [result.id],
  );
  return { ...result, ...detail.rows[0]! };
}
async function paidEntitlements(orderId: string) {
  return Number(
    (
      await pool.query<{ count: string }>(
        `SELECT count(*) FROM app."EffectiveEntitlement" WHERE "orderId"=$1`,
        [orderId],
      )
    ).rows[0]!.count,
  );
}
beforeAll(async () => {
  userId = randomUUID();
  await pool.query(
    `INSERT INTO app."User" (id,email,status,"emailVerifiedAt","termsAcceptedAt","privacyVersion","createdAt","updatedAt")
    VALUES ($1,$2,'ACTIVE',now(),now(),'TEST-ONLY',now(),now())`,
    [userId, `billing-${userId}@example.invalid`],
  );
  planId = (
    await billing.createPlan(
      {
        name: '[TEST ONLY] Monthly library',
        period: 'monthly',
        scopeKind: 'LIBRARY',
        amountMinor: 2000,
      },
      userId,
      randomUUID(),
    )
  ).id;
  quarterlyId = (
    await billing.createPlan(
      {
        name: '[TEST ONLY] Quarterly library',
        period: 'quarterly',
        scopeKind: 'LIBRARY',
        amountMinor: 5500,
      },
      userId,
      randomUUID(),
    )
  ).id;
}, 30_000);
afterAll(async () => {
  await pool.end();
});

describe('sandbox-only verified billing', () => {
  it('never activates pending, failed or mismatched payments', async () => {
    const pending = await create();
    gateway.set(pending.merchantRef, 2000, 'pending');
    expect((await billing.settle(pending.merchantRef, randomUUID())).status).toBe('PENDING');
    expect(await paidEntitlements(pending.id)).toBe(0);
    gateway.set(pending.merchantRef, 2000, 'successful', { amountMinor: 1999 });
    expect((await billing.settle(pending.merchantRef, randomUUID())).status).toBe('REVIEW');
    expect(await paidEntitlements(pending.id)).toBe(0);
    const failed = await create();
    gateway.set(failed.merchantRef, 2000, 'failed');
    await billing.settle(failed.merchantRef, randomUUID());
    expect((await billing.order(userId, failed.id)).status).toBe('FAILED');
    expect(await paidEntitlements(failed.id)).toBe(0);
  });
  it('activates exactly once after delayed successful server verification, including concurrent retries', async () => {
    const order = await create();
    const first = await billing.createOrder(
      userId,
      { planVersionId: planId },
      'duplicate-fixture-key',
      randomUUID(),
    );
    const again = await billing.createOrder(
      userId,
      { planVersionId: planId },
      'duplicate-fixture-key',
      randomUUID(),
    );
    expect(first.id).toBe(again.id);
    expect(await paidEntitlements(order.id)).toBe(0);
    gateway.set(order.merchantRef, 2000);
    await Promise.all([
      billing.settle(order.merchantRef, randomUUID()),
      billing.settle(order.merchantRef, randomUUID()),
    ]);
    const before = await pool.query<{ currentPeriodEnd: Date }>(
      `SELECT "currentPeriodEnd" FROM app."Subscription" WHERE id=$1`,
      [order.subscriptionId],
    );
    await billing.settle(order.merchantRef, randomUUID());
    const after = await pool.query<{ currentPeriodEnd: Date }>(
      `SELECT "currentPeriodEnd" FROM app."Subscription" WHERE id=$1`,
      [order.subscriptionId],
    );
    expect(after.rows[0]!.currentPeriodEnd.toISOString()).toBe(
      before.rows[0]!.currentPeriodEnd.toISOString(),
    );
    expect(await paidEntitlements(order.id)).toBe(1);
    expect((await billing.invoices(userId)).some((invoice) => invoice.orderId === order.id)).toBe(
      true,
    );
  });
  it('rejects forged webhook signatures and remains idempotent for signed retries', async () => {
    const order = await create();
    gateway.set(order.merchantRef, 2000);
    await expect(
      billing.webhook(
        'flutterwave_v3',
        'forged',
        { data: { tx_ref: order.merchantRef } },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(await paidEntitlements(order.id)).toBe(0);
    const payload = { event: 'charge.completed', data: { tx_ref: order.merchantRef } };
    await billing.webhook('flutterwave_v3', 'TEST-ONLY-SIGNATURE', payload, randomUUID());
    await billing.webhook('flutterwave_v3', 'TEST-ONLY-SIGNATURE', payload, randomUUID());
    expect(await paidEntitlements(order.id)).toBe(1);
  });
  it('supports manual renewal and an upgrade with independently scoped paid periods', async () => {
    const original = await create();
    gateway.set(original.merchantRef, 2000);
    await billing.settle(original.merchantRef, randomUUID());
    const renewal = await create(planId, { renewalSubscriptionId: original.subscriptionId! });
    gateway.set(renewal.merchantRef, 2000);
    await billing.settle(renewal.merchantRef, randomUUID());
    expect(await paidEntitlements(renewal.id)).toBe(0); // scheduled after the current paid term
    const upgraded = await create(quarterlyId, { upgradeFromId: original.subscriptionId! });
    gateway.set(upgraded.merchantRef, 5500);
    await billing.settle(upgraded.merchantRef, randomUUID());
    expect(await paidEntitlements(original.id)).toBe(1);
    expect(await paidEntitlements(upgraded.id)).toBe(1);
    const old = (await billing.subscriptions(userId)).find(
      (item) => item.id === original.subscriptionId,
    );
    expect(old?.cancelAtPeriodEnd).toBe(true);
  });
  it('keeps paid-through access after cancellation and revokes a reversed payment', async () => {
    const order = await create();
    gateway.set(order.merchantRef, 2000);
    await billing.settle(order.merchantRef, randomUUID());
    await billing.cancel(userId, order.subscriptionId!, randomUUID());
    expect(await paidEntitlements(order.id)).toBe(1);
    gateway.set(order.merchantRef, 2000, 'reversed');
    await billing.settle(order.merchantRef, randomUUID());
    expect(await paidEntitlements(order.id)).toBe(0);
    expect((await billing.order(userId, order.id)).status).toBe('REFUNDED');
  });
  it('requires independent refund approval and provider settlement before full revocation', async () => {
    const order = await create();
    gateway.set(order.merchantRef, 2000);
    await billing.settle(order.merchantRef, randomUUID());
    const attempt = await pool.query<{ id: string }>(
      `SELECT id FROM app."PaymentAttempt" WHERE "orderId"=$1`,
      [order.id],
    );
    const requested = await billing.requestRefund(
      attempt.rows[0]!.id,
      2000,
      'Customer cancellation request',
      userId,
      randomUUID(),
      randomUUID(),
    );
    await expect(billing.approveRefund(requested.id, userId, randomUUID())).rejects.toMatchObject({
      status: 403,
    });
    const approverId = randomUUID();
    await pool.query(
      `INSERT INTO app."User" (id,email,status,"emailVerifiedAt","termsAcceptedAt","privacyVersion","createdAt","updatedAt")
      VALUES ($1,$2,'ACTIVE',now(),now(),'TEST-ONLY',now(),now())`,
      [approverId, `billing-approver-${approverId}@example.invalid`],
    );
    const submitted = await billing.approveRefund(requested.id, approverId, randomUUID());
    expect(submitted.status).toBe('SUBMITTED');
    expect(await paidEntitlements(order.id)).toBe(1);
    gateway.refundState.set(gateway.lastRefundId, {
      ...gateway.refundState.get(gateway.lastRefundId)!,
      status: 'completed',
    });
    expect((await billing.settleRefund(requested.id, randomUUID())).status).toBe('SETTLED');
    expect(await paidEntitlements(order.id)).toBe(0);
    expect(gateway.refundCalls).toBe(1);
  });
  it('serializes same-key concurrent checkout initialization', async () => {
    const key = randomUUID();
    const calls = gateway.checkoutCalls;
    const [first, second] = await Promise.all([
      billing.createOrder(userId, { planVersionId: planId }, key, randomUUID()),
      billing.createOrder(userId, { planVersionId: planId }, key, randomUUID()),
    ]);
    expect(first.id).toBe(second.id);
    expect(first.checkoutUrl).toBe(second.checkoutUrl);
    expect(gateway.checkoutCalls - calls).toBe(1);
  });
  it('freezes a disputed paid entitlement and restores it after independent verified resolution', async () => {
    const order = await create();
    gateway.set(order.merchantRef, 2000);
    await billing.settle(order.merchantRef, randomUUID());
    const attempt = await pool.query<{ id: string }>(
      `SELECT id FROM app."PaymentAttempt" WHERE "orderId"=$1`,
      [order.id],
    );
    const dispute = await billing.dispute(
      attempt.rows[0]!.id,
      `TEST-${randomUUID()}`,
      'Customer reports a chargeback',
      userId,
      randomUUID(),
    );
    expect(await paidEntitlements(order.id)).toBe(0);
    await expect(
      billing.resolveDispute(dispute.id, 'WON', userId, randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
    const reviewer = randomUUID();
    await pool.query(
      `INSERT INTO app."User" (id,email,status,"emailVerifiedAt","termsAcceptedAt","privacyVersion","createdAt","updatedAt")
      VALUES ($1,$2,'ACTIVE',now(),now(),'TEST-ONLY',now(),now())`,
      [reviewer, `billing-reviewer-${reviewer}@example.invalid`],
    );
    expect((await billing.resolveDispute(dispute.id, 'WON', reviewer, randomUUID())).status).toBe(
      'WON',
    );
    expect(await paidEntitlements(order.id)).toBe(1);
  });
  it('reconciles a delayed provider settlement and exposes a bounded audit run', async () => {
    const from = new Date(Date.now() - 2_000);
    const order = await create();
    gateway.set(order.merchantRef, 2000);
    const result = await billing.reconcile(
      from,
      new Date(Date.now() + 2_000),
      userId,
      randomUUID(),
    );
    expect(result.examined).toBeGreaterThan(0);
    expect(await paidEntitlements(order.id)).toBe(1);
    const run = await billing.reconciliationRun(result.id);
    expect(
      run.items.some(
        (item: { providerRef: string; outcome: string }) =>
          item.providerRef === order.merchantRef && item.outcome === 'SUCCESSFUL',
      ),
    ).toBe(true);
    expect(
      (await billing.reconciliationRuns()).some((item: { id: string }) => item.id === result.id),
    ).toBe(true);
  });
  it('expires paid access while retaining payment history', async () => {
    const order = await create();
    gateway.set(order.merchantRef, 2000);
    await billing.settle(order.merchantRef, randomUUID());
    await pool.query(
      `UPDATE app."Subscription" SET "currentPeriodStart"=now()-interval '31 days',
      "currentPeriodEnd"=now()-interval '1 day' WHERE id=$1`,
      [order.subscriptionId],
    );
    await pool.query(
      `UPDATE app."Entitlement" SET "startsAt"=now()-interval '31 days',
      "endsAt"=now()-interval '1 day' WHERE "orderId"=$1`,
      [order.id],
    );
    expect(await paidEntitlements(order.id)).toBe(0);
    await billing.expire(randomUUID());
    const status = await pool.query<{ status: string }>(
      `SELECT status FROM app."Subscription" WHERE id=$1`,
      [order.subscriptionId],
    );
    expect(status.rows[0]?.status).toBe('EXPIRED');
  });
  it('ends cancelled subscriptions at paid-through expiry even with grace enabled', async () => {
    const order = await create();
    gateway.set(order.merchantRef, 2000);
    await billing.settle(order.merchantRef, randomUUID());
    await billing.cancel(userId, order.subscriptionId!, randomUUID());
    await pool.query(
      `UPDATE app."Subscription" SET "currentPeriodStart"=now()-interval '31 days',
      "currentPeriodEnd"=now()-interval '1 day' WHERE id=$1`,
      [order.subscriptionId],
    );
    settings.subscriptions.graceDays = 5;
    try {
      await billing.expire(randomUUID());
      const row = await pool.query<{ status: string }>(
        `SELECT status FROM app."Subscription" WHERE id=$1`,
        [order.subscriptionId],
      );
      expect(row.rows[0]?.status).toBe('CANCELLED');
    } finally {
      settings.subscriptions.graceDays = 0;
    }
  });
});
