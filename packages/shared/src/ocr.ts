import { calendarDateSchema } from './schemas/events.js';
import { ocrDocumentSchema, type OcrDocument, type OcrLine } from './schemas/ocr.js';

export type OcrWarningCode =
  | 'MISSING_DATE'
  | 'MISSING_YEAR'
  | 'INVALID_DATE'
  | 'AMBIGUOUS_DATE'
  | 'REGISTRATION_DATE'
  | 'MISSING_TIME'
  | 'INVALID_TIME'
  | 'AMBIGUOUS_TIME'
  | 'AMBIGUOUS_LAYOUT'
  | 'MISSING_TITLE';

export interface OcrWarning {
  code: OcrWarningCode;
  message: string;
  lineIds: string[];
}

export interface OcrDateCandidate {
  day: number;
  month: number;
  year: number | null;
  /** Null for invalid dates and missing/uncertain years. No current-year inference. */
  isoDate: string | null;
  valid: boolean;
  text: string;
  lineId: string;
  role: 'event' | 'registration';
}

export interface OcrEventProposal {
  title: string | null;
  location: string | null;
  dates: OcrDateCandidate[];
  startDate: string | null;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number | null;
  source: OcrLine[];
  warnings: OcrWarning[];
  /** A proposal is never an approved event, even when every field was recognized. */
  requiresConfirmation: true;
}

export interface OcrParseResult {
  proposals: OcrEventProposal[];
  warnings: OcrWarning[];
}

const messages: Record<OcrWarningCode, string> = {
  MISSING_DATE: 'Nie rozpoznano daty. Uzupełnij ją na podstawie źródła.',
  MISSING_YEAR: 'Brakuje roku. Wybierz i potwierdź rok wydarzenia.',
  INVALID_DATE: 'Data jest niepoprawna lub nieczytelna. Sprawdź tekst źródłowy.',
  AMBIGUOUS_DATE: 'Rozpoznano kilka dat. Wybierz datę wydarzenia lub rozdziel propozycję.',
  REGISTRATION_DATE: 'Fragment zawiera termin zapisów. Potwierdź, która data dotyczy wydarzenia.',
  MISSING_TIME: 'Nie rozpoznano godziny. Uzupełnij ją albo wybierz wydarzenie całodniowe.',
  INVALID_TIME: 'Godzina jest niepoprawna. Sprawdź tekst źródłowy.',
  AMBIGUOUS_TIME: 'Godziny lub ich przedział są niejednoznaczne. Potwierdź początek i koniec.',
  AMBIGUOUS_LAYOUT: 'Nie można jednoznacznie połączyć fragmentów układu. Sprawdź sąsiednie bloki.',
  MISSING_TITLE: 'Nie rozpoznano tytułu. Uzupełnij go na podstawie źródła.',
};

function warning(code: OcrWarningCode, lines: OcrLine[]): OcrWarning {
  return { code, message: messages[code], lineIds: lines.map((line) => line.id) };
}

const months = [
  ['styczen', 'stycznia', 'sty'],
  ['luty', 'lutego', 'lut'],
  ['marzec', 'marca', 'mar'],
  ['kwiecien', 'kwietnia', 'kwi'],
  ['maj', 'maja'],
  ['czerwiec', 'czerwca', 'cze'],
  ['lipiec', 'lipca', 'lip'],
  ['sierpien', 'sierpnia', 'sie'],
  ['wrzesien', 'wrzesnia', 'wrz'],
  ['pazdziernik', 'pazdziernika', 'paz'],
  ['listopad', 'listopada', 'lis'],
  ['grudzien', 'grudnia', 'gru'],
];
const monthNumbers = new Map(months.flatMap((names, index) => names.map((name) => [name, index + 1] as const)));
const monthPattern = [...monthNumbers.keys()].sort((a, b) => b.length - a.length).join('|');
const fold = (text: string) => text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l');
const pad = (value: number) => String(value).padStart(2, '0');

