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

describe('date-anchored photo layout', () => {
  const photo = (lines: OcrLine[]) => parseOcrEvents(document(lines), { groupByDates: true });

  const november = (firstDate = '5.11.2026 R.') => [
    line('LISTOPAD', 'month', 0.38, 0.04, 0.21),
    line(firstDate, 'date-5', 0.055, 0.27, 0.15),
    line('SESJA ZDJĘCIOWA', 'photo-title', 0.035, 0.345, 0.19),
    line('ŚWIĄTECZNA', 'photo-subtitle', 0.065, 0.375, 0.13),
    line('9.11.2026 R.', 'date-9', 0.315, 0.305, 0.15),
    line('SZKOŁA DO', 'anthem-title', 0.33, 0.46, 0.15),
    line('HYMNU', 'anthem-subtitle', 0.36, 0.495, 0.09),
    line('10.11.2026 R.', 'date-10', 0.54, 0.3, 0.17),
    line('SCK - KINO', 'cinema-title', 0.56, 0.345, 0.12),
    line('KACPER I EMMA', 'cinema-subtitle', 0.535, 0.375, 0.17),
    line('NA SAFARI', 'cinema-last', 0.56, 0.41, 0.13),
    line('13.11.2026 R.', 'date-13', 0.77, 0.27, 0.17),
    line('FILHARMONIA', 'music-title', 0.76, 0.315, 0.17),
    line('MUZYCZNYCH', 'music-subtitle', 0.76, 0.35, 0.17),
    line('KADRÓW BEZ LIKU', 'music-last', 0.76, 0.385, 0.17),
    line('18.11.2026 R.', 'date-18', 0.235, 0.685, 0.17),
    line('DOGOTERAPIA', 'dog-title', 0.21, 0.79, 0.18),
    line('23.11.2026 R.', 'date-23', 0.49, 0.65, 0.18),
    line('EDUKACYJNA', 'visit-title', 0.505, 0.71, 0.16),
    line('WIZYTA STRAŻY', 'visit-subtitle', 0.49, 0.745, 0.19),
    line('MIEJSKIEJ', 'visit-last', 0.53, 0.78, 0.12),
    line('27.11.2026 R.', 'date-27', 0.75, 0.645, 0.18),
    line('AUDYCJA', 'audition-title', 0.78, 0.695, 0.1),
    line('MUZYCZNA', 'audition-subtitle', 0.765, 0.73, 0.13),
    line('"PATRIOTYCZNIE"', 'audition-theme', 0.735, 0.765, 0.19),
    line('"ANDRZEJKI"', 'audition-last', 0.76, 0.8, 0.145),
  ];

  it('keeps all seven staggered November cards including the anthem as a title', () => {
    const ornament = {
      ...line('NNVV', 'ornament', 0.82, 0.1, 0.17),
      box: { x: 0.82, y: 0.1, width: 0.17, height: 0.075 },
      confidence: 85,
    };
    const result = photo([...november(), ornament]);
    expect(result.proposals).toHaveLength(7);
    expect(result.proposals.map(({ startDate }) => startDate)).toEqual(
      [5, 9, 10, 13, 18, 23, 27].map((day) => `2026-11-${String(day).padStart(2, '0')}`),
    );
    expect(result.proposals[0]!.title).toBe('SESJA ZDJĘCIOWA ŚWIĄTECZNA');
    expect(result.proposals[1]).toMatchObject({ title: 'SZKOŁA DO HYMNU', location: null });
    expect(result.proposals[6]!.title).toBe('AUDYCJA MUZYCZNA "PATRIOTYCZNIE" "ANDRZEJKI"');
    expect(result).toEqual(photo([...november(), ornament].reverse()));
  });

  it('does not attach an isolated Christmas photo card to November 9 when its date is unread', () => {
    const result = photo(november().filter(({ id }) => id !== 'date-5'));
    const first = result.proposals.find(({ title }) => title === 'SESJA ZDJĘCIOWA ŚWIĄTECZNA');
    expect(first).toMatchObject({ startDate: null });
    expect(codes(first!)).toContain('MISSING_DATE');
    expect(result.proposals.find(({ startDate }) => startDate === '2026-11-09')?.title).toBe('SZKOŁA DO HYMNU');
    const damaged = photo(november('S.11.2026 R.')).proposals.find(
      ({ title }) => title === 'SESJA ZDJĘCIOWA ŚWIĄTECZNA',
    );
    expect(damaged).toMatchObject({ startDate: null });
  });

  it.each(['12-14 marca 2024', '12–14 MARCA 2024', '12 do 14 marca 2024', '12-14.03.2024'])(
    'keeps %s as an inclusive range rather than an invalid month or alternative dates',
    (text) => {
      const result = photo([line('Targi wyrobów', 'title'), line(text, 'date', 0.1, 0.15)]).proposals[0]!;
      expect(result).toMatchObject({
        startDate: '2024-03-12',
        dateRange: { start: { day: 12, isoDate: '2024-03-12' }, end: { day: 14, isoDate: '2024-03-14' } },
        durationMinutes: null,
      });
      expect(codes(result)).not.toContain('AMBIGUOUS_DATE');
      expect(codes(result)).not.toContain('INVALID_DATE');
    },
  );

  it('joins repeated fair dates and keeps daily opening hours separate from event duration', () => {
    const result = photo([
      line('BEER', 'brand', 0.45, 0.2, 0.2),
      line('12-14 MARCA 2024', 'main-date', 0.4, 0.6, 0.25),
      line('GODZINY OTWARCIA:', 'hours-label', 0.02, 0.7, 0.2),
      line('12-14 marca 2024', 'repeated-date', 0.08, 0.76, 0.1),
      line('10:00 - 17:00', 'hours', 0.1, 0.8, 0.1),
    ]);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      startDate: '2024-03-12',
      dateRange: { end: { isoDate: '2024-03-14' } },
      openingHours: { startTime: '10:00', endTime: '17:00' },
      startTime: null,
      endTime: null,
      durationMinutes: null,
    });
    expect(result.proposals[0]!.dates).toHaveLength(2);
    expect(codes(result.proposals[0]!)).not.toContain('AMBIGUOUS_DATE');
  });

  it('does not turn a list of dates or a reverse range into a continuous event', () => {
    for (const value of ['12 i 14 marca 2024', '12 lub 14 marca 2024', '14-12 marca 2024']) {
      const result = photo([line('Koncert', 'title'), line(value, 'date', 0.1, 0.14)]).proposals[0]!;
      expect(result.dateRange).toBeNull();
      expect(result.startDate).toBeNull();
      expect(codes(result)).toContain('AMBIGUOUS_DATE');
    }
  });

  it('keeps missing years in a range and in a spaced date unconfirmed', () => {
    const range = photo([line('Targi 12-14 marca', 'event')]).proposals[0]!;
    expect(range.dateRange).toMatchObject({ start: { day: 12, year: null }, end: { day: 14, year: null } });
    expect(range.startDate).toBeNull();
    expect(codes(range)).toContain('MISSING_YEAR');
    const partial = photo([line('Stand-up 2024', 'title'), line('14 06', 'date', 0.1, 0.2)]).proposals[0]!;
    expect(partial.dates).toMatchObject([{ day: 14, month: 6, year: null }]);
    expect(partial.startDate).toBeNull();
  });

  it('uses an explicit concert start while retaining a warning about programme times', () => {
    const result = photo([
      line('KONCERT', 'title'),
      line('30 SIERPNIA', 'date', 0.1, 0.2),
      line('TEREN ZIELONY PRZED CENTRUM', 'location', 0.1, 0.25),
      line('START GODZ. 17:15', 'start', 0.1, 0.3),
      line('17:15 Julia', 'first-act', 0.1, 0.7),
      line('18:30 Oceana', 'second-act', 0.1, 0.75),
      line('20:00 Justyna', 'third-act', 0.1, 0.8),
    ]).proposals[0]!;
    expect(result).toMatchObject({ startDate: null, startTime: '17:15', location: 'TEREN ZIELONY PRZED CENTRUM' });
    expect(codes(result)).toContain('PROGRAM_TIMES');
    expect(codes(result)).toContain('MISSING_YEAR');
    expect(codes(result)).not.toContain('AMBIGUOUS_TIME');
  });

  it('does not remove the letter R from Polish words when cleaning labels', () => {
    expect(photo([line('ŚRÓDMIEŚCIE', 'title'), line('12.05.2026', 'date', 0.1, 0.14)]).proposals[0]!.title).toBe(
      'ŚRÓDMIEŚCIE',
    );
  });

  it('joins differently sized title lines without adding distant website navigation', () => {
    const result = photo([
      { ...line('DLA WYSTAWCÓW KONTAKT', 'nav', 0.2, 0.02, 0.6), box: { x: 0.2, y: 0.02, width: 0.6, height: 0.04 } },
      { ...line('BEER', 'brand', 0.45, 0.2, 0.2), box: { x: 0.45, y: 0.2, width: 0.2, height: 0.1 } },
      { ...line('WARSAW', 'brand-2', 0.45, 0.32, 0.2), box: { x: 0.45, y: 0.32, width: 0.2, height: 0.055 } },
      { ...line('EXPO', 'brand-3', 0.45, 0.39, 0.1), box: { x: 0.45, y: 0.39, width: 0.1, height: 0.055 } },
      line('12-14 marca 2024', 'date', 0.4, 0.6, 0.25),
    ]).proposals[0]!;
    expect(result.title).toBe('BEER WARSAW EXPO');
  });

  it('uses the event title rather than a decorative glyph or a price', () => {
    const result = photo([
      { ...line('V', 'decoration', 0.75, 0, 0.05), confidence: 65 },
      line('21.10.2026 R.', 'date', 0.15, 0.19, 0.7),
      { ...line('DOGOTERAPIA', 'title', 0.15, 0.33, 0.73), confidence: 92 },
      line('10 ZŁ', 'price', 0.37, 0.53, 0.3),
    ]);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({ title: 'DOGOTERAPIA', startDate: '2026-10-21', startTime: null });
    expect(codes(result.proposals[0]!)).toEqual(['MISSING_TIME']);
  });

  it('excludes a price joined to a decorative letter and suppresses isolated graphics', () => {
    const result = photo([
      line('13.11.2026', 'date', 0.7, 0.25, 0.2),
      line('FILHARMONIA', 'title', 0.7, 0.3, 0.2),
      { ...line('15ZŁ [A', 'price', 0.7, 0.4, 0.2), box: { x: 0.7, y: 0.4, width: 0.2, height: 0.08 } },
      line('=>', 'graphic', 0.05, 0.8, 0.02),
    ]);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({ title: 'FILHARMONIA', startDate: '2026-11-13' });
  });

  it('connects a separated ticket title, date and address and excludes seat metadata', () => {
    const result = photo([
      line('AGENCJA ARTYSTYCZNA', 'agency', 0.1, 0.18, 0.15),
      {
        ...line('ARKA NOEGO - KONCERT KOLĘD', 'title', 0.08, 0.28, 0.52),
        box: { x: 0.08, y: 0.28, width: 0.52, height: 0.05 },
      },
      line('DATA, GODZINA I MIEJSCE', 'label', 0.08, 0.51, 0.15),
      line('10.01.2027, godz. 11:00', 'date', 0.08, 0.55, 0.25),
      line('Katowice, Pałac Młodzieży, ul. Mikołowska 26', 'address', 0.08, 0.59, 0.47),
      line('parter', 'seat', 0.08, 0.74, 0.08),
      line('110,00 zł (w tym 8% VAT)', 'price', 0.7, 0.74, 0.25),
    ]);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      title: 'ARKA NOEGO - KONCERT KOLĘD',
      startDate: '2027-01-10',
      startTime: '11:00',
      location: 'Katowice, Pałac Młodzieży, ul. Mikołowska 26',
      warnings: [],
    });
  });

  it('separates eight staggered event cards and joins their multiline titles', () => {
    const days = [2, 6, 7, 9, 16, 21, 23, 30];
    const lines = [
      { ...line('PAŹDZIERNIK', 'month', 0.3, 0.09, 0.35), box: { x: 0.3, y: 0.09, width: 0.35, height: 0.05 } },
    ];
    for (const [index, day] of days.entries()) {
      const x = 0.02 + (index % 4) * 0.24;
      const y = 0.2 + Math.floor(index / 4) * 0.4 + (index % 4) * 0.02;
      lines.push(line(`${day}.10.2026 R.`, `date-${index}`, x + 0.03, y, 0.15));
      lines.push(line(`WARSZTATY`, `title-${index}`, x + 0.02, y + 0.06, 0.18));
      lines.push(line(`TEMATYCZNE ${index + 1}`, `continuation-${index}`, x, y + 0.1, 0.21));
      lines.push(line('10 ZŁ', `price-${index}`, x + 0.07, y + 0.2, 0.07));
    }
    const result = photo(lines);
    expect(result.proposals.map((item) => item.startDate)).toEqual(
      days.map((day) => `2026-10-${String(day).padStart(2, '0')}`),
    );
    expect(result.proposals.map((item) => item.title)).toEqual(
      days.map((_, index) => `WARSZTATY TEMATYCZNE ${index + 1}`),
    );
    expect(result.proposals.every((item) => item.startTime === null)).toBe(true);
    expect(result).toEqual(photo([...lines].reverse()));
  });

  it('does not interpret a damaged word ending in O and a numeral as a time', () => {
    const result = photo([
      line('6.10.2026', 'date'),
      line('SCK - KINO', 'title', 0.1, 0.14),
      { ...line('"PUC|O 2”', 'subtitle', 0.1, 0.18), confidence: 75 },
    ]);
    expect(result.proposals[0]).toMatchObject({ title: 'SCK - KINO "PUC|O 2”', startTime: null });
    expect(codes(result.proposals[0]!)).toEqual(['MISSING_TIME', 'LOW_CONFIDENCE']);
  });

  it('preserves nearby alternative dates and registration ambiguity', () => {
    const result = photo([
      line('Warsztaty', 'title'),
      line('Zapisy do 10 maja 2026', 'registration', 0.1, 0.14),
      line('Wydarzenie 15 maja 2026 o 18:00', 'date', 0.1, 0.18),
    ]);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({ startDate: null, startTime: null });
    expect(codes(result.proposals[0]!)).toContain('REGISTRATION_DATE');
    expect(codes(result.proposals[0]!)).toContain('AMBIGUOUS_DATE');
  });

  it('continues to respect explicit adapter boundaries', () => {
    const result = photo([
      { ...line('Koncert 12.05.2026', 'event'), blockId: 'event' },
      { ...line('godz. 18:00', 'time', 0.1, 0.14), blockId: 'other' },
    ]);
    expect(result.proposals).toHaveLength(2);
    expect(result.proposals[0]?.startTime).toBeNull();
  });
});
