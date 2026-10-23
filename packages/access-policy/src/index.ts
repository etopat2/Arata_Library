export type Action = 'health.live' | 'health.ready';
export interface Principal {
  kind: 'anonymous' | 'service';
}
/** Explicit allowlist; future domain operations must add a reviewed policy here. */
export function mayAccess(principal: Principal, action: Action): boolean {
  if (action === 'health.live') return true;
  if (action === 'health.ready') return principal.kind === 'service';
  return false;
}
