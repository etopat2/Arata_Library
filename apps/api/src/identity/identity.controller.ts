import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { z } from 'zod';
import type { Request, Response } from 'express';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';
import { IdentityService, type AuthContext } from './identity.service.js';

const email = z.email().max(320);
const password = z.string().min(12).max(1024);
const registerDto = z.strictObject({
  email,
  password,
  termsVersion: z.string().min(1).max(64),
  privacyVersion: z.string().min(1).max(64),
});
const loginDto = z.strictObject({ email, password: z.string().min(1).max(1024) });
const tokenDto = z.strictObject({ token: z.string().min(20).max(512) });
const resetDto = z.strictObject({ token: tokenDto.shape.token, newPassword: password });
const codeDto = z.strictObject({
  challengeId: z.string().min(20).max(512),
  code: z.string().regex(/^\d{6}$/),
});
const profileDto = z.strictObject({
  displayName: z.string().trim().min(1).max(200).nullable().optional(),
  locale: z.string().min(2).max(32).optional(),
  timezone: z.string().min(2).max(80).optional(),
});
const privacyDto = z.strictObject({
  analyticsConsent: z.boolean(),
  researchConsent: z.boolean(),
  personalizationConsent: z.boolean(),
  aiAssistanceConsent: z.boolean(),
  policyVersion: z.string().min(1).max(64),
});
const uuid = z.uuid();

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpException('Invalid request', 400);
  return result.data;
}
const wrap = (request: Request, data: unknown) => ({ data, requestId: request.id });
const acknowledge = (request: Request) =>
  wrap(request, {
    accepted: true,
    message: 'If the request is eligible, instructions will be sent.',
  });
const ipOf = (request: Request) => request.ip ?? request.socket.remoteAddress ?? 'unknown';
const labelOf = (request: Request) =>
  request.header('user-agent')?.slice(0, 160) ?? 'Unknown device';
const sessionView = (session: { id: string; createdAt: Date; expiresAt: Date }) => ({
  id: session.id,
  createdAt: session.createdAt,
  expiresAt: session.expiresAt,
  current: true,
});

@Controller('auth')
export class AuthController {
  constructor(private readonly identity: IdentityService) {}

  @Get('policy-versions')
  policyVersions(@Req() request: Request) {
    return wrap(request, this.identity.policyVersions());
  }

  private async protected(request: Request, mutate = false): Promise<AuthContext> {
    const context = await this.identity.context(request.headers.cookie);
    if (mutate)
      this.identity.checkCsrf(
        context,
        request.header('origin'),
        request.header('x-csrf-token'),
        request.headers.cookie,
      );
    return context;
  }

  @Post('register')
  async register(@Body() body: unknown, @Req() request: Request) {
    const values = parse(registerDto, body);
    await this.identity.register(
      values.email,
      values.password,
      values.termsVersion,
      values.privacyVersion,
      ipOf(request),
      request.id,
    );
    return acknowledge(request);
  }

  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(@Body() body: unknown, @Req() request: Request) {
    const values = parse(tokenDto, body);
    await this.identity.throttle('verify', ipOf(request));
    await this.identity.verifyEmail(values.token, request.id);
    return acknowledge(request);
  }

  @Post('verify-email/resend')
  @HttpCode(200)
  async resendVerification(@Body() body: unknown, @Req() request: Request) {
    const values = parse(z.strictObject({ email }), body);
    await this.identity.resendVerification(values.email, ipOf(request), request.id);
    return acknowledge(request);
  }

  @Post('invitations/accept')
  @HttpCode(200)
  async acceptInvitation(@Body() body: unknown, @Req() request: Request) {
    const values = parse(
      z.strictObject({
        token: tokenDto.shape.token,
        password,
        termsVersion: z.string().min(1).max(64),
        privacyVersion: z.string().min(1).max(64),
      }),
      body,
    );
    await this.identity.throttle('invitation', ipOf(request));
    await this.identity.acceptInvitation(
      values.token,
      values.password,
      values.termsVersion,
      values.privacyVersion,
      request.id,
    );
    return acknowledge(request);
  }

  @Post('login')
  async login(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const values = parse(loginDto, body);
    const created = await this.identity.login(
      values.email,
      values.password,
      ipOf(request),
      labelOf(request),
      request.id,
    );
    response.setHeader('Set-Cookie', this.identity.cookieHeaders(created.raw));
    response.setHeader('Cache-Control', 'no-store');
    return wrap(request, sessionView(created.session));
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const context = await this.protected(request, true);
    await this.identity.revoke(context, context.session.id, request.id);
    response.setHeader('Set-Cookie', this.identity.clearCookieHeaders());
    return acknowledge(request);
  }

