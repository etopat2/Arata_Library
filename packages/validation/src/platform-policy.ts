import { z } from 'zod';

const days = z.number().int().min(0).max(3650);
const positiveDays = days.min(1);
const plan = z.strictObject({
  months: z.number().int().min(1).max(12),
  priceMinor: z.number().int().nonnegative().max(1_000_000_000).nullable(),
  enabled: z.boolean(),
  allowedAccessClasses: z.array(z.enum(['PUBLIC_FREE', 'REGISTERED_FREE', 'PREMIUM'])).min(1),
});

export const platformSettingsSchema = z
  .strictObject({
    subscriptions: z.strictObject({
      currency: z.string().regex(/^[A-Z]{3}$/),
      plans: z.strictObject({ monthly: plan, quarterly: plan, annual: plan }),
      trialDays: days,
      trialEnabled: z.boolean(),
      trialOncePerVerifiedPerson: z.boolean(),
      reminderDaysBeforeExpiry: z.array(days).max(5),
      graceDays: days.max(30),
      automaticRenewalEnabled: z.boolean(),
      cancellationAtPeriodEnd: z.boolean(),
      refundWindowDays: days.max(90),
      refundsRequireFinanceApproval: z.boolean(),
      disputeFreezesPaymentEntitlement: z.boolean(),
    }),
    complimentary: z.strictObject({
      allowedDays: z.array(positiveDays).min(1).max(12),
      maxCustomDays: positiveDays,
      permanentRequiresDualApproval: z.boolean(),
      reasonRequired: z.boolean(),
      bulkLimit: z.number().int().min(1).max(1000),
      expiryNoticeDays: days.max(30),
      allowedScopes: z
        .array(z.enum(['LIBRARY', 'COLLECTION', 'PUBLICATION', 'VOLUME', 'EDITION']))
        .min(1),
    }),
    institutional: z.strictObject({
      benefitsEnabled: z.boolean(),
      centralApprovalRequired: z.boolean(),
      domainMethods: z
        .array(z.enum(['DNS_TXT', 'HTTPS_TOKEN', 'MANUAL_EVIDENCE', 'VERIFIED_EMAIL']))
        .min(1),
      studentValidityDays: positiveDays,
      staffValidityDays: positiveDays,
      reverifyDays: positiveDays,
      cohortValidityDays: positiveDays,
      defaultMemberLimit: z.number().int().positive().max(100_000).nullable(),
      manualEvidenceRequiresIndependentReviewer: z.boolean(),
      staffExemptionRequiresApproval: z.boolean(),
    }),
    reader: z.strictObject({
      defaultCopy: z.boolean(),
      defaultPrint: z.boolean(),
      defaultDownload: z.boolean(),
      defaultExport: z.boolean(),
      defaultOffline: z.boolean(),
      offlineLicenceDays: positiveDays.max(90),
      maxLicensedDevices: z.number().int().min(1).max(20),
      previewMaxChapters: z.number().int().min(0).max(20),
      watermarkEnabled: z.boolean(),
      watermarkUsesPseudonym: z.boolean(),
      screenshotNoticeEnabled: z.boolean(),
      forthcomingVisible: z.boolean(),
      archivedAvailableToExistingEntitlements: z.boolean(),
    }),
    research: z.strictObject({
      collectionEnabled: z.boolean(),
      consentRequired: z.boolean(),
      idleSeconds: z.number().int().min(60).max(3600),
      sessionGapSeconds: z.number().int().min(300).max(86_400),
      heartbeatSeconds: z.number().int().min(10).max(300),
      eventRetentionDays: positiveDays,
      sessionRetentionDays: positiveDays,
      aggregateRetentionDays: positiveDays,
      publicMinimumSubjects: z.number().int().min(10).max(10_000),
      publicPublicationEnabled: z.boolean(),
      independentPrivacyApprovalRequired: z.boolean(),
    }),
    security: z.strictObject({
      sessionHours: z.number().int().min(1).max(168),
      administratorMfaRequired: z.boolean(),
      recoveryTokenMinutes: z.number().int().min(5).max(120),
      uploadMaxBytes: z.number().int().min(1024).max(2_000_000_000),
      uploadMimeTypes: z
        .array(
          z.enum([
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/epub+zip',
            'application/zip',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'text/markdown',
            'text/plain',
            'image/png',
            'image/jpeg',
            'image/webp',
            'audio/mpeg',
            'video/mp4',
          ]),
        )
        .min(1),
      loginAttemptsPerWindow: z.number().int().min(1).max(50),
      loginRequestsPerWindow: z.number().int().min(1).max(200).default(20),
      loginWindowMinutes: z.number().int().min(1).max(120),
      lockoutMinutes: z.number().int().min(1).max(1440),
      auditRetentionDays: positiveDays,
      backupIntervalHours: z.number().int().min(1).max(168),
      restoreDrillIntervalDays: positiveDays,
      recoveryPointHours: z.number().int().positive().nullable(),
      recoveryTimeHours: z.number().int().positive().nullable(),
    }),
  })
  .superRefine((value, ctx) => {
    if (value.research.heartbeatSeconds >= value.research.idleSeconds)
      ctx.addIssue({
        code: 'custom',
        path: ['research', 'heartbeatSeconds'],
        message: 'Heartbeat must be shorter than idle threshold',
      });
    if (value.research.idleSeconds >= value.research.sessionGapSeconds)
      ctx.addIssue({
        code: 'custom',
        path: ['research', 'sessionGapSeconds'],
        message: 'Session gap must exceed idle threshold',
      });
    if (value.subscriptions.trialEnabled && value.subscriptions.trialDays === 0)
      ctx.addIssue({
        code: 'custom',
        path: ['subscriptions', 'trialDays'],
        message: 'Enabled trials require a positive duration',
      });
    if (
      Object.values(value.subscriptions.plans).some(
        (item) => item.enabled && (item.priceMinor === null || item.priceMinor === 0),
      )
    )
      ctx.addIssue({
        code: 'custom',
        path: ['subscriptions', 'plans'],
        message: 'Enabled plans require approved prices',
      });
    if (value.subscriptions.automaticRenewalEnabled)
      ctx.addIssue({
        code: 'custom',
        path: ['subscriptions', 'automaticRenewalEnabled'],
        message: 'Recurring gateway capability is not verified',
      });
    if (!value.institutional.domainMethods.some((method) => method !== 'VERIFIED_EMAIL'))
      ctx.addIssue({
        code: 'custom',
        path: ['institutional', 'domainMethods'],
        message: 'Verified email alone cannot prove institution domain ownership',
      });
    for (const [path, enabled] of [
      [['security', 'administratorMfaRequired'], value.security.administratorMfaRequired],
      [
        ['complimentary', 'permanentRequiresDualApproval'],
        value.complimentary.permanentRequiresDualApproval,
      ],
      [
        ['subscriptions', 'refundsRequireFinanceApproval'],
        value.subscriptions.refundsRequireFinanceApproval,
      ],
      [['institutional', 'centralApprovalRequired'], value.institutional.centralApprovalRequired],
      [
        ['institutional', 'manualEvidenceRequiresIndependentReviewer'],
        value.institutional.manualEvidenceRequiresIndependentReviewer,
      ],
      [
        ['research', 'independentPrivacyApprovalRequired'],
        value.research.independentPrivacyApprovalRequired,
      ],
    ] as const)
      if (!enabled)
        ctx.addIssue({
          code: 'custom',
          path: [...path],
          message: 'This SRS safety control cannot be disabled',
        });
  });

