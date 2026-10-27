import { createHash, randomUUID } from 'node:crypto';
import {
  HttpException,
  Inject,
  Injectable,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { IdentityMailer } from '../identity/identity.service.js';
import { PlatformPolicyService } from '../platform-policy/platform-policy.service.js';
import type { BillingGateway, GatewaySettlement } from './gateway.js';

type PlanRow = {
  id: string;
  code: string;
  name: string;
  version: number;
  planVersionId: string;
  currencyCode: string;
  amountMinor: string;
  periodMonths: number | null;
  scopeKind: string;
  scopeId: string | null;
  scopeTitle: string;
};
type OrderRow = {
  id: string;
  userId: string;
  planVersionId: string;
  subscriptionId: string | null;
  upgradeFromId: string | null;
  merchantRef: string;
  status: string;
  currencyCode: string;
  totalMinor: string;
  email: string;
  paymentAttemptId: string;
  paymentStatus: string;
  checkoutUrl: string | null;
  providerTransactionId: string | null;
  scopeKind: string;
  scopeId: string | null;
  periodMonths: number | null;
};
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const periodName = (months: number | null): 'monthly' | 'quarterly' | 'annual' | null =>
  months === 1 ? 'monthly' : months === 3 ? 'quarterly' : months === 12 ? 'annual' : null;
const addMonths = (start: Date, months: number): Date => {
  const next = new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth() + months,
      1,
      start.getUTCHours(),
      start.getUTCMinutes(),
      start.getUTCSeconds(),
      start.getUTCMilliseconds(),
    ),
  );
  const maxDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(start.getUTCDate(), maxDay));
  return next;
};

