import { randomUUID, createHmac } from 'node:crypto';
import { HttpException, Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { Redis } from 'ioredis';
import nodemailer from 'nodemailer';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransport,
} from '@simplewebauthn/server';
import type { ApiConfig } from '../app.js';
import {
  csrfToken,
  hashPassword,
  newTotpSecret,
  normalizeEmail,
  randomToken,
  safeEqual,
  seal,
  tokenHash,
  unseal,
  verifyPassword,
  verifyTotp,
} from './security.js';

export type IdentityUser = {
  id: string;
  email: string;
  passwordHash: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  emailVerifiedAt: Date | null;
  termsAcceptedAt: Date | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  createdAt: Date;
};
export type IdentitySession = {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  mfaVerifiedAt: Date | null;
  createdAt: Date;
  deviceLabel: string | null;
  lastSeenAt: Date | null;
};
export type AuthContext = {
  user: IdentityUser;
  session: IdentitySession;
  rawToken: string;
  csrf: string;
  roles: string[];
  permissions: string[];
};
type MailMessage = { to: string; subject: string; text: string };

@Injectable()
export class IdentityMailer {
  readonly captured: MailMessage[] = [];
  private readonly transport: ReturnType<typeof nodemailer.createTransport> | null;

  constructor(@Inject('APP_CONFIG') private readonly config: ApiConfig) {
    if (config.NODE_ENV === 'production' && !config.AUTH_SMTP_HOST)
      throw new Error('AUTH_SMTP_HOST is required in production');
    this.transport = config.AUTH_SMTP_HOST
      ? nodemailer.createTransport({
          host: config.AUTH_SMTP_HOST,
          port: config.AUTH_SMTP_PORT,
          secure: config.AUTH_SMTP_PORT === 465,
          requireTLS: config.NODE_ENV === 'production' && config.AUTH_SMTP_PORT !== 465,
          ...(config.AUTH_SMTP_USER && config.AUTH_SMTP_PASSWORD
            ? { auth: { user: config.AUTH_SMTP_USER, pass: config.AUTH_SMTP_PASSWORD } }
            : {}),
        })
      : null;
  }

  async send(message: MailMessage): Promise<void> {
    if (this.config.NODE_ENV === 'test') {
      this.captured.push(message);
      return;
    }
    if (!this.transport) throw new HttpException('Email delivery is unavailable', 503);
    await this.transport.sendMail({ from: this.config.AUTH_MAIL_FROM, ...message });
  }
}

