import { ocrDocumentSchema, parseOcrEvents, type OcrDocument, type OcrLine } from '@rodzina/shared';
import { prepareOcrLineImage, prepareOcrVariants } from './ocrImage.js';
import type { Line, Page, Word } from 'tesseract.js';

declare const __OCR_ASSET_BASE__: string;
export const ocrAssetBase = typeof __OCR_ASSET_BASE__ === 'string' ? __OCR_ASSET_BASE__ : '';

function fragments(line: Line): Array<Pick<Line, 'text' | 'bbox'> & { confidence?: number }> {
  if (!line.words?.length) return [line];
  const groups: Word[][] = [];
  const heights = line.words
    .filter((word) => /[\p{L}\d]/u.test(word.text))
    .map((word) => word.bbox.y1 - word.bbox.y0)
    .sort((a, b) => a - b);
  const height = heights[Math.floor(heights.length / 2)] ?? line.bbox.y1 - line.bbox.y0;
  for (const word of [...line.words].sort((a, b) => a.bbox.x0 - b.bbox.x0)) {
    const previous = groups.at(-1)?.at(-1);
    const center = (item: Word) => (item.bbox.y0 + item.bbox.y1) / 2;
    // Decorations can share a Tesseract line with a date despite a different baseline.
    if (
      !previous ||
      word.bbox.x0 - previous.bbox.x1 > height * 3 ||
      Math.abs(center(word) - center(previous)) > height * 0.8
    )
      groups.push([]);
    groups.at(-1)!.push(word);
  }
  return groups.map((words) => ({
    text: groups.length === 1 ? line.text : words.map((word) => word.text).join(' '),
    confidence: words.reduce((sum, word) => sum + word.confidence, 0) / words.length,
    bbox: {
      x0: Math.min(...words.map((word) => word.bbox.x0)),
      y0: Math.min(...words.map((word) => word.bbox.y0)),
      x1: Math.max(...words.map((word) => word.bbox.x1)),
      y1: Math.max(...words.map((word) => word.bbox.y1)),
    },
  }));
}

export function tesseractDocument(page: Pick<Page, 'blocks'>, image: OcrDocument['image']): OcrDocument {
  const lines: OcrDocument['lines'] = [];
  // Tesseract blocks often separate a poster heading from its date by typography.
  // Leave optional blockId unset: the shared parser groups lines geometrically.
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines.flatMap(fragments)) {
        const { x0, y0, x1, y1 } = line.bbox;
        const x = Math.max(0, Math.min(1, x0 / image.width));
        const y = Math.max(0, Math.min(1, y0 / image.height));
        const width = Math.min(1, x1 / image.width) - x;
        const height = Math.min(1, y1 / image.height) - y;
        if (!line.text.trim() || width <= 0 || height <= 0) continue;
        lines.push({
          id: `line-${lines.length}`,
          text: line.text.trim(),
          box: { x, y, width, height },
          ...(Number.isFinite(line.confidence) ? { confidence: Math.max(0, Math.min(100, line.confidence!)) } : {}),
        });
      }
    }
  }
  return ocrDocumentSchema.parse({ image, lines });
}

export function mergeOcrPasses(documents: OcrDocument[]): OcrDocument {
  const lines: OcrLine[] = [];
  const comparable = (a: OcrLine, b: OcrLine) => {
    const width = Math.max(0, Math.min(a.box.x + a.box.width, b.box.x + b.box.width) - Math.max(a.box.x, b.box.x));
    const height = Math.max(0, Math.min(a.box.y + a.box.height, b.box.y + b.box.height) - Math.max(a.box.y, b.box.y));
    return (
      (width * height) / Math.min(a.box.width * a.box.height, b.box.width * b.box.height) > 0.65 &&
      (width * height) / Math.max(a.box.width * a.box.height, b.box.width * b.box.height) > 0.35 &&
      height / Math.min(a.box.height, b.box.height) > 0.65
    );
  };
  const foldText = (text: string) => text.toLocaleLowerCase('pl-PL').replace(/[^\p{L}\d]/gu, '');
  const withoutStroke = (text: string) => text.toLocaleLowerCase('pl-PL').replace(/[|i]/gu, '');
  const dates = (line: OcrLine) =>
    parseOcrEvents({ image: documents[0]!.image, lines: [line] })
      .proposals.flatMap((proposal) => proposal.dates)
      .map((date) => `${date.day}:${date.month}:${date.year}:${date.valid}`)
      .join('|');
  for (const document of documents)
    for (const line of document.lines) {
      const index = lines.findIndex((old) => comparable(old, line));
      if (index < 0) {
        lines.push(line);
        continue;
      }
      const old = lines[index]!;
      const oldDates = dates(old);
      const newDates = dates(line);
      if (oldDates && newDates && oldDates !== newDates) {
        if (!lines.some((other) => comparable(other, line) && dates(other) === newDates)) lines.push(line);
        continue;
      }
      if (oldDates && !newDates) continue;
      const fuller =
        foldText(line.text).includes(foldText(old.text)) &&
        foldText(line.text).length > foldText(old.text).length &&
        (line.confidence ?? 0) >= 50;
      const resolvedGlyph =
        old.text.includes('|') &&
        !line.text.includes('|') &&
        withoutStroke(old.text) === withoutStroke(line.text) &&
        (line.confidence ?? 0) >= 50;
      const losesGlyph =
        line.text.includes('|') &&
        !old.text.includes('|') &&
        withoutStroke(old.text) === withoutStroke(line.text) &&
        (old.confidence ?? 0) >= 50;
      if (
        !losesGlyph &&
        ((!oldDates && newDates) || fuller || resolvedGlyph || (line.confidence ?? 0) > (old.confidence ?? 0))
      )
        lines[index] = line;
    }
  return ocrDocumentSchema.parse({
    image: documents[0]!.image,
    lines: lines.map((line, index) => ({ ...line, id: `line-${index}` })),
  });
}

