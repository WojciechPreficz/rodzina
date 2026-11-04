import { registerPlugin } from '@capacitor/core';
import { ocrDocumentSchema } from '@rodzina/shared';
import { mergeNativeOcrPasses } from './ocrNativeMerge.js';

const nativeOcr = registerPlugin<{
  pickAndRecognize(options: { requestId: string }): Promise<{
    cancelled?: boolean;
    document?: unknown;
    alternateDocument?: unknown;
    binaryDocument?: unknown;
    refinedDocument?: unknown;
    preview?: string;
  }>;
  cancel(options: { requestId: string }): Promise<void>;
}>('RodzinaOcr');

export async function recognizeNativePhoto(signal: AbortSignal) {
  signal.throwIfAborted();
  const requestId = crypto.randomUUID();
  let rejectAbort: (error: Error) => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const cancel = (reason: Error) => {
    void nativeOcr.cancel({ requestId }).catch(() => undefined);
    rejectAbort(reason);
  };
  const abort = () => cancel(new DOMException('Odczyt anulowany.', 'AbortError'));
  signal.addEventListener('abort', abort, { once: true });
  // Covers a stalled provider or OCR without keeping the screen busy indefinitely.
  const timeout = setTimeout(() => cancel(new Error('Odczyt trwa zbyt długo. Wybierz zdjęcie ponownie.')), 120_000);
  try {
    const result = await Promise.race([nativeOcr.pickAndRecognize({ requestId }), aborted]);
    signal.throwIfAborted();
    if (result.cancelled) return;
    let document = ocrDocumentSchema.parse(result.document);
    for (const pass of [result.alternateDocument, result.binaryDocument, result.refinedDocument]) {
      if (pass) document = mergeNativeOcrPasses(document, ocrDocumentSchema.parse(pass));
    }
    const preview = result.preview;
    if (preview && (preview.length > 350_000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(preview)))
      throw new Error('Nieprawidłowy podgląd zdjęcia.');
    return { document, preview };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}
