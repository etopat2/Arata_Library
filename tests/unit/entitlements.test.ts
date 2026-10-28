import { describe, expect, it } from 'vitest';
import { resolveEffectiveEntitlement, type EntitlementFact } from '@arata/access-policy';

const now = new Date('2026-10-27T12:00:00.000Z');
const fact = (overrides: Partial<EntitlementFact> = {}): EntitlementFact => ({
  id: 'paid',
  source: 'PAID',
  status: 'ACTIVE',
  scope: 'LIBRARY',
  startsAt: new Date('2026-10-26T00:00:00.000Z'),
  endsAt: new Date('2026-10-28T00:00:00.000Z'),
  sourceValid: true,
  ...overrides,
});

describe('independent effective entitlements', () => {
  it('retains access from a second valid source after one expires or is revoked', () => {
    const facts = [
      fact({ id: 'expired', endsAt: now }),
      fact({ id: 'revoked', status: 'REVOKED', revokedAt: now }),
      fact({ id: 'institution', source: 'INSTITUTION' }),
    ];
    expect(resolveEffectiveEntitlement(facts, {}, now).matched.map((item) => item.id)).toEqual([
      'institution',
    ]);
  });
  it('keeps paid access when institutional eligibility is suspended or expires', () => {
    const paid = fact({ id: 'paid-subscription', source: 'PAID' });
    const institution = fact({ id: 'school-benefit', source: 'INSTITUTION' });
    for (const unavailable of [
      { ...institution, status: 'SUSPENDED' as const },
      { ...institution, endsAt: now },
      { ...institution, sourceValid: false },
    ]) {
      expect(
        resolveEffectiveEntitlement([paid, unavailable], {}, now).matched.map((x) => x.id),
      ).toEqual(['paid-subscription']);
    }
  });
  it('rejects future, suspended and invalid source records', () => {
    const facts = [
      fact({ startsAt: new Date('2026-10-28T00:00:00.000Z') }),
      fact({ status: 'SUSPENDED' }),
      fact({ sourceValid: false }),
    ];
    expect(resolveEffectiveEntitlement(facts, {}, now)).toMatchObject({
      allowed: false,
      reason: 'NO_MATCH',
    });
  });
  it('honours collection, publication, volume, edition and resource boundaries', () => {
    const cases: {
      scope: EntitlementFact['scope'];
      key: keyof EntitlementFact;
      target: Parameters<typeof resolveEffectiveEntitlement>[1];
    }[] = [
      { scope: 'COLLECTION', key: 'collectionId', target: { collectionIds: ['one'] } },
      { scope: 'PUBLICATION', key: 'publicationId', target: { publicationId: 'one' } },
      { scope: 'VOLUME', key: 'volumeId', target: { volumeId: 'one' } },
      { scope: 'EDITION', key: 'editionId', target: { editionId: 'one' } },
      { scope: 'RESOURCE', key: 'resourceId', target: { resourceId: 'one' } },
    ];
    for (const item of cases) {
      const record = fact({ scope: item.scope, [item.key]: 'one' });
      expect(resolveEffectiveEntitlement([record], item.target, now).allowed).toBe(true);
      expect(resolveEffectiveEntitlement([record], {}, now).allowed).toBe(false);
    }
  });
  it('uses an exclusive end time and rejects invalid evaluation time', () => {
    expect(resolveEffectiveEntitlement([fact({ endsAt: now })], {}, now).allowed).toBe(false);
    expect(() => resolveEffectiveEntitlement([], {}, new Date('invalid'))).toThrow();
  });
});
