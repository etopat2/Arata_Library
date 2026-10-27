import { describe, expect, it } from 'vitest';
import { invoiceCsvCell } from '../../apps/api/src/billing/billing.controller.js';

describe('invoice CSV safety', () => {
  it('quotes fields and neutralizes spreadsheet formulas in plan names', () => {
    expect(invoiceCsvCell('=HYPERLINK("https://example.invalid")')).toBe(
      '"\'=HYPERLINK(""https://example.invalid"")"',
    );
    expect(invoiceCsvCell('Quarterly, Library')).toBe('"Quarterly, Library"');
    expect(invoiceCsvCell('  @SUM(1,2)')).toBe('"\'  @SUM(1,2)"');
  });
});
