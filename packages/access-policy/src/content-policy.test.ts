import { describe, expect, it } from 'vitest';
import { mayUseContent, resolveContentPolicy, type ContentPolicyRow } from './content-policy.js';

const id = (value: number) => String(value).padStart(36, '0');
const base = (changes: Partial<ContentPolicyRow>): ContentPolicyRow => ({
  id: id(1),
  version: 1,
  isActive: true,
  approvedAt: new Date(),
  accessClass: null,
  allowRead: null,
  allowPreview: null,
  allowSelect: null,
  allowCopy: null,
  maxCopyChars: null,
  allowPrint: null,
  allowDownload: null,
  allowExportPdf: null,
  allowExportEpub: null,
  allowOffline: null,
  allowShare: null,
  watermark: null,
  watermarkLabel: null,
  screenshotMode: null,
  maxConcurrentSessions: null,
  licenceEndsAt: null,
  ...changes,
});

describe('effective reader policy', () => {
  it('denies every action without an approved active policy', () => {
    const policy = resolveContentPolicy({ publicationId: id(2) }, []);
    for (const action of ['read', 'copy', 'print', 'download', 'offline'] as const)
      expect(mayUseContent(policy, action, { authenticated: true, entitled: true })).toBe(false);
  });

  it('allows public free reading without a subscription but keeps actions separate', () => {
    const policy = resolveContentPolicy({ publicationId: id(2) }, [
      base({
        publicationId: id(2),
        accessClass: 'PUBLIC_FREE',
        allowRead: true,
      }),
    ]);
    expect(mayUseContent(policy, 'read', { authenticated: false, entitled: false })).toBe(true);
    expect(mayUseContent(policy, 'download', { authenticated: false, entitled: false })).toBe(
      false,
    );
    expect(mayUseContent(policy, 'copy', { authenticated: false, entitled: false })).toBe(false);
  });

  it('requires sign in and an effective grant for premium content', () => {
    const policy = resolveContentPolicy({ publicationId: id(2) }, [
      base({
        publicationId: id(2),
        accessClass: 'PREMIUM',
        allowRead: true,
      }),
    ]);
    expect(mayUseContent(policy, 'read', { authenticated: false, entitled: true })).toBe(false);
    expect(mayUseContent(policy, 'read', { authenticated: true, entitled: false })).toBe(false);
    expect(mayUseContent(policy, 'read', { authenticated: true, entitled: true })).toBe(true);
  });

  it('inherits null, applies explicit overrides, and retains an ancestor read veto', () => {
    const path = { publicationId: id(2), chapterId: id(3) };
    const rows = [
      base({
        id: id(4),
        publicationId: id(2),
        accessClass: 'PUBLIC_FREE',
        allowRead: false,
        allowCopy: true,
        maxCopyChars: 100,
      }),
      base({ id: id(5), chapterId: id(3), allowRead: true, allowCopy: false }),
    ];
    const policy = resolveContentPolicy(path, rows);
    expect(policy.allowRead).toBe(false);
    expect(policy.maxCopyChars).toBe(0);
    expect(policy.sources).toHaveLength(2);
  });

  it('uses the earliest licence expiry and strictest session cap', () => {
    const policy = resolveContentPolicy({ publicationId: id(2), editionId: id(3) }, [
      base({
        id: id(4),
        publicationId: id(2),
        allowRead: true,
        accessClass: 'PUBLIC_FREE',
        licenceEndsAt: '2027-01-01T00:00:00Z',
        maxConcurrentSessions: 3,
      }),
      base({
        id: id(5),
        editionId: id(3),
        licenceEndsAt: '2026-12-01T00:00:00Z',
        maxConcurrentSessions: 1,
      }),
    ]);
    expect(policy.maxConcurrentSessions).toBe(1);
    expect(
      mayUseContent(policy, 'read', {
        authenticated: false,
        entitled: false,
        now: new Date('2026-12-01T00:00:00Z'),
      }),
    ).toBe(false);
  });

  it('requires a separate preview flag and turns watermark mode into a watermark', () => {
    const policy = resolveContentPolicy({ chapterId: id(2) }, [
      base({
        chapterId: id(2),
        accessClass: 'PREMIUM',
        allowRead: true,
        allowPreview: true,
        screenshotMode: 'WATERMARK',
      }),
    ]);
    expect(mayUseContent(policy, 'preview', { authenticated: false, entitled: false })).toBe(true);
    expect(mayUseContent(policy, 'read', { authenticated: false, entitled: false })).toBe(false);
    expect(policy.watermark).toBe(true);
  });
});
