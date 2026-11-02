// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseOcrEvents, ocrDocumentSchema, type OcrDocument, type OcrLine, type OcrEventProposal } from './index.js';

const line = (text: string, id = 'line', x = 0.1, y = 0.1, width = 0.4): OcrLine => ({
  id,
  text,
  box: { x, y, width, height: 0.025 },
});
const document = (lines: OcrLine[]): OcrDocument => ({ image: { width: 1200, height: 1600 }, lines });
const parse = (text: string) =>
  parseOcrEvents(document([line('Koncert', 'title'), line(text, 'date', 0.1, 0.14)])).proposals[0]!;
const codes = (proposal: OcrEventProposal) => proposal.warnings.map((item) => item.code);

interface Fixture {
  name: string;
  document: OcrDocument;
  expected: (Omit<Partial<OcrEventProposal>, 'source'> & { codes: string[]; source: string[] })[];
}
const fixtures = JSON.parse(
  readFileSync(new URL('../../../test-fixtures/ocr/events.json', import.meta.url), 'utf8'),
) as Fixture[];

describe('OCR reference announcements (synthetic, without personal data)', () => {
  it.each(fixtures)('$name', (fixture) => {
    const before = structuredClone(fixture.document);
    const result = parseOcrEvents(fixture.document);
    expect(result.proposals).toHaveLength(fixture.expected.length);
    fixture.expected.forEach(({ codes: expectedCodes, source, ...fields }, index) => {
      const actual = result.proposals[index]!;
      expect(actual).toMatchObject({ ...fields, requiresConfirmation: true });
      expect(codes(actual).sort()).toEqual(expectedCodes.sort());
      expect(actual.source.map((item) => item.id)).toEqual(source);
      expect(actual.source).toEqual(source.map((id) => fixture.document.lines.find((item) => item.id === id)));
      actual.warnings.forEach((item) => {
        expect(item.message).not.toBe('');
        expect(item.lineIds.every((id) => source.includes(id))).toBe(true);
      });
    });
    expect(fixture.document).toEqual(before);
    expect(parseOcrEvents(document([...fixture.document.lines].reverse()))).toEqual(result);
  });
});

describe('Polish dates', () => {
  it.each(['12 i 14 maja 2026', '12–14 maja 2026', '12–14.05.2026', '12.05–14.05'])(
    'does not silently choose one date from %s',
    (text) => {
      const result = parse(text);
      expect(result.dates.map((date) => date.day)).toEqual([12, 14]);
      expect(result.startDate).toBeNull();
      expect(codes(result)).toContain('AMBIGUOUS_DATE');
    },
  );

  it('recognizes sentence-ending punctuation', () => {
    const result = parse('12.05.2026, godz. 18:00.');
    expect(result).toMatchObject({ startDate: '2026-05-12', startTime: '18:00' });
  });
  it.each(
    [
      ['stycznia', 'styczeń'],
      ['lutego', 'luty'],
      ['marca', 'marzec'],
      ['kwietnia', 'kwiecień'],
      ['maja', 'maj'],
      ['czerwca', 'czerwiec'],
      ['lipca', 'lipiec'],
      ['sierpnia', 'sierpień'],
      ['września', 'wrzesień'],
      ['października', 'październik'],
      ['listopada', 'listopad'],
      ['grudnia', 'grudzień'],
    ].map((names, index) => ({ names, month: String(index + 1).padStart(2, '0') })),
  )('recognizes $names', ({ names, month }) => {
    for (const name of names) {
      const result = parse(`12 ${name.toUpperCase()} 2026 r.`);
      expect(result.startDate).toBe(`2026-${month}-12`);
      expect(result.dates[0]).toMatchObject({ valid: true, year: 2026, role: 'event' });
    }
  });

  it.each(['12.05.2026', '12/05/2026', '12-05-2026', '2026-05-12', '12. 05. 2026', '12 maj 2026', '12 paź. 2026'])(
    'recognizes %s',
    (text) => {
      expect(parse(text).startDate).toBe(text.includes('paź') ? '2026-10-12' : '2026-05-12');
    },
  );

  it.each([
    '31.04.2026',
    '29 lutego 2026',
    '29.02.2100',
    '00.05.2026',
    '12.13.2026',
    '12.05.0026',
    '12.05.26',
    '12 maja 2O26',
  ])('keeps an invalid or uncertain date visible: %s', (text) => {
    const result = parse(text);
    expect(result.startDate).toBeNull();
    expect(codes(result)).toContain('INVALID_DATE');
    expect(result.dates[0]?.valid).toBe(false);
    expect(result.dates[0]?.text).toBe(text);
  });

  it.each(['29.02.2024', '29 lutego 2000'])('validates leap day %s', (text) => {
    expect(parse(text).dates[0]?.valid).toBe(true);
    expect(codes(parse(text))).not.toContain('INVALID_DATE');
  });

  it.each(['12.05', '12/05', '12 maja', '29 lutego'])('does not infer a year for %s', (text) => {
    const result = parse(text);
    expect(result.startDate).toBeNull();
    expect(result.dates[0]).toMatchObject({ year: null, isoDate: null, valid: true });
    expect(codes(result)).toContain('MISSING_YEAR');
  });

  it('keeps a yearless date followed immediately by a time', () => {
    const result = parse('12 maja 18:00');
    expect(result.dates[0]).toMatchObject({ day: 12, month: 5, year: null, valid: true });
    expect(result.startTime).toBe('18:00');
    expect(codes(result)).toContain('MISSING_YEAR');
  });

  it('does not read a phone number as a date', () => {
    expect(parse('Kontakt: 123-456-789').dates).toEqual([]);
  });
});

