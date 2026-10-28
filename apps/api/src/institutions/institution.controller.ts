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
import { InstitutionService } from './institution.service.js';
import { benefitCategories, verificationModes } from './rules.js';

const uuid = z.uuid();
const reason = z.string().trim().min(10).max(1000);
const registration = z.strictObject({
  legalName: z.string().trim().min(3).max(400),
  kind: z.enum(['EDUCATIONAL', 'ORGANIZATION']),
  registrationRef: z.string().trim().min(3).max(160),
  evidenceRef: z.string().trim().min(8).max(500),
});
const decision = z.strictObject({ reason });
const domain = z.strictObject({ domain: z.string().trim().min(4).max(253) });
const proof = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{40,60}$/) });
const policy = z.strictObject({
  category: z.enum(benefitCategories),
  scope: z.enum(['LIBRARY', 'PUBLICATION', 'VOLUME']),
  scopeId: uuid.optional(),
  verificationMode: z.enum(verificationModes),
  validityDays: z.number().int().min(1).max(3650),
});
const enrollment = z.strictObject({
  institutionId: uuid,
  category: z.enum(benefitCategories),
  evidenceRef: z.string().trim().min(8).max(160).optional(),
});
const review = z.strictObject({
  decision: z.enum(['APPROVED', 'REJECTED', 'SUSPENDED']),
  reason,
  evidenceRef: z.string().trim().min(8).max(160).optional(),
});
const roster = z.strictObject({
  csv: z.string().min(1).max(1_000_000),
  apply: z.boolean().default(false),
});
const cohort = z.strictObject({ name: z.string().trim().min(3).max(200) });
const cohortMember = z.strictObject({ userId: uuid, join: z.boolean() });
const sso = z.strictObject({
  issuerUrl: z.url().max(500),
  clientId: z.string().trim().min(3).max(300),
});
const manager = z.strictObject({ userId: uuid });
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpException('Invalid institutional request', 400);
  return result.data;
};
const wrap = (request: Request, data: unknown) => ({ data, requestId: request.id });