export async function recognizeOcrImage(
  image: { blob: Blob; width: number; height: number },
  signal: AbortSignal,
  onProgress: (message: string, progress: number) => void,
): Promise<OcrDocument> {
  signal.throwIfAborted();
  // Own the pinned Tesseract.js worker protocol so cancellation also terminates
  // initialization; createWorker() exposes its worker only after initialization.
  const worker = new Worker(`${ocrAssetBase}/worker.min.js`);
  let pending: { resolve: (value: unknown) => void; reject: (reason: Error) => void } | undefined;
  let sequence = 0;
  let activeJob = '';
  const stop = () => {
    worker.terminate();
    pending?.reject(new DOMException('Anulowano odczyt.', 'AbortError'));
    pending = undefined;
  };
  signal.addEventListener('abort', stop, { once: true });
  const timeout = setTimeout(() => {
    pending?.reject(new Error('Odczyt trwa zbyt długo. Spróbuj ponownie z mniejszym zdjęciem.'));
    worker.terminate();
  }, 120_000);
  worker.onerror = (event) => {
    event.preventDefault();
    pending?.reject(new Error('Nie udało się uruchomić odczytu. Sprawdź połączenie i zasoby przeglądarki.'));
  };
  worker.onmessageerror = () => pending?.reject(new Error('Przeglądarka nie może odebrać wyniku odczytu.'));
  worker.onmessage = ({ data: packet }) => {
    if (packet.jobId !== activeJob) return;
    if (packet.status === 'resolve') pending?.resolve(packet.data);
    if (packet.status === 'reject')
      pending?.reject(new Error('Nie udało się odczytać zdjęcia lub załadować zasobów OCR. Spróbuj ponownie.'));
    if (packet.status === 'progress') {
      const recognizing = packet.data.status === 'recognizing text';
      onProgress(
        recognizing ? 'Odczytywanie tekstu' : 'Ładowanie lokalnego silnika i języka polskiego',
        recognizing ? Math.round(Math.max(0, Math.min(1, packet.data.progress)) * 100) : 0,
      );
    }
  };
  const job = (action: string, payload: unknown) => {
    signal.throwIfAborted();
    activeJob = String(++sequence);
    return new Promise<unknown>((resolve, reject) => {
      pending = { resolve, reject };
      worker.postMessage({ workerId: 'photo-ocr', jobId: activeJob, action, payload });
    });
  };
  try {
    await job('load', {
      options: { lstmOnly: true, corePath: new URL(ocrAssetBase, window.location.href).href, logging: false },
    });
    await job('loadLanguage', {
      langs: 'pol',
      options: {
        langPath: new URL(ocrAssetBase, window.location.href).href,
        cacheMethod: 'none',
        gzip: true,
        lstmOnly: true,
      },
    });
    await job('initialize', { langs: 'pol', oem: 1, config: {} });
    await job('setParameters', { params: { tessedit_pageseg_mode: '11', user_defined_dpi: '300' } });
    const recognize = async (input: typeof image) => {
      const bytes = new Uint8Array(await input.blob.arrayBuffer());
      signal.throwIfAborted();
      const page = (await job('recognize', {
        image: bytes,
        options: {},
        output: { text: true, blocks: true },
      })) as Page;
      return tesseractDocument(page, { width: input.width, height: input.height });
    };
    const original = await recognize(image);
    onProgress('Poprawianie kontrastu i odczyt kolorowego plakatu', 0);
    const variants = await prepareOcrVariants(image, signal);
    const passes = [original];
    for (const variant of variants) {
      signal.throwIfAborted();
      passes.push(await recognize(variant));
    }
    signal.throwIfAborted();
    let merged = mergeOcrPasses(passes);
    const uncertain = merged.lines
      .filter(
        (line) =>
          (/\d{4}/u.test(line.text) || (line.confidence ?? 100) < 80) &&
          ((line.text.match(/\p{L}/gu)?.length ?? 0) >= 3 || /\d{4}/u.test(line.text)),
      )
      .slice(0, 32);
    await job('setParameters', { params: { tessedit_pageseg_mode: '7' } });
    for (const line of uncertain) {
      onProgress('Sprawdzanie niepewnych dat i napisów', 0);
      const crop = await prepareOcrLineImage(image, line, signal);
      const result = await recognize(crop);
      // One isolated source line has one box in the full image, regardless of crop scale.
      if (result.lines.length !== 1) continue;
      merged = mergeOcrPasses([merged, { image: merged.image, lines: [{ ...result.lines[0]!, box: line.box }] }]);
    }
    return merged;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', stop);
    worker.terminate();
    pending = undefined;
  }
}