describe('time interpretation', () => {
  it.each([
    ['godz. 9:05', '09:05', null, null],
    ['o 9.05', '09:05', null, null],
    ['godzina 9', '09:00', null, null],
    ['9:00–11:30', '09:00', '11:30', 150],
    ['godz. 9-11', '09:00', '11:00', 120],
    ['od 9 do 11', '09:00', '11:00', 120],
    ['09.00 — 11.30', '09:00', '11:30', 150],
  ])('recognizes %s', (text, startTime, endTime, durationMinutes) => {
    const result = parse(`12 maja 2026, ${text}`);
    expect(result).toMatchObject({ startDate: '2026-05-12', startTime, endTime, durationMinutes });
    expect(codes(result)).toEqual([]);
  });

  it.each(['25:00', 'godz. 12:65', 'godz. 24', '18:00–25:00'])('warns on invalid %s', (text) => {
    const result = parse(`12 maja 2026, ${text}`);
    expect(result.startTime).toBeNull();
    expect(codes(result)).toContain('INVALID_TIME');
  });

  it.each(['23:00–01:00', '18:00–18:00', '18:00 lub 19:00'])('does not guess a duration for %s', (text) => {
    const result = parse(`12 maja 2026, ${text}`);
    expect(result).toMatchObject({ startTime: null, endTime: null, durationMinutes: null });
    expect(codes(result)).toContain('AMBIGUOUS_TIME');
  });

  it('does not invent a duration or interpret a date as a time', () => {
    expect(parse('12.05.2026, 18:00')).toMatchObject({ startTime: '18:00', durationMinutes: null });
    expect(parse('12.05')).toMatchObject({ startTime: null, durationMinutes: null });
    expect(parse('18–20 maja 2026').startTime).toBeNull();
  });
});

