import { describe, expect, it } from 'vitest';
import {
  accessIsCurrent,
  complimentaryEndsAt,
  initialPlatformSettings,
  institutionMembershipEligible,
  mayPublishResearchAggregate,
  platformSettingsSchema,
  previewPlatformSettings,
  researchEventWindow,
  subscriptionEndsAt,
  trialEligible,
} from '../../packages/validation/src/platform-policy.js';
import {
  resolveContentPolicy,
  type ContentPolicyRow,
} from '../../packages/access-policy/src/content-policy.js';

const clone = () => structuredClone(initialPlatformSettings);

describe('platform policy validation and precedence', () => {
  it('starts with commercial, institutional and research release gates closed', () => {
    const policy = platformSettingsSchema.parse(initialPlatformSettings);
    expect(
      Object.values(policy.subscriptions.plans).every(
        (plan) => !plan.enabled && plan.priceMinor === null,
      ),
    ).toBe(true);
    expect(policy.subscriptions.automaticRenewalEnabled).toBe(false);
    expect(policy.institutional.benefitsEnabled).toBe(false);
    expect(policy.research.collectionEnabled).toBe(false);
    expect(policy.research.publicPublicationEnabled).toBe(false);
    expect(policy.security.loginRequestsPerWindow).toBeGreaterThan(
      policy.security.loginAttemptsPerWindow,
    );
  });

  it('rejects priced plans without an approved integer amount and prevents unverified recurring billing', () => {
    const missing = clone();
    missing.subscriptions.plans.monthly.enabled = true;
    expect(platformSettingsSchema.safeParse(missing).success).toBe(false);
    missing.subscriptions.plans.monthly.priceMinor = 50_000;
    expect(platformSettingsSchema.safeParse(missing).success).toBe(true);
    missing.subscriptions.automaticRenewalEnabled = true;
    expect(platformSettingsSchema.safeParse(missing).success).toBe(false);
  });

  it('rejects invalid research timing, unknown secrets and zero enabled trial', () => {
    const timing = clone();
    timing.research.heartbeatSeconds = timing.research.idleSeconds;
    expect(platformSettingsSchema.safeParse(timing).success).toBe(false);
    const trial = clone();
    trial.subscriptions.trialEnabled = true;
    trial.subscriptions.trialDays = 0;
    expect(platformSettingsSchema.safeParse(trial).success).toBe(false);
    expect(platformSettingsSchema.safeParse({ ...clone(), paymentApiKey: 'secret' }).success).toBe(
      false,
    );
  });

  it('previews sensitive effect changes and preserves unchanged source snapshot', () => {
    const before = clone();
    const after = clone();
    after.security.sessionHours = 4;
    after.reader.defaultCopy = true;
    const result = previewPlatformSettings(before, after);
    expect(result.affected).toEqual(['reader', 'security']);
    expect(result.requiresIndependentApproval).toBe(true);
    expect(result.changes).toContainEqual({ path: 'security.sessionHours', before: 12, after: 4 });
    expect(before.security.sessionHours).toBe(12);
  });

  it('constrains complimentary expiry and research minimum disclosure', () => {
    const policy = clone();
    policy.complimentary.maxCustomDays = 0;
    expect(platformSettingsSchema.safeParse(policy).success).toBe(false);
    policy.complimentary.maxCustomDays = 365;
    policy.research.publicMinimumSubjects = 3;
    expect(platformSettingsSchema.safeParse(policy).success).toBe(false);
  });

  it('expires timed grants exactly at the boundary and requires extra approval for permanent grants', () => {
    const start = new Date('2026-10-01T00:00:00.000Z');
    const end = complimentaryEndsAt(start, 7, clone())!;
    expect(end.toISOString()).toBe('2026-10-08T00:00:00.000Z');
    expect(accessIsCurrent(start, end, new Date(end.getTime() - 1))).toBe(true);
    expect(accessIsCurrent(start, end, end)).toBe(false);
    expect(() => complimentaryEndsAt(start, 'PERMANENT', clone())).toThrow();
    expect(complimentaryEndsAt(start, 'PERMANENT', clone(), true)).toBeNull();
    expect(() => complimentaryEndsAt(start, 366, clone())).toThrow();
  });

  it('clamps month-end renewals in UTC and denies unapproved institutional membership', () => {
    expect(
      subscriptionEndsAt(new Date('2027-01-31T12:00:00.000Z'), 'monthly', clone()).toISOString(),
    ).toBe('2027-02-28T12:00:00.000Z');
    const settings = clone();
    settings.institutional.benefitsEnabled = true;
    const input = {
      organizationApproved: true,
      domainVerified: true,
      memberVerified: true,
      kind: 'STUDENT' as const,
      verifiedAt: new Date('2026-10-01T00:00:00.000Z'),
      agreementEndsAt: new Date('2026-11-01T00:00:00.000Z'),
      membershipStartsAt: new Date('2026-10-01T00:00:00.000Z'),
      membershipEndsAt: new Date('2026-10-30T00:00:00.000Z'),
      memberCount: 10,
      approvedMemberLimit: 10,
      now: new Date('2026-10-15T00:00:00.000Z'),
    };
    expect(institutionMembershipEligible(settings, input)).toBe(true);
    expect(institutionMembershipEligible(settings, { ...input, domainVerified: false })).toBe(
      false,
    );
    expect(institutionMembershipEligible(settings, { ...input, now: input.membershipEndsAt })).toBe(
      false,
    );
    expect(institutionMembershipEligible(settings, { ...input, memberCount: 11 })).toBe(false);
    expect(institutionMembershipEligible(settings, { ...input, agreementEndsAt: null })).toBe(
      false,
    );
    expect(institutionMembershipEligible(clone(), input)).toBe(false);
  });

  it('uses platform defaults below a publication override', () => {
    const path = { publicationId: 'publication' };
    const row = {
      id: 'policy',
      version: 1,
      isActive: true,
      approvedAt: new Date(),
      publicationId: 'publication',
      allowCopy: true,
      allowRead: true,
      accessClass: 'PUBLIC_FREE',
    } as ContentPolicyRow;
    const effective = resolveContentPolicy(path, [row], { allowCopy: false, allowPrint: true });
    expect(effective.allowCopy).toBe(true);
    expect(effective.allowPrint).toBe(true);
    expect(effective.allowRead).toBe(true);
  });

  it('guards trial reuse and independent research publication', () => {
    const settings = clone();
    settings.subscriptions.trialEnabled = true;
    expect(
      trialEligible(settings, { emailVerified: true, priorTrialCount: 0, accountActive: true }),
    ).toBe(true);
    expect(
      trialEligible(settings, { emailVerified: true, priorTrialCount: 1, accountActive: true }),
    ).toBe(false);
    expect(
      trialEligible(settings, { emailVerified: false, priorTrialCount: 0, accountActive: true }),
    ).toBe(false);
    const at = new Date('2026-10-01T00:00:00.000Z');
    expect(researchEventWindow(settings, at, new Date(at.getTime() + 180_000))).toBe('IDLE');
    expect(researchEventWindow(settings, at, new Date(at.getTime() + 1_800_000))).toBe(
      'NEW_SESSION',
    );
    const release = {
      distinctSubjects: 30,
      participantConsentReviewed: true,
      privacyApproved: true,
      snapshotApproved: true,
    };
    expect(mayPublishResearchAggregate(settings, release)).toBe(false);
    settings.research.publicPublicationEnabled = true;
    expect(mayPublishResearchAggregate(settings, release)).toBe(true);
    expect(mayPublishResearchAggregate(settings, { ...release, distinctSubjects: 29 })).toBe(false);
  });
});
