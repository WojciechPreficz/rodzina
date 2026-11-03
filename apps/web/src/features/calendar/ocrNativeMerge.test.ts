import { expect, it } from 'vitest';
import { parseOcrEvents, type OcrDocument } from '@rodzina/shared';
import { mergeNativeOcrPasses } from './ocrNativeMerge.js';

const document = (text: string, confidence: number, y = 0.1): OcrDocument => ({
  image: { width: 2000, height: 1415 },
  lines: [{ id: 'same-id', text, confidence, box: { x: 0.1, y, width: 0.3, height: 0.04 } }],
});
it('uses the clearer title from the contrast pass without rewriting any letters', () => {
  const first = document('AUDYCA MUZYCZNA', 70);
  const second = document('AUDYCJA MUZYCZNA', 94);
  expect(mergeNativeOcrPasses(first, second).lines.map(({ text }) => text)).toEqual(['AUDYCJA MUZYCZNA']);
  expect(mergeNativeOcrPasses(second, first).lines.map(({ text }) => text)).toEqual(['AUDYCJA MUZYCZNA']);
});
it('retains conflicting date readings instead of silently replacing 5 with 9', () => {
  const merged = mergeNativeOcrPasses(document('5.11.2026 R.', 75), document('9.11.2026 R.', 96));
  const proposal = parseOcrEvents(merged, { groupByDates: true }).proposals[0]!;
  expect(proposal.startDate).toBeNull();
  expect(proposal.dates.map(({ day }) => day)).toEqual([5, 9]);
  expect(proposal.warnings.map(({ code }) => code)).toContain('AMBIGUOUS_DATE');
});
it('adds newly recovered lines and keeps a recognized date if enhancement loses it', () => {
  const first = document('5.11.2026 R.', 80);
  const second = document('S.11.2026 R.', 95);
  expect(mergeNativeOcrPasses(first, second).lines[0]!.text).toBe('5.11.2026 R.');
  expect(mergeNativeOcrPasses(first, document('SZKOŁA DO HYMNU', 94, 0.3)).lines).toHaveLength(2);
});
it('prefers a recognized letter from an alternate pass over a decorative stroke', () => {
  const original = document('KACPER | EMMA', 96);
  const alternate = document('KACPER I EMMA', 90);
  expect(mergeNativeOcrPasses(original, alternate).lines[0]?.text).toBe('KACPER I EMMA');
  expect(mergeNativeOcrPasses(alternate, original).lines[0]?.text).toBe('KACPER I EMMA');
});
