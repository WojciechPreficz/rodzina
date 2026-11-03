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