interface Span {
  from: number;
  to: number;
}
interface TimeCandidate extends Span {
  start: string | null;
  end: string | null;
  duration: number | null;
  issue: 'INVALID_TIME' | 'AMBIGUOUS_TIME' | null;
}
interface LineData {
  line: OcrLine;
  dates: OcrDateCandidate[];
  times: TimeCandidate[];
  residue: string;
}

const overlaps = (a: Span, b: Span) => a.from < b.to && b.from < a.to;

function timeValue(token: string): { text: string; minutes: number } | null {
  const [hour = 0, minute = 0] = token.split(/[:.]/).map(Number);
  if (hour > 23 || minute > 59) return null;
  return { text: `${pad(hour)}:${pad(minute)}`, minutes: hour * 60 + minute };
}

function readTimes(text: string): TimeCandidate[] {
  const found: TimeCandidate[] = [];
  const token = String.raw`\d{1,2}(?:[:.]\d{2})?`;
  const range = new RegExp(
    String.raw`(?<![\p{L}\d.:/])(?:(?:godz(?:ina)?\.?|od)\s*)?(${token})\s*(?:[–—-]|do)\s*(${token})(?![\p{L}\d:/]|\.\d)`,
    'giu',
  );
  for (const match of text.matchAll(range)) {
    // Bare "18-20" can be a range of days; do not turn it into a time.
    const explicit = /godz|od|do|:/i.test(match[0]);
    if (!explicit) {
      const dotted = [match[1]!, match[2]!].map((value) => value.split('.'));
      if (dotted.some((parts) => parts.length !== 2)) continue;
      // "12.05–14.05" can be two dates; only a time marker can disambiguate it.
      if (dotted.every((parts) => Number(parts[1]) >= 1 && Number(parts[1]) <= 12)) continue;
    }
    const start = timeValue(match[1]!);
    const end = timeValue(match[2]!);
    const issue = !start || !end ? 'INVALID_TIME' : end.minutes <= start.minutes ? 'AMBIGUOUS_TIME' : null;
    found.push({
      from: match.index,
      to: match.index + match[0].length,
      start: issue ? null : start!.text,
      end: issue ? null : end!.text,
      duration: issue ? null : end!.minutes - start!.minutes,
      issue,
    });
  }
  const single =
    /(?<![\p{L}\d.:/])(?:(?:godz(?:ina)?\.?|o)\s*(\d{1,2}(?:[:.]\d{2})?)|(\d{1,2}:\d{2}))(?![\p{L}\d:/]|\.\d)/giu;
  for (const match of text.matchAll(single)) {
    const span = { from: match.index, to: match.index + match[0].length };
    if (found.some((item) => overlaps(item, span))) continue;
    const value = timeValue(match[1] ?? match[2]!);
    found.push({
      ...span,
      start: value?.text ?? null,
      end: null,
      duration: null,
      issue: value ? null : 'INVALID_TIME',
    });
  }
  return found.sort((a, b) => a.from - b.from);
}

