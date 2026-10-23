import { describe, expect, it } from 'vitest';
import { mayAccess } from './index.js';

describe('foundation policy', () => {
  it('allows public liveness and denies anonymous readiness', () => {
    expect(mayAccess({ kind: 'anonymous' }, 'health.live')).toBe(true);
    expect(mayAccess({ kind: 'anonymous' }, 'health.ready')).toBe(false);
    expect(mayAccess({ kind: 'service' }, 'health.ready')).toBe(true);
  });
});
