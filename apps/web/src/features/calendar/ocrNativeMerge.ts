import { ocrDocumentSchema, parseOcrEvents, type OcrDocument, type OcrLine } from '@rodzina/shared';

/** Compare only corresponding image fragments; never repair words or infer dates. */
export function mergeNativeOcrPasses(first: OcrDocument, second: OcrDocument): OcrDocument {
  const lines = [...first.lines];
  const dates = (line: OcrLine) =>
    parseOcrEvents({ image: first.image, lines: [line] })
      .proposals.flatMap((proposal) => proposal.dates)
      .map((date) => `${date.day}:${date.month}:${date.year}:${date.valid}`)
      .sort()
      .join('|');
  for (const candidate of second.lines) {
    const index = lines.findIndex((old) => {
      const width = Math.max(
        0,
        Math.min(old.box.x + old.box.width, candidate.box.x + candidate.box.width) -
          Math.max(old.box.x, candidate.box.x),
      );
      const height = Math.max(
        0,
        Math.min(old.box.y + old.box.height, candidate.box.y + candidate.box.height) -
          Math.max(old.box.y, candidate.box.y),
      );
      const area = width * height;
      return (
        area / Math.min(old.box.width * old.box.height, candidate.box.width * candidate.box.height) > 0.65 &&
        area / Math.max(old.box.width * old.box.height, candidate.box.width * candidate.box.height) > 0.35 &&
        height / Math.min(old.box.height, candidate.box.height) > 0.65
      );
    });
    if (index < 0) {
      lines.push(candidate);
      continue;
    }
    const old = lines[index]!;
    const oldDates = dates(old);
    const newDates = dates(candidate);
    if (oldDates && newDates && oldDates !== newDates) {
      // Both readings remain visible and the shared parser requires a date decision.
      lines.push(candidate);
      continue;
    }
    const moreCertain = (candidate.confidence ?? 0) > (old.confidence ?? 0);
    if ((!oldDates && newDates) || (oldDates === newDates && moreCertain)) lines[index] = candidate;
  }
  return ocrDocumentSchema.parse({
    image: first.image,
    lines: lines.map((line, index) => ({ ...line, id: `line-${index}` })),
  });
}
