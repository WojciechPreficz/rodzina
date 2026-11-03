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
  | 'LOW_CONFIDENCE'
  | 'PROGRAM_TIMES'
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
  dateRange: { start: OcrDateCandidate; end: OcrDateCandidate } | null;
  openingHours: { startTime: string; endTime: string } | null;
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
  MISSING_TIME: 'Nie rozpoznano godziny',
  INVALID_TIME: 'Godzina jest niepoprawna. Sprawdź tekst źródłowy.',
  AMBIGUOUS_TIME: 'Godziny lub ich przedział są niejednoznaczne. Potwierdź początek i koniec.',
  AMBIGUOUS_LAYOUT: 'Nie można jednoznacznie połączyć fragmentów układu. Sprawdź sąsiednie bloki.',
  MISSING_TITLE: 'Nie rozpoznano tytułu. Uzupełnij go na podstawie źródła.',
  LOW_CONFIDENCE: 'Niektóre fragmenty mają niską pewność odczytu. Porównaj je ze zdjęciem przed zatwierdzeniem.',
  PROGRAM_TIMES:
    'Plakat zawiera także godziny programu. Sprawdź je w tekście źródłowym; godzina początku pochodzi z oznaczenia „start”.',
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
  dateRanges: Array<{ start: OcrDateCandidate; end: OcrDateCandidate }>;
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
    if (
      !/godz|[:.]/iu.test(match[0]) &&
      new RegExp(`^\\s+(?:${monthPattern})(?!\\p{L})`, 'u').test(text.slice(match.index + match[0].length))
    )
      continue;
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
    /(?<![\p{L}\d.:/|])(?:(?:godz(?:ina)?\.?|o)\s*(\d{1,2}(?:[:.]\d{2})?)|(\d{1,2}:\d{2}))(?![\p{L}\d:/]|\.\d)/giu;
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
  const dateRanges: LineData['dateRanges'] = [];
  const add = (match: RegExpExecArray, days: string, month: number, rawYear: string | undefined) => {
    const span = { from: match.index, to: match.index + match[0].length };
    if (spans.some((item) => overlaps(item, span))) return;
    spans.push(span);
    const year = rawYear && /^\d{4}$/.test(rawYear) ? Number(rawYear) : null;
    const prefix = text.slice(0, match.index);
    const lastRegistration = [...prefix.matchAll(/zapis\p{L}*|rejestrac\p{L}*|zgloszen\p{L}*/gu)].at(-1)?.index ?? -1;
    const lastEvent =
      [...prefix.matchAll(/wydarzenie|impreza|koncert|spotkanie|termin wydarzenia/gu)].at(-1)?.index ?? -1;
    const first = dates.length;
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
    if (/^\d{1,2}\s*(?:[–—-]|do)\s*\d{1,2}$/u.test(days) && dates.length === first + 2) {
      const start = dates[first]!;
      const end = dates[first + 1]!;
      if (start.valid && end.valid && start.day <= end.day) dateRanges.push({ start, end });
    }
  };
  for (const match of text.matchAll(/(?<![\p{L}\d])([0-9oIl]{4})-(\d{1,2})-(\d{1,2})(?![\p{L}\d])/giu))
    add(match, match[3]!, Number(match[2]), match[1]);
  const dayList = String.raw`(?:\d{1,2}\s*(?:,|i|lub|oraz|do|[–—-])\s*)*\d{1,2}`;
  const numeric = new RegExp(
    String.raw`(?<![\p{L}\d.:/])(${dayList})\s*([./-])\s*(\d{1,2})(?:\s*\2\s*([0-9oil]{2,4}))?(?![\p{L}\d:/]|\.\d)`,
    'gu',
  );
  const named = new RegExp(
    String.raw`(?<![\p{L}\d])(?:od\s+)?(${dayList})\.?\s+(${monthPattern})(?!\p{L})\.?(?:\s+([0-9oil]{2,4})(?![\p{L}\d:]|\.\d))?`,
    'gu',
  );
  for (const match of text.matchAll(named)) add(match, match[1]!, monthNumbers.get(match[2]!)!, match[3]);
  // A named range such as "12-14 marca" is more specific than numeric "12-14".
  for (const match of text.matchAll(numeric)) add(match, match[1]!, Number(match[3]), match[4]);
  const spacedDate = /^(\d{1,2})\s+(0?[1-9]|1[0-2])$/u.exec(text.trim());
  if (spacedDate) add(spacedDate, spacedDate[1]!, Number(spacedDate[2]), undefined);

  let residue = line.text;
  for (const span of spans.sort((a, b) => b.from - a.from))
    residue = residue.slice(0, span.from) + ' ' + residue.slice(span.to);
  residue = residue
    .replace(/(?<!\p{L})(?:r(?:oku)?|godz(?:ina)?|data|termin)(?!\p{L})\.?/giu, ' ')
    .replace(/^[\s:;,–—-]+|[\s:;,–—-]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { line, dates, times, residue, dateRanges };
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

/** Dates anchor event cards even when typography and whitespace split their text. */
function photoRegions(lines: OcrLine[]): Region[] {
  const anchors = lines.filter((line) => readLine(line).dates.length > 0);
  if (!anchors.length) return regions(lines);
  const rangeKey = (line: OcrLine) => {
    const ranges = readLine(line).dateRanges;
    return ranges.length === 1
      ? `${ranges[0]!.start.day}:${ranges[0]!.end.day}:${ranges[0]!.start.month}:${ranges[0]!.start.year}`
      : null;
  };
  if (
    anchors.length > 1 &&
    rangeKey(anchors[0]!) &&
    anchors.every((line) => rangeKey(line) === rangeKey(anchors[0]!)) &&
    lines.some((line) => /godziny\s+otwarcia/iu.test(line.text))
  )
    return [{ lines, ambiguous: false }];
  const centerX = (line: OcrLine) => line.box.x + line.box.width / 2;
  const centerY = (line: OcrLine) => line.box.y + line.box.height / 2;
  const columns: OcrLine[][] = [];
  const tolerance = Math.max(0.08, Math.min(0.15, median(anchors.map((line) => line.box.width)) * 0.6));
  for (const anchor of [...anchors].sort((a, b) => centerX(a) - centerX(b) || centerY(a) - centerY(b))) {
    const last = columns.at(-1);
    if (!last || centerX(anchor) - median(last.map(centerX)) > tolerance) columns.push([anchor]);
    else last.push(anchor);
  }
  const groups = columns.map((column) => {
    const rows: Array<{ anchors: OcrLine[]; region: Region }> = [];
    for (const anchor of [...column].sort((a, b) => centerY(a) - centerY(b))) {
      const last = rows.at(-1);
      // Nearby alternatives and registration deadlines remain one ambiguous proposal.
      if (!last || centerY(anchor) - centerY(last.anchors.at(-1)!) > Math.max(0.14, anchor.box.height * 5))
        rows.push({ anchors: [anchor], region: { lines: [], ambiguous: false } });
      else last.anchors.push(anchor);
    }
    return { x: median(column.map(centerX)), rows };
  });
  const unanchored: OcrLine[] = [];
  for (const line of lines) {
    const heading = fold(line.text)
      .trim()
      .replace(/\s+\d{4}(?:\s*r\.?)?$/u, '');
    if (
      anchors.length > 1 &&
      monthNumbers.has(heading) &&
      line.box.y < Math.min(...anchors.map((anchor) => anchor.box.y))
    )
      continue;
    const own = groups.flatMap((column) => column.rows).find((row) => row.anchors.includes(line));
    if (own) {
      own.region.lines.push(line);
      continue;
    }
    const column = [...groups].sort((a, b) => Math.abs(a.x - centerX(line)) - Math.abs(b.x - centerX(line)))[0]!;
    if (columns.length > 1 && line.box.width > 0.5) continue;
    const distance = (row: (typeof column.rows)[number]) => {
      const delta = centerY(line) - median(row.anchors.map(centerY));
      return Math.abs(delta) * (delta < 0 ? 2 : 1);
    };
    const row = [...column.rows].sort((a, b) => distance(a) - distance(b))[0]!;
    const firstY = Math.min(...column.rows[0]!.anchors.map((anchor) => anchor.box.y));
    // A global month heading is context, rather than an additional event card.
    if (anchors.length > 1 && line.box.y + line.box.height < firstY - Math.max(0.12, line.box.height * 2)) continue;
    const horizontalGap = Math.min(
      ...row.anchors.map((anchor) =>
        Math.max(0, anchor.box.x - line.box.x - line.box.width, line.box.x - anchor.box.x - anchor.box.width),
      ),
    );
    // An unread date must not make an isolated card borrow its neighbour's date.
    if (columns.length > 1 && horizontalGap > Math.max(0.04, line.box.height * 2)) {
      unanchored.push(line);
      continue;
    }
    row.region.lines.push(line);
  }
  return [...groups.flatMap((column) => column.rows.map((row) => row.region)), ...regions(unanchored)];
}

const isPhotoMetadata = (text: string) =>
  /^(?:data\b|godzina\b|sektor\b|rz[ąa]d\b|cena\b|parter\b|balkon\b|widoczno[śs][ćc]\b|agencja\b|organizator\b|patronat\b|(?:miejsce|lokalizacja|adres)\s*[:|]?$)/iu.test(
    text.trim(),
  ) || /\d\s*(?:z[łl]|pln|eur|€)\b/iu.test(text);

function photoTitle(candidates: LineData[]): { title: string | null; lines: OcrLine[] } {
  const eligible = candidates.filter(
    (item) =>
      !item.dates.length &&
      !item.times.length &&
      !isPhotoMetadata(item.residue) &&
      (item.residue.match(/\p{L}/gu)?.length ?? 0) >= 3 &&
      (item.line.confidence ?? 100) >= 40,
  );
  const base = [...eligible].sort(
    (a, b) => b.line.box.width * b.line.box.height ** 2 - a.line.box.width * a.line.box.height ** 2,
  )[0];
  if (!base)
    return {
      title:
        candidates.find((item) => item.dates.length && item.residue && !isPhotoMetadata(item.residue))?.residue ?? null,
      lines: [],
    };
  const comparable = eligible.filter(
    (item) => item.line.box.height >= base.line.box.height * 0.35 && item.line.box.height <= base.line.box.height * 1.4,
  );
  const ordered = [...comparable].sort((a, b) => a.line.box.y - b.line.box.y || a.line.box.x - b.line.box.x);
  const index = ordered.indexOf(base);
  let start = index;
  let end = index;
  const adjacent = (a: LineData, b: LineData) =>
    b.line.box.y - a.line.box.y - a.line.box.height <=
    Math.max(0.02, Math.min(a.line.box.height, b.line.box.height) * 1.4);
  while (start > 0 && adjacent(ordered[start - 1]!, ordered[start]!)) start--;
  while (end + 1 < ordered.length && adjacent(ordered[end]!, ordered[end + 1]!)) end++;
  const selected = ordered.slice(start, end + 1);
  return {
    title: selected
      .map((item) => item.residue)
      .join(' ')
      .replace(/^(?:tytuł|wydarzenie)\s*:\s*/iu, '')
      .trim(),
    lines: selected.map((item) => item.line),
  };
}

function proposal(region: Region, photo = false): OcrEventProposal {
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
  const rawDates = data.flatMap((item) => item.dates);
  const dates = photo
    ? [
        ...new Map(
          rawDates.map((date) => [`${date.day}:${date.month}:${date.year}:${date.role}:${date.valid}`, date]),
        ).values(),
      ]
    : rawDates;
  const ranges = data.flatMap((item) => item.dateRanges);
  const uniqueRanges = [
    ...new Map(
      ranges.map((range) => [`${range.start.day}:${range.end.day}:${range.start.month}:${range.start.year}`, range]),
    ).values(),
  ];
  const dateRange =
    photo && dates.length === 2 && uniqueRanges.length === 1 && dates.every((date) => date.role === 'event')
      ? uniqueRanges[0]!
      : null;
  const rawTimes = data.flatMap((item) => item.times);
  const times = photo
    ? [...new Map(rawTimes.map((time) => [`${time.start}:${time.end}:${time.issue}`, time])).values()]
    : rawTimes;
  const explicitStarts = photo
    ? data.filter((item) => /(?:^|\s)start\b/iu.test(item.line.text)).flatMap((item) => item.times)
    : [];
  const explicitStart = explicitStarts.length === 1 && !explicitStarts[0]!.issue ? explicitStarts[0]! : null;
  const warnings: OcrWarning[] = [];
  const warn = (code: OcrWarningCode, lines = source) => warnings.push(warning(code, lines));
  if (!dates.length) warn('MISSING_DATE');
  if (dates.some((date) => !date.valid))
    warn(
      'INVALID_DATE',
      source.filter((line) => dates.some((date) => date.lineId === line.id && !date.valid)),
    );
  if (dates.some((date) => date.valid && date.year === null)) warn('MISSING_YEAR');
  if (dates.length > 1 && !dateRange) warn('AMBIGUOUS_DATE');
  if (dates.some((date) => date.role === 'registration')) warn('REGISTRATION_DATE');
  if (!times.length) warn('MISSING_TIME');
  if (times.some((time) => time.issue === 'INVALID_TIME')) warn('INVALID_TIME');
  if ((times.length > 1 && !explicitStart) || times.some((time) => time.issue === 'AMBIGUOUS_TIME'))
    warn('AMBIGUOUS_TIME');
  if (times.length > 1 && explicitStart) warn('PROGRAM_TIMES');
  if (region.ambiguous) warn('AMBIGUOUS_LAYOUT');

  const locationLine =
    data.find((item) => /^(?:miejsce|lokalizacja|adres)\s*:/iu.test(item.line.text.trim())) ??
    data.find(
      (item) =>
        (/^(?:dom kultury|sala|biblioteka|stadion|ul\.)(?:\s|$)/iu.test(item.residue) ||
          (!photo && /^szkoła(?:\s|$)/iu.test(item.residue)) ||
          /^szkoła\s+(?:podstawowa|średnia|muzyczna|nr\b|im\.)/iu.test(item.residue) ||
          (photo && /(?:^|\s)ul\.\s+\p{L}|^teren\s+zielony\b|^spodek$/iu.test(item.residue))) &&
        !item.dates.length,
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
  const photoSelection = photo ? photoTitle(titles) : null;
  const title = photoSelection
    ? photoSelection.title
    : (titles.find((item) => !item.dates.length && !item.times.length) ?? titles[0])?.residue
        .replace(/^(?:tytuł|wydarzenie)\s*:\s*/iu, '')
        .trim() || null;
  if (!title) warn('MISSING_TITLE');
  if (photo) {
    const relevant = new Set([
      ...photoSelection!.lines,
      ...data
        .filter((item) => item.dates.length || item.times.length || item === locationLine)
        .map((item) => item.line),
    ]);
    const uncertain = source.filter(
      (line) => relevant.has(line) && line.confidence !== undefined && line.confidence < 80,
    );
    if (uncertain.length) warn('LOW_CONFIDENCE', uncertain);
  }
  const date = dateRange
    ? dateRange.start.isoDate
    : dates.length === 1 && dates[0]!.role === 'event'
      ? dates[0]!.isoDate
      : null;
  // A shared time cannot safely be attached to one of several dates in the same region.
  const time =
    explicitStart ?? (times.length === 1 && (dates.length <= 1 || dateRange) && !times[0]!.issue ? times[0]! : null);
  const openingHours =
    dateRange && time?.start && time.end && source.some((line) => /godziny\s+otwarcia/iu.test(line.text))
      ? { startTime: time.start, endTime: time.end }
      : null;
  if (times.length && dates.length > 1 && !dateRange && !warnings.some((item) => item.code === 'AMBIGUOUS_TIME'))
    warn('AMBIGUOUS_TIME');
  return {
    title,
    location,
    dates,
    startDate: date,
    dateRange,
    openingHours,
    startTime: openingHours ? null : (time?.start ?? null),
    endTime: openingHours ? null : (time?.end ?? null),
    durationMinutes: dateRange ? null : (time?.duration ?? null),
    source,
    warnings,
    requiresConfirmation: true,
  };
}

/** Pure local parser: no clock, storage, network, OCR engine or event creation. */
export function parseOcrEvents(input: OcrDocument, options: { groupByDates?: boolean } = {}): OcrParseResult {
  const document = ocrDocumentSchema.parse(input);
  const blocks = new Map<string | undefined, OcrLine[]>();
  for (const line of document.lines) {
    if (!line.text.trim()) continue;
    const block = blocks.get(line.blockId) ?? [];
    block.push(line);
    blocks.set(line.blockId, block);
  }
  const proposals = [...blocks.values()]
    .flatMap(options.groupByDates ? photoRegions : regions)
    .map((region) => proposal(region, options.groupByDates))
    .sort(
      (a, b) =>
        (options.groupByDates && a.startDate && b.startDate ? a.startDate.localeCompare(b.startDate) : 0) ||
        a.source[0]!.box.y - b.source[0]!.box.y ||
        a.source[0]!.box.x - b.source[0]!.box.x,
    );
  return { proposals, warnings: proposals.length ? [] : [warning('MISSING_DATE', [])] };
}
