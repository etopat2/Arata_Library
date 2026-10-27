import { createHash, timingSafeEqual } from 'node:crypto';
import { HttpException } from '@nestjs/common';

export type GatewaySettlement = {
  reference: string;
  transactionId: string;
  accountId: string;
  amountMinor: number;
  currency: string;
  status: 'successful' | 'pending' | 'failed' | 'reversed';
};
export type GatewayRefund = {
  id: string;
  status: string;
  amountMinor: number;
  accountId: string;
  transactionId: string;
};
export interface BillingGateway {
  readonly code: string;
  readonly referencePrefix: 'ATL-TEST' | 'ATL-LIVE';
  checkout(input: {
    reference: string;
    amountMinor: number;
    currency: string;
    email: string;
    redirectUrl: string;
  }): Promise<string>;
  verify(reference: string): Promise<GatewaySettlement | null>;
  ownsMerchant(accountId: string): boolean;
  verifyWebhook(signature: string | undefined): boolean;
  refund(transactionId: string, amountMinor: number, reason: string): Promise<GatewayRefund>;
  refundStatus(transactionId: string, refundId: string): Promise<GatewayRefund | null>;
}

type FlutterwaveConfig = {
  secretKey: string;
  webhookHash: string;
  accountId: string;
  mode?: 'test' | 'live';
};
const apiBase = 'https://api.flutterwave.com/v3';
const checkoutHost = 'checkout.flutterwave.com';

/** V3 adapter. Hosted checkout keeps all card and mobile-money credentials off Arata servers. */
export class FlutterwaveV3Gateway implements BillingGateway {
  readonly code = 'FLUTTERWAVE_V3';
  readonly referencePrefix: 'ATL-TEST' | 'ATL-LIVE';
  constructor(private readonly config: FlutterwaveConfig) {
    const mode = config.mode ?? 'test';
    this.referencePrefix = mode === 'live' ? 'ATL-LIVE' : 'ATL-TEST';
    const expected = mode === 'live' ? /^FLWSECK[-_](?!TEST[-_])/ : /^FLWSECK_TEST[-_]/;
    if (!expected.test(config.secretKey) || !config.webhookHash || !/^\d+$/.test(config.accountId))
      throw new Error(`Flutterwave ${mode} key, webhook hash and merchant account ID are required`);
  }

