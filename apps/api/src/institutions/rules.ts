import { domainToASCII } from 'node:url';
import { isIP } from 'node:net';

export const benefitCategories = [
  'STUDENT',
  'ACADEMIC_STAFF',
  'ORGANIZATION_MEMBER',
  'SCHOLARSHIP',
  'SPONSORED_COHORT',
] as const;
export type BenefitCategory = (typeof benefitCategories)[number];
export const verificationModes = ['MANUAL', 'ROSTER', 'DOMAIN_ONLY', 'SSO'] as const;
export type VerificationMode = (typeof verificationModes)[number];

/** Canonical exact-match DNS name; no suffix or wildcard matching is ever used. */
export function canonicalDomain(input: string): string {
  const value = domainToASCII(input.trim().toLowerCase());
  if (
    !value ||
    value.length > 253 ||
    value.endsWith('.') ||
    isIP(value) ||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(value) ||
    value
      .split('.')
      .some((label) => label.length > 63 || label.startsWith('-') || label.endsWith('-'))
  )
    throw new Error('Invalid institutional domain');
  return value;
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at !== email.indexOf('@')) throw new Error('Invalid email');
  return canonicalDomain(email.slice(at + 1));
}

export function membershipDays(
  category: BenefitCategory,
  policyDays: number,
  settings: {
    studentValidityDays: number;
    staffValidityDays: number;
    cohortValidityDays: number;
    reverifyDays: number;
  },
): number {
  const categoryDays =
    category === 'STUDENT' || category === 'SCHOLARSHIP'
      ? settings.studentValidityDays
      : category === 'SPONSORED_COHORT'
        ? settings.cohortValidityDays
        : settings.staffValidityDays;
  return Math.min(policyDays, categoryDays, settings.reverifyDays);
}

export type RosterRow = {
  row: number;
  email: string;
  category: BenefitCategory;
  action: 'UPSERT' | 'REVOKE';
};

/** Small RFC-4180 parser with strict header and row limits; reports never echo roster emails. */
export function parseRosterCsv(source: string): RosterRow[] {
  if (Buffer.byteLength(source, 'utf8') > 1_000_000) throw new Error('Roster exceeds 1 MB');
  const grid: string[][] = [];
  let cell = '',
    row: string[] = [],
    quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') {
      if (cell) throw new Error('Malformed CSV quote');
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.replace(/\r$/, ''));
      grid.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (row.length || cell) {
    row.push(cell.replace(/\r$/, ''));
    grid.push(row);
  }
  if (grid.length < 2 || grid.length > 501 || grid[0]?.join(',') !== 'email,category,action')
    throw new Error('Roster header or size invalid');
  const seen = new Set<string>();
  return grid.slice(1).map((cells, index) => {
    const [rawEmail, rawCategory, rawAction] = cells;
    const email = rawEmail?.trim().toLowerCase() ?? '';
    if (
      cells.length !== 3 ||
      !/^[^\s@,]+@[^\s@,]+$/.test(email) ||
      !benefitCategories.includes(rawCategory as BenefitCategory) ||
      !['UPSERT', 'REVOKE'].includes(rawAction ?? '') ||
      seen.has(email)
    )
      throw new Error(`Invalid or duplicate roster row ${index + 2}`);
    seen.add(email);
    return {
      row: index + 2,
      email,
      category: rawCategory as BenefitCategory,
      action: rawAction as 'UPSERT' | 'REVOKE',
    };
  });
}
