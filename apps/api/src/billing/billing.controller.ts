import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { IdentityService, type AuthContext } from '../identity/identity.service.js';
import { BillingService } from './billing.service.js';

const uuid = z.uuid();
const reason = z.string().trim().min(10).max(1000);
const createOrder = z.strictObject({
  planVersionId: uuid,
  renewalSubscriptionId: uuid.optional(),
  upgradeFromId: uuid.optional(),
});
const createPlan = z.strictObject({
  name: z.string().trim().min(3).max(200),
  period: z.enum(['monthly', 'quarterly', 'annual']),
  scopeKind: z.enum(['LIBRARY', 'PUBLICATION', 'VOLUME']),
  scopeId: uuid.optional(),
  amountMinor: z.number().int().positive().max(1_000_000_000),
});
const refund = z.strictObject({
  paymentAttemptId: uuid,
  amountMinor: z.number().int().positive(),
  reason,
});
const dispute = z.strictObject({
  paymentAttemptId: uuid,
  providerCaseId: z.string().min(3).max(160),
  reason,
});
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpException('Invalid billing request', 400);
  return result.data;
}
const wrap = (request: Request, data: unknown) => ({ data, requestId: request.id });
export const invoiceCsvCell = (value: string) => {
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
};

@Controller()
export class BillingController {
  constructor(
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(IdentityService) private readonly identity: IdentityService,
  ) {}

  private async member(request: Request, write = false) {
    const context = await this.identity.context(request.headers.cookie);
    if (write)
      this.identity.checkCsrf(
        context,
        request.headers.origin,
        request.header('X-CSRF-Token'),
        request.headers.cookie,
      );
    return context;
  }
  private async finance(request: Request, permission: string, write = false): Promise<AuthContext> {
    const context = await this.member(request, write);
    if (
      !context.roles.includes('FINANCE') ||
      !context.permissions.includes(permission) ||
      !context.session.mfaVerifiedAt ||
      (write && Date.now() - context.session.mfaVerifiedAt.getTime() > 5 * 60_000)
    )
      throw new HttpException('Finance role and MFA required', 403);
    return context;
  }

  @Get('plans')
  async plans(@Req() request: Request) {
    return wrap(request, await this.billing.plans());
  }

