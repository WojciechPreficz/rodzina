import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Page } from 'tesseract.js';
import { parseOcrEvents } from '@rodzina/shared';
import { mergeOcrPasses, recognizeOcrImage, tesseractDocument } from './ocrWeb.js';
import * as imagePreparation from './ocrImage.js';
import { maxOcrBytes, ocrImageSize, prepareOcrImage, validateOcrFile } from './ocrImage.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OCR image preparation and adapter', () => {
  it('merges corresponding fragments across scales without duplicating dates', () => {
    const first = {
      image: { width: 2000, height: 1000 },
      lines: [{ id: 'a', text: 'KATOWICE', confidence: 80, box: { x: 0.1, y: 0.1, width: 0.3, height: 0.08 } }],
    };
    const second = {
      image: { width: 1000, height: 500 },
      lines: [
        { id: 'a', text: 'KATOWICE STAND', confidence: 75, box: { x: 0.1, y: 0.1, width: 0.5, height: 0.08 } },
        { id: 'b', text: '14 06', confidence: 96, box: { x: 0.7, y: 0.8, width: 0.2, height: 0.03 } },
      ],
    };
    const merged = mergeOcrPasses([first, second, second]);
    expect(merged.image).toEqual(first.image);
    expect(merged.lines.map((line) => line.text)).toEqual(['KATOWICE STAND', '14 06']);
    expect(merged.lines.map((line) => line.id)).toEqual(['line-0', 'line-1']);
  });

  it('does not let an oversized heading box swallow a distinct subtitle from another pass', () => {
    const image = { width: 1000, height: 1000 };
    const first = {
      image,
      lines: [{ id: 'a', text: 'KONCERT', confidence: 86, box: { x: 0.1, y: 0.1, width: 0.6, height: 0.2 } }],
    };
    const second = {
      image,
      lines: [
        { id: 'b', text: 'ZAKOŃCZENIE LATA', confidence: 94, box: { x: 0.1, y: 0.25, width: 0.6, height: 0.05 } },
      ],
    };
    expect(mergeOcrPasses([first, second]).lines.map((line) => line.text)).toEqual(['KONCERT', 'ZAKOŃCZENIE LATA']);
  });

  it('tries local contrast variants when the first pass has no date and terminates its worker', async () => {
    const terminate = vi.fn();
    const blob = { arrayBuffer: async () => new ArrayBuffer(1) } as Blob;
    const variants = vi
      .spyOn(imagePreparation, 'prepareOcrVariants')
      .mockResolvedValue([{ blob, width: 500, height: 500 }]);
    let recognition = 0;
    vi.stubGlobal(
      'Worker',
      class {
        onmessage: ((event: MessageEvent) => void) | null = null;
        terminate = terminate;
        postMessage(packet: { action: string; jobId: string }) {
          const data =
            packet.action === 'recognize'
              ? ++recognition === 1
                ? { blocks: [] }
                : {
                    blocks: [
                      {
                        paragraphs: [
                          {
                            lines: [{ text: '30 SIERPNIA', confidence: 95, bbox: { x0: 50, y0: 50, x1: 300, y1: 80 } }],
                          },
                        ],
                      },
                    ],
                  }
              : {};
          queueMicrotask(() =>
            this.onmessage?.({ data: { jobId: packet.jobId, status: 'resolve', data } } as MessageEvent),
          );
        }
      },
    );
    const result = await recognizeOcrImage({ blob, width: 1000, height: 1000 }, new AbortController().signal, vi.fn());
    expect(variants).toHaveBeenCalledOnce();
    expect(result.lines[0]?.text).toBe('30 SIERPNIA');
    expect(terminate).toHaveBeenCalledOnce();
  });
  it('limits files, accepts supported image types and resizes oriented dimensions', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp'])
      expect(() => validateOcrFile(new File(['x'], 'image', { type }))).not.toThrow();
    expect(() => validateOcrFile(new File(['x'], 'x', { type: 'application/pdf' }))).toThrow('JPEG');
    expect(() => validateOcrFile({ type: 'image/png', size: maxOcrBytes + 1 } as File)).toThrow('20 MB');
    expect(() => validateOcrFile(new File([], 'x', { type: 'image/png' }))).toThrow('pusty');
    expect(ocrImageSize(6400, 4800)).toEqual({ width: 3200, height: 2400 });
    expect(ocrImageSize(4800, 6400)).toEqual({ width: 2400, height: 3200 });
    expect(ocrImageSize(800, 600)).toEqual({ width: 2000, height: 1500 });
    expect(ocrImageSize(2000, 1400)).toEqual({ width: 2000, height: 1400 });
    expect(ocrImageSize(100, 80)).toEqual({ width: 300, height: 240 });
  });

  it('reports missing browser support, corrupt files and releases late decoded images', async () => {
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    vi.stubGlobal('createImageBitmap', undefined);
    await expect(prepareOcrImage(file, new AbortController().signal)).rejects.toThrow('przeglądarka');
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode')));
    await expect(prepareOcrImage(file, new AbortController().signal)).rejects.toThrow('uszkodzony');
    const close = vi.fn();
    const controller = new AbortController();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        controller.abort();
        return { width: 600, height: 800, close };
      }),
    );
    await expect(prepareOcrImage(file, controller.signal)).rejects.toThrow();
    expect(close).toHaveBeenCalledOnce();
    expect(createImageBitmap).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
  });

  it('normalizes positions and leaves geometric grouping to the shared parser', () => {
    const page = {
      blocks: [0, 1].map((column) => ({
        paragraphs: [
          {
            lines: [
              { text: `Kolumna ${column}`, bbox: { x0: column * 500, y0: 100, x1: column * 500 + 400, y1: 150 } },
            ],
          },
        ],
      })),
    } as unknown as Pick<Page, 'blocks'>;
    const document = tesseractDocument(page, { width: 1000, height: 500 });
    expect(document.lines).toHaveLength(2);
    expect(parseOcrEvents(document).proposals).toHaveLength(2);
    expect(document.lines[1]).toEqual({
      id: 'line-1',
      text: 'Kolumna 1',
      box: { x: 0.5, y: 0.2, width: 0.4, height: 0.09999999999999998 },
    });
    expect(tesseractDocument({ blocks: null }, { width: 100, height: 100 }).lines).toEqual([]);
  });

  it('connects a heading and date from adjacent Tesseract typography blocks', () => {
    const page = {
      blocks: [
        { paragraphs: [{ lines: [{ text: 'Koncert rodzinny', bbox: { x0: 100, y0: 100, x1: 700, y1: 160 } }] }] },
        {
          paragraphs: [
            { lines: [{ text: '12 listopada 2026 godz. 18:30', bbox: { x0: 100, y0: 200, x1: 800, y1: 250 } }] },
          ],
        },
      ],
    } as unknown as Pick<Page, 'blocks'>;
    const result = parseOcrEvents(tesseractDocument(page, { width: 1000, height: 1000 }));
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      title: 'Koncert rodzinny',
      startDate: '2026-11-12',
      startTime: '18:30',
    });
  });

  it('separates a decoration on a different baseline without splitting normal punctuation', () => {
    const word = (text: string, x0: number, y0: number, x1: number, y1: number) => ({
      text,
      confidence: 95,
      bbox: { x0, y0, x1, y1 },
    });
    const page = {
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                {
                  text: '6.10.2026 R. ŻY',
                  bbox: { x0: 100, y0: 20, x1: 450, y1: 160 },
                  words: [
                    word('6.10.2026', 100, 100, 300, 130),
                    word('R.', 330, 100, 350, 130),
                    word('ŻY', 380, 20, 450, 160),
                  ],
                },
                {
                  text: 'SCK - KINO',
                  bbox: { x0: 100, y0: 200, x1: 360, y1: 230 },
                  words: [
                    word('SCK', 100, 200, 200, 230),
                    word('-', 230, 213, 240, 218),
                    word('KINO', 260, 200, 360, 230),
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as Pick<Page, 'blocks'>;
    const result = tesseractDocument(page, { width: 1000, height: 1000 });
    expect(result.lines.map((line) => line.text)).toEqual(['6.10.2026 R.', 'ŻY', 'SCK - KINO']);
    expect(result.lines[0]?.box).toMatchObject({ x: 0.1, y: 0.1, width: 0.24999999999999997 });
    expect(result.lines.every((line) => line.confidence === 95)).toBe(true);
  });

  it('terminates a worker immediately when cancelled during initialization', async () => {
    const terminate = vi.fn();
    const postMessage = vi.fn();
    vi.stubGlobal(
      'Worker',
      class {
        terminate = terminate;
        postMessage = postMessage;
      },
    );
    const controller = new AbortController();
    const pending = recognizeOcrImage({ blob: new Blob(), width: 100, height: 100 }, controller.signal, vi.fn());
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'load' }));
    controller.abort();
    await expect(pending).rejects.toThrow('Anulowano');
    expect(terminate).toHaveBeenCalled();
  });
});