export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

/** Conservative proposal. Commercial, legal and research release gates stay closed. */
export const initialPlatformSettings: PlatformSettings = platformSettingsSchema.parse({
  subscriptions: {
    currency: 'UGX',
    plans: {
      monthly: {
        months: 1,
        priceMinor: null,
        enabled: false,
        allowedAccessClasses: ['PUBLIC_FREE', 'REGISTERED_FREE', 'PREMIUM'],
      },
      quarterly: {
        months: 3,
        priceMinor: null,
        enabled: false,
        allowedAccessClasses: ['PUBLIC_FREE', 'REGISTERED_FREE', 'PREMIUM'],
      },
      annual: {
        months: 12,
        priceMinor: null,
        enabled: false,
        allowedAccessClasses: ['PUBLIC_FREE', 'REGISTERED_FREE', 'PREMIUM'],
      },
    },
    trialDays: 7,
    trialEnabled: false,
    trialOncePerVerifiedPerson: true,
    reminderDaysBeforeExpiry: [7, 1],
    graceDays: 0,
    automaticRenewalEnabled: false,
    cancellationAtPeriodEnd: true,
    refundWindowDays: 7,
    refundsRequireFinanceApproval: true,
    disputeFreezesPaymentEntitlement: true,
  },
  complimentary: {
    allowedDays: [1, 7, 14, 30, 90, 365],
    maxCustomDays: 365,
    permanentRequiresDualApproval: true,
    reasonRequired: true,
    bulkLimit: 100,
    expiryNoticeDays: 7,
    allowedScopes: ['LIBRARY', 'COLLECTION', 'PUBLICATION', 'VOLUME', 'EDITION'],
  },
  institutional: {
    benefitsEnabled: false,
    centralApprovalRequired: true,
    domainMethods: ['DNS_TXT', 'HTTPS_TOKEN', 'MANUAL_EVIDENCE'],
    studentValidityDays: 90,
    staffValidityDays: 180,
    reverifyDays: 90,
    cohortValidityDays: 90,
    defaultMemberLimit: null,
    manualEvidenceRequiresIndependentReviewer: true,
    staffExemptionRequiresApproval: true,
  },
  reader: {
    defaultCopy: false,
    defaultPrint: false,
    defaultDownload: false,
    defaultExport: false,
    defaultOffline: false,
    offlineLicenceDays: 7,
    maxLicensedDevices: 2,
    previewMaxChapters: 1,
    watermarkEnabled: true,
    watermarkUsesPseudonym: true,
    screenshotNoticeEnabled: true,
    forthcomingVisible: true,
    archivedAvailableToExistingEntitlements: false,
  },
  research: {
    collectionEnabled: false,
    consentRequired: true,
    idleSeconds: 180,
    sessionGapSeconds: 1800,
    heartbeatSeconds: 30,
    eventRetentionDays: 90,
    sessionRetentionDays: 365,
    aggregateRetentionDays: 730,
    publicMinimumSubjects: 30,
    publicPublicationEnabled: false,
    independentPrivacyApprovalRequired: true,
  },
  security: {
    sessionHours: 12,
    administratorMfaRequired: true,
    recoveryTokenMinutes: 30,
    uploadMaxBytes: 52_428_800,
    uploadMimeTypes: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/epub+zip',
      'application/zip',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/markdown',
      'text/plain',
      'image/png',
      'image/jpeg',
      'image/webp',
      'audio/mpeg',
      'video/mp4',
    ],
    loginAttemptsPerWindow: 5,
    loginRequestsPerWindow: 20,
    loginWindowMinutes: 15,
    lockoutMinutes: 15,
    auditRetentionDays: 365,
    backupIntervalHours: 24,
    restoreDrillIntervalDays: 90,
    recoveryPointHours: null,
    recoveryTimeHours: null,
  },
});

