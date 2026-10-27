import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlutterwaveV3Gateway, configuredGateway } from '../../apps/api/src/billing/gateway.js';

const gateway = () =>
  new FlutterwaveV3Gateway({
    secretKey: 'FLWSECK_TEST-UNIT-ONLY-NO-CHARGES',
    webhookHash: 'UNIT-ONLY-WEBHOOK-HASH-NEVER-PRODUCTION',
    accountId: '73362',
  });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('Flutterwave v3 sandbox adapter', () => {
  it('rejects live keys and invalid webhook signatures', () => {
    expect(
      () =>
        new FlutterwaveV3Gateway({
          secretKey: 'FLWSECK-LIVE',
          webhookHash: 'test',
          accountId: '73362',
        }),
    ).toThrow();
    expect(gateway().verifyWebhook('forged')).toBe(false);
    expect(gateway().verifyWebhook('UNIT-ONLY-WEBHOOK-HASH-NEVER-PRODUCTION')).toBe(true);
  });
  it('keeps production checkout closed unless a separate live key set is explicitly enabled', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BILLING_LIVE_ENABLED', '0');
    vi.stubEnv('FLUTTERWAVE_TEST_SECRET_KEY', 'FLWSECK_TEST-UNIT-ONLY-NO-CHARGES');
    expect(configuredGateway()).toBeNull();
    expect(
      () =>
        new FlutterwaveV3Gateway({
          secretKey: 'FLWSECK_TEST-UNIT-ONLY-NO-CHARGES',
          webhookHash: 'UNIT-ONLY-WEBHOOK-HASH-NEVER-PRODUCTION',
          accountId: '73362',
          mode: 'live',
        }),
    ).toThrow();
  });
  it('uses hosted UGX card and Uganda mobile money checkout without card data', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        data: { link: 'https://checkout.flutterwave.com/v3/hosted/pay/unit-only' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const link = await gateway().checkout({
      reference: 'ATL-TEST-123',
      amountMinor: 2000,
      currency: 'UGX',
      email: 'test@example.invalid',
      redirectUrl: 'http://localhost:5173/?screen=payment-result',
    });
    expect(link).toContain('checkout.flutterwave.com');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.flutterwave.com/v3/payments');
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1].body as string) as Record<string, unknown>;
    expect(body.payment_options).toBe('card, mobilemoneyuganda');
    expect(body).not.toHaveProperty('card');
    expect(body).not.toHaveProperty('phone_number');
  });
  it('rejects non-provider redirect hosts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'success', data: { link: 'https://evil.example/pay' } }),
      }),
    );
    await expect(
      gateway().checkout({
        reference: 'ATL-TEST-123',
        amountMinor: 2000,
        currency: 'UGX',
        email: 'test@example.invalid',
        redirectUrl: 'http://localhost:5173',
      }),
    ).rejects.toMatchObject({ status: 503 });
  });
  it('verifies provider data by merchant reference and rejects malformed settlement', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        data: {
          id: 9123,
          tx_ref: 'ATL-TEST-123',
          account_id: 73362,
          amount: 2000,
          currency: 'UGX',
          status: 'successful',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await gateway().verify('ATL-TEST-123')).toMatchObject({
      transactionId: '9123',
      status: 'successful',
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain('verify_by_reference?tx_ref=ATL-TEST-123');
  });
});
