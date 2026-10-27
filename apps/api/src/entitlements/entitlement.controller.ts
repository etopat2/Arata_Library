import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { IdentityService, type AuthContext } from '../identity/identity.service.js';
import { EntitlementService } from './entitlement.service.js';

const uuid = z.uuid();
const reason = z.string().trim().min(10).max(1000);
const scope = z.enum(['LIBRARY', 'COLLECTION', 'PUBLICATION', 'VOLUME', 'EDITION']);
const target = z.strictObject({ scope, scopeId: uuid.optional() });
const requestGrant = target
  .extend({
    userId: uuid,
    reason,
    startsAt: z.iso.datetime().optional(),
    durationDays: z.number().int().min(1).max(3650).optional(),
    endsAt: z.iso.datetime().optional(),
    permanent: z.boolean().optional(),
    source: z.enum(['COMPLIMENTARY', 'INSTITUTION', 'SPONSORED']).optional(),
    membershipId: uuid.optional(),
    cohortId: uuid.optional(),
  })
  .refine(
    (value) =>
      [value.durationDays !== undefined, !!value.endsAt, value.permanent === true].filter(Boolean)
        .length === 1,
    'Choose one duration, end date or permanent grant',
  );
const campaign = target.extend({
  kind: z.enum(['BULK', 'PROMOTION']),
  name: z.string().trim().min(3).max(160),
  reason,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  maxClaims: z.number().int().min(1).max(1000),
  userIds: z.array(uuid).max(1000).optional(),
});
const statusReason = z.strictObject({ reason });
const extension = z.strictObject({ durationDays: z.number().int().min(1).max(3650), reason });
const redemption = z.strictObject({
  code: z
    .string()
    .min(40)
    .max(80)
    .regex(/^[a-zA-Z0-9_-]+$/),
});
const agreement = z.strictObject({
  institutionId: uuid,
  reason,
  scope: z.enum(['LIBRARY', 'PUBLICATION', 'VOLUME']),
  scopeId: uuid.optional(),
  memberLimit: z.number().int().min(1).max(100000),
  permittedCategories: z
    .array(
      z.enum([
        'STUDENT',
        'ACADEMIC_STAFF',
        'ORGANIZATION_MEMBER',
        'SCHOLARSHIP',
        'SPONSORED_COHORT',
      ]),
    )
    .min(1),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
});
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpException('Invalid access request', 400);
  return result.data;
};
const wrap = (request: Request, data: unknown) => ({ data, requestId: request.id });

