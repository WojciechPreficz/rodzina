import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { recognizeNativePhoto } from './ocrNative.js';

const { pick, cancel } = vi.hoisted(() => ({ pick: vi.fn(), cancel: vi.fn() }));
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({ pickAndRecognize: pick, cancel }) }));
const document = { image: { width: 100, height: 200 }, lines: [] };
beforeEach(() => {
  vi.resetAllMocks();
  cancel.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
});

it('validates the shared document and bounded preview', async () => {
  pick.mockResolvedValueOnce({ document, preview: 'data:image/jpeg;base64,YQ==' });
  expect(await recognizeNativePhoto(new AbortController().signal)).toEqual({
    document,
    preview: 'data:image/jpeg;base64,YQ==',
  });
  pick.mockResolvedValueOnce({ document, preview: 'https://external.test/photo' });
  await expect(recognizeNativePhoto(new AbortController().signal)).rejects.toThrow('Nieprawidłowy podgląd');
  pick.mockResolvedValueOnce({ document, preview: `data:image/jpeg;base64,${'A'.repeat(350_000)}` });
  await expect(recognizeNativePhoto(new AbortController().signal)).rejects.toThrow('Nieprawidłowy podgląd');
  pick.mockResolvedValueOnce({ document: { ...document, lines: [{ text: 'invalid' }] } });
  await expect(recognizeNativePhoto(new AbortController().signal)).rejects.toThrow();
});

it('recovers a date from the optional isolated-line pass without borrowing another card date', async () => {
  const source = { id: '1', text: 'S.11.2026 R.', confidence: 95, box: { x: 0.1, y: 0.1, width: 0.5, height: 0.05 } };
  pick.mockResolvedValueOnce({
    document: { ...document, lines: [source] },
    refinedDocument: { ...document, lines: [{ ...source, text: '5.11.2026 R.', confidence: 80 }] },
  });
  const result = await recognizeNativePhoto(new AbortController().signal);
  expect(result?.document.lines.map(({ text }) => text)).toEqual(['5.11.2026 R.']);
});
it('settles immediately on abort and cancels only its own operation', async () => {
  let resolve!: (value: unknown) => void;
  pick.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const controller = new AbortController();
  const pending = recognizeNativePhoto(controller.signal);
  const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await assertion;
  expect(cancel).toHaveBeenCalledWith(pick.mock.calls[0]![0]);
  resolve({ document });
});
it('merges the optional native contrast pass before returning the shared document', async () => {
  const source = {
    id: '1',
    text: 'AUDYCA MUZYCZNA',
    confidence: 60,
    box: { x: 0.1, y: 0.1, width: 0.5, height: 0.05 },
  };
  pick.mockResolvedValueOnce({
    document: { ...document, lines: [source] },
    alternateDocument: { ...document, lines: [{ ...source, text: 'AUDYCJA MUZYCZNA', confidence: 95 }] },
  });
  const result = await recognizeNativePhoto(new AbortController().signal);
  expect(result?.document.lines.map(({ text }) => text)).toEqual(['AUDYCJA MUZYCZNA']);
});
it('handles cancelled picker and bounds stalled provider time', async () => {
  pick.mockResolvedValueOnce({ cancelled: true });
  expect(await recognizeNativePhoto(new AbortController().signal)).toBeUndefined();
  vi.useFakeTimers();
  pick.mockImplementation(() => new Promise(() => {}));
  const pending = recognizeNativePhoto(new AbortController().signal);
  const assertion = expect(pending).rejects.toThrow('Odczyt trwa zbyt długo');
  await vi.advanceTimersByTimeAsync(120_000);
  await assertion;
  expect(cancel).toHaveBeenCalledOnce();
});
