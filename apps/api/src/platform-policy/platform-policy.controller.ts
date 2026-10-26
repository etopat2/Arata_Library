import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { platformSettingsSchema } from '@arata/validation';
import { IdentityService } from '../identity/identity.service.js';
import { PlatformPolicyService } from './platform-policy.service.js';

const reason = z.string().trim().min(10).max(1000);
const settingsInput = z.strictObject({ settings: platformSettingsSchema, reason });
const reasonInput = z.strictObject({ reason });
const approvalInput = z.strictObject({ reason, effectiveAt: z.iso.datetime({ offset: true }) });

@Controller('admin/platform-policy')
export class PlatformPolicyController {
  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(PlatformPolicyService) private readonly policy: PlatformPolicyService,
  ) {}

  private async admin(
    request: Request,
    permission: 'PLATFORM_POLICY_READ' | 'PLATFORM_POLICY_MANAGE' | 'PLATFORM_POLICY_APPROVE',
    write = false,
  ) {
    const context = await this.identity.context(request.headers.cookie);
    this.identity.requireAdmin(context, permission, write);
    if (write)
      this.identity.checkCsrf(
        context,
        request.headers.origin,
        request.header('X-CSRF-Token'),
        request.headers.cookie,
      );
    return context;
  }

  private id(value: string) {
    const result = z.uuid().safeParse(value);
    if (!result.success) throw new HttpException('Invalid policy ID', 400);
    return result.data;
  }

  @Get('effective')
  async effective(@Req() request: Request) {
    await this.admin(request, 'PLATFORM_POLICY_READ');
    return { data: await this.policy.current(), requestId: request.id };
  }

  @Get('history')
  async history(@Req() request: Request) {
    await this.admin(request, 'PLATFORM_POLICY_READ');
    return { data: await this.policy.history(), requestId: request.id };
  }

  @Get('export')
  async exportCurrent(@Req() request: Request) {
    await this.admin(request, 'PLATFORM_POLICY_READ');
    const current = await this.policy.current();
    return {
      data: {
        format: 'arata-platform-policy/v1',
        version: current.version,
        settings: current.settings,
      },
      requestId: request.id,
    };
  }

  @Get(':id')
  async version(@Req() request: Request, @Param('id') id: string) {
    await this.admin(request, 'PLATFORM_POLICY_READ');
    return { data: await this.policy.version(this.id(id)), requestId: request.id };
  }

  @Get(':id/events')
  async events(@Req() request: Request, @Param('id') id: string) {
    await this.admin(request, 'PLATFORM_POLICY_READ');
    return { data: await this.policy.events(this.id(id)), requestId: request.id };
  }

  @Post('preview')
  async preview(@Req() request: Request, @Body() body: unknown) {
    await this.admin(request, 'PLATFORM_POLICY_MANAGE', true);
    const parsed = platformSettingsSchema.safeParse(body);
    if (!parsed.success) throw new HttpException('Invalid platform settings', 400);
    return { data: await this.policy.preview(parsed.data), requestId: request.id };
  }

  @Post('drafts')
  async create(@Req() request: Request, @Body() body: unknown) {
    const context = await this.admin(request, 'PLATFORM_POLICY_MANAGE', true);
    const parsed = settingsInput.safeParse(body);
    if (!parsed.success) throw new HttpException('Invalid settings or reason', 400);
    return {
      data: await this.policy.create(
        parsed.data.settings,
        parsed.data.reason,
        context.user.id,
        request.id,
      ),
      requestId: request.id,
    };
  }

  @Post('import')
  async importConfig(@Req() request: Request, @Body() body: unknown) {
    const context = await this.admin(request, 'PLATFORM_POLICY_MANAGE', true);
    const parsed = z
      .strictObject({
        format: z.literal('arata-platform-policy/v1'),
        settings: platformSettingsSchema,
        reason,
      })
      .safeParse(body);
    if (!parsed.success) throw new HttpException('Invalid configuration export', 400);
    return {
      data: await this.policy.create(
        parsed.data.settings,
        parsed.data.reason,
        context.user.id,
        request.id,
      ),
      requestId: request.id,
    };
  }

  @Patch('drafts/:id')
  async edit(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const context = await this.admin(request, 'PLATFORM_POLICY_MANAGE', true);
    const parsed = settingsInput.safeParse(body);
    if (!parsed.success) throw new HttpException('Invalid settings or reason', 400);
    return {
      data: await this.policy.edit(
        this.id(id),
        parsed.data.settings,
        parsed.data.reason,
        context.user.id,
        request.id,
      ),
      requestId: request.id,
    };
  }

  @Post('drafts/:id/submit')
  async submit(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const context = await this.admin(request, 'PLATFORM_POLICY_MANAGE', true);
    const parsed = reasonInput.safeParse(body);
    if (!parsed.success) throw new HttpException('Reason required', 400);
    return {
      data: await this.policy.submit(this.id(id), parsed.data.reason, context.user.id, request.id),
      requestId: request.id,
    };
  }

  @Post(':id/approve')
  async approve(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const context = await this.admin(request, 'PLATFORM_POLICY_APPROVE', true);
    const parsed = approvalInput.safeParse(body);
    if (!parsed.success) throw new HttpException('Reason and UTC effective date required', 400);
    return {
      data: await this.policy.approve(
        this.id(id),
        parsed.data.reason,
        context.user.id,
        request.id,
        new Date(parsed.data.effectiveAt),
      ),
      requestId: request.id,
    };
  }

  @Post(':id/reject')
  async reject(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const context = await this.admin(request, 'PLATFORM_POLICY_APPROVE', true);
    const parsed = reasonInput.safeParse(body);
    if (!parsed.success) throw new HttpException('Reason required', 400);
    return {
      data: await this.policy.reject(this.id(id), parsed.data.reason, context.user.id, request.id),
      requestId: request.id,
    };
  }

  @Post(':id/activate')
  async activate(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const context = await this.admin(request, 'PLATFORM_POLICY_APPROVE', true);
    const parsed = reasonInput.safeParse(body);
    if (!parsed.success) throw new HttpException('Reason required', 400);
    return {
      data: await this.policy.activate(
        this.id(id),
        parsed.data.reason,
        context.user.id,
        request.id,
      ),
      requestId: request.id,
    };
  }

  @Post(':id/rollback')
  async rollback(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const context = await this.admin(request, 'PLATFORM_POLICY_MANAGE', true);
    const parsed = reasonInput.safeParse(body);
    if (!parsed.success) throw new HttpException('Reason required', 400);
    return {
      data: await this.policy.rollback(
        this.id(id),
        parsed.data.reason,
        context.user.id,
        request.id,
      ),
      requestId: request.id,
    };
  }
}