@Controller()
export class InstitutionController {
  constructor(
    @Inject(InstitutionService) private readonly institutions: InstitutionService,
    @Inject(IdentityService) private readonly identity: IdentityService,
  ) {}
  private async member(request: Request, write = false): Promise<AuthContext> {
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
  private async central(request: Request, permission: string, write = false) {
    const context = await this.member(request, write);
    this.identity.requireAdmin(context, permission, write);
    if (write)
      await this.identity.throttle(
        `institution-${permission.toLowerCase()}`,
        context.user.id,
        context.user.email,
      );
    return context;
  }
  private async scoped(request: Request, institutionId: string, permission: string, write = false) {
    const id = parse(uuid, institutionId),
      context = await this.member(request, write);
    const central =
      context.roles.includes('SYSTEM_ADMIN') && context.permissions.includes(permission);
    const manager = await this.institutions.manager(context.user.id, id, permission);
    if (!central && !manager) throw new HttpException('Institution access denied', 403);
    if (
      !context.session.mfaVerifiedAt ||
      (write && Date.now() - context.session.mfaVerifiedAt.getTime() > 5 * 60_000)
    )
      throw new HttpException('Recent MFA required', 403);
    if (write)
      await this.identity.throttle(
        `institution-${permission.toLowerCase()}`,
        context.user.id,
        context.user.email,
      );
    return { context, id };
  }
  @Get('institutional/memberships')
  async mine(@Req() request: Request) {
    const context = await this.member(request);
    return wrap(request, await this.institutions.myMemberships(context.user.id));
  }
  @Get('institutional/eligible-institutions')
  async eligible(@Req() request: Request) {
    const context = await this.member(request);
    return wrap(request, await this.institutions.eligibleInstitutions(context.user.id));
  }
  @Post('institutional/memberships')
  async enroll(@Req() request: Request, @Body() body: unknown) {
    const context = await this.member(request, true),
      input = parse(enrollment, body);
    await this.identity.throttle('institution-enroll', context.user.id, context.user.email);
    return wrap(
      request,
      await this.institutions.requestMembership(
        input.institutionId,
        context.user.id,
        input.category,
        input.evidenceRef,
        request.id,
      ),
    );
  }
  @Post('institutional/memberships/:id/opt-out')
  async optOut(@Req() request: Request, @Param('id') id: string) {
    const context = await this.member(request, true);
    return wrap(
      request,
      await this.institutions.optOut(parse(uuid, id), context.user.id, request.id),
    );
  }
  @Get('admin/institutions')
  async list(@Req() request: Request) {
    await this.central(request, 'INSTITUTION_READ');
    return wrap(request, await this.institutions.institutions());
  }
  @Post('admin/institutions')
  async create(@Req() request: Request, @Body() body: unknown) {
    const context = await this.central(request, 'INSTITUTION_APPROVE', true);
    return wrap(
      request,
      await this.institutions.createInstitution(
        parse(registration, body),
        context.user.id,
        request.id,
      ),
    );
  }
  @Post('admin/institutions/:id/approve')
  async approve(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const context = await this.central(request, 'INSTITUTION_APPROVE', true);
    return wrap(
      request,
      await this.institutions.decideInstitution(
        parse(uuid, id),
        'APPROVED',
        context.user.id,
        request.id,
        parse(decision, body).reason,
      ),
    );
  }
  @Post('admin/institutions/:id/reject')
  async reject(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const context = await this.central(request, 'INSTITUTION_APPROVE', true);
    return wrap(
      request,
      await this.institutions.decideInstitution(
        parse(uuid, id),
        'REJECTED',
        context.user.id,
        request.id,
        parse(decision, body).reason,
      ),
    );
  }
  @Post('admin/institutions/:id/suspend')
  async suspend(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const context = await this.central(request, 'INSTITUTION_APPROVE', true);
    return wrap(
      request,
      await this.institutions.decideInstitution(
        parse(uuid, id),
        'SUSPENDED',
        context.user.id,
        request.id,
        parse(decision, body).reason,
      ),
    );
  }
  @Post('admin/institutions/:id/managers')
  async assignManager(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const context = await this.central(request, 'INSTITUTION_APPROVE', true);
    return wrap(
      request,
      await this.institutions.assignManager(
        parse(uuid, id),
        parse(manager, body).userId,
        context.user.id,
        request.id,
      ),
    );
  }
  @Post('admin/institutions/:id/managers/:userId/revoke')
  async revokeManager(
    @Req() request: Request,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ) {
    const context = await this.central(request, 'INSTITUTION_APPROVE', true);
    return wrap(
      request,
      await this.institutions.revokeManager(
        parse(uuid, id),
        parse(uuid, userId),
        context.user.id,
        request.id,
        parse(decision, body).reason,
      ),
    );
  }
  @Get('admin/institutions/:id/dashboard')
  async dashboard(@Req() request: Request, @Param('id') id: string) {
    const access = await this.scoped(request, id, 'INSTITUTION_READ');
    return wrap(request, await this.institutions.dashboard(access.id));
  }
  @Get('admin/institutions/:id/domains')
  async domains(@Req() request: Request, @Param('id') id: string) {
    const access = await this.scoped(request, id, 'INSTITUTION_READ');
    return wrap(request, await this.institutions.domains(access.id));
  }
  @Post('admin/institutions/:id/domains')
  async requestDomain(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const access = await this.scoped(request, id, 'INSTITUTION_ROSTER', true);
    return wrap(
      request,
      await this.institutions.requestDomain(
        access.id,
        parse(domain, body).domain,
        access.context.user.id,
        request.id,
      ),
    );
  }
  @Post('admin/institutions/:id/domains/:domainId/challenge')
  async challenge(
    @Req() request: Request,
    @Param('id') id: string,
    @Param('domainId') domainId: string,
  ) {
    const access = await this.scoped(request, id, 'INSTITUTION_ROSTER', true);
    return wrap(
      request,
      await this.institutions.renewDomainChallenge(
        access.id,
        parse(uuid, domainId),
        access.context.user.id,
        request.id,
      ),
    );
  }
  @Post('admin/institutions/:id/domains/:domainId/verify')
  async verify(
    @Req() request: Request,
    @Param('id') id: string,
    @Param('domainId') domainId: string,
    @Body() body: unknown,
  ) {
    const access = await this.scoped(request, id, 'INSTITUTION_ROSTER', true);
    return wrap(
      request,
      await this.institutions.verifyDomain(
        access.id,
        parse(uuid, domainId),
        parse(proof, body).token,
        access.context.user.id,
        request.id,
      ),
    );
  }
  @Post('admin/institutions/:id/domains/:domainId/approve')
  async approveDomain(
    @Req() request: Request,
    @Param('id') id: string,
    @Param('domainId') domainId: string,
    @Body() body: unknown,
  ) {
    const context = await this.central(request, 'INSTITUTION_APPROVE', true);
    return wrap(
      request,
      await this.institutions.approveDomain(
        parse(uuid, id),
        parse(uuid, domainId),
        context.user.id,
        request.id,
        parse(decision, body).reason,
      ),
    );
  }
  @Post('admin/institutions/:id/domains/:domainId/suspend')
  async suspendDomain(
    @Req() request: Request,
    @Param('id') id: string,
    @Param('domainId') domainId: string,
    @Body() body: unknown,
  ) {
    const context = await this.central(request, 'INSTITUTION_APPROVE', true);
    return wrap(
      request,
      await this.institutions.suspendDomain(
        parse(uuid, id),
        parse(uuid, domainId),
        context.user.id,
        request.id,
        parse(decision, body).reason,
      ),
    );
  }
  @Get('admin/institutions/:id/eligibility-policies')
  async policies(@Req() request: Request, @Param('id') id: string) {
    const access = await this.scoped(request, id, 'INSTITUTION_READ');
    return wrap(request, await this.institutions.policies(access.id));
  }
  @Post('admin/institutions/:id/eligibility-policies')
  async requestPolicy(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const access = await this.scoped(request, id, 'INSTITUTION_ROSTER', true);
    return wrap(
      request,
      await this.institutions.requestPolicy(
        access.id,
        parse(policy, body),
        access.context.user.id,
        request.id,
      ),
    );
  }
  @Post('admin/institutions/:id/eligibility-policies/:policyId/approve')
  async approvePolicy(
    @Req() request: Request,
    @Param('id') id: string,
    @Param('policyId') policyId: string,
    @Body() body: unknown,
  ) {
    const context = await this.central(request, 'INSTITUTION_APPROVE', true);
    return wrap(
      request,
      await this.institutions.approvePolicy(
        parse(uuid, id),
        parse(uuid, policyId),
        context.user.id,
        request.id,
        parse(decision, body).reason,
      ),
    );
  }
  @Post('admin/institutions/:id/eligibility-policies/:policyId/suspend')
  async suspendPolicy(
    @Req() request: Request,
    @Param('id') id: string,
    @Param('policyId') policyId: string,
    @Body() body: unknown,
  ) {
    const context = await this.central(request, 'INSTITUTION_APPROVE', true);
    return wrap(
      request,
      await this.institutions.suspendPolicy(
        parse(uuid, id),
        parse(uuid, policyId),
        context.user.id,
        request.id,
        parse(decision, body).reason,
      ),
    );
  }
  @Get('admin/institutions/:id/memberships')
  async memberships(
    @Req() request: Request,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    const access = await this.scoped(request, id, 'INSTITUTION_READ');
    return wrap(
      request,
      await this.institutions.memberships(
        access.id,
        parse(z.coerce.number().int().min(1).max(200).default(100), limit),
      ),
    );
  }
  @Post('admin/institutions/:id/memberships/:membershipId/review')
  async review(
    @Req() request: Request,
    @Param('id') id: string,
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
  ) {
    const access = await this.scoped(request, id, 'INSTITUTION_ROSTER', true),
      input = parse(review, body);
    return wrap(
      request,
      await this.institutions.reviewMembership(
        access.id,
        parse(uuid, membershipId),
        input.decision,
        access.context.user.id,
        request.id,
        input.reason,
        input.evidenceRef,
      ),
    );
  }
  @Post('admin/institutions/:id/roster-imports')
  async roster(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const access = await this.scoped(request, id, 'INSTITUTION_ROSTER', true),
      input = parse(roster, body);
    return wrap(
      request,
      await this.institutions.roster(
        access.id,
        input.csv,
        access.context.user.id,
        request.id,
        input.apply,
      ),
    );
  }
  @Get('admin/institutions/:id/cohorts')
  async cohorts(@Req() request: Request, @Param('id') id: string) {
    const access = await this.scoped(request, id, 'INSTITUTION_READ');
    return wrap(request, await this.institutions.cohorts(access.id));
  }
  @Post('admin/institutions/:id/cohorts')
  async createCohort(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const access = await this.scoped(request, id, 'INSTITUTION_COHORT', true);
    return wrap(
      request,
      await this.institutions.createCohort(
        access.id,
        parse(cohort, body).name,
        access.context.user.id,
        request.id,
      ),
    );
  }
  @Post('admin/institutions/:id/cohorts/:cohortId/members')
  async cohortMember(
    @Req() request: Request,
    @Param('id') id: string,
    @Param('cohortId') cohortId: string,
    @Body() body: unknown,
  ) {
    const access = await this.scoped(request, id, 'INSTITUTION_COHORT', true),
      input = parse(cohortMember, body);
    return wrap(
      request,
      await this.institutions.cohortMember(
        access.id,
        parse(uuid, cohortId),
        input.userId,
        input.join,
        access.context.user.id,
        request.id,
      ),
    );
  }
  @Post('admin/institutions/:id/cohorts/:cohortId/suspend')
  async suspendCohort(
    @Req() request: Request,
    @Param('id') id: string,
    @Param('cohortId') cohortId: string,
    @Body() body: unknown,
  ) {
    const access = await this.scoped(request, id, 'INSTITUTION_COHORT', true);
    return wrap(
      request,
      await this.institutions.suspendCohort(
        access.id,
        parse(uuid, cohortId),
        access.context.user.id,
        request.id,
        parse(decision, body).reason,
      ),
    );
  }
  @Get('admin/institutions/:id/sso-providers')
  async ssoProviders(@Req() request: Request, @Param('id') id: string) {
    const access = await this.scoped(request, id, 'INSTITUTION_READ');
    return wrap(request, await this.institutions.ssoProviders(access.id));
  }
  @Post('admin/institutions/:id/sso-providers')
  async requestSso(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const access = await this.scoped(request, id, 'INSTITUTION_ROSTER', true),
      input = parse(sso, body);
    return wrap(
      request,
      await this.institutions.requestSso(
        access.id,
        input.issuerUrl,
        input.clientId,
        access.context.user.id,
        request.id,
      ),
    );
  }
  @Post('admin/institutions/:id/sso-providers/:providerId/approve')
  async approveSso(
    @Req() request: Request,
    @Param('id') id: string,
    @Param('providerId') providerId: string,
    @Body() body: unknown,
  ) {
    const context = await this.central(request, 'INSTITUTION_SSO', true);
    return wrap(
      request,
      await this.institutions.approveSso(
        parse(uuid, id),
        parse(uuid, providerId),
        context.user.id,
        request.id,
        parse(decision, body).reason,
      ),
    );
  }
}