  @Post('orders')
  async order(
    @Req() request: Request,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const context = await this.member(request, true);
    if (!key || !/^[a-zA-Z0-9_-]{16,120}$/.test(key))
      throw new HttpException('Idempotency-Key header required', 400);
    return wrap(
      request,
      await this.billing.createOrder(context.user.id, parse(createOrder, body), key, request.id),
    );
  }
  @Get('orders/:id')
  async orderStatus(@Req() request: Request, @Param('id') id: string) {
    const context = await this.member(request);
    return wrap(request, await this.billing.order(context.user.id, parse(uuid, id)));
  }
  @Post('orders/:id/verify')
  async verify(@Req() request: Request, @Param('id') id: string) {
    const context = await this.member(request, true);
    const order = await this.billing.order(context.user.id, parse(uuid, id));
    if (order.status === 'PAID' || order.status === 'REFUNDED') return wrap(request, order);
    await this.billing.verifyOwnOrder(context.user.id, id, request.id);
    return wrap(request, await this.billing.order(context.user.id, id));
  }
  @Post('orders/:id/retry')
  async retry(
    @Req() request: Request,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const context = await this.member(request, true);
    if (!key || !/^[a-zA-Z0-9_-]{16,120}$/.test(key))
      throw new HttpException('Idempotency-Key header required', 400);
    return wrap(
      request,
      await this.billing.retryOrder(context.user.id, parse(uuid, id), key, request.id),
    );
  }
  @Get('payments/:id/status')
  async paymentStatus(@Req() request: Request, @Param('id') id: string) {
    const context = await this.member(request);
    return wrap(request, await this.billing.paymentStatus(context.user.id, parse(uuid, id)));
  }
  @Post('payments/webhooks/:provider')
  async webhook(
    @Req() request: Request,
    @Param('provider') provider: string,
    @Body() body: unknown,
  ) {
    // V3 uses the dashboard secret in verif-hash. No browser session or CSRF token is accepted here.
    await this.billing.webhook(provider, request.header('verif-hash'), body, request.id);
    return { received: true };
  }
  @Get('me/subscriptions')
  async subscriptions(@Req() request: Request) {
    const context = await this.member(request);
    return wrap(request, await this.billing.subscriptions(context.user.id));
  }
  @Post('me/subscriptions/:id/cancel')
  async cancel(@Req() request: Request, @Param('id') id: string) {
    const context = await this.member(request, true);
    return wrap(request, await this.billing.cancel(context.user.id, parse(uuid, id), request.id));
  }
  @Get('me/invoices')
  async invoices(@Req() request: Request) {
    const context = await this.member(request);
    return wrap(request, await this.billing.invoices(context.user.id));
  }
  @Get('me/billing-notifications')
  async notifications(@Req() request: Request) {
    const context = await this.member(request);
    return wrap(request, await this.billing.notifications(context.user.id));
  }
  @Get('me/invoices/:id')
  async invoice(@Req() request: Request, @Param('id') id: string) {
    const context = await this.member(request);
    return wrap(request, await this.billing.invoice(context.user.id, parse(uuid, id)));
  }
  @Get('me/invoices/:id/statement')
  async statement(@Req() request: Request, @Param('id') id: string, @Res() response: Response) {
    const context = await this.member(request);
    const row = await this.billing.invoice(context.user.id, parse(uuid, id));
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Disposition', `attachment; filename="${row.invoiceNumber}.csv"`);
    response
      .type('text/csv')
      .send(
        'Invoice,Issued UTC,Plan,Currency,Amount minor,Tax note\n' +
          [
            row.invoiceNumber,
            new Date(row.issuedAt).toISOString(),
            invoiceCsvCell(row.planName),
            row.currencyCode,
            row.totalMinor,
            invoiceCsvCell(row.tax),
          ].join(',') +
          '\n',
      );
  }
  @Get('admin/plans')
  async adminPlans(@Req() request: Request) {
    await this.finance(request, 'BILLING_READ');
    return wrap(request, await this.billing.plans());
  }
  @Post('admin/plans')
  async adminCreatePlan(@Req() request: Request, @Body() body: unknown) {
    const context = await this.finance(request, 'BILLING_PLAN_MANAGE', true);
    return wrap(
      request,
      await this.billing.createPlan(parse(createPlan, body), context.user.id, request.id),
    );
  }
  @Get('admin/finance/report')
  async financeReport(@Req() request: Request) {
    const context = await this.finance(request, 'BILLING_READ');
    return wrap(request, await this.billing.finance('BILLING_READ', context.roles));
  }
  @Get(['admin/orders', 'admin/payments', 'admin/refunds', 'admin/disputes', 'admin/invoices'])
  async records(@Req() request: Request, @Query('limit') limit?: string) {
    await this.finance(request, 'BILLING_READ');
    const parsedKind = parse(
      z.enum(['orders', 'payments', 'refunds', 'disputes', 'invoices']),
      request.path.split('/').at(-1),
    );
    const parsedLimit = parse(z.coerce.number().int().min(1).max(100).default(50), limit);
    return wrap(request, await this.billing.records(parsedKind, parsedLimit));
  }
  @Get('admin/reconciliation-runs')
  async reconciliationRuns(@Req() request: Request, @Query('limit') limit?: string) {
    await this.finance(request, 'BILLING_READ');
    return wrap(
      request,
      await this.billing.reconciliationRuns(
        parse(z.coerce.number().int().min(1).max(100).default(50), limit),
      ),
    );
  }
  @Get('admin/reconciliation-runs/:id')
  async reconciliationRun(@Req() request: Request, @Param('id') id: string) {
    await this.finance(request, 'BILLING_READ');
    return wrap(request, await this.billing.reconciliationRun(parse(uuid, id)));
  }
  @Post('admin/refunds')
  async requestRefund(
    @Req() request: Request,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const context = await this.finance(request, 'BILLING_REFUND_REQUEST', true);
    if (!key || !/^[a-zA-Z0-9_-]{16,120}$/.test(key))
      throw new HttpException('Idempotency-Key header required', 400);
    const value = parse(refund, body);
    return wrap(
      request,
      await this.billing.requestRefund(
        value.paymentAttemptId,
        value.amountMinor,
        value.reason,
        context.user.id,
        request.id,
        key,
      ),
    );
  }
  @Post('admin/refunds/:id/approve')
  async approveRefund(@Req() request: Request, @Param('id') id: string) {
    const context = await this.finance(request, 'BILLING_REFUND_APPROVE', true);
    return wrap(
      request,
      await this.billing.approveRefund(parse(uuid, id), context.user.id, request.id),
    );
  }
  @Post('admin/disputes')
  async dispute(@Req() request: Request, @Body() body: unknown) {
    const context = await this.finance(request, 'BILLING_REFUND_REQUEST', true);
    const value = parse(dispute, body);
    return wrap(
      request,
      await this.billing.dispute(
        value.paymentAttemptId,
        value.providerCaseId,
        value.reason,
        context.user.id,
        request.id,
      ),
    );
  }
  @Post('admin/disputes/:id/resolve')
  async resolveDispute(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const context = await this.finance(request, 'BILLING_REFUND_APPROVE', true);
    const value = parse(z.strictObject({ decision: z.enum(['WON', 'LOST']) }), body);
    return wrap(
      request,
      await this.billing.resolveDispute(
        parse(uuid, id),
        value.decision,
        context.user.id,
        request.id,
      ),
    );
  }
  @Post('admin/payments/reconcile')
  async reconcile(@Req() request: Request, @Body() body: unknown) {
    const context = await this.finance(request, 'BILLING_RECONCILE', true);
    const value = parse(
      z.strictObject({
        from: z.iso.datetime({ offset: true }),
        to: z.iso.datetime({ offset: true }),
      }),
      body,
    );
    if (
      new Date(value.to) <= new Date(value.from) ||
      new Date(value.to).getTime() - new Date(value.from).getTime() > 365 * 86_400_000
    )
      throw new HttpException('Invalid reconciliation window', 400);
    return wrap(
      request,
      await this.billing.reconcile(
        new Date(value.from),
        new Date(value.to),
        context.user.id,
        request.id,
      ),
    );
  }
}