export function comparePlatformSettings(before: PlatformSettings, after: PlatformSettings) {
  const changes: { path: string; before: unknown; after: unknown }[] = [];
  const visit = (a: unknown, b: unknown, path: string) => {
    if (
      a &&
      b &&
      typeof a === 'object' &&
      typeof b === 'object' &&
      !Array.isArray(a) &&
      !Array.isArray(b)
    ) {
      for (const key of Object.keys(b))
        visit(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
          path ? `${path}.${key}` : key,
        );
    } else if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ path, before: a, after: b });
  };
  visit(before, after, '');
  return changes;
}

export function previewPlatformSettings(before: PlatformSettings, after: PlatformSettings) {
  const changes = comparePlatformSettings(before, after);
  const sensitive = changes.some(
    ({ path }) =>
      /^(subscriptions|complimentary|institutional|research|security)\./.test(path) ||
      /^(reader\.default|reader\.offline|reader\.maxLicensed)/.test(path),
  );
  const affected = [...new Set(changes.map(({ path }) => path.split('.')[0]))];
  return {
    changes,
    affected,
    sensitive,
    requiresIndependentApproval: sensitive,
    warnings: [
      ...(after.subscriptions.plans.monthly.enabled ||
      after.subscriptions.plans.quarterly.enabled ||
      after.subscriptions.plans.annual.enabled
        ? [
            'Verify approved prices, tax treatment, disclosure and payment provider before checkout.',
          ]
        : []),
      ...(after.institutional.benefitsEnabled
        ? ['Institution agreements, domain proof and capacity require separate approval.']
        : []),
      ...(after.research.collectionEnabled || after.research.publicPublicationEnabled
        ? ['Privacy lawful basis and disclosure review remain separate release gates.']
        : []),
    ],
  };
}

