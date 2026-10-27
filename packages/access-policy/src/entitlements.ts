export type EntitlementScope =
  'LIBRARY' | 'COLLECTION' | 'PUBLICATION' | 'VOLUME' | 'EDITION' | 'RESOURCE';
export type EntitlementSource =
  'PAID' | 'TRIAL' | 'INSTITUTION' | 'COMPLIMENTARY' | 'SPONSORED' | 'PROMOTION';

export interface EntitlementTarget {
  collectionIds?: readonly string[];
  publicationId?: string;
  volumeId?: string;
  editionId?: string;
  resourceId?: string;
}

export interface EntitlementFact {
  id: string;
  source: EntitlementSource;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  scope: EntitlementScope;
  collectionId?: string | null;
  publicationId?: string | null;
  volumeId?: string | null;
  editionId?: string | null;
  resourceId?: string | null;
  startsAt: Date;
  endsAt: Date | null;
  revokedAt?: Date | null;
  /** Derived on the server from the source record, never accepted from a client. */
  sourceValid: boolean;
}

export interface EffectiveEntitlement {
  allowed: boolean;
  matched: readonly Pick<EntitlementFact, 'id' | 'source' | 'scope' | 'endsAt'>[];
  reason: 'MATCH' | 'NO_MATCH';
}

/** Independent valid sources form a union; expiry or revocation never vetoes another grant. */
export function resolveEffectiveEntitlement(
  facts: readonly EntitlementFact[],
  target: EntitlementTarget,
  now: Date,
): EffectiveEntitlement {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid evaluation time');
  const matched = facts
    .filter(
      (fact) =>
        fact.status === 'ACTIVE' &&
        fact.sourceValid &&
        !fact.revokedAt &&
        Number.isFinite(fact.startsAt.getTime()) &&
        fact.startsAt <= now &&
        (fact.endsAt === null || (Number.isFinite(fact.endsAt.getTime()) && now < fact.endsAt)) &&
        (fact.scope === 'LIBRARY' ||
          (fact.scope === 'COLLECTION' &&
            !!fact.collectionId &&
            target.collectionIds?.includes(fact.collectionId)) ||
          (fact.scope === 'PUBLICATION' &&
            !!fact.publicationId &&
            fact.publicationId === target.publicationId) ||
          (fact.scope === 'VOLUME' && !!fact.volumeId && fact.volumeId === target.volumeId) ||
          (fact.scope === 'EDITION' && !!fact.editionId && fact.editionId === target.editionId) ||
          (fact.scope === 'RESOURCE' &&
            !!fact.resourceId &&
            fact.resourceId === target.resourceId)),
    )
    .map(({ id, source, scope, endsAt }) => ({ id, source, scope, endsAt }));
  return {
    allowed: matched.length > 0,
    matched,
    reason: matched.length > 0 ? 'MATCH' : 'NO_MATCH',
  };
}
