import { describe, expect, it } from 'vitest';
import { distantCountdown } from './distantCountdown.js';

describe('distant countdown', () => {
  it('counts calendar years and months without inventing a day for a monthly deadline', () => {
    expect(distantCountdown('2028-05-01', '2026-10-12', 'month')).toBe('za 1 rok i 7 mies.');
    expect(distantCountdown('2028-05-01', '2028-05-20', 'month')).toBe('w tym miesiącu');
  });
  it('handles today, tomorrow and month-end dates', () => {
    expect(distantCountdown('2026-10-12', '2026-10-12', 'day')).toBe('dzisiaj');
    expect(distantCountdown('2026-10-13', '2026-10-12', 'day')).toBe('za 1 dzień');
    expect(distantCountdown('2027-02-28', '2027-01-31', 'day')).toBe('za 28 dni');
  });
});