  @Post('password/reset-request')
  @HttpCode(200)
  async requestReset(@Body() body: unknown, @Req() request: Request) {
    const values = parse(z.strictObject({ email }), body);
    await this.identity.requestReset(values.email, ipOf(request), request.id);
    return acknowledge(request);
  }

  @Post('password/reset')
  @HttpCode(200)
  async reset(@Body() body: unknown, @Req() request: Request) {
    const values = parse(resetDto, body);
    await this.identity.throttle('reset', ipOf(request));
    await this.identity.resetPassword(values.token, values.newPassword, request.id);
    return acknowledge(request);
  }

  @Get('sessions')
  async sessions(@Req() request: Request) {
    return wrap(request, await this.identity.sessions(await this.protected(request)));
  }

  @Delete('sessions/:id')
  @HttpCode(200)
  async revoke(
    @Param('id') id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    parse(uuid, id);
    const context = await this.protected(request, true);
    await this.identity.revoke(context, id, request.id);
    if (id === context.session.id)
      response.setHeader('Set-Cookie', this.identity.clearCookieHeaders());
    return acknowledge(request);
  }

  @Post('mfa/enroll')
  async enroll(@Body() body: unknown, @Req() request: Request) {
    const values = parse(z.strictObject({ password: z.string().min(1) }), body);
    const context = await this.protected(request, true);
    return wrap(request, await this.identity.enrollTotp(context, values.password, request.id));
  }

  @Post('mfa/confirm')
  async confirm(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const values = parse(z.strictObject({ id: uuid, code: z.string().regex(/^\d{6}$/) }), body);
    const context = await this.protected(request, true);
    const rotated = await this.identity.confirmTotp(context, values.id, values.code, request.id);
    response.setHeader('Set-Cookie', this.identity.cookieHeaders(rotated.raw));
    return wrap(request, sessionView(rotated.session));
  }

  @Post('mfa/challenge')
  async challenge(@Body() body: unknown, @Req() request: Request) {
    parse(z.strictObject({ method: z.literal('totp'), action: z.string().min(1).max(120) }), body);
    const context = await this.protected(request, true);
    return wrap(request, await this.identity.challenge(context, request.id));
  }

  @Post('mfa/verify')
  async verifyMfa(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const values = parse(codeDto, body);
    const context = await this.protected(request, true);
    await this.identity.throttle('mfa', ipOf(request), context.user.email);
    const rotated = await this.identity.verifyMfa(
      context,
      values.challengeId,
      values.code,
      request.id,
    );
    response.setHeader('Set-Cookie', this.identity.cookieHeaders(rotated.raw));
    return wrap(request, sessionView(rotated.session));
  }

  @Post('passkeys/register/options')
  async passkeyRegistrationOptions(@Req() request: Request) {
    return wrap(
      request,
      await this.identity.passkeyRegistrationOptions(await this.protected(request, true)),
    );
  }

  @Post('passkeys/register/verify')
  async passkeyRegister(@Body() body: unknown, @Req() request: Request) {
    const response = parse(
      z.looseObject({
        id: z.string().min(1),
        rawId: z.string().min(1),
        type: z.literal('public-key'),
        clientExtensionResults: z.record(z.string(), z.unknown()),
        response: z.looseObject({
          clientDataJSON: z.string().min(20),
          attestationObject: z.string().min(20),
        }),
      }),
      body,
    );
    return wrap(
      request,
      await this.identity.registerPasskey(
        await this.protected(request, true),
        response as RegistrationResponseJSON,
        request.id,
      ),
    );
  }

  @Post('passkeys/login/options')
  async passkeyLoginOptions(@Body() body: unknown, @Req() request: Request) {
    const values = parse(z.strictObject({ email }), body);
    return wrap(request, await this.identity.passkeyLoginOptions(values.email, ipOf(request)));
  }

  @Post('passkeys/login/verify')
  async passkeyLogin(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const credential = parse(
      z.looseObject({
        id: z.string().min(1),
        rawId: z.string().min(1),
        type: z.literal('public-key'),
        clientExtensionResults: z.record(z.string(), z.unknown()),
        response: z.looseObject({
          clientDataJSON: z.string().min(20),
          authenticatorData: z.string().min(20),
          signature: z.string().min(20),
        }),
      }),
      body,
    );
    const created = await this.identity.loginPasskey(
      credential as AuthenticationResponseJSON,
      ipOf(request),
      labelOf(request),
      request.id,
    );
    response.setHeader('Set-Cookie', this.identity.cookieHeaders(created.raw));
    return wrap(request, sessionView(created.session));
  }
}

