export const maxOcrBytes = 20 * 1024 * 1024;

export function validateOcrFile(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Wybierz zdjęcie JPEG, PNG lub WebP.');
  if (file.size > maxOcrBytes) throw new Error('Zdjęcie przekracza limit 20 MB.');
  if (file.size === 0) throw new Error('Plik jest pusty lub uszkodzony.');
}

export function ocrImageSize(width: number, height: number) {
  const longest = Math.max(width, height);
  // Small screenshots need larger glyphs; retain detail in already large posters.
  const scale = Math.min(3, Math.max(1, 2000 / longest), 3200 / longest);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function prepareOcrImage(file: File, signal: AbortSignal) {
  validateOcrFile(file);
  signal.throwIfAborted();
  if (typeof createImageBitmap !== 'function' || typeof Worker === 'undefined' || typeof WebAssembly === 'undefined')
    throw new Error('Ta przeglądarka nie obsługuje odczytu zdjęć. Użyj aktualnej przeglądarki.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    signal.throwIfAborted();
    throw new Error('Nie można odczytać zdjęcia. Plik jest uszkodzony lub nieobsługiwany.');
  }
  const canvas = document.createElement('canvas');
  try {
    signal.throwIfAborted();
    const size = ocrImageSize(bitmap.width, bitmap.height);
    Object.assign(canvas, size);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Przeglądarka nie może przygotować zdjęcia.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('Nie udało się przygotować zdjęcia.'))),
        'image/png',
      );
    });
    signal.throwIfAborted();
    return { ...size, blob };
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}

/** Additional local passes for colored posters; the original preview stays unchanged. */
export async function prepareOcrVariants(image: { blob: Blob; width: number; height: number }, signal: AbortSignal) {
  const bitmap = await createImageBitmap(image.blob);
  const canvas = document.createElement('canvas');
  const variants: Array<{ blob: Blob; width: number; height: number }> = [];
  try {
    for (const [scale, channel] of [
      [1, 'luma'],
      [0.5, 'luma'],
      [1, 'red'],
    ] as const) {
      signal.throwIfAborted();
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Nie udało się poprawić kontrastu zdjęcia.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let row = 0; row < canvas.height; row++) {
        if (row % 128 === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          signal.throwIfAborted();
        }
        for (let column = 0; column < canvas.width; column++) {
          const index = (row * canvas.width + column) * 4;
          const value =
            channel === 'red'
              ? pixels.data[index]!
              : Math.round(
                  pixels.data[index]! * 0.299 + pixels.data[index + 1]! * 0.587 + pixels.data[index + 2]! * 0.114,
                );
          pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = value;
        }
      }
      context.putImageData(pixels, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error('Nie udało się przygotować kontrastu.'))),
          'image/png',
        ),
      );
      signal.throwIfAborted();
      variants.push({ blob, width: canvas.width, height: canvas.height });
    }
    return variants;
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}