@Controller()
export class EntitlementController {
  constructor(
    @Inject(EntitlementService) private readonly entitlements: EntitlementService,
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
  private async admin(request: Request, permission: string, write = false): Promise<AuthContext> {
    const context = await this.member(request, write);
    if (
      !context.roles.includes('SYSTEM_ADMIN') ||
      !context.permissions.includes(permission) ||
      !context.session.mfaVerifiedAt ||
      (write && Date.now() - context.session.mfaVerifiedAt.getTime() > 5 * 60_000)
    )
      throw new HttpException('Administrator permission and recent MFA required', 403);
    if (write)
      await this.identity.throttle(
        `entitlement-admin-${permission.toLowerCase()}`,
        context.user.id,
        context.user.email,
      );
    return context;
  }

  @Get('me/entitlements')
  async mine(@Req() request: Request) {
    const context = await this.member(request);
    return wrap(request, await this.entitlements.mine(context.user.id));
  }
  @Post('me/trials')
  async trial(@Req() request: Request) {
    const context = await this.member(request, true);
    await this.identity.throttle('trial', request.ip ?? 'unknown', context.user.email);
    return wrap(request, await this.entitlements.startTrial(context.user.id, request.id));
  }
  @Post('me/promotion-redemptions')
  async redeem(@Req() request: Request, @Body() body: unknown) {
    const context = await this.member(request, true);
    await this.identity.throttle('promotion', request.ip ?? 'unknown', context.user.email);
    return wrap(
      request,
      await this.entitlements.redeem(context.user.id, parse(redemption, body).code, request.id),
    );
  }
  @Get('admin/entitlement-users')
  async users(@Req() request: Request, @Query('q') search?: string) {
    await this.admin(request, 'ENTITLEMENT_READ');
    return wrap(
      request,
      await this.entitlements.users(parse(z.string().trim().min(3).max(120), search)),
    );
  }
  @Get('admin/entitlements')
  async list(
    @Req() request: Request,
    @Query('userId') userId?: string,
    @Query('limit') limit?: string,
  ) {
    await this.admin(request, 'ENTITLEMENT_READ');
    return wrap(
      request,
      await this.entitlements.adminList(
        userId ? parse(uuid, userId) : undefined,
        parse(z.coerce.number().int().min(1).max(200).default(100), limit),
      ),
    );
  }
  @Get('admin/entitlements/upcoming')
  async upcoming(@Req() request: Request, @Query('days') days?: string) {
    await this.admin(request, 'ENTITLEMENT_READ');
    return wrap(
      request,
      await this.entitlements.expirations(
        parse(z.coerce.number().int().min(1).max(90).default(7), days),
      ),
    );
  }
  @Get('admin/entitlements/:id/history')
  async history(@Req() request: Request, @Param('id') id: string) {
    await this.admin(request, 'ENTITLEMENT_READ');
    return wrap(request, await this.entitlements.history(parse(uuid, id)));
  }
  @Post('admin/entitlements')
  async request(@Req() request: Request, @Body() body: unknown) {
    const context = await this.admin(request, 'ENTITLEMENT_GRANT', true);
    const input = parse(requestGrant, body);
    if (
      input.source &&
      input.source !== 'COMPLIMENTARY' &&
      !context.permissions.includes('ENTITLEMENT_INSTITUTION')
    )
      throw new HttpException('Institution permission required', 403);
    return wrap(
      request,
      await this.entitlements.requestGrant(
        {
          ...input,
          startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
          endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
        },
        context.user.id,
        request.id,
      ),
    );
  }
  @Post('admin/entitlements/:id/approve')
  async approve(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const context = await this.admin(request, 'ENTITLEMENT_APPROVE', true);
    return wrap(
      request,
      await this.entitlements.approve(
        parse(uuid, id),
        context.user.id,
        request.id,
        parse(statusReason, body).reason,
      ),
    );
  }
  @Post('admin/entitlements/:id/extend')
  async extend(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const context = await this.admin(request, 'ENTITLEMENT_GRANT', true);
    const input = parse(extension, body);
    return wrap(
      request,
      await this.entitlements.extend(
        parse(uuid, id),
        input.durationDays,
        context.user.id,
        request.id,
        input.reason,
      ),
    );
  }
  @Post('admin/entitlements/:id/suspend')
  async suspend(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    return this.change(request, id, body, 'SUSPEND');
  }
  @Post('admin/entitlements/:id/resume')
  async resume(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    return this.change(request, id, body, 'RESUME');
  }
  @Post('admin/entitlements/:id/revoke')
  async revoke(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    return this.change(request, id, body, 'REVOKE');
  }
  private async change(
    request: Request,
    id: string,
    body: unknown,
    action: 'SUSPEND' | 'RESUME' | 'REVOKE',
  ) {
    const context = await this.admin(request, 'ENTITLEMENT_REVOKE', true);
    return wrap(
      request,
      await this.entitlements.changeStatus(
        parse(uuid, id),
        action,
        context.user.id,
        request.id,
        parse(statusReason, body).reason,
      ),
    );
  }
  @Get('admin/grant-campaigns')
  async campaigns(@Req() request: Request) {
    await this.admin(request, 'ENTITLEMENT_READ');
    return wrap(request, await this.entitlements.campaigns());
  }
  @Post('admin/grant-campaigns')
  async createCampaign(@Req() request: Request, @Body() body: unknown) {
    const context = await this.admin(request, 'ENTITLEMENT_GRANT', true);
    const input = parse(campaign, body);
    return wrap(
      request,
      await this.entitlements.createCampaign(
        {
          ...input,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
        },
        context.user.id,
        request.id,
      ),
    );
  }
  @Post('admin/grant-campaigns/:id/approve')
  async approveCampaign(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const context = await this.admin(request, 'ENTITLEMENT_APPROVE', true);
    return wrap(
      request,
      await this.entitlements.approveCampaign(
        parse(uuid, id),
        context.user.id,
        request.id,
        parse(statusReason, body).reason,
      ),
    );
  }
  @Post('admin/entitlements/maintenance')
  async maintenance(@Req() request: Request) {
    await this.admin(request, 'ENTITLEMENT_APPROVE', true);
    return wrap(request, await this.entitlements.sweep());
  }
  @Get('admin/institution-agreements')
  async agreements(@Req() request: Request, @Query('institutionId') institutionId?: string) {
    await this.admin(request, 'ENTITLEMENT_READ');
    return wrap(
      request,
      await this.entitlements.agreements(institutionId ? parse(uuid, institutionId) : undefined),
    );
  }
  @Post('admin/institution-agreements')
  async requestAgreement(@Req() request: Request, @Body() body: unknown) {
    const context = await this.admin(request, 'ENTITLEMENT_INSTITUTION', true);
    const input = parse(agreement, body);
    return wrap(
      request,
      await this.entitlements.requestAgreement(
        {
          ...input,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
        },
        context.user.id,
        request.id,
        input.reason,
      ),
    );
  }
  @Post('admin/institution-agreements/:id/approve')
  async approveAgreement(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const context = await this.admin(request, 'ENTITLEMENT_APPROVE', true);
    return wrap(
      request,
      await this.entitlements.approveAgreement(
        parse(uuid, id),
        context.user.id,
        request.id,
        parse(statusReason, body).reason,
      ),
    );
  }
}