function readLine(line: OcrLine): LineData {
  const text = fold(line.text);
  const times = readTimes(text);
  const spans: Span[] = [...times];
  const dates: OcrDateCandidate[] = [];
  const add = (match: RegExpExecArray, days: string, month: number, rawYear: string | undefined) => {
    const span = { from: match.index, to: match.index + match[0].length };
    if (spans.some((item) => overlaps(item, span))) return;
    spans.push(span);
    const year = rawYear && /^\d{4}$/.test(rawYear) ? Number(rawYear) : null;
    const prefix = text.slice(0, match.index);
    const lastRegistration = [...prefix.matchAll(/zapis\p{L}*|rejestrac\p{L}*|zgloszen\p{L}*/gu)].at(-1)?.index ?? -1;
    const lastEvent =
      [...prefix.matchAll(/wydarzenie|impreza|koncert|spotkanie|termin wydarzenia/gu)].at(-1)?.index ?? -1;
    for (const [day] of days.matchAll(/\d{1,2}/g)) {
      const value = `${String(year ?? 2000).padStart(4, '0')}-${pad(month)}-${pad(Number(day))}`;
      // The leap year 2000 validates a partial February 29 without inventing its actual year.
      const valid = (!rawYear || year !== null) && calendarDateSchema.safeParse(value).success;
      dates.push({
        day: Number(day),
        month,
        year,
        isoDate: valid && year !== null ? value : null,
        valid,
        text: line.text.slice(span.from, span.to),
        lineId: line.id,
        role: lastRegistration > lastEvent ? 'registration' : 'event',
      });
    }
  };
  for (const match of text.matchAll(/(?<![\p{L}\d])([0-9oIl]{4})-(\d{1,2})-(\d{1,2})(?![\p{L}\d])/giu))
    add(match, match[3]!, Number(match[2]), match[1]);
  const dayList = String.raw`(?:\d{1,2}\s*(?:,|i|lub|oraz|[–—-])\s*)*\d{1,2}`;
  const numeric = new RegExp(
    String.raw`(?<![\p{L}\d.:/])(${dayList})\s*([./-])\s*(\d{1,2})(?:\s*\2\s*([0-9oil]{2,4}))?(?![\p{L}\d:/]|\.\d)`,
    'gu',
  );
  for (const match of text.matchAll(numeric)) add(match, match[1]!, Number(match[3]), match[4]);
  const named = new RegExp(
    String.raw`(?<![\p{L}\d])(${dayList})\.?\s+(${monthPattern})(?!\p{L})\.?(?:\s+([0-9oil]{2,4})(?![\p{L}\d:]|\.\d))?`,
    'gu',
  );
  for (const match of text.matchAll(named)) add(match, match[1]!, monthNumbers.get(match[2]!)!, match[3]);

  let residue = line.text;
  for (const span of spans.sort((a, b) => b.from - a.from))
    residue = residue.slice(0, span.from) + ' ' + residue.slice(span.to);
  residue = residue
    .replace(/\b(?:r(?:oku)?|godz(?:ina)?|data|termin)\b\.?/giu, ' ')
    .replace(/^[\s:;,–—-]+|[\s:;,–—-]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { line, dates, times, residue };
}

interface Region {
  lines: OcrLine[];
  ambiguous: boolean;
}

function median(values: number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
}

function splitGaps(lines: OcrLine[], axis: 'x' | 'y', minimum: number): OcrLine[][] {
  const size = axis === 'x' ? 'width' : 'height';
  const sorted = [...lines].sort((a, b) => a.box[axis] - b.box[axis] || a.id.localeCompare(b.id));
  const groups: OcrLine[][] = [];
  let end = -Infinity;
  for (const line of sorted) {
    if (line.box[axis] - end > minimum || groups.length === 0) groups.push([]);
    groups.at(-1)!.push(line);
    end = Math.max(end, line.box[axis] + line.box[size]);
  }
  return groups;
}

/** Whitespace cuts never connect columns through a spanning heading. */
function regions(lines: OcrLine[]): Region[] {
  if (!lines.length) return [];
  const rows = splitGaps(lines, 'y', Math.max(0.04, median(lines.map((line) => line.box.height)) * 2.5));
  if (rows.length > 1) return rows.flatMap(regions);
  const columns = splitGaps(lines, 'x', 0.025);
  if (columns.length > 1) return columns.flatMap(regions);
  const typicalWidth = median(lines.map((line) => line.box.width));
  const narrow = lines.filter((line) => line.box.width < typicalWidth * 1.5);
  const narrowSet = new Set(narrow);
  const headings = lines.filter((line) => !narrowSet.has(line));
  if (headings.length && narrow.length && splitGaps(narrow, 'x', 0.025).length > 1) {
    return [...regions(narrow).map((region) => ({ ...region, ambiguous: true })), { lines: headings, ambiguous: true }];
  }
  return [{ lines, ambiguous: false }];
}

function proposal(region: Region): OcrEventProposal {
  const source = [...region.lines].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x || a.id.localeCompare(b.id));
  const data = source.map(readLine);
  for (const [index, item] of data.entries()) {
    const previous = data[index - 1];
    if (
      previous &&
      !previous.dates.length &&
      /^(?:zapisy|rejestracja|zgłoszenia)\b/iu.test(previous.line.text) &&
      !/wydarzenie|impreza|koncert|spotkanie/iu.test(item.line.text)
    ) {
      item.dates.forEach((date) => {
        date.role = 'registration';
      });
    }
  }
  const dates = data.flatMap((item) => item.dates);
  const times = data.flatMap((item) => item.times);
  const warnings: OcrWarning[] = [];
  const warn = (code: OcrWarningCode, lines = source) => warnings.push(warning(code, lines));
  if (!dates.length) warn('MISSING_DATE');
  if (dates.some((date) => !date.valid))
    warn(
      'INVALID_DATE',
      source.filter((line) => dates.some((date) => date.lineId === line.id && !date.valid)),
    );
  if (dates.some((date) => date.valid && date.year === null)) warn('MISSING_YEAR');
  if (dates.length > 1) warn('AMBIGUOUS_DATE');
  if (dates.some((date) => date.role === 'registration')) warn('REGISTRATION_DATE');
  if (!times.length) warn('MISSING_TIME');
  if (times.some((time) => time.issue === 'INVALID_TIME')) warn('INVALID_TIME');
  if (times.length > 1 || times.some((time) => time.issue === 'AMBIGUOUS_TIME')) warn('AMBIGUOUS_TIME');
  if (region.ambiguous) warn('AMBIGUOUS_LAYOUT');

  const locationLine =
    data.find((item) => /^(?:miejsce|lokalizacja|adres)\s*:/iu.test(item.line.text.trim())) ??
    data.find(
      (item) =>
        /^(?:dom kultury|sala|szkoła|biblioteka|stadion|ul\.)(?:\s|$)/iu.test(item.residue) && !item.dates.length,
    );
  const locationIndex = locationLine ? data.indexOf(locationLine) : -1;
  const locationValue = locationLine?.residue.replace(/^(?:miejsce|lokalizacja|adres)(?:\s*:\s*|$)/iu, '').trim();
  const next = data[locationIndex + 1];
  const locationContinuation =
    locationLine && !locationValue && next && !next.dates.length && !next.times.length ? next : null;
  const location = locationValue || locationContinuation?.residue || null;
  const titles = data.filter(
    (item) =>
      item.residue &&
      item !== locationLine &&
      item !== locationContinuation &&
      !/^(?:zapis|rejestrac|zgłoszen)/iu.test(item.residue) &&
      /\p{L}/u.test(item.residue),
  );
  const title =
    (titles.find((item) => !item.dates.length && !item.times.length) ?? titles[0])?.residue
      .replace(/^(?:tytuł|wydarzenie)\s*:\s*/iu, '')
      .trim() || null;
  if (!title) warn('MISSING_TITLE');
  const date = dates.length === 1 && dates[0]!.role === 'event' ? dates[0]!.isoDate : null;
  // A shared time cannot safely be attached to one of several dates in the same region.
  const time = times.length === 1 && dates.length <= 1 && !times[0]!.issue ? times[0]! : null;
  if (times.length && dates.length > 1 && !warnings.some((item) => item.code === 'AMBIGUOUS_TIME'))
    warn('AMBIGUOUS_TIME');
  return {
    title,
    location,
    dates,
    startDate: date,
    startTime: time?.start ?? null,
    endTime: time?.end ?? null,
    durationMinutes: time?.duration ?? null,
    source,
    warnings,
    requiresConfirmation: true,
  };
}

/** Pure local parser: no clock, storage, network, OCR engine or event creation. */
export function parseOcrEvents(input: OcrDocument): OcrParseResult {
  const document = ocrDocumentSchema.parse(input);
  const blocks = new Map<string | undefined, OcrLine[]>();
  for (const line of document.lines) {
    if (!line.text.trim()) continue;
    const block = blocks.get(line.blockId) ?? [];
    block.push(line);
    blocks.set(line.blockId, block);
  }
  const proposals = [...blocks.values()]
    .flatMap(regions)
    .map(proposal)
    .sort((a, b) => a.source[0]!.box.y - b.source[0]!.box.y || a.source[0]!.box.x - b.source[0]!.box.x);
  return { proposals, warnings: proposals.length ? [] : [warning('MISSING_DATE', [])] };
}