  private async call(path: string, method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
    const response = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.secretKey}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new HttpException('Payment provider unavailable', 503);
    }
    return response.json();
  }

  async checkout(input: Parameters<BillingGateway['checkout']>[0]): Promise<string> {
    if (
      input.currency !== 'UGX' ||
      !Number.isSafeInteger(input.amountMinor) ||
      input.amountMinor <= 0
    )
      throw new HttpException('Unsupported checkout amount', 400);
    const result = (await this.call('/payments', 'POST', {
      tx_ref: input.reference,
      amount: input.amountMinor,
      currency: input.currency,
      redirect_url: input.redirectUrl,
      payment_options: 'card, mobilemoneyuganda',
      customer: { email: input.email },
      customizations: { title: 'Arata TechLibrary' },
    })) as { status?: string; data?: { link?: string } };
    const link = result?.data?.link;
    if (result?.status !== 'success' || !link) throw new HttpException('Checkout unavailable', 503);
    const parsed = new URL(link);
    if (parsed.protocol !== 'https:' || parsed.hostname !== checkoutHost)
      throw new HttpException('Invalid payment provider redirect', 503);
    return link;
  }

  async verify(reference: string): Promise<GatewaySettlement | null> {
    const result = (await this.call(
      `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
      'GET',
    )) as {
      status?: string;
      data?: Record<string, unknown>;
    } | null;
    if (!result || result.status !== 'success' || !result.data) return null;
    const row = result.data;
    if (
      typeof row.tx_ref !== 'string' ||
      !Number.isSafeInteger(row.id) ||
      !Number.isSafeInteger(row.account_id) ||
      !Number.isSafeInteger(row.amount) ||
      typeof row.currency !== 'string' ||
      typeof row.status !== 'string'
    )
      throw new HttpException('Invalid provider verification response', 503);
    return {
      reference: row.tx_ref,
      transactionId: String(row.id),
      accountId: String(row.account_id),
      amountMinor: row.amount as number,
      currency: row.currency,
      status:
        row.status === 'successful'
          ? 'successful'
          : row.status === 'failed'
            ? 'failed'
            : row.status === 'reversed'
              ? 'reversed'
              : 'pending',
    };
  }

  verifyWebhook(signature: string | undefined): boolean {
    if (!signature || signature.length > 256) return false;
    const expected = createHash('sha256').update(this.config.webhookHash).digest();
    const actual = createHash('sha256').update(signature).digest();
    return timingSafeEqual(actual, expected);
  }

  async refund(transactionId: string, amountMinor: number, reason: string) {
    if (!/^\d+$/.test(transactionId)) throw new HttpException('Invalid provider transaction', 409);
    const result = (await this.call(`/transactions/${transactionId}/refund`, 'POST', {
      amount: amountMinor,
      comments: reason,
    })) as {
      status?: string;
      data?: {
        id?: number;
        status?: string;
        amount_refunded?: number;
        account_id?: number;
        tx_id?: number;
      };
    };
    if (
      result?.status !== 'success' ||
      !Number.isSafeInteger(result.data?.id) ||
      result.data?.amount_refunded !== amountMinor ||
      String(result.data?.tx_id) !== transactionId ||
      !this.ownsMerchant(String(result.data?.account_id))
    )
      throw new HttpException('Refund submission unconfirmed', 503);
    return {
      id: String(result.data!.id),
      status: result.data?.status ?? 'pending',
      amountMinor,
      transactionId,
      accountId: String(result.data?.account_id),
    };
  }

  async refundStatus(transactionId: string, refundId: string): Promise<GatewayRefund | null> {
    if (!/^\d+$/.test(transactionId) || !/^\d+$/.test(refundId))
      throw new HttpException('Invalid refund reference', 409);
    const result = (await this.call(`/refunds/${transactionId}`, 'GET')) as {
      status?: string;
      data?:
        | {
            id?: number;
            status?: string;
            amount_refunded?: number;
            account_id?: number;
            transaction_id?: number;
            tx_id?: number;
          }
        | {
            id?: number;
            status?: string;
            amount_refunded?: number;
            account_id?: number;
            transaction_id?: number;
            tx_id?: number;
          }[];
    } | null;
    const candidates = Array.isArray(result?.data)
      ? result.data
      : result?.data
        ? [result.data]
        : [];
    const row = candidates.find((item) => String(item.id) === refundId);
    if (!row) return null;
    if (
      !Number.isSafeInteger(row.amount_refunded) ||
      !Number.isSafeInteger(row.account_id) ||
      !Number.isSafeInteger(row.transaction_id ?? row.tx_id) ||
      typeof row.status !== 'string'
    )
      throw new HttpException('Invalid provider refund response', 503);
    return {
      id: refundId,
      status: row.status,
      amountMinor: row.amount_refunded!,
      accountId: String(row.account_id),
      transactionId: String(row.transaction_id ?? row.tx_id),
    };
  }

  ownsMerchant(accountId: string): boolean {
    return accountId === this.config.accountId;
  }
}

export function configuredGateway(): BillingGateway | null {
  const live = process.env.NODE_ENV === 'production';
  if (live && process.env.BILLING_LIVE_ENABLED !== '1') return null;
  const secretKey =
    process.env[live ? 'FLUTTERWAVE_LIVE_SECRET_KEY' : 'FLUTTERWAVE_TEST_SECRET_KEY'];
  const webhookHash =
    process.env[live ? 'FLUTTERWAVE_LIVE_WEBHOOK_HASH' : 'FLUTTERWAVE_TEST_WEBHOOK_HASH'];
  const accountId =
    process.env[live ? 'FLUTTERWAVE_LIVE_ACCOUNT_ID' : 'FLUTTERWAVE_TEST_ACCOUNT_ID'];
  if (!secretKey || !webhookHash || !accountId) return null;
  return new FlutterwaveV3Gateway({
    secretKey,
    webhookHash,
    accountId,
    mode: live ? 'live' : 'test',
  });
}
