export type AccessClass = 'PUBLIC_FREE' | 'REGISTERED_FREE' | 'PREMIUM' | 'RESTRICTED';
export type ScreenshotMode = 'ALLOW' | 'WATERMARK' | 'RESTRICTED_NOTICE';
export type PolicyScope =
  | 'libraryId'
  | 'publicationId'
  | 'volumeId'
  | 'editionId'
  | 'revisionId'
  | 'chapterId'
  | 'lessonId'
  | 'resourceId';

export const policyScopeOrder: readonly PolicyScope[] = [
  'libraryId',
  'publicationId',
  'volumeId',
  'editionId',
  'revisionId',
  'chapterId',
  'lessonId',
  'resourceId',
];

export interface ContentPolicyRow {
  id: string;
  version: number;
  isActive: boolean;
  approvedAt: Date | string | null;
  accessClass: AccessClass | null;
  allowRead: boolean | null;
  allowPreview: boolean | null;
  allowSelect: boolean | null;
  allowCopy: boolean | null;
  maxCopyChars: number | null;
  allowPrint: boolean | null;
  allowDownload: boolean | null;
  allowExportPdf: boolean | null;
  allowExportEpub: boolean | null;
  allowOffline: boolean | null;
  allowShare: boolean | null;
  watermark: boolean | null;
  watermarkLabel: string | null;
  screenshotMode: ScreenshotMode | null;
  maxConcurrentSessions: number | null;
  licenceEndsAt: Date | string | null;
  libraryId?: string | null;
  publicationId?: string | null;
  volumeId?: string | null;
  editionId?: string | null;
  revisionId?: string | null;
  chapterId?: string | null;
  lessonId?: string | null;
  resourceId?: string | null;
}

export type PolicyPath = Partial<Record<PolicyScope, string>>;
export interface EffectiveContentPolicy {
  accessClass: AccessClass;
  allowRead: boolean;
  allowPreview: boolean;
  allowSelect: boolean;
  allowCopy: boolean;
  maxCopyChars: number;
  allowPrint: boolean;
  allowDownload: boolean;
  allowExportPdf: boolean;
  allowExportEpub: boolean;
  allowOffline: boolean;
  allowShare: boolean;
  watermark: boolean;
  watermarkLabel: string | null;
  screenshotMode: ScreenshotMode;
  maxConcurrentSessions: number | null;
  sessionLimits: { policyId: string; maxSessions: number }[];
  licenceEndsAt: string | null;
  sources: { scope: PolicyScope; id: string; version: number }[];
}

const defaults: EffectiveContentPolicy = {
  accessClass: 'RESTRICTED',
  allowRead: false,
  allowPreview: false,
  allowSelect: false,
  allowCopy: false,
  maxCopyChars: 0,
  allowPrint: false,
  allowDownload: false,
  allowExportPdf: false,
  allowExportEpub: false,
  allowOffline: false,
  allowShare: false,
  watermark: false,
  watermarkLabel: null,
  screenshotMode: 'RESTRICTED_NOTICE',
  maxConcurrentSessions: null,
  sessionLimits: [],
  licenceEndsAt: null,
  sources: [],
};

const overrideFields = [
  'accessClass',
  'allowRead',
  'allowPreview',
  'allowSelect',
  'allowCopy',
  'maxCopyChars',
  'allowPrint',
  'allowDownload',
  'allowExportPdf',
  'allowExportEpub',
  'allowOffline',
  'allowShare',
  'watermark',
  'watermarkLabel',
  'screenshotMode',
] as const;

export function resolveContentPolicy(
  path: PolicyPath,
  rows: readonly ContentPolicyRow[],
  platformDefaults: Partial<EffectiveContentPolicy> = {},
): EffectiveContentPolicy {
  const result: EffectiveContentPolicy = {
    ...defaults,
    ...platformDefaults,
    sources: [],
    sessionLimits: [],
  };
  let explicitReadDeny = false;
  for (const scope of policyScopeOrder) {
    const id = path[scope];
    if (!id) continue;
    const candidates = rows.filter((row) => row.isActive && row.approvedAt && row[scope] === id);
    if (candidates.length > 1) throw new Error(`Conflicting active ${scope} policies`);
    const row = candidates[0];
    if (!row) continue;
    result.sources.push({ scope, id: row.id, version: row.version });
    for (const field of overrideFields) {
      if (row[field] !== null && row[field] !== undefined) {
        // Every null inherits; explicit false remains a deliberate override.
        (result as unknown as Record<string, unknown>)[field] = row[field];
      }
    }
    if (row.allowRead === false) explicitReadDeny = true;
    if (row.maxConcurrentSessions !== null) {
      result.sessionLimits.push({ policyId: row.id, maxSessions: row.maxConcurrentSessions });
      result.maxConcurrentSessions =
        result.maxConcurrentSessions === null
          ? row.maxConcurrentSessions
          : Math.min(result.maxConcurrentSessions, row.maxConcurrentSessions);
    }
    if (row.licenceEndsAt) {
      const instant = new Date(row.licenceEndsAt).toISOString();
      if (!result.licenceEndsAt || instant < result.licenceEndsAt) result.licenceEndsAt = instant;
    }
  }
  if (explicitReadDeny) result.allowRead = false;
  if (!result.allowCopy) result.maxCopyChars = 0;
  if (result.screenshotMode === 'WATERMARK') result.watermark = true;
  return result;
}

export type ReaderAction =
  | 'read'
  | 'preview'
  | 'select'
  | 'copy'
  | 'print'
  | 'download'
  | 'exportPdf'
  | 'exportEpub'
  | 'offline'
  | 'share';

export function mayUseContent(
  policy: EffectiveContentPolicy,
  action: ReaderAction,
  subject: { authenticated: boolean; entitled: boolean; now?: Date },
): boolean {
  if (!policy.allowRead) return false;
  if (policy.licenceEndsAt && new Date(policy.licenceEndsAt) <= (subject.now ?? new Date()))
    return false;
  if (action === 'preview' && policy.allowPreview) return true;
  const audience =
    policy.accessClass === 'PUBLIC_FREE' ||
    (policy.accessClass === 'REGISTERED_FREE' && subject.authenticated) ||
    (policy.accessClass === 'PREMIUM' && subject.authenticated && subject.entitled);
  if (!audience) return false;
  const field = {
    read: 'allowRead',
    preview: 'allowPreview',
    select: 'allowSelect',
    copy: 'allowCopy',
    print: 'allowPrint',
    download: 'allowDownload',
    exportPdf: 'allowExportPdf',
    exportEpub: 'allowExportEpub',
    offline: 'allowOffline',
    share: 'allowShare',
  } as const;
  return policy[field[action]];
}
