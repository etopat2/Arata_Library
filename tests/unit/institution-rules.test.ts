import { describe, expect, it } from 'vitest';
import {
  canonicalDomain,
  emailDomain,
  membershipDays,
  parseRosterCsv,
} from '../../apps/api/src/institutions/rules.js';

describe('institution boundaries', () => {
  it('uses canonical exact domains and rejects suffix forgery and wildcards', () => {
    expect(canonicalDomain('University.Example')).toBe('university.example');
    expect(emailDomain('reader@university.example')).toBe('university.example');
    expect(emailDomain('reader@university.example.attacker.invalid')).not.toBe(
      'university.example',
    );
    for (const value of [
      '*.university.example',
      'university.example.',
      '127.0.0.1',
      'localhost',
      'uni versity.example',
    ])
      expect(() => canonicalDomain(value)).toThrow();
  });
  it('caps membership at the shortest approved platform and institution period', () => {
    const settings = {
      studentValidityDays: 180,
      staffValidityDays: 365,
      cohortValidityDays: 90,
      reverifyDays: 60,
    };
    expect(membershipDays('STUDENT', 120, settings)).toBe(60);
    expect(membershipDays('SPONSORED_COHORT', 30, settings)).toBe(30);
  });
  it('parses a controlled roster and rejects duplicate, malformed and oversize input', () => {
    expect(
      parseRosterCsv('email,category,action\n"a@university.example",STUDENT,UPSERT\n'),
    ).toEqual([{ row: 2, email: 'a@university.example', category: 'STUDENT', action: 'UPSERT' }]);
    expect(() =>
      parseRosterCsv(
        'email,category,action\na@u.example,STUDENT,UPSERT\na@u.example,STUDENT,UPSERT',
      ),
    ).toThrow(/duplicate/);
    expect(() => parseRosterCsv('email,category,action\n"a@u.example,STUDENT,UPSERT')).toThrow(
      /quote/,
    );
    expect(() => parseRosterCsv('x'.repeat(1_000_001))).toThrow(/1 MB/);
  });
});