/** Calendar-month arithmetic in UTC; end-of-month starts clamp to the last day. */
export function subscriptionEndsAt(
  start: Date,
  plan: keyof PlatformSettings['subscriptions']['plans'],
  settings: PlatformSettings,
): Date {
  if (!Number.isFinite(start.getTime())) throw new Error('Invalid subscription start');
  const months = settings.subscriptions.plans[plan].months;
  const first = new Date(
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
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  first.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  return first;
}

export function complimentaryEndsAt(
  start: Date,
  daysRequested: number | 'PERMANENT',
  settings: PlatformSettings,
  independentApproval = false,
): Date | null {
  if (!Number.isFinite(start.getTime())) throw new Error('Invalid grant start');
  if (daysRequested === 'PERMANENT') {
    if (settings.complimentary.permanentRequiresDualApproval && !independentApproval)
      throw new Error('Independent permanent-grant approval required');
    return null;
  }
  if (
    !Number.isInteger(daysRequested) ||
    daysRequested < 1 ||
    daysRequested > settings.complimentary.maxCustomDays
  )
    throw new Error('Grant duration outside policy');
  return new Date(start.getTime() + daysRequested * 86_400_000);
}

export function accessIsCurrent(startsAt: Date, endsAt: Date | null, now: Date): boolean {
  return (
    Number.isFinite(startsAt.getTime()) &&
    Number.isFinite(now.getTime()) &&
    startsAt <= now &&
    (endsAt === null || (Number.isFinite(endsAt.getTime()) && now < endsAt))
  );
}

export function institutionMembershipEligible(
  settings: PlatformSettings,
  input: {
    organizationApproved: boolean;
    domainVerified: boolean;
    memberVerified: boolean;
    kind: 'STUDENT' | 'STAFF' | 'COHORT';
    verifiedAt: Date;
    agreementEndsAt: Date | null;
    membershipStartsAt: Date;
    membershipEndsAt: Date;
    memberCount: number;
    approvedMemberLimit: number | null;
    now: Date;
  },
): boolean {
  if (
    !settings.institutional.benefitsEnabled ||
    !input.organizationApproved ||
    !input.domainVerified ||
    !input.memberVerified
  )
    return false;
  const limit = input.approvedMemberLimit ?? settings.institutional.defaultMemberLimit;
  if (limit === null || input.memberCount > limit || input.agreementEndsAt === null) return false;
  const validity =
    input.kind === 'STUDENT'
      ? settings.institutional.studentValidityDays
      : input.kind === 'STAFF'
        ? settings.institutional.staffValidityDays
        : settings.institutional.cohortValidityDays;
  const policyEnd = new Date(input.membershipStartsAt.getTime() + validity * 86_400_000);
  const reverifyEnd = new Date(
    input.verifiedAt.getTime() + settings.institutional.reverifyDays * 86_400_000,
  );
  return (
    accessIsCurrent(input.membershipStartsAt, input.membershipEndsAt, input.now) &&
    input.now < policyEnd &&
    input.now < reverifyEnd &&
    input.now < input.agreementEndsAt
  );
}

export function trialEligible(
  settings: PlatformSettings,
  input: { emailVerified: boolean; priorTrialCount: number; accountActive: boolean },
): boolean {
  return (
    settings.subscriptions.trialEnabled &&
    settings.subscriptions.trialDays > 0 &&
    input.accountActive &&
    input.emailVerified &&
    input.priorTrialCount >= 0 &&
    (!settings.subscriptions.trialOncePerVerifiedPerson || input.priorTrialCount === 0)
  );
}

export function researchEventWindow(
  settings: PlatformSettings,
  lastActivity: Date,
  now: Date,
): 'ACTIVE' | 'IDLE' | 'NEW_SESSION' {
  const elapsed = (now.getTime() - lastActivity.getTime()) / 1000;
  if (!Number.isFinite(elapsed) || elapsed < 0)
    throw new Error('Invalid research event timestamps');
  if (elapsed >= settings.research.sessionGapSeconds) return 'NEW_SESSION';
  if (elapsed >= settings.research.idleSeconds) return 'IDLE';
  return 'ACTIVE';
}

export function mayPublishResearchAggregate(
  settings: PlatformSettings,
  input: {
    distinctSubjects: number;
    participantConsentReviewed: boolean;
    privacyApproved: boolean;
    snapshotApproved: boolean;
  },
): boolean {
  return (
    settings.research.publicPublicationEnabled &&
    input.distinctSubjects >= settings.research.publicMinimumSubjects &&
    input.participantConsentReviewed &&
    input.privacyApproved &&
    input.snapshotApproved
  );
}