@Injectable()
export class BillingService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(
    @Inject('DB_POOL') private readonly pool: Pool,
    @Inject(PlatformPolicyService) private readonly policy: PlatformPolicyService,
    @Inject('BILLING_GATEWAY') private readonly gateway: BillingGateway | null,
    @Optional() @Inject(IdentityMailer) private readonly mailer?: IdentityMailer,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.BILLING_JOBS_ENABLED === '0') return;
    this.timer = setInterval(
      () =>
        void this.runScheduled().catch((error) =>
          console.error(
            JSON.stringify({
              event: 'billing.scheduled_error',
              errorName: error instanceof Error ? error.name : 'UnknownError',
            }),
          ),
        ),
      15 * 60_000,
    );
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private async runScheduled() {
    const client = await this.pool.connect();
    try {
      const lock = await client.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_lock(hashtext('arata-billing-jobs')) AS locked`,
      );
      if (!lock.rows[0]?.locked) return;
      try {
        await this.expire(randomUUID());
        await this.queueReminders();
        await this.deliverNotifications();
        if (this.gateway) {
          const to = new Date();
          const from = new Date(to.getTime() - 365 * 86_400_000);
          await this.reconcile(from, to, null, randomUUID());
        }
      } finally {
        await client.query(`SELECT pg_advisory_unlock(hashtext('arata-billing-jobs'))`);
      }
    } finally {
      client.release();
    }
  }

  private provider(): BillingGateway {
    if (!this.gateway) throw new HttpException('Sandbox payment provider is not configured', 503);
    return this.gateway;
  }
  private async tx<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  private async audit(
    client: PoolClient,
    actorId: string | null,
    action: string,
    objectType: string,
    objectId: string,
    correlationId: string,
    reason?: string,
  ) {
    await client.query(
      `INSERT INTO app."AuditEvent" (id,"actorId",action,"objectType","objectId","correlationId",reason)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), actorId, action, objectType, objectId, correlationId, reason ?? null],
    );
  }
  private async notify(
    client: PoolClient,
    userId: string,
    kind: string,
    objectId: string,
    uniqueKey = objectId,
  ) {
    const inserted = await client.query(
      `INSERT INTO app."OutboxEvent" (id,"aggregateType","aggregateId","eventType","idempotencyKey",payload)
      VALUES ($1,'Billing',$2,$3,$4,$5) ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING id`,
      [
        randomUUID(),
        objectId,
        `billing.${kind.toLowerCase()}`,
        `${uniqueKey}:${kind}`,
        JSON.stringify({ userId }),
      ],
    );
    if (inserted.rowCount)
      await client.query(
        `INSERT INTO app."Notification" (id,"userId",kind,"templateCode") VALUES ($1,$2,$3,$4)`,
        [randomUUID(), userId, kind, `billing.${kind.toLowerCase()}`],
      );
  }

  async notifications(userId: string) {
    return (
      await this.pool.query(
        `SELECT id,kind,status,"createdAt","sentAt" FROM app."Notification"
      WHERE "userId"=$1 AND kind LIKE 'PAYMENT_%' OR "userId"=$1 AND kind LIKE 'SUBSCRIPTION_%'
      OR "userId"=$1 AND kind LIKE 'RENEWAL_%' OR "userId"=$1 AND kind='REFUND_SETTLED'
      ORDER BY "createdAt" DESC LIMIT 100`,
        [userId],
      )
    ).rows;
  }
  async queueReminders() {
    const days = (await this.policy.current()).settings.subscriptions.reminderDaysBeforeExpiry;
    return this.tx(async (client) => {
      for (const day of days) {
        const due = await client.query<{ id: string; userId: string; currentPeriodEnd: Date }>(
          `SELECT id,"userId","currentPeriodEnd"
          FROM app."Subscription" WHERE status='ACTIVE' AND NOT "cancelAtPeriodEnd"
          AND "currentPeriodEnd">=now()+($1::int * interval '1 day')
          AND "currentPeriodEnd"<now()+(($1::int+1) * interval '1 day') LIMIT 200`,
          [day],
        );
        for (const row of due.rows)
          await this.notify(
            client,
            row.userId,
            `RENEWAL_REMINDER_${day}D`,
            row.id,
            `${row.id}:${row.currentPeriodEnd.toISOString()}`,
          );
      }
    });
  }
  async deliverNotifications() {
    if (!this.mailer) return 0;
    const pending = await this.pool.query<{
      id: string;
      userId: string;
      kind: string;
      email: string;
      emailEnabled: boolean;
    }>(
      `SELECT n.id,n."userId",n.kind,u.email,COALESCE(p.email,true) AS "emailEnabled"
       FROM app."Notification" n JOIN app."User" u ON u.id=n."userId"
       LEFT JOIN app."NotificationPreference" p ON p."userId"=u.id
       WHERE n.status='QUEUED' AND n.kind ~ '^(PAYMENT_|RENEWAL_|REFUND_|SUBSCRIPTION_)'
       ORDER BY n."createdAt" LIMIT 50`,
    );
    let delivered = 0;
    for (const item of pending.rows) {
      const required = [
        'PAYMENT_CONFIRMED',
        'PAYMENT_FAILED',
        'PAYMENT_REVERSED',
        'REFUND_SETTLED',
        'SUBSCRIPTION_EXPIRED',
      ].includes(item.kind);
      if (!required && !item.emailEnabled) {
        await this.pool.query(
          `UPDATE app."Notification" SET status='SENT',"sentAt"=now() WHERE id=$1 AND status='QUEUED'`,
          [item.id],
        );
        continue;
      }
      try {
        await this.mailer.send({
          to: item.email,
          subject: `Arata TechLibrary: ${item.kind.replaceAll('_', ' ').toLowerCase()}`,
          text: `Your billing update is ${item.kind.replaceAll('_', ' ').toLowerCase()}. Sign in to your Arata TechLibrary account to review the details. Never share a payment PIN or password by email.`,
        });
        await this.pool.query(
          `UPDATE app."Notification" SET status='SENT',"sentAt"=now() WHERE id=$1 AND status='QUEUED'`,
          [item.id],
        );
        delivered++;
      } catch {
        /* Keep queued for the next run; do not claim delivery. */
      }
    }
    return delivered;
  }

  async plans() {
    const current = await this.policy.current();
    const result = await this.pool
      .query<PlanRow>(`SELECT DISTINCT ON (p.id) p.id,p.code,p.name,v.version,v.id AS "planVersionId",
      v."currencyCode",v."amountMinor",v."periodMonths",v."scopeKind",v."scopeId",
      CASE WHEN v."scopeKind"='PUBLICATION' THEN (SELECT title FROM app."Publication" WHERE id=v."scopeId")
        WHEN v."scopeKind"='VOLUME' THEN (SELECT p.title || ' — ' || vol.title FROM app."Volume" vol
          JOIN app."Publication" p ON p.id=vol."publicationId" WHERE vol.id=v."scopeId")
        ELSE 'Entire library' END AS "scopeTitle"
      FROM app."Plan" p JOIN app."PlanVersion" v ON v."planId"=p.id
      WHERE p.active AND v."validFrom"<=now() AND (v."validUntil" IS NULL OR v."validUntil">now())
      ORDER BY p.id,v.version DESC`);
    return {
      free: {
        name: 'Free access',
        priceMinor: 0,
        currency: current.settings.subscriptions.currency,
        description:
          'Public-free resources require no account or subscription. Registered-free resources require sign in.',
      },
      paid: result.rows
        .filter((row) => {
          const period = periodName(row.periodMonths);
          return (
            period &&
            current.settings.subscriptions.plans[period].enabled &&
            row.currencyCode === current.settings.subscriptions.currency
          );
        })
        .map((row) => ({
          ...row,
          amountMinor: Number(row.amountMinor),
          automaticRenewal: false,
          cancellation: 'Access continues to paid-through expiry; renewal is manual.',
          refundWindowDays: current.settings.subscriptions.refundWindowDays,
          trialDays: current.settings.subscriptions.trialEnabled
            ? current.settings.subscriptions.trialDays
            : 0,
        })),
      policyVersion: current.version,
    };
  }

  async createPlan(
    input: {
      name: string;
      period: 'monthly' | 'quarterly' | 'annual';
      scopeKind: 'LIBRARY' | 'PUBLICATION' | 'VOLUME';
      scopeId?: string | undefined;
      amountMinor: number;
    },
    actorId: string,
    requestId: string,
  ) {
    const current = await this.policy.current();
    const setting = current.settings.subscriptions.plans[input.period];
    if (current.status !== 'ACTIVE' || !setting.enabled || setting.priceMinor === null)
      throw new HttpException('Approved paid plan policy is required', 409);
    if (current.settings.subscriptions.currency !== 'UGX')
      throw new HttpException('Configured gateway only supports UGX', 409);
    if (input.scopeKind === 'LIBRARY' ? !!input.scopeId : !input.scopeId)
      throw new HttpException('Invalid plan scope', 400);
    if (input.scopeKind === 'LIBRARY' && input.amountMinor !== setting.priceMinor)
      throw new HttpException('Library price must match active policy', 409);
    const code = `${input.period.toUpperCase()}:${input.scopeKind}:${input.scopeId ?? 'ALL'}`;
    return this.tx(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`plan:${code}`]);
      if (input.scopeId) {
        const exists = await client.query(
          input.scopeKind === 'VOLUME'
            ? `SELECT 1 FROM app."Volume" v JOIN app."Publication" p ON p.id=v."publicationId"
             WHERE v.id=$1 AND p.status='PUBLISHED'`
            : `SELECT 1 FROM app."Publication" WHERE id=$1 AND status='PUBLISHED'`,
          [input.scopeId],
        );
        if (!exists.rowCount) throw new HttpException('Plan scope not found', 404);
      }
      const plan = await client.query<{ id: string }>(
        `INSERT INTO app."Plan" (id,code,name,active) VALUES ($1,$2,$3,true)
        ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name,active=true RETURNING id`,
        [randomUUID(), code, input.name],
      );
      const planId = plan.rows[0]!.id;
      const termsHash = digest({ input, policyVersion: current.version });
      const latest = await client.query<{ id: string; version: number; termsHash: string }>(
        `SELECT id,version,"termsHash" FROM app."PlanVersion"
        WHERE "planId"=$1 ORDER BY version DESC LIMIT 1`,
        [planId],
      );
      if (latest.rows[0]?.termsHash === termsHash)
        return { id: latest.rows[0].id, code, version: latest.rows[0].version };
      const number = await client.query<{ version: number }>(
        `SELECT COALESCE(max(version),0)+1 AS version FROM app."PlanVersion" WHERE "planId"=$1`,
        [planId],
      );
      const version = number.rows[0]!.version;
      const id = randomUUID();
      await client.query(
        `INSERT INTO app."PlanVersion" (id,"planId",version,"currencyCode","amountMinor","periodMonths","scopeKind","scopeId","termsHash","validFrom")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
        [
          id,
          planId,
          version,
          current.settings.subscriptions.currency,
          input.amountMinor,
          setting.months,
          input.scopeKind,
          input.scopeId ?? null,
          termsHash,
        ],
      );
      await this.audit(
        client,
        actorId,
        'billing.plan_version_created',
        'PlanVersion',
        id,
        requestId,
      );
      return { id, code, version };
    });
  }

  private orderSql = `SELECT o.*,u.email,a.id AS "paymentAttemptId",a.status AS "paymentStatus",a."checkoutUrl",a."providerTransactionId",
    v."scopeKind",v."scopeId",v."periodMonths" FROM app."Order" o
    JOIN app."User" u ON u.id=o."userId" JOIN app."PaymentAttempt" a ON a."orderId"=o.id
    JOIN app."PlanVersion" v ON v.id=o."planVersionId"`;
  private safeOrder(row: OrderRow) {
    return {
      id: row.id,
      status: row.status,
      paymentStatus: row.paymentStatus,
      planVersionId: row.planVersionId,
      amountMinor: Number(row.totalMinor),
      currency: row.currencyCode,
      checkoutUrl: row.checkoutUrl,
      subscriptionId: row.subscriptionId,
    };
  }
  async order(userId: string, id: string) {
    const found = await this.pool.query<OrderRow>(
      `${this.orderSql} WHERE o.id=$1 AND o."userId"=$2`,
      [id, userId],
    );
    if (!found.rows[0]) throw new HttpException('Order not found', 404);
    return this.safeOrder(found.rows[0]);
  }
  async verifyOwnOrder(userId: string, id: string, requestId: string) {
    const found = await this.pool.query<{ merchantRef: string }>(
      `SELECT "merchantRef" FROM app."Order" WHERE id=$1 AND "userId"=$2`,
      [id, userId],
    );
    if (!found.rows[0]) throw new HttpException('Order not found', 404);
    return this.settle(found.rows[0].merchantRef, requestId);
  }
  async paymentStatus(userId: string, id: string) {
    const found = await this.pool.query(
      `SELECT a.id,a.status,a."verifiedAt",a."createdAt",o.id AS "orderId",o.status AS "orderStatus"
      FROM app."PaymentAttempt" a JOIN app."Order" o ON o.id=a."orderId" WHERE a.id=$1 AND o."userId"=$2`,
      [id, userId],
    );
    if (!found.rows[0]) throw new HttpException('Payment not found', 404);
    return found.rows[0];
  }
  async retryOrder(userId: string, id: string, key: string, requestId: string) {
    const prior = await this.pool.query<OrderRow>(
      `${this.orderSql} WHERE o.id=$1 AND o."userId"=$2`,
      [id, userId],
    );
    const row = prior.rows[0];
    if (!row) throw new HttpException('Order not found', 404);
    if (!['FAILED', 'CANCELLED'].includes(row.status))
      throw new HttpException('Order is not retryable', 409);
    const previousSub = await this.pool.query<{ status: string; currentPeriodEnd: Date | null }>(
      `SELECT status,"currentPeriodEnd" FROM app."Subscription" WHERE id=$1`,
      [row.subscriptionId],
    );
    return this.createOrder(
      userId,
      {
        planVersionId: row.planVersionId,
        ...(previousSub.rows[0]?.status === 'ACTIVE' || previousSub.rows[0]?.status === 'PAST_DUE'
          ? { renewalSubscriptionId: row.subscriptionId! }
          : {}),
        ...(row.upgradeFromId ? { upgradeFromId: row.upgradeFromId } : {}),
      },
      key,
      requestId,
    );
  }
  async createOrder(
    userId: string,
    input: {
      planVersionId: string;
      renewalSubscriptionId?: string | undefined;
      upgradeFromId?: string | undefined;
    },
    key: string,
    requestId: string,
  ) {
    const provider = this.provider();
    const current = await this.policy.current();
    const plans = await this.plans();
    const plan = plans.paid.find((item) => item.planVersionId === input.planVersionId);
    if (!plan || current.status !== 'ACTIVE' || plan.currencyCode !== 'UGX')
      throw new HttpException('Plan unavailable', 409);
    const scopedKey = digest({ userId, key });
    const result = await this.tx(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`order:${scopedKey}`]);
      const prior = await client.query<OrderRow>(`${this.orderSql} WHERE o."idempotencyKey"=$1`, [
        scopedKey,
      ]);
      if (prior.rows[0]) {
        if (
          prior.rows[0].userId !== userId ||
          prior.rows[0].planVersionId !== input.planVersionId ||
          prior.rows[0].upgradeFromId !== (input.upgradeFromId ?? null) ||
          (input.renewalSubscriptionId &&
            prior.rows[0].subscriptionId !== input.renewalSubscriptionId)
        )
          throw new HttpException('Idempotency key has different request', 409);
        return { row: prior.rows[0], created: false };
      }
      const recent = await client.query<{ count: string }>(
        `SELECT count(*) FROM app."Order" WHERE "userId"=$1
        AND "createdAt">now()-interval '1 hour'`,
        [userId],
      );
      if (Number(recent.rows[0]?.count ?? 0) >= 20)
        throw new HttpException('Checkout rate limit reached', 429);
      if (input.renewalSubscriptionId && input.upgradeFromId)
        throw new HttpException('Renewal and upgrade cannot be combined', 400);
      let subscriptionId = input.renewalSubscriptionId;
      if (subscriptionId) {
        const existing = await client.query(
          `SELECT 1 FROM app."Subscription" WHERE id=$1 AND "userId"=$2 AND "planVersionId"=$3 AND status IN ('ACTIVE','PAST_DUE')`,
          [subscriptionId, userId, input.planVersionId],
        );
        if (!existing.rowCount) throw new HttpException('Subscription cannot be renewed', 409);
      } else {
        if (input.upgradeFromId) {
          const previous = await client.query(
            `SELECT 1 FROM app."Subscription" WHERE id=$1 AND "userId"=$2 AND status='ACTIVE'`,
            [input.upgradeFromId, userId],
          );
          if (!previous.rowCount) throw new HttpException('Upgrade source unavailable', 409);
        }
        subscriptionId = randomUUID();
        await client.query(
          `INSERT INTO app."Subscription" (id,"userId","planVersionId") VALUES ($1,$2,$3)`,
          [subscriptionId, userId, input.planVersionId],
        );
      }
      const id = randomUUID();
      const merchantRef = `${provider.referencePrefix}-${id}`;
      await client.query(
        `INSERT INTO app."Order" (id,"userId","planVersionId","subscriptionId","upgradeFromId","merchantRef","idempotencyKey","currencyCode","totalMinor")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          id,
          userId,
          input.planVersionId,
          subscriptionId,
          input.upgradeFromId ?? null,
          merchantRef,
          scopedKey,
          plan.currencyCode,
          plan.amountMinor,
        ],
      );
      const attemptId = randomUUID();
      await client.query(
        `INSERT INTO app."PaymentAttempt" (id,"orderId",provider,"providerRef","idempotencyKey","amountMinor","currencyCode")
        VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          attemptId,
          id,
          provider.code,
          merchantRef,
          `checkout:${id}`,
          plan.amountMinor,
          plan.currencyCode,
        ],
      );
      await this.audit(client, userId, 'billing.order_created', 'Order', id, requestId);
      const row = await client.query<OrderRow>(`${this.orderSql} WHERE o.id=$1`, [id]);
      return { row: row.rows[0]!, created: true };
    });
    if (result.row.checkoutUrl) return this.safeOrder(result.row);
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [`checkout:${result.row.id}`]);
      const existing = await client.query<{ checkoutUrl: string | null }>(
        `SELECT "checkoutUrl" FROM app."PaymentAttempt" WHERE id=$1`,
        [result.row.paymentAttemptId],
      );
      if (!existing.rows[0]?.checkoutUrl) {
        const redirectUrl = `${process.env.WEB_ORIGIN ?? 'http://localhost:5173'}/?screen=payment-result&order=${result.row.id}`;
        const checkoutUrl = await provider.checkout({
          reference: result.row.merchantRef,
          amountMinor: Number(result.row.totalMinor),
          currency: result.row.currencyCode,
          email: result.row.email,
          redirectUrl,
        });
        await client.query(
          `UPDATE app."PaymentAttempt" SET "checkoutUrl"=$2,status='PENDING' WHERE id=$1
            AND "checkoutUrl" IS NULL AND status IN ('INITIATED','PENDING')`,
          [result.row.paymentAttemptId, checkoutUrl],
        );
      }
    } finally {
      await client
        .query('SELECT pg_advisory_unlock(hashtext($1))', [`checkout:${result.row.id}`])
        .catch(() => undefined);
      client.release();
    }
    return this.order(userId, result.row.id);
  }

  async settle(reference: string, correlationId: string, webhookEventId?: string) {
    const provider = this.provider();
    const verified = await provider.verify(reference);
    const order = await this.pool.query<OrderRow>(`${this.orderSql} WHERE o."merchantRef"=$1`, [
      reference,
    ]);
    if (!order.rows[0]) throw new HttpException('Order not found', 404);
    const expected = order.rows[0];
    if (!verified) return { status: 'PENDING', orderId: expected.id };
    const matching = this.matches(expected, verified, provider);
    return this.tx(async (client) => {
      const locked = await client.query<OrderRow>(
        `${this.orderSql} WHERE o.id=$1 FOR UPDATE OF o,a`,
        [expected.id],
      );
      const row = locked.rows[0]!;
      if (!matching) {
        await this.audit(
          client,
          null,
          'billing.settlement_mismatch',
          'Order',
          row.id,
          correlationId,
        );
        return { status: 'REVIEW', orderId: row.id };
      }
      const eventId =
        webhookEventId ?? `verify:${reference}:${verified.transactionId}:${verified.status}`;
      const event = await client.query<{ id: string }>(
        `INSERT INTO app."GatewayEvent"
        (id,provider,"providerEventId","paymentAttemptId","payloadHash","signatureValid","serverVerifiedAt")
        VALUES ($1,$2,$3,$4,$5,$6,now()) ON CONFLICT (provider,"providerEventId") DO NOTHING RETURNING id`,
        [
          randomUUID(),
          provider.code,
          eventId,
          row.paymentAttemptId,
          digest(verified),
          !!webhookEventId,
        ],
      );
      await client.query(
        `UPDATE app."PaymentAttempt" SET "providerTransactionId"=$2 WHERE id=$1 AND "providerTransactionId" IS NULL`,
        [row.paymentAttemptId, verified.transactionId],
      );
      if (verified.status === 'successful' && row.status !== 'PAID' && row.status !== 'REFUNDED') {
        await client.query(
          `UPDATE app."PaymentAttempt" SET status='VERIFIED',"verifiedAt"=now() WHERE id=$1`,
          [row.paymentAttemptId],
        );
        await client.query(`UPDATE app."Order" SET status='PAID',"paidAt"=now() WHERE id=$1`, [
          row.id,
        ]);
        const subscription = await client.query<{ currentPeriodEnd: Date | null }>(
          `SELECT "currentPeriodEnd" FROM app."Subscription" WHERE id=$1 FOR UPDATE`,
          [row.subscriptionId],
        );
        const previousEnd = subscription.rows[0]?.currentPeriodEnd;
        const start = previousEnd && previousEnd > new Date() ? previousEnd : new Date();
        const end = addMonths(start, row.periodMonths!);
        await client.query(
          `UPDATE app."Subscription" SET status='ACTIVE',"currentPeriodStart"=COALESCE("currentPeriodStart",$2),
          "currentPeriodEnd"=$3 WHERE id=$1`,
          [row.subscriptionId, start, end],
        );
        if (row.upgradeFromId)
          await client.query(`UPDATE app."Subscription" SET "cancelAtPeriodEnd"=true WHERE id=$1`, [
            row.upgradeFromId,
          ]);
        const entitlementId = randomUUID();
        await client.query(
          `INSERT INTO app."Entitlement" (id,"userId",source,status,scope,"publicationId","volumeId","orderId","subscriptionId","startsAt","endsAt")
          VALUES ($1,$2,'PAID','ACTIVE',$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
          [
            entitlementId,
            row.userId,
            row.scopeKind,
            row.scopeKind === 'PUBLICATION' ? row.scopeId : null,
            row.scopeKind === 'VOLUME' ? row.scopeId : null,
            row.id,
            row.subscriptionId,
            start,
            end,
          ],
        );
        await client.query(
          `INSERT INTO app."Invoice" (id,"orderId","invoiceNumber","currencyCode","totalMinor")
          VALUES ($1,$2,$3,$4,$5) ON CONFLICT ("orderId") DO NOTHING`,
          [
            randomUUID(),
            row.id,
            `ATL-${new Date().getUTCFullYear()}-${row.id.slice(0, 12).toUpperCase()}`,
            row.currencyCode,
            row.totalMinor,
          ],
        );
        await this.notify(client, row.userId, 'PAYMENT_CONFIRMED', row.id);
        await this.audit(client, null, 'billing.payment_verified', 'Order', row.id, correlationId);
      } else if (verified.status === 'failed' && row.status === 'PENDING') {
        await client.query(`UPDATE app."PaymentAttempt" SET status='FAILED' WHERE id=$1`, [
          row.paymentAttemptId,
        ]);
        await client.query(`UPDATE app."Order" SET status='FAILED' WHERE id=$1`, [row.id]);
        await this.notify(client, row.userId, 'PAYMENT_FAILED', row.id);
        await this.audit(client, null, 'billing.payment_failed', 'Order', row.id, correlationId);
      } else if (verified.status === 'reversed' && row.status === 'PAID') {
        await this.revokeOrder(client, row.id, 'PAYMENT_REVERSED');
        await client.query(`UPDATE app."PaymentAttempt" SET status='REVERSED' WHERE id=$1`, [
          row.paymentAttemptId,
        ]);
        await this.notify(client, row.userId, 'PAYMENT_REVERSED', row.id);
        await this.audit(client, null, 'billing.payment_reversed', 'Order', row.id, correlationId);
      } else if (verified.status === 'pending') {
        await client.query(
          `UPDATE app."PaymentAttempt" SET status='PENDING' WHERE id=$1 AND status='INITIATED'`,
          [row.paymentAttemptId],
        );
      }
      if (event.rows[0])
        await client.query(
          `UPDATE app."GatewayEvent" SET "processedAt"=now() WHERE id=$1 AND "processedAt" IS NULL`,
          [event.rows[0].id],
        );
      return { status: verified.status.toUpperCase(), orderId: row.id };
    });
  }
  private matches(row: OrderRow, verified: GatewaySettlement, provider: BillingGateway) {
    return (
      verified.reference === row.merchantRef &&
      provider.ownsMerchant(verified.accountId) &&
      verified.amountMinor === Number(row.totalMinor) &&
      verified.currency === row.currencyCode &&
      /^\d+$/.test(verified.transactionId) &&
      (!row.providerTransactionId || row.providerTransactionId === verified.transactionId)
    );
  }
  private async revokeOrder(client: PoolClient, orderId: string, reason: string) {
    await client.query(`UPDATE app."Order" SET status='REFUNDED' WHERE id=$1`, [orderId]);
    const entitlements = await client.query<{ id: string }>(
      `UPDATE app."Entitlement" SET status='REVOKED',"revokedAt"=now(),reason=$2
      WHERE "orderId"=$1 AND status='ACTIVE' RETURNING id`,
      [orderId, reason],
    );
    for (const entitlement of entitlements.rows)
      await client.query(
        `INSERT INTO app."EntitlementEvent" (id,"entitlementId",action,reason) VALUES ($1,$2,'REVOKED',$3)`,
        [randomUUID(), entitlement.id, reason],
      );
    await client.query(
      `UPDATE app."Subscription" s SET status='EXPIRED'
      FROM app."Order" o WHERE o.id=$1 AND s.id=o."subscriptionId"
      AND s.status IN ('ACTIVE','PAST_DUE') AND NOT EXISTS (
        SELECT 1 FROM app."Entitlement" e JOIN app."Order" paid ON paid.id=e."orderId"
        WHERE e."subscriptionId"=s.id AND e.status='ACTIVE' AND e."startsAt"<=now()
          AND e."endsAt">now() AND paid.status='PAID')`,
      [orderId],
    );
  }

  async webhook(
    providerCode: string,
    signature: string | undefined,
    payload: unknown,
    requestId: string,
  ) {
    const provider = this.provider();
    if (providerCode !== provider.code.toLowerCase() || !provider.verifyWebhook(signature))
      throw new HttpException('Invalid payment webhook', 401);
    const data =
      payload && typeof payload === 'object' && 'data' in payload
        ? (payload as { data: unknown }).data
        : null;
    const reference =
      data && typeof data === 'object' && 'tx_ref' in data
        ? (data as { tx_ref: unknown }).tx_ref
        : null;
    if (
      typeof reference !== 'string' ||
      !/^ATL-(TEST|LIVE)-[0-9a-f-]{36}$/.test(reference) ||
      !reference.startsWith(`${provider.referencePrefix}-`)
    )
      throw new HttpException('Unknown payment reference', 400);
    const eventId = digest(payload);
    return this.settle(reference, requestId, eventId);
  }

  async subscriptions(userId: string) {
    const rows = await this.pool.query(
      `SELECT s.id,s.status,s."currentPeriodStart",s."currentPeriodEnd",s."cancelAtPeriodEnd",
      p.name,v."scopeKind",v."scopeId",v."periodMonths" FROM app."Subscription" s
      JOIN app."PlanVersion" v ON v.id=s."planVersionId" JOIN app."Plan" p ON p.id=v."planId"
      WHERE s."userId"=$1 ORDER BY s."createdAt" DESC`,
      [userId],
    );
    return rows.rows;
  }
  async cancel(userId: string, id: string, requestId: string) {
    return this.tx(async (client) => {
      const row = await client.query<{ currentPeriodEnd: Date | null }>(
        `UPDATE app."Subscription" SET "cancelAtPeriodEnd"=true
        WHERE id=$1 AND "userId"=$2 AND status IN ('ACTIVE','PAST_DUE') RETURNING "currentPeriodEnd"`,
        [id, userId],
      );
      if (!row.rows[0]) throw new HttpException('Subscription not found', 404);
      await this.audit(
        client,
        userId,
        'billing.subscription_cancelled',
        'Subscription',
        id,
        requestId,
      );
      return { id, cancelAtPeriodEnd: true, paidThrough: row.rows[0].currentPeriodEnd };
    });
  }
  async invoices(userId: string) {
    const rows = await this.pool.query(
      `SELECT i.id,i."invoiceNumber",i."currencyCode",i."totalMinor",i."issuedAt",o.id AS "orderId"
      FROM app."Invoice" i JOIN app."Order" o ON o.id=i."orderId" WHERE o."userId"=$1 ORDER BY i."issuedAt" DESC`,
      [userId],
    );
    return rows.rows.map((row) => ({ ...row, totalMinor: Number(row.totalMinor) }));
  }
  async invoice(userId: string, id: string) {
    const rows = await this.pool.query(
      `SELECT i.id,i."invoiceNumber",i."currencyCode",i."totalMinor",i."issuedAt",
      o.id AS "orderId",o."paidAt",p.name AS "planName",v."periodMonths",v."scopeKind",v."scopeId"
      FROM app."Invoice" i JOIN app."Order" o ON o.id=i."orderId" JOIN app."PlanVersion" v ON v.id=o."planVersionId"
      JOIN app."Plan" p ON p.id=v."planId" WHERE i.id=$1 AND o."userId"=$2`,
      [id, userId],
    );
    if (!rows.rows[0]) throw new HttpException('Invoice not found', 404);
    return {
      ...rows.rows[0],
      totalMinor: Number(rows.rows[0].totalMinor),
      tax: 'Tax treatment pending legal and finance review',
    };
  }

  async finance(permission: string, userRoles: string[]) {
    if (!userRoles.includes('FINANCE') || permission !== 'BILLING_READ')
      throw new HttpException('Finance role required', 403);
    const rows = await this.pool.query(`SELECT
      (SELECT count(*)::int FROM app."Invoice") AS "paidOrders",
      (SELECT COALESCE(sum("totalMinor"),0)::text FROM app."Invoice") AS "grossMinor",
      (SELECT COALESCE(sum(r."amountMinor"),0)::text FROM app."Refund" r WHERE r.status='SETTLED') AS "settledRefundMinor",
      (SELECT count(*)::int FROM app."Order" WHERE status='PENDING') AS "pendingOrders",
      (SELECT count(*)::int FROM app."PaymentDispute" WHERE status='OPEN') AS "openDisputes"`);
    const row = rows.rows[0];
    return {
      ...row,
      grossMinor: String(row.grossMinor),
      settledRefundMinor: String(row.settledRefundMinor),
      currency: (await this.policy.current()).settings.subscriptions.currency,
    };
  }
  async records(kind: 'orders' | 'payments' | 'refunds' | 'disputes' | 'invoices', limit = 50) {
    const sql = {
      orders: `SELECT id,"userId","merchantRef","currencyCode","totalMinor",status,"createdAt","paidAt" FROM app."Order" ORDER BY "createdAt" DESC LIMIT $1`,
      payments: `SELECT id,"orderId",provider,"providerRef",status,"verifiedAt","createdAt" FROM app."PaymentAttempt" ORDER BY "createdAt" DESC LIMIT $1`,
      refunds: `SELECT id,"paymentAttemptId","amountMinor",status,reason,"requestedById","approvedById","requestedAt","approvedAt","settledAt" FROM app."Refund" ORDER BY "requestedAt" DESC LIMIT $1`,
      disputes: `SELECT id,"paymentAttemptId",status,reason,"openedAt","resolvedAt" FROM app."PaymentDispute" ORDER BY "openedAt" DESC LIMIT $1`,
      invoices: `SELECT i.id,i."invoiceNumber",i."orderId",i."currencyCode",i."totalMinor",i."issuedAt",o."userId",o.status
        FROM app."Invoice" i JOIN app."Order" o ON o.id=i."orderId" ORDER BY i."issuedAt" DESC LIMIT $1`,
    }[kind];
    return (await this.pool.query(sql, [limit])).rows;
  }

  async requestRefund(
    paymentAttemptId: string,
    amountMinor: number,
    reason: string,
    actorId: string,
    requestId: string,
    key: string,
  ) {
    const policy = (await this.policy.current()).settings.subscriptions;
    return this.tx(async (client) => {
      const scopedKey = digest({ actorId, key });
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`refund:${scopedKey}`]);
      const existing = await client.query<{
        id: string;
        paymentAttemptId: string;
        amountMinor: string;
        reason: string;
        status: string;
      }>(
        `SELECT id,"paymentAttemptId","amountMinor",reason,status FROM app."Refund" WHERE "idempotencyKey"=$1`,
        [scopedKey],
      );
      if (existing.rows[0]) {
        if (
          existing.rows[0].paymentAttemptId !== paymentAttemptId ||
          Number(existing.rows[0].amountMinor) !== amountMinor ||
          existing.rows[0].reason !== reason
        )
          throw new HttpException('Idempotency key has different request', 409);
        return { id: existing.rows[0].id, status: existing.rows[0].status };
      }
      const paid = await client.query<{ amountMinor: string; verifiedAt: Date; status: string }>(
        `SELECT "amountMinor","verifiedAt",status FROM app."PaymentAttempt" WHERE id=$1 FOR UPDATE`,
        [paymentAttemptId],
      );
      if (paid.rows[0]?.status !== 'VERIFIED')
        throw new HttpException('Verified payment required', 409);
      if (Date.now() - paid.rows[0].verifiedAt.getTime() > policy.refundWindowDays * 86_400_000)
        throw new HttpException('Refund policy window expired', 409);
      const reserved = await client.query<{ amount: string }>(
        `SELECT COALESCE(sum("amountMinor"),0)::text AS amount FROM app."Refund"
        WHERE "paymentAttemptId"=$1 AND status <> 'REJECTED'`,
        [paymentAttemptId],
      );
      if (amountMinor > Number(paid.rows[0].amountMinor) - Number(reserved.rows[0]?.amount ?? 0))
        throw new HttpException('Refund exceeds available amount', 409);
      const id = randomUUID();
      await client.query(
        `INSERT INTO app."Refund" (id,"paymentAttemptId","idempotencyKey","amountMinor",reason,"requestedById","correlationId")
        VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, paymentAttemptId, scopedKey, amountMinor, reason, actorId, requestId],
      );
      await this.audit(
        client,
        actorId,
        'billing.refund_requested',
        'Refund',
        id,
        requestId,
        reason,
      );
      return { id, status: 'REQUESTED' };
    });
  }
  async approveRefund(id: string, actorId: string, requestId: string) {
    const provider = this.provider();
    const row = await this.tx(async (client) => {
      const locked = await client.query<{
        paymentAttemptId: string;
        amountMinor: string;
        reason: string;
        requestedById: string;
        providerRef: string;
        providerTransactionId: string;
        orderId: string;
        paidAmount: string;
        currencyCode: string;
      }>(
        `SELECT r."paymentAttemptId",r."amountMinor",r.reason,r."requestedById",
        a."providerRef",a."providerTransactionId",a."orderId",a."amountMinor" AS "paidAmount",a."currencyCode"
        FROM app."Refund" r JOIN app."PaymentAttempt" a ON a.id=r."paymentAttemptId"
        WHERE r.id=$1 AND r.status='REQUESTED' FOR UPDATE OF r`,
        [id],
      );
      const found = locked.rows[0];
      if (!found) throw new HttpException('Refund not pending approval', 409);
      if (found.requestedById === actorId)
        throw new HttpException('Independent approval required', 403);
      await client.query(
        `UPDATE app."Refund" SET status='SUBMITTED',"approvedById"=$2,"approvedAt"=now() WHERE id=$1`,
        [id, actorId],
      );
      await this.audit(client, actorId, 'billing.refund_approved', 'Refund', id, requestId);
      return found;
    });
    // Never repeat an uncertain provider submission automatically: v3 lacks an evidenced idempotency header.
    const payment = await provider.verify(row.providerRef);
    if (
      !payment ||
      payment.status !== 'successful' ||
      !provider.ownsMerchant(payment.accountId) ||
      payment.transactionId !== row.providerTransactionId ||
      payment.amountMinor !== Number(row.paidAmount) ||
      payment.currency !== row.currencyCode
    )
      throw new HttpException('Original transaction requires finance review', 409);
    const submitted = await provider.refund(
      payment.transactionId,
      Number(row.amountMinor),
      row.reason,
    );
    await this.pool.query(`UPDATE app."Refund" SET "providerRefundId"=$2 WHERE id=$1`, [
      id,
      submitted.id,
    ]);
    return { id, status: 'SUBMITTED', providerStatus: submitted.status };
  }
  async settleRefund(id: string, requestId: string) {
    const provider = this.provider();
    const row = await this.pool.query<{
      providerRefundId: string;
      amountMinor: string;
      paymentAttemptId: string;
      orderId: string;
      totalMinor: string;
      userId: string;
      providerTransactionId: string;
    }>(
      `SELECT r."providerRefundId",r."amountMinor",r."paymentAttemptId",
      a."orderId",a."providerTransactionId",o."totalMinor",o."userId" FROM app."Refund" r JOIN app."PaymentAttempt" a ON a.id=r."paymentAttemptId"
      JOIN app."Order" o ON o.id=a."orderId" WHERE r.id=$1 AND r.status='SUBMITTED'`,
      [id],
    );
    const found = row.rows[0];
    if (!found?.providerRefundId)
      throw new HttpException('Refund awaits provider confirmation', 409);
    const settlement = await provider.refundStatus(
      found.providerTransactionId,
      found.providerRefundId,
    );
    if (
      !settlement ||
      settlement.amountMinor !== Number(found.amountMinor) ||
      settlement.transactionId !== found.providerTransactionId ||
      !provider.ownsMerchant(settlement.accountId)
    )
      throw new HttpException('Refund settlement mismatch', 409);
    const providerStatus = settlement.status;
    if (!['completed', 'successful'].includes(providerStatus))
      return { id, status: 'SUBMITTED', providerStatus };
    return this.tx(async (client) => {
      const updated = await client.query(
        `UPDATE app."Refund" SET status='SETTLED',"settledAt"=now() WHERE id=$1 AND status='SUBMITTED' RETURNING id`,
        [id],
      );
      if (!updated.rowCount) return { id, status: 'SETTLED', providerStatus };
      const settled = await client.query<{ amount: string }>(
        `SELECT COALESCE(sum("amountMinor"),0)::text AS amount FROM app."Refund"
        WHERE "paymentAttemptId"=$1 AND status='SETTLED'`,
        [found.paymentAttemptId],
      );
      if (Number(settled.rows[0]!.amount) >= Number(found.totalMinor))
        await this.revokeOrder(client, found.orderId, 'FULL_REFUND');
      await this.notify(client, found.userId, 'REFUND_SETTLED', found.orderId);
      await this.audit(client, null, 'billing.refund_settled', 'Refund', id, requestId);
      return { id, status: 'SETTLED', providerStatus };
    });
  }
  async dispute(
    paymentAttemptId: string,
    providerCaseId: string,
    reason: string,
    actorId: string,
    requestId: string,
  ) {
    return this.tx(async (client) => {
      const paid = await client.query(
        `SELECT a.id,a."orderId" FROM app."PaymentAttempt" a WHERE a.id=$1 AND a.status='VERIFIED' FOR UPDATE`,
        [paymentAttemptId],
      );
      if (!paid.rows[0]) throw new HttpException('Verified payment required', 409);
      const id = randomUUID();
      await client.query(
        `INSERT INTO app."PaymentDispute" (id,"paymentAttemptId","providerCaseId",status,reason,"reportedById")
        VALUES ($1,$2,$3,'OPEN',$4,$5)`,
        [id, paymentAttemptId, providerCaseId, reason, actorId],
      );
      if ((await this.policy.current()).settings.subscriptions.disputeFreezesPaymentEntitlement)
        await this.revokeOrder(client, paid.rows[0].orderId, 'DISPUTE_OPEN');
      await this.audit(
        client,
        actorId,
        'billing.dispute_opened',
        'PaymentDispute',
        id,
        requestId,
        reason,
      );
      return { id, status: 'OPEN' };
    });
  }
  async resolveDispute(id: string, decision: 'WON' | 'LOST', actorId: string, requestId: string) {
    const dispute = await this.pool.query<{ orderId: string; reportedById: string | null }>(
      `SELECT a."orderId",d."reportedById" FROM app."PaymentDispute" d
       JOIN app."PaymentAttempt" a ON a.id=d."paymentAttemptId" WHERE d.id=$1 AND d.status='OPEN'`,
      [id],
    );
    if (!dispute.rows[0]) throw new HttpException('Open dispute not found', 404);
    if (dispute.rows[0].reportedById === actorId)
      throw new HttpException('Independent review required', 403);
    const item = await this.pool.query<OrderRow>(`${this.orderSql} WHERE o.id=$1`, [
      dispute.rows[0].orderId,
    ]);
    const settlement =
      decision === 'WON' ? await this.provider().verify(item.rows[0]!.merchantRef) : null;
    if (
      decision === 'WON' &&
      (!settlement ||
        settlement.status !== 'successful' ||
        !this.matches(item.rows[0]!, settlement, this.provider()))
    )
      throw new HttpException('Provider no longer confirms payment', 409);
    return this.tx(async (client) => {
      const updated = await client.query<{ paymentAttemptId: string }>(
        `UPDATE app."PaymentDispute" SET status=$2,"resolvedAt"=now(),"resolvedById"=$3
        WHERE id=$1 AND status='OPEN' RETURNING "paymentAttemptId"`,
        [id, decision, actorId],
      );
      if (!updated.rows[0]) throw new HttpException('Dispute already resolved', 409);
      if (decision === 'WON') {
        const order = await client.query<{ id: string; userId: string }>(
          `SELECT o.id,o."userId" FROM app."Order" o
          JOIN app."PaymentAttempt" a ON a."orderId"=o.id WHERE a.id=$1`,
          [updated.rows[0].paymentAttemptId],
        );
        const row = order.rows[0]!;
        const refunded = await client.query(
          `SELECT 1 FROM app."Refund" WHERE "paymentAttemptId"=$1 AND status='SETTLED'`,
          [updated.rows[0].paymentAttemptId],
        );
        if (refunded.rowCount) throw new HttpException('Settled refund cannot be reinstated', 409);
        await client.query(`UPDATE app."Order" SET status='PAID' WHERE id=$1`, [row.id]);
        await client.query(
          `UPDATE app."Entitlement" SET status='ACTIVE',"revokedAt"=NULL,reason=NULL
          WHERE "orderId"=$1 AND status='REVOKED' AND "endsAt">now()`,
          [row.id],
        );
        await client.query(
          `UPDATE app."Subscription" s SET status='ACTIVE' FROM app."Order" o
          WHERE o.id=$1 AND s.id=o."subscriptionId" AND s."currentPeriodEnd">now()
            AND EXISTS (SELECT 1 FROM app."Entitlement" WHERE "orderId"=o.id AND status='ACTIVE' AND "endsAt">now())`,
          [row.id],
        );
        await this.notify(client, row.userId, 'DISPUTE_RESOLVED', row.id);
      }
      await this.audit(
        client,
        actorId,
        'billing.dispute_resolved',
        'PaymentDispute',
        id,
        requestId,
        decision,
      );
      return { id, status: decision };
    });
  }

  async reconcile(from: Date, to: Date, actorId: string | null, requestId: string) {
    const provider = this.provider();
    const runId = randomUUID();
    await this.pool.query(
      `INSERT INTO app."ReconciliationRun" (id,provider,"periodFrom","periodTo") VALUES ($1,$2,$3,$4)`,
      [runId, provider.code, from, to],
    );
    const items = await this.pool.query<{
      id: string;
      merchantRef: string;
      paymentAttemptId: string;
      status: string;
    }>(
      `SELECT o.id,o."merchantRef",a.id AS "paymentAttemptId",o.status
      FROM app."Order" o JOIN app."PaymentAttempt" a ON a."orderId"=o.id
      LEFT JOIN LATERAL (SELECT max(r."startedAt") AS last FROM app."ReconciliationItem" i
        JOIN app."ReconciliationRun" r ON r.id=i."runId" WHERE i."paymentAttemptId"=a.id) history ON true
      WHERE o."createdAt">=$1 AND o."createdAt"<$2 AND o.status IN ('PENDING','PAID')
      ORDER BY history.last NULLS FIRST,o."createdAt" LIMIT 200`,
      [from, to],
    );
    let exceptions = 0;
    for (const item of items.rows) {
      let outcome = 'PENDING';
      let detail: { code: string } | null = null;
      try {
        outcome = (await this.settle(item.merchantRef, requestId)).status;
        if (outcome === 'REVIEW') {
          exceptions++;
          detail = { code: 'SETTLEMENT_MISMATCH' };
        }
      } catch (error) {
        outcome = 'ERROR';
        exceptions++;
        detail = {
          code:
            error instanceof HttpException ? `HTTP_${error.getStatus()}` : 'GATEWAY_CHECK_ERROR',
        };
      }
      await this.pool.query(
        `INSERT INTO app."ReconciliationItem" (id,"runId","paymentAttemptId","providerRef",outcome,detail)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [
          randomUUID(),
          runId,
          item.paymentAttemptId,
          item.merchantRef,
          outcome,
          detail ? JSON.stringify(detail) : null,
        ],
      );
    }
    const refunds = await this.pool.query<{ id: string; paymentAttemptId: string }>(
      `SELECT r.id,r."paymentAttemptId" FROM app."Refund" r
      JOIN app."PaymentAttempt" a ON a.id=r."paymentAttemptId" JOIN app."Order" o ON o.id=a."orderId"
      LEFT JOIN LATERAL (SELECT max(run."startedAt") AS last FROM app."ReconciliationItem" item
        JOIN app."ReconciliationRun" run ON run.id=item."runId" WHERE item."providerRef"='refund:'||r.id) history ON true
      WHERE r.status='SUBMITTED' AND r."providerRefundId" IS NOT NULL AND o."createdAt">=$1 AND o."createdAt"<$2
      ORDER BY history.last NULLS FIRST,r."approvedAt" LIMIT 200`,
      [from, to],
    );
    for (const refund of refunds.rows) {
      let outcome = 'PENDING';
      let detail: { code: string } | null = null;
      try {
        outcome = (await this.settleRefund(refund.id, requestId)).status;
      } catch (error) {
        outcome = 'ERROR';
        exceptions++;
        detail = {
          code: error instanceof HttpException ? `HTTP_${error.getStatus()}` : 'REFUND_CHECK_ERROR',
        };
      }
      await this.pool.query(
        `INSERT INTO app."ReconciliationItem" (id,"runId","paymentAttemptId","providerRef",outcome,detail)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [
          randomUUID(),
          runId,
          refund.paymentAttemptId,
          `refund:${refund.id}`,
          outcome,
          detail ? JSON.stringify(detail) : null,
        ],
      );
    }
    await this.pool.query(`UPDATE app."ReconciliationRun" SET "endedAt"=now() WHERE id=$1`, [
      runId,
    ]);
    await this.tx((client) =>
      this.audit(client, actorId, 'billing.reconciled', 'ReconciliationRun', runId, requestId),
    );
    return {
      id: runId,
      examined: items.rowCount,
      refundsExamined: refunds.rowCount,
      batchLimited: items.rows.length === 200 || refunds.rows.length === 200,
      exceptions,
    };
  }
  async reconciliationRuns(limit = 50) {
    return (
      await this.pool.query(
        `SELECT r.id,r.provider,r."periodFrom",r."periodTo",r."startedAt",r."endedAt",
      count(i.id)::int AS examined,
      count(i.id) FILTER (WHERE i.outcome IN ('ERROR','REVIEW'))::int AS exceptions
      FROM (SELECT * FROM app."ReconciliationRun" ORDER BY "startedAt" DESC LIMIT $1) r
      LEFT JOIN app."ReconciliationItem" i ON i."runId"=r.id
      GROUP BY r.id,r.provider,r."periodFrom",r."periodTo",r."startedAt",r."endedAt"
      ORDER BY r."startedAt" DESC`,
        [limit],
      )
    ).rows;
  }
  async reconciliationRun(id: string) {
    const run = await this.pool.query(
      `SELECT id,provider,"periodFrom","periodTo","startedAt","endedAt"
      FROM app."ReconciliationRun" WHERE id=$1`,
      [id],
    );
    if (!run.rows[0]) throw new HttpException('Reconciliation run not found', 404);
    const items = await this.pool.query(
      `SELECT id,"paymentAttemptId","providerRef",outcome,detail
      FROM app."ReconciliationItem" WHERE "runId"=$1 ORDER BY outcome DESC,id LIMIT 400`,
      [id],
    );
    return { ...run.rows[0], items: items.rows };
  }
  async expire(requestId: string) {
    const settings = (await this.policy.current()).settings.subscriptions;
    return this.tx(async (client) => {
      if (settings.graceDays > 0) {
        const grace = await client.query<{ id: string; userId: string }>(
          `UPDATE app."Subscription" SET status='PAST_DUE'
          WHERE status='ACTIVE' AND NOT "cancelAtPeriodEnd" AND "currentPeriodEnd"<=now()
          AND "currentPeriodEnd">now()-($1::int * interval '1 day') RETURNING id,"userId"`,
          [settings.graceDays],
        );
        for (const row of grace.rows) {
          await client.query(
            `UPDATE app."Entitlement" SET "endsAt"="endsAt"+($2::int * interval '1 day')
            WHERE "subscriptionId"=$1 AND status='ACTIVE' AND "endsAt"<=now()`,
            [row.id, settings.graceDays],
          );
          await this.notify(client, row.userId, 'PAYMENT_GRACE', row.id);
        }
      }
      const expired = await client.query<{ id: string; userId: string }>(
        `UPDATE app."Subscription" SET status=CASE WHEN "cancelAtPeriodEnd" THEN 'CANCELLED'::app."SubscriptionStatus"
        ELSE 'EXPIRED'::app."SubscriptionStatus" END WHERE status IN ('ACTIVE','PAST_DUE')
        AND "currentPeriodEnd" <= CASE WHEN "cancelAtPeriodEnd" THEN now()
          ELSE now() - ($1::int * interval '1 day') END RETURNING id,"userId"`,
        [settings.graceDays],
      );
      for (const row of expired.rows)
        await this.notify(client, row.userId, 'SUBSCRIPTION_EXPIRED', row.id);
      await this.audit(client, null, 'billing.expiry_job', 'Subscription', randomUUID(), requestId);
      return expired.rowCount;
    });
  }
}