@Injectable()
export class IdentityService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly redisReady: Promise<void>;
  private readonly sessionCookie: string;
  private readonly csrfCookie: string;

  constructor(
    @Inject('DB_POOL') private readonly pool: Pool,
    @Inject('APP_CONFIG') readonly config: ApiConfig,
    readonly mailer: IdentityMailer,
  ) {
    this.redis = new Redis(config.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.redis.on('error', () => undefined);
    this.redisReady = this.redis.connect();
    const secure = config.NODE_ENV === 'production' || config.WEB_ORIGIN.startsWith('https:');
    this.sessionCookie = secure ? '__Host-arata_session' : 'arata_session';
    this.csrfCookie = secure ? '__Host-arata_csrf' : 'arata_csrf';
  }

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }

  private async tx<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
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
    objectId: string | null,
    requestId: string,
    reason: string | null = null,
  ) {
    await client.query(
      'INSERT INTO app."AuditEvent" (id,"actorId",action,"objectType","objectId","correlationId",reason,"occurredAt") VALUES ($1,$2,$3,$4,$5,$6,$7,now())',
      [randomUUID(), actorId, action, objectType, objectId, requestId, reason],
    );
  }

  private bucket(value: string): string {
    return createHmac('sha256', Buffer.from(this.config.AUTH_SESSION_SECRET, 'hex'))
      .update(value)
      .digest('hex');
  }
  async throttle(category: string, ip: string, email?: string): Promise<void> {
    const keys = [`${this.config.AUTH_RATE_PREFIX}:auth:${category}:ip:${this.bucket(ip)}`];
    if (email)
      keys.push(
        `${this.config.AUTH_RATE_PREFIX}:auth:${category}:subject:${this.bucket(normalizeEmail(email))}`,
      );
    try {
      await this.redisReady;
      for (const key of keys) {
        const count = await this.redis.incr(key);
        if (count === 1) await this.redis.expire(key, 900);
        if (count > (category === 'login' ? 20 : 8))
          throw new HttpException('Please try again later', 429);
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException('Authentication temporarily unavailable', 503);
    }
  }

  private async issueToken(
    client: PoolClient,
    userId: string,
    purpose: string,
    minutes: number,
  ): Promise<string> {
    const raw = randomToken();
    await client.query(
      'INSERT INTO app."VerificationToken" (id,"userId",purpose,"tokenHash","expiresAt","createdAt") VALUES ($1,$2,$3,$4,now()+($5::int * interval \'1 minute\'),now())',
      [randomUUID(), userId, purpose, tokenHash(raw), minutes],
    );
    return raw;
  }

  policyVersions() {
    const { AUTH_TERMS_VERSION, AUTH_PRIVACY_VERSION, AUTH_TERMS_URL, AUTH_PRIVACY_URL } =
      this.config;
    if (!AUTH_TERMS_VERSION || !AUTH_PRIVACY_VERSION || !AUTH_TERMS_URL || !AUTH_PRIVACY_URL)
      throw new HttpException('Registration policy is not configured', 503);
    return {
      termsVersion: AUTH_TERMS_VERSION,
      privacyVersion: AUTH_PRIVACY_VERSION,
      termsUrl: AUTH_TERMS_URL,
      privacyUrl: AUTH_PRIVACY_URL,
    };
  }

  async register(
    emailInput: string,
    password: string,
    termsVersion: string,
    privacyVersion: string,
    ip: string,
    requestId: string,
  ): Promise<void> {
    const policy = this.policyVersions();
    if (termsVersion !== policy.termsVersion || privacyVersion !== policy.privacyVersion)
      throw new HttpException('Policy acknowledgement is outdated', 400);
    const email = normalizeEmail(emailInput);
    await this.throttle('register', ip, email);
    const passwordHash = await hashPassword(password);
    const result = await this.tx(async (client) => {
      const inserted = await client.query<{ id: string }>(
        'INSERT INTO app."User" (id,email,"passwordHash",status,"termsAcceptedAt","termsVersion","privacyVersion","createdAt","updatedAt") VALUES ($1,$2,$3,\'ACTIVE\',now(),$4,$5,now(),now()) ON CONFLICT DO NOTHING RETURNING id',
        [randomUUID(), email, passwordHash, termsVersion, privacyVersion],
      );
      const id = inserted.rows[0]?.id;
      if (!id) return null;
      await client.query(
        'INSERT INTO app."UserProfile" ("userId",locale,timezone,"updatedAt") VALUES ($1,\'en-GB\',\'UTC\',now())',
        [id],
      );
      await client.query(
        'INSERT INTO app."RoleAssignment" (id,"userId","roleId","scopeType","startsAt") SELECT $1,$2,id,\'PLATFORM\',now() FROM app."Role" WHERE code=\'READER\'',
        [randomUUID(), id],
      );
      await this.audit(client, id, 'identity.register', 'User', id, requestId);
      const token = await this.issueToken(client, id, 'VERIFY_EMAIL', 1440);
      return { token, id };
    });
    if (result) {
      try {
        await this.mailer.send({
          to: email,
          subject: 'Verify your Arata TechLibrary email',
          text: `Open ${this.config.WEB_ORIGIN}/?screen=verify-email&token=${encodeURIComponent(result.token)} to verify your address. This link expires in 24 hours.`,
        });
      } catch {
        console.error(
          JSON.stringify({
            event: 'identity.mail_delivery_failed',
            purpose: 'verify_email',
            requestId,
          }),
        );
      }
    }
  }

  async verifyEmail(raw: string, requestId: string): Promise<void> {
    await this.tx(async (client) => {
      const used = await client.query<{ userId: string }>(
        'UPDATE app."VerificationToken" SET "usedAt"=now() WHERE "tokenHash"=$1 AND purpose=\'VERIFY_EMAIL\' AND "usedAt" IS NULL AND "expiresAt">now() RETURNING "userId"',
        [tokenHash(raw)],
      );
      const id = used.rows[0]?.userId;
      if (!id) throw new HttpException('Invalid or expired verification link', 400);
      const activated = await client.query(
        'UPDATE app."User" SET "emailVerifiedAt"=COALESCE("emailVerifiedAt",now()),"updatedAt"=now() WHERE id=$1 AND status=\'ACTIVE\'',
        [id],
      );
      if (!activated.rowCount) throw new HttpException('Invalid or expired verification link', 400);
      await this.audit(client, id, 'identity.email_verified', 'User', id, requestId);
    });
  }

  async resendVerification(emailInput: string, ip: string, requestId: string): Promise<void> {
    const email = normalizeEmail(emailInput);
    await this.throttle('verify-resend', ip, email);
    const raw = await this.tx(async (client) => {
      const found = await client.query<{ id: string }>(
        'SELECT id FROM app."User" WHERE email=$1 AND status=\'ACTIVE\' AND "emailVerifiedAt" IS NULL AND "passwordHash" IS NOT NULL',
        [email],
      );
      const id = found.rows[0]?.id;
      if (!id) return null;
      const token = await this.issueToken(client, id, 'VERIFY_EMAIL', 1440);
      await this.audit(client, id, 'identity.verification_resent', 'User', id, requestId);
      return token;
    });
    if (raw) {
      try {
        await this.mailer.send({
          to: email,
          subject: 'Verify your Arata TechLibrary email',
          text: `Open ${this.config.WEB_ORIGIN}/?screen=verify-email&token=${encodeURIComponent(raw)} to verify your address. This link expires in 24 hours.`,
        });
      } catch {
        console.error(
          JSON.stringify({
            event: 'identity.mail_delivery_failed',
            purpose: 'verify_email',
            requestId,
          }),
        );
      }
    }
  }

  async login(
    emailInput: string,
    password: string,
    ip: string,
    deviceLabel: string,
    requestId: string,
  ) {
    const email = normalizeEmail(emailInput);
    await this.throttle('login', ip, email);
    const lookup = await this.pool.query<IdentityUser>(
      'SELECT id,email,"passwordHash",status,"emailVerifiedAt","termsAcceptedAt","failedLoginCount","lockedUntil","createdAt" FROM app."User" WHERE email=$1',
      [email],
    );
    const user = lookup.rows[0];
    const correct = await verifyPassword(password, user?.passwordHash ?? null);
    if (
      !user ||
      !correct ||
      user.status !== 'ACTIVE' ||
      !user.emailVerifiedAt ||
      !user.termsAcceptedAt ||
      (user.lockedUntil && user.lockedUntil > new Date())
    ) {
      if (user && !correct && user.status === 'ACTIVE')
        await this.pool.query(
          'UPDATE app."User" SET "failedLoginCount"=LEAST("failedLoginCount"+1,1000),"lockedUntil"=CASE WHEN "failedLoginCount"+1>=5 THEN now()+interval \'15 minutes\' ELSE "lockedUntil" END WHERE id=$1',
          [user.id],
        );
      throw new HttpException('Invalid credentials or account unavailable', 401);
    }
    return this.tx(async (client) => {
      await client.query(
        'UPDATE app."User" SET "failedLoginCount"=0,"lockedUntil"=NULL WHERE id=$1',
        [user.id],
      );
      const raw = randomToken();
      const id = randomUUID();
      const inserted = await client.query<IdentitySession>(
        'INSERT INTO app."AuthSession" (id,"userId","tokenHash","expiresAt","createdAt","deviceLabel","lastSeenAt") VALUES ($1,$2,$3,now()+interval \'12 hours\',now(),$4,now()) RETURNING id,"userId","expiresAt","revokedAt","mfaVerifiedAt","createdAt","deviceLabel","lastSeenAt"',
        [id, user.id, tokenHash(raw), deviceLabel.slice(0, 160)],
      );
      await this.audit(client, user.id, 'identity.login', 'AuthSession', id, requestId);
      return { raw, session: inserted.rows[0]! };
    });
  }

  cookieHeaders(raw: string, maxAgeSeconds = 43_200): string[] {
    const secure = this.sessionCookie.startsWith('__Host-') ? '; Secure' : '';
    const csrf = csrfToken(raw, this.config.AUTH_SESSION_SECRET);
    return [
      `${this.sessionCookie}=${raw}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`,
      `${this.csrfCookie}=${csrf}; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`,
    ];
  }

  clearCookieHeaders(): string[] {
    return this.cookieHeaders('', 0);
  }

  private cookie(header: string | undefined, name: string): string | undefined {
    return header
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))
      ?.slice(name.length + 1);
  }

  async context(cookieHeader: string | undefined): Promise<AuthContext> {
    const raw = this.cookie(cookieHeader, this.sessionCookie);
    if (!raw || !/^[A-Za-z0-9_-]{40,60}$/.test(raw))
      throw new HttpException('Authentication required', 401);
    const record = await this.pool.query<IdentityUser & IdentitySession>(
      `SELECT s.id,s."userId",s."expiresAt",s."revokedAt",s."mfaVerifiedAt",s."createdAt",s."deviceLabel",s."lastSeenAt",u.email,u."passwordHash",u.status,u."emailVerifiedAt",u."termsAcceptedAt",u."failedLoginCount",u."lockedUntil" FROM app."AuthSession" s JOIN app."User" u ON u.id=s."userId" WHERE s."tokenHash"=$1`,
      [tokenHash(raw)],
    );
    const row = record.rows[0];
    if (
      !row ||
      row.revokedAt ||
      row.expiresAt <= new Date() ||
      row.status !== 'ACTIVE' ||
      !row.emailVerifiedAt
    )
      throw new HttpException('Authentication required', 401);
    const grants = await this.pool.query<{ code: string; permission: string | null }>(
      'SELECT r.code,p.code AS permission FROM app."RoleAssignment" a JOIN app."Role" r ON r.id=a."roleId" LEFT JOIN app."RolePermission" rp ON rp."roleId"=r.id LEFT JOIN app."Permission" p ON p.id=rp."permissionId" WHERE a."userId"=$1 AND a."scopeType"=\'PLATFORM\' AND a."scopeId" IS NULL AND a."startsAt"<=now() AND (a."endsAt" IS NULL OR a."endsAt">now()) AND a."revokedAt" IS NULL',
      [row.userId],
    );
    return {
      user: {
        id: row.userId,
        email: row.email,
        passwordHash: row.passwordHash,
        status: row.status,
        emailVerifiedAt: row.emailVerifiedAt,
        termsAcceptedAt: row.termsAcceptedAt,
        failedLoginCount: row.failedLoginCount,
        lockedUntil: row.lockedUntil,
        createdAt: row.createdAt,
      },
      session: row,
      rawToken: raw,
      csrf: csrfToken(raw, this.config.AUTH_SESSION_SECRET),
      roles: [...new Set(grants.rows.map((r) => r.code))],
      permissions: [
        ...new Set(grants.rows.map((r) => r.permission).filter((v): v is string => !!v)),
      ],
    };
  }

  checkCsrf(
    context: AuthContext,
    origin: string | undefined,
    header: string | undefined,
    cookieHeader: string | undefined,
  ): void {
    const cookie = this.cookie(cookieHeader, this.csrfCookie);
    if (
      origin !== this.config.WEB_ORIGIN ||
      !header ||
      !cookie ||
      !safeEqual(context.csrf, header) ||
      !safeEqual(context.csrf, cookie)
    )
      throw new HttpException('CSRF check failed', 403);
  }

  requireAdmin(context: AuthContext, permission: string, stepUp = false): void {
    if (!context.roles.includes('SYSTEM_ADMIN') || !context.permissions.includes(permission))
      throw new HttpException('Access denied', 403);
    if (
      !context.session.mfaVerifiedAt ||
      (stepUp && Date.now() - context.session.mfaVerifiedAt.getTime() > 5 * 60_000)
    )
      throw new HttpException('Recent MFA verification required', 403);
  }

  async revoke(context: AuthContext, sessionId: string, requestId: string): Promise<void> {
    await this.tx(async (client) => {
      const result = await client.query(
        'UPDATE app."AuthSession" SET "revokedAt"=now() WHERE id=$1 AND "userId"=$2 AND "revokedAt" IS NULL RETURNING id',
        [sessionId, context.user.id],
      );
      if (!result.rowCount) throw new HttpException('Session not found', 404);
      await this.audit(
        client,
        context.user.id,
        'identity.session_revoked',
        'AuthSession',
        sessionId,
        requestId,
      );
    });
  }

  async sessions(context: AuthContext) {
    const rows = await this.pool.query<IdentitySession>(
      'SELECT id,"userId","expiresAt","revokedAt","mfaVerifiedAt","createdAt","deviceLabel","lastSeenAt" FROM app."AuthSession" WHERE "userId"=$1 AND "revokedAt" IS NULL AND "expiresAt">now() ORDER BY "createdAt" DESC',
      [context.user.id],
    );
    return rows.rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      current: row.id === context.session.id,
      deviceLabel: row.deviceLabel,
      lastSeenAt: row.lastSeenAt,
    }));
  }

  async requestReset(emailInput: string, ip: string, requestId: string): Promise<void> {
    const email = normalizeEmail(emailInput);
    await this.throttle('recovery', ip, email);
    const result = await this.tx(async (client) => {
      const user = await client.query<IdentityUser>(
        'SELECT id,email FROM app."User" WHERE email=$1 AND status=\'ACTIVE\' AND "emailVerifiedAt" IS NOT NULL',
        [email],
      );
      if (!user.rows[0]) return null;
      const raw = await this.issueToken(client, user.rows[0].id, 'PASSWORD_RESET', 30);
      await this.audit(
        client,
        user.rows[0].id,
        'identity.reset_requested',
        'User',
        user.rows[0].id,
        requestId,
      );
      return raw;
    });
    if (result) {
      try {
        await this.mailer.send({
          to: email,
          subject: 'Reset your Arata TechLibrary password',
          text: `Open ${this.config.WEB_ORIGIN}/?screen=recovery&token=${encodeURIComponent(result)} to reset your password. This link expires in 30 minutes.`,
        });
      } catch {
        console.error(
          JSON.stringify({
            event: 'identity.mail_delivery_failed',
            purpose: 'password_reset',
            requestId,
          }),
        );
      }
    }
  }

  async resetPassword(raw: string, password: string, requestId: string): Promise<void> {
    const passwordHash = await hashPassword(password);
    await this.tx(async (client) => {
      const used = await client.query<{ userId: string }>(
        'UPDATE app."VerificationToken" SET "usedAt"=now() WHERE "tokenHash"=$1 AND purpose=\'PASSWORD_RESET\' AND "usedAt" IS NULL AND "expiresAt">now() RETURNING "userId"',
        [tokenHash(raw)],
      );
      const userId = used.rows[0]?.userId;
      if (!userId) throw new HttpException('Invalid or expired recovery link', 400);
      const changed = await client.query(
        'UPDATE app."User" SET "passwordHash"=$1,"failedLoginCount"=0,"lockedUntil"=NULL,"updatedAt"=now() WHERE id=$2 AND status=\'ACTIVE\'',
        [passwordHash, userId],
      );
      if (!changed.rowCount) throw new HttpException('Invalid or expired recovery link', 400);
      await client.query(
        'UPDATE app."AuthSession" SET "revokedAt"=now() WHERE "userId"=$1 AND "revokedAt" IS NULL',
        [userId],
      );
      await this.audit(client, userId, 'identity.password_reset', 'User', userId, requestId);
    });
  }

  async profile(context: AuthContext) {
    const result = await this.pool.query<{
      displayName: string | null;
      locale: string;
      timezone: string;
    }>('SELECT "displayName",locale,timezone FROM app."UserProfile" WHERE "userId"=$1', [
      context.user.id,
    ]);
    return {
      id: context.user.id,
      email: context.user.email,
      emailVerified: true,
      status: context.user.status.toLowerCase(),
      ...result.rows[0],
    };
  }

  async updateProfile(
    context: AuthContext,
    values: {
      displayName?: string | null | undefined;
      locale?: string | undefined;
      timezone?: string | undefined;
    },
    requestId: string,
  ) {
    await this.tx(async (client) => {
      await client.query(
        'UPDATE app."UserProfile" SET "displayName"=COALESCE($2,"displayName"),locale=COALESCE($3,locale),timezone=COALESCE($4,timezone),"updatedAt"=now() WHERE "userId"=$1',
        [context.user.id, values.displayName, values.locale, values.timezone],
      );
      await this.audit(
        client,
        context.user.id,
        'identity.profile_updated',
        'User',
        context.user.id,
        requestId,
      );
    });
    return this.profile(context);
  }

  async privacy(context: AuthContext) {
    const rows = await this.pool.query<{ code: string; granted: boolean }>(
      'SELECT p.code,v.granted FROM app."ProcessingPurpose" p JOIN LATERAL (SELECT granted FROM app."PrivacyPreference" WHERE "userId"=$1 AND "purposeId"=p.id ORDER BY "effectiveAt" DESC LIMIT 1) v ON true WHERE p.code IN (\'ANALYTICS\',\'RESEARCH\',\'PERSONALIZATION\',\'AI_ASSISTANCE\')',
      [context.user.id],
    );
    const mapped = Object.fromEntries(rows.rows.map((r) => [r.code, r.granted]));
    return {
      analyticsConsent: mapped.ANALYTICS ?? false,
      researchConsent: mapped.RESEARCH ?? false,
      personalizationConsent: mapped.PERSONALIZATION ?? false,
      aiAssistanceConsent: mapped.AI_ASSISTANCE ?? false,
    };
  }

  async updatePrivacy(
    context: AuthContext,
    values: Record<
      'analyticsConsent' | 'researchConsent' | 'personalizationConsent' | 'aiAssistanceConsent',
      boolean
    > & { policyVersion: string },
    requestId: string,
  ) {
    if (
      !this.config.AUTH_PRIVACY_VERSION ||
      values.policyVersion !== this.config.AUTH_PRIVACY_VERSION
    )
      throw new HttpException('Privacy notice version is unavailable or outdated', 400);
    await this.tx(async (client) => {
      const purposes: [string, boolean][] = [
        ['ANALYTICS', values.analyticsConsent],
        ['RESEARCH', values.researchConsent],
        ['PERSONALIZATION', values.personalizationConsent],
        ['AI_ASSISTANCE', values.aiAssistanceConsent],
      ];
      for (const [code, granted] of purposes) {
        const purpose = await client.query<{ id: string }>(
          'SELECT id FROM app."ProcessingPurpose" WHERE code=$1',
          [code],
        );
        if (!purpose.rows[0]) throw new HttpException('Privacy purpose is not configured', 503);
        await client.query(
          'INSERT INTO app."PrivacyPreference" (id,"userId","purposeId",granted,"policyVersion","effectiveAt","withdrawnAt") VALUES ($1,$2,$3,$4,$5,now(),$6)',
          [
            randomUUID(),
            context.user.id,
            purpose.rows[0].id,
            granted,
            values.policyVersion,
            granted ? null : new Date(),
          ],
        );
      }
      await this.audit(
        client,
        context.user.id,
        'identity.privacy_updated',
        'User',
        context.user.id,
        requestId,
      );
    });
    return this.privacy(context);
  }

  async notificationPreferences(context: AuthContext) {
    const result = await this.pool.query<{ email: boolean; inApp: boolean; updatedAt: Date }>(
      'SELECT email,"inApp","updatedAt" FROM app."NotificationPreference" WHERE "userId"=$1',
      [context.user.id],
    );
    return {
      email: result.rows[0]?.email ?? true,
      inApp: result.rows[0]?.inApp ?? true,
      securityMandatory: true,
      updatedAt: result.rows[0]?.updatedAt ?? new Date(),
    };
  }

  async updateNotificationPreferences(
    context: AuthContext,
    email: boolean,
    inApp: boolean,
    requestId: string,
  ) {
    await this.tx(async (client) => {
      await client.query(
        'INSERT INTO app."NotificationPreference" ("userId",email,"inApp","updatedAt") VALUES ($1,$2,$3,now()) ON CONFLICT ("userId") DO UPDATE SET email=EXCLUDED.email,"inApp"=EXCLUDED."inApp","updatedAt"=now()',
        [context.user.id, email, inApp],
      );
      await this.audit(
        client,
        context.user.id,
        'identity.notifications_updated',
        'User',
        context.user.id,
        requestId,
      );
    });
    return this.notificationPreferences(context);
  }

  async enrollTotp(context: AuthContext, password: string, requestId: string) {
    if (!(await verifyPassword(password, context.user.passwordHash)))
      throw new HttpException('Invalid credentials', 401);
    const existing = await this.pool.query(
      'SELECT 1 FROM app."Authenticator" WHERE "userId"=$1 AND kind=\'TOTP\' AND "revokedAt" IS NULL AND "confirmedAt" IS NOT NULL',
      [context.user.id],
    );
    if (existing.rowCount) throw new HttpException('MFA already enrolled', 409);
    const secret = newTotpSecret();
    const id = randomUUID();
    await this.tx(async (client) => {
      await client.query(
        'UPDATE app."Authenticator" SET "revokedAt"=now() WHERE "userId"=$1 AND kind=\'TOTP\' AND "confirmedAt" IS NULL AND "revokedAt" IS NULL',
        [context.user.id],
      );
      await client.query(
        'INSERT INTO app."Authenticator" (id,"userId",kind,"credentialHash","createdAt","transports") VALUES ($1,$2,\'TOTP\',$3,now(),ARRAY[]::text[])',
        [id, context.user.id, seal(secret, this.config.AUTH_DATA_KEY)],
      );
      await this.audit(
        client,
        context.user.id,
        'identity.mfa_enrollment_started',
        'Authenticator',
        id,
        requestId,
      );
    });
    return {
      id,
      secret,
      otpauthUrl: `otpauth://totp/Arata%20TechLibrary:${encodeURIComponent(context.user.email)}?secret=${secret}&issuer=Arata%20TechLibrary&algorithm=SHA1&digits=6&period=30`,
    };
  }

  async confirmTotp(context: AuthContext, id: string, code: string, requestId: string) {
    return this.tx(async (client) => {
      const found = await client.query<{ credentialHash: string }>(
        'SELECT "credentialHash" FROM app."Authenticator" WHERE id=$1 AND "userId"=$2 AND kind=\'TOTP\' AND "confirmedAt" IS NULL AND "revokedAt" IS NULL FOR UPDATE',
        [id, context.user.id],
      );
      if (
        !found.rows[0] ||
        !verifyTotp(unseal(found.rows[0].credentialHash, this.config.AUTH_DATA_KEY), code)
      )
        throw new HttpException('Invalid MFA code', 401);
      await client.query(
        'UPDATE app."Authenticator" SET "confirmedAt"=now(),"lastUsedAt"=now() WHERE id=$1',
        [id],
      );
      await this.audit(
        client,
        context.user.id,
        'identity.mfa_enrolled',
        'Authenticator',
        id,
        requestId,
      );
      return this.rotateSession(client, context, true);
    });
  }

  async challenge(context: AuthContext, requestId: string) {
    const raw = await this.tx(async (client) => {
      const value = await this.issueToken(client, context.user.id, `MFA:${context.session.id}`, 5);
      await this.audit(
        client,
        context.user.id,
        'identity.mfa_challenge',
        'AuthSession',
        context.session.id,
        requestId,
      );
      return value;
    });
    return { challengeId: raw, expiresAt: new Date(Date.now() + 5 * 60_000) };
  }

  async verifyMfa(context: AuthContext, challengeId: string, code: string, requestId: string) {
    return this.tx(async (client) => {
      const used = await client.query(
        'UPDATE app."VerificationToken" SET "usedAt"=now() WHERE "tokenHash"=$1 AND "userId"=$2 AND purpose=$3 AND "usedAt" IS NULL AND "expiresAt">now() RETURNING id',
        [tokenHash(challengeId), context.user.id, `MFA:${context.session.id}`],
      );
      if (!used.rowCount) throw new HttpException('Invalid or expired MFA challenge', 401);
      const auth = await client.query<{
        id: string;
        credentialHash: string;
        lastUsedAt: Date | null;
      }>(
        'SELECT id,"credentialHash","lastUsedAt" FROM app."Authenticator" WHERE "userId"=$1 AND kind=\'TOTP\' AND "confirmedAt" IS NOT NULL AND "revokedAt" IS NULL FOR UPDATE',
        [context.user.id],
      );
      const authenticator = auth.rows[0];
      if (
        !authenticator ||
        !verifyTotp(unseal(authenticator.credentialHash, this.config.AUTH_DATA_KEY), code) ||
        (authenticator.lastUsedAt && Date.now() - authenticator.lastUsedAt.getTime() < 25_000)
      )
        throw new HttpException('Invalid MFA code', 401);
      await client.query('UPDATE app."Authenticator" SET "lastUsedAt"=now() WHERE id=$1', [
        authenticator.id,
      ]);
      await this.audit(
        client,
        context.user.id,
        'identity.mfa_verified',
        'AuthSession',
        context.session.id,
        requestId,
      );
      return this.rotateSession(client, context, true);
    });
  }

  private async rotateSession(client: PoolClient, context: AuthContext, mfa: boolean) {
    const raw = randomToken();
    const id = randomUUID();
    await client.query(
      'UPDATE app."AuthSession" SET "revokedAt"=now() WHERE id=$1 AND "userId"=$2 AND "revokedAt" IS NULL',
      [context.session.id, context.user.id],
    );
    const result = await client.query<IdentitySession>(
      'INSERT INTO app."AuthSession" (id,"userId","tokenHash","expiresAt","mfaVerifiedAt","createdAt","deviceLabel","lastSeenAt") VALUES ($1,$2,$3,now()+interval \'12 hours\',$4,now(),$5,now()) RETURNING id,"userId","expiresAt","revokedAt","mfaVerifiedAt","createdAt","deviceLabel","lastSeenAt"',
      [id, context.user.id, tokenHash(raw), mfa ? new Date() : null, context.session.deviceLabel],
    );
    return { raw, session: result.rows[0]! };
  }

  async requestDeletion(context: AuthContext, password: string, requestId: string) {
    if (!(await verifyPassword(password, context.user.passwordHash)))
      throw new HttpException('Invalid credentials', 401);
    return this.tx(async (client) => {
      const id = randomUUID();
      await client.query(
        'INSERT INTO app."SubjectRequest" (id,"userId","requestType",status,"requestedAt") VALUES ($1,$2,\'ACCOUNT_DELETION\',\'OPEN\',now())',
        [id, context.user.id],
      );
      await client.query(
        'UPDATE app."User" SET status=\'CLOSED\',"closedAt"=now(),"updatedAt"=now() WHERE id=$1',
        [context.user.id],
      );
      await client.query(
        'UPDATE app."AuthSession" SET "revokedAt"=now() WHERE "userId"=$1 AND "revokedAt" IS NULL',
        [context.user.id],
      );
      await this.audit(
        client,
        context.user.id,
        'identity.deletion_requested',
        'SubjectRequest',
        id,
        requestId,
      );
      return { id, status: 'open' };
    });
  }

  async adminUsers(context: AuthContext, limit: number, cursor?: string) {
    this.requireAdmin(context, 'IDENTITY_USER_READ');
    const rows = await this.pool.query<{
      id: string;
      email: string;
      status: string;
      emailVerifiedAt: Date | null;
      createdAt: Date;
    }>(
      'SELECT id,email,status,"emailVerifiedAt","createdAt" FROM app."User" WHERE ($1::uuid IS NULL OR id>$1::uuid) ORDER BY id LIMIT $2',
      [cursor ?? null, limit + 1],
    );
    return {
      data: rows.rows.slice(0, limit).map((row) => ({
        id: row.id,
        email: row.email,
        status: row.status.toLowerCase(),
        emailVerified: !!row.emailVerifiedAt,
        createdAt: row.createdAt,
      })),
      page: {
        limit,
        hasMore: rows.rows.length > limit,
        nextCursor: rows.rows.length > limit ? rows.rows[limit - 1]?.id : undefined,
      },
    };
  }

  async inviteUser(context: AuthContext, emailInput: string, requestId: string) {
    this.requireAdmin(context, 'IDENTITY_USER_CREATE', true);
    const email = normalizeEmail(emailInput);
    const result = await this.tx(async (client) => {
      const inserted = await client.query<{ id: string }>(
        'INSERT INTO app."User" (id,email,status,"privacyVersion","termsVersion","createdAt","updatedAt") VALUES ($1,$2,\'ACTIVE\',\'PENDING_ACCEPTANCE\',\'PENDING_ACCEPTANCE\',now(),now()) ON CONFLICT DO NOTHING RETURNING id',
        [randomUUID(), email],
      );
      const id = inserted.rows[0]?.id;
      if (!id) return null;
      await client.query(
        'INSERT INTO app."UserProfile" ("userId",locale,timezone,"updatedAt") VALUES ($1,\'en-GB\',\'UTC\',now())',
        [id],
      );
      await client.query(
        'INSERT INTO app."RoleAssignment" (id,"userId","roleId","scopeType","startsAt") SELECT $1,$2,id,\'PLATFORM\',now() FROM app."Role" WHERE code=\'READER\'',
        [randomUUID(), id],
      );
      const raw = await this.issueToken(client, id, 'INVITATION', 1440);
      await this.audit(client, context.user.id, 'identity.user_invited', 'User', id, requestId);
      return { id, raw };
    });
    if (result) {
      try {
        await this.mailer.send({
          to: email,
          subject: 'Your Arata TechLibrary invitation',
          text: `Open ${this.config.WEB_ORIGIN}/?screen=register&token=${encodeURIComponent(result.raw)} to accept your invitation. This link expires in 24 hours.`,
        });
      } catch {
        console.error(
          JSON.stringify({
            event: 'identity.mail_delivery_failed',
            purpose: 'invitation',
            requestId,
          }),
        );
      }
    }
    return { accepted: true };
  }

  async acceptInvitation(
    raw: string,
    password: string,
    termsVersion: string,
    privacyVersion: string,
    requestId: string,
  ) {
    const policy = this.policyVersions();
    if (termsVersion !== policy.termsVersion || privacyVersion !== policy.privacyVersion)
      throw new HttpException('Policy acknowledgement is outdated', 400);
    const passwordHash = await hashPassword(password);
    await this.tx(async (client) => {
      const used = await client.query<{ userId: string }>(
        'UPDATE app."VerificationToken" SET "usedAt"=now() WHERE "tokenHash"=$1 AND purpose=\'INVITATION\' AND "usedAt" IS NULL AND "expiresAt">now() RETURNING "userId"',
        [tokenHash(raw)],
      );
      const id = used.rows[0]?.userId;
      if (!id) throw new HttpException('Invalid or expired invitation', 400);
      const changed = await client.query(
        'UPDATE app."User" SET "passwordHash"=$1,"emailVerifiedAt"=now(),"termsAcceptedAt"=now(),"termsVersion"=$2,"privacyVersion"=$3,"updatedAt"=now() WHERE id=$4 AND status=\'ACTIVE\' AND "passwordHash" IS NULL RETURNING id',
        [passwordHash, termsVersion, privacyVersion, id],
      );
      if (!changed.rowCount) throw new HttpException('Invitation unavailable', 400);
      await this.audit(client, id, 'identity.invitation_accepted', 'User', id, requestId);
    });
  }

  async changeStatus(
    context: AuthContext,
    userId: string,
    status: 'ACTIVE' | 'SUSPENDED',
    reason: string,
    requestId: string,
  ) {
    this.requireAdmin(context, 'IDENTITY_USER_SUSPEND', true);
    if (userId === context.user.id) throw new HttpException('Self status change denied', 403);
    return this.tx(async (client) => {
      const result = await client.query<{ id: string; status: string; createdAt: Date }>(
        'UPDATE app."User" SET status=$1,"updatedAt"=now() WHERE id=$2 AND status<>\'CLOSED\' RETURNING id,status,"createdAt"',
        [status, userId],
      );
      const user = result.rows[0];
      if (!user) throw new HttpException('User not found', 404);
      if (status === 'SUSPENDED')
        await client.query(
          'UPDATE app."AuthSession" SET "revokedAt"=now() WHERE "userId"=$1 AND "revokedAt" IS NULL',
          [userId],
        );
      await this.audit(
        client,
        context.user.id,
        `identity.user_${status.toLowerCase()}`,
        'User',
        userId,
        requestId,
        reason,
      );
      return { id: user.id, status: user.status.toLowerCase(), createdAt: user.createdAt };
    });
  }

  async roles(context: AuthContext) {
    this.requireAdmin(context, 'IDENTITY_ROLE_ASSIGN');
    const result = await this.pool.query<{ code: string; description: string | null }>(
      'SELECT code,description FROM app."Role" ORDER BY code',
    );
    return result.rows;
  }

  async assignRole(
    context: AuthContext,
    userId: string,
    code: string,
    reason: string,
    requestId: string,
  ) {
    this.requireAdmin(context, 'IDENTITY_ROLE_ASSIGN', true);
    if (!['READER', 'AUTHOR', 'EDITOR', 'PUBLISHER'].includes(code) || userId === context.user.id)
      throw new HttpException('Role change requires independent approval', 403);
    return this.tx(async (client) => {
      const role = await client.query<{ id: string }>('SELECT id FROM app."Role" WHERE code=$1', [
        code,
      ]);
      const target = await client.query(
        'SELECT 1 FROM app."User" WHERE id=$1 AND status=\'ACTIVE\' AND "emailVerifiedAt" IS NOT NULL',
        [userId],
      );
      if (!role.rows[0] || !target.rowCount) throw new HttpException('Role or user not found', 404);
      const existing = await client.query(
        'SELECT 1 FROM app."RoleAssignment" WHERE "userId"=$1 AND "roleId"=$2 AND "scopeType"=\'PLATFORM\' AND "scopeId" IS NULL AND "revokedAt" IS NULL AND ("endsAt" IS NULL OR "endsAt">now())',
        [userId, role.rows[0].id],
      );
      if (existing.rowCount) throw new HttpException('Role already assigned', 409);
      const id = randomUUID();
      await client.query(
        'INSERT INTO app."RoleAssignment" (id,"userId","roleId","scopeType","startsAt") VALUES ($1,$2,$3,\'PLATFORM\',now())',
        [id, userId, role.rows[0].id],
      );
      await this.audit(
        client,
        context.user.id,
        'identity.role_assigned',
        'RoleAssignment',
        id,
        requestId,
        reason,
      );
      return { id };
    });
  }

  async revokeRole(context: AuthContext, assignmentId: string, requestId: string) {
    this.requireAdmin(context, 'IDENTITY_ROLE_ASSIGN', true);
    return this.tx(async (client) => {
      const found = await client.query<{ userId: string; code: string }>(
        'SELECT a."userId",r.code FROM app."RoleAssignment" a JOIN app."Role" r ON r.id=a."roleId" WHERE a.id=$1 AND a."revokedAt" IS NULL FOR UPDATE OF a',
        [assignmentId],
      );
      const row = found.rows[0];
      if (!row) throw new HttpException('Assignment not found', 404);
      if (row.userId === context.user.id || row.code === 'SYSTEM_ADMIN')
        throw new HttpException('Role change requires independent approval', 403);
      await client.query('UPDATE app."RoleAssignment" SET "revokedAt"=now() WHERE id=$1', [
        assignmentId,
      ]);
      await this.audit(
        client,
        context.user.id,
        'identity.role_revoked',
        'RoleAssignment',
        assignmentId,
        requestId,
      );
    });
  }

  private get rpId() {
    return new URL(this.config.WEB_ORIGIN).hostname;
  }

  private responseChallenge(encodedClientData: string): string {
    try {
      const decoded = JSON.parse(Buffer.from(encodedClientData, 'base64url').toString('utf8')) as {
        challenge?: unknown;
      };
      if (
        typeof decoded.challenge !== 'string' ||
        !/^[A-Za-z0-9_-]{20,200}$/.test(decoded.challenge)
      )
        throw new Error();
      return decoded.challenge;
    } catch {
      throw new HttpException('Invalid passkey response', 400);
    }
  }

  async passkeyRegistrationOptions(context: AuthContext) {
    const existing = await this.pool.query<{ credentialId: string; transports: string[] }>(
      'SELECT "credentialId",transports FROM app."Authenticator" WHERE "userId"=$1 AND kind=\'PASSKEY\' AND "revokedAt" IS NULL',
      [context.user.id],
    );
    const options = await generateRegistrationOptions({
      rpName: 'Arata TechLibrary',
      rpID: this.rpId,
      userName: context.user.email,
      userID: Buffer.from(context.user.id.replaceAll('-', ''), 'hex'),
      attestationType: 'none',
      supportedAlgorithmIDs: [-7],
      excludeCredentials: existing.rows.map((row) => ({
        id: row.credentialId,
        transports: row.transports as AuthenticatorTransport[],
      })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    await this.redis.set(
      `passkey:reg:${tokenHash(options.challenge)}`,
      context.session.id,
      'EX',
      300,
    );
    return options;
  }

  async registerPasskey(
    context: AuthContext,
    response: RegistrationResponseJSON,
    requestId: string,
  ) {
    const challenge = this.responseChallenge(response.response.clientDataJSON);
    const sessionId = await this.redis.getdel(`passkey:reg:${tokenHash(challenge)}`);
    if (sessionId !== context.session.id) throw new HttpException('Passkey challenge expired', 400);
    let verified;
    try {
      verified = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: this.config.WEB_ORIGIN,
        expectedRPID: this.rpId,
        requireUserVerification: true,
      });
    } catch {
      throw new HttpException('Passkey verification failed', 400);
    }
    if (!verified.verified || !verified.registrationInfo)
      throw new HttpException('Passkey verification failed', 400);
    const credential = verified.registrationInfo.credential;
    const id = randomUUID();
    await this.tx(async (client) => {
      await client.query(
        'INSERT INTO app."Authenticator" (id,"userId",kind,"credentialHash","credentialId","signCount",transports,"confirmedAt","createdAt") VALUES ($1,$2,\'PASSKEY\',$3,$4,$5,$6,now(),now())',
        [
          id,
          context.user.id,
          Buffer.from(credential.publicKey).toString('base64url'),
          credential.id,
          credential.counter,
          credential.transports ?? [],
        ],
      );
      await this.audit(
        client,
        context.user.id,
        'identity.passkey_registered',
        'Authenticator',
        id,
        requestId,
      );
    });
    return { id, createdAt: new Date() };
  }

  async passkeyLoginOptions(emailInput: string, ip: string) {
    const email = normalizeEmail(emailInput);
    await this.throttle('passkey', ip, email);
    const rows = await this.pool.query<{ id: string }>(
      'SELECT id FROM app."User" WHERE email=$1 AND status=\'ACTIVE\' AND "emailVerifiedAt" IS NOT NULL',
      [email],
    );
    const options = await generateAuthenticationOptions({
      rpID: this.rpId,
      userVerification: 'required',
      allowCredentials: [],
    });
    await this.redis.set(
      `passkey:auth:${tokenHash(options.challenge)}`,
      rows.rows[0]?.id ?? '',
      'EX',
      300,
    );
    return options;
  }

  async loginPasskey(
    response: AuthenticationResponseJSON,
    ip: string,
    deviceLabel: string,
    requestId: string,
  ) {
    await this.throttle('passkey', ip);
    const challenge = this.responseChallenge(response.response.clientDataJSON);
    const userId = await this.redis.getdel(`passkey:auth:${tokenHash(challenge)}`);
    if (!userId) throw new HttpException('Invalid passkey or challenge', 401);
    return this.tx(async (client) => {
      const result = await client.query<{
        id: string;
        credentialId: string;
        credentialHash: string;
        signCount: number;
        transports: string[];
      }>(
        'SELECT id,"credentialId","credentialHash","signCount",transports FROM app."Authenticator" WHERE "userId"=$1 AND "credentialId"=$2 AND kind=\'PASSKEY\' AND "revokedAt" IS NULL FOR UPDATE',
        [userId, response.id],
      );
      const row = result.rows[0];
      if (!row) throw new HttpException('Invalid passkey or challenge', 401);
      const account = await client.query<{
        status: string;
        emailVerifiedAt: Date | null;
        termsAcceptedAt: Date | null;
      }>(
        'SELECT status,"emailVerifiedAt","termsAcceptedAt" FROM app."User" WHERE id=$1 FOR UPDATE',
        [userId],
      );
      if (
        account.rows[0]?.status !== 'ACTIVE' ||
        !account.rows[0]?.emailVerifiedAt ||
        !account.rows[0]?.termsAcceptedAt
      )
        throw new HttpException('Invalid passkey or challenge', 401);
      const credential: WebAuthnCredential = {
        id: row.credentialId,
        publicKey: new Uint8Array(Buffer.from(row.credentialHash, 'base64url')),
        counter: row.signCount,
        transports: row.transports as AuthenticatorTransport[],
      };
      let verified;
      try {
        verified = await verifyAuthenticationResponse({
          response,
          expectedChallenge: challenge,
          expectedOrigin: this.config.WEB_ORIGIN,
          expectedRPID: this.rpId,
          credential,
          requireUserVerification: true,
        });
      } catch {
        throw new HttpException('Invalid passkey or challenge', 401);
      }
      if (!verified.verified) throw new HttpException('Invalid passkey or challenge', 401);
      await client.query(
        'UPDATE app."Authenticator" SET "signCount"=$1,"lastUsedAt"=now() WHERE id=$2',
        [verified.authenticationInfo.newCounter, row.id],
      );
      const raw = randomToken();
      const id = randomUUID();
      const session = await client.query<IdentitySession>(
        'INSERT INTO app."AuthSession" (id,"userId","tokenHash","expiresAt","mfaVerifiedAt","createdAt","deviceLabel","lastSeenAt") VALUES ($1,$2,$3,now()+interval \'12 hours\',now(),now(),$4,now()) RETURNING id,"userId","expiresAt","revokedAt","mfaVerifiedAt","createdAt","deviceLabel","lastSeenAt"',
        [id, userId, tokenHash(raw), deviceLabel.slice(0, 160)],
      );
      await this.audit(client, userId, 'identity.passkey_login', 'AuthSession', id, requestId);
      return { raw, session: session.rows[0]! };
    });
  }
}