@Controller('me')
export class AccountController {
  constructor(private readonly identity: IdentityService) {}
  private async protected(request: Request, mutate = false) {
    const context = await this.identity.context(request.headers.cookie);
    if (mutate)
      this.identity.checkCsrf(
        context,
        request.header('origin'),
        request.header('x-csrf-token'),
        request.headers.cookie,
      );
    return context;
  }

  @Get('profile')
  async profile(@Req() request: Request) {
    return wrap(request, await this.identity.profile(await this.protected(request)));
  }

  @Patch('profile')
  async updateProfile(@Body() body: unknown, @Req() request: Request) {
    const values = parse(profileDto, body);
    return wrap(
      request,
      await this.identity.updateProfile(await this.protected(request, true), values, request.id),
    );
  }

  @Get('privacy-preferences')
  async privacy(@Req() request: Request) {
    return wrap(request, await this.identity.privacy(await this.protected(request)));
  }

  @Put('privacy-preferences')
  async updatePrivacy(@Body() body: unknown, @Req() request: Request) {
    const values = parse(privacyDto, body);
    return wrap(
      request,
      await this.identity.updatePrivacy(await this.protected(request, true), values, request.id),
    );
  }

  @Get('notification-preferences')
  async notificationPreferences(@Req() request: Request) {
    return wrap(
      request,
      await this.identity.notificationPreferences(await this.protected(request)),
    );
  }

  @Put('notification-preferences')
  async updateNotificationPreferences(@Body() body: unknown, @Req() request: Request) {
    const values = parse(z.strictObject({ email: z.boolean(), inApp: z.boolean() }), body);
    return wrap(
      request,
      await this.identity.updateNotificationPreferences(
        await this.protected(request, true),
        values.email,
        values.inApp,
        request.id,
      ),
    );
  }

  @Post('account/deletion')
  async deletion(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const values = parse(z.strictObject({ password: z.string().min(1) }), body);
    const result = await this.identity.requestDeletion(
      await this.protected(request, true),
      values.password,
      request.id,
    );
    response.setHeader('Set-Cookie', this.identity.clearCookieHeaders());
    return wrap(request, result);
  }
}

@Controller('admin')
export class IdentityAdminController {
  constructor(private readonly identity: IdentityService) {}
  private async protected(request: Request, mutate = false) {
    const context = await this.identity.context(request.headers.cookie);
    if (mutate)
      this.identity.checkCsrf(
        context,
        request.header('origin'),
        request.header('x-csrf-token'),
        request.headers.cookie,
      );
    return context;
  }

  @Get('users')
  async users(
    @Req() request: Request,
    @Query('limit') inputLimit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const limit = inputLimit ? parse(z.coerce.number().int().min(1).max(100), inputLimit) : 25;
    if (cursor) parse(uuid, cursor);
    const result = await this.identity.adminUsers(await this.protected(request), limit, cursor);
    return { ...result, requestId: request.id };
  }

  @Post('users')
  async createUser(@Body() body: unknown, @Req() request: Request) {
    const values = parse(z.strictObject({ email }), body);
    return wrap(
      request,
      await this.identity.inviteUser(await this.protected(request, true), values.email, request.id),
    );
  }

  @Patch('users/:id/status')
  async status(@Param('id') id: string, @Body() body: unknown, @Req() request: Request) {
    parse(uuid, id);
    const values = parse(
      z.strictObject({
        status: z.enum(['active', 'suspended']),
        reason: z.string().min(5).max(500),
      }),
      body,
    );
    return wrap(
      request,
      await this.identity.changeStatus(
        await this.protected(request, true),
        id,
        values.status.toUpperCase() as 'ACTIVE' | 'SUSPENDED',
        values.reason,
        request.id,
      ),
    );
  }

  @Get('roles')
  async roles(@Req() request: Request) {
    return wrap(request, await this.identity.roles(await this.protected(request)));
  }

  @Post('role-assignments')
  async assign(@Body() body: unknown, @Req() request: Request) {
    const values = parse(
      z.strictObject({
        userId: uuid,
        role: z.string().min(1).max(80),
        reason: z.string().min(5).max(500),
      }),
      body,
    );
    return wrap(
      request,
      await this.identity.assignRole(
        await this.protected(request, true),
        values.userId,
        values.role.toUpperCase(),
        values.reason,
        request.id,
      ),
    );
  }

  @Delete('role-assignments/:id')
  @HttpCode(200)
  async revoke(@Param('id') id: string, @Req() request: Request) {
    parse(uuid, id);
    await this.identity.revokeRole(await this.protected(request, true), id, request.id);
    return acknowledge(request);
  }
}
