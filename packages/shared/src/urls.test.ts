import { describe, expect, it } from 'vitest';
import { eventUrl } from './urls.js';

describe('eventUrl', () => {
  it('builds the common details address with an optional occurrence date', () => {
    expect(eventUrl('abc')).toBe('/kalendarz/wydarzenie/abc');
    expect(eventUrl('abc', '2026-10-12')).toBe('/kalendarz/wydarzenie/abc?data=2026-10-12');
    expect(eventUrl('a/b')).toBe('/kalendarz/wydarzenie/a%2Fb');
  });
});