describe('layout and partial proposals', () => {
  it('does not attach times from a different adapter block', () => {
    const result = parseOcrEvents(
      document([
        { ...line('Koncert 12.05.2026', 'a'), blockId: 'a' },
        { ...line('godz. 18:00', 'b', 0.1, 0.14), blockId: 'b' },
      ]),
    );
    expect(result.proposals).toHaveLength(2);
    expect(result.proposals[0]?.startTime).toBeNull();
    expect(codes(result.proposals[1]!)).toContain('MISSING_DATE');
  });

  it('splits vertically distant announcements even without block IDs', () => {
    const result = parseOcrEvents(
      document([line('Koncert 12.05.2026', 'a'), line('Piknik 13.05.2026', 'b', 0.1, 0.5)]),
    );
    expect(result.proposals.map((item) => item.startDate)).toEqual(['2026-05-12', '2026-05-13']);
  });

  it('keeps a spanning heading from bridging two columns', () => {
    const result = parseOcrEvents(
      document([
        line('Program wydarzeń', 'heading', 0.05, 0.1, 0.9),
        line('Koncert 12.05.2026', 'left', 0.05, 0.14, 0.35),
        line('Kino 13.05.2026 o 19:00', 'right', 0.6, 0.14, 0.35),
      ]),
    );
    expect(result.proposals).toHaveLength(3);
    expect(result.proposals.find((item) => item.startDate === '2026-05-12')?.startTime).toBeNull();
    result.proposals.forEach((item) => expect(codes(item)).toContain('AMBIGUOUS_LAYOUT'));
  });

  it('keeps all alternative dates and source fragments for manual review', () => {
    const result = parse('Zapisy do 10 maja 2026; koncert 15 maja 2026 o 18:00');
    expect(result.dates.map((date) => date.role)).toEqual(['registration', 'event']);
    expect(result.dates.map((date) => date.isoDate)).toEqual(['2026-05-10', '2026-05-15']);
    expect(result).toMatchObject({ startDate: null, startTime: null, requiresConfirmation: true });
  });

  it('leaves an isolated registration deadline unselected', () => {
    const result = parse('Zapisy do 10 maja 2026');
    expect(result.startDate).toBeNull();
    expect(codes(result)).toContain('REGISTRATION_DATE');
  });

  it('recognizes a registration heading on the preceding line', () => {
    const result = parseOcrEvents(
      document([line('Zapisy do', 'registration'), line('10 maja 2026', 'date', 0.1, 0.14)]),
    ).proposals[0]!;
    expect(result.startDate).toBeNull();
    expect(codes(result)).toContain('REGISTRATION_DATE');
  });

  it('proposes a neighboring venue and a title below the date', () => {
    const result = parseOcrEvents(
      document([
        line('12 maja 2026', 'date'),
        line('Koncert rodzinny', 'title', 0.1, 0.14),
        line('Dom Kultury', 'venue', 0.1, 0.18),
      ]),
    ).proposals[0]!;
    expect(result).toMatchObject({ title: 'Koncert rodzinny', location: 'Dom Kultury' });
  });

  it('reads a location label followed by its value on the next line', () => {
    const result = parseOcrEvents(
      document([
        line('Koncert 12 maja 2026', 'title'),
        line('Miejsce:', 'label', 0.1, 0.14),
        line('Park miejski', 'value', 0.1, 0.18),
      ]),
    ).proposals[0]!;
    expect(result).toMatchObject({ title: 'Koncert', location: 'Park miejski' });
  });

  it('returns a warning for empty OCR and partial proposals for text without dates', () => {
    expect(parseOcrEvents(document([]))).toMatchObject({ proposals: [], warnings: [{ code: 'MISSING_DATE' }] });
    expect(codes(parse('nieczytelny tekst'))).toContain('MISSING_DATE');
    expect(codes(parseOcrEvents(document([line('12.05.2026')])).proposals[0]!)).toContain('MISSING_TITLE');
  });
});

describe('shared OCR adapter contract', () => {
  it('accepts normalized coordinates for a portrait image after orientation correction', () => {
    const input = document([line('Tekst')]);
    expect(ocrDocumentSchema.parse(input)).toEqual(input);
    expect(ocrDocumentSchema.parse({ ...input, image: { width: 1600, height: 1200 } })).toBeTruthy();
  });

  it.each([
    { x: -0.1 },
    { y: NaN },
    { width: 0 },
    { height: Infinity },
    { x: 0.8, width: 0.3 },
    { y: 0.99, height: 0.1 },
  ])('rejects invalid geometry %j', (box) => {
    const source = line('Tekst');
    expect(() => parseOcrEvents(document([{ ...source, box: { ...source.box, ...box } }]))).toThrow();
  });

  it('rejects duplicate line IDs and invalid dimensions', () => {
    expect(ocrDocumentSchema.safeParse(document([line('A'), line('B')])).success).toBe(false);
    expect(ocrDocumentSchema.safeParse({ ...document([]), image: { width: 0, height: 1200 } }).success).toBe(false);
  });
});
