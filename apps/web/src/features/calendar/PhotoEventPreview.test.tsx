import { MantineProvider } from '@mantine/core';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { OcrDocument } from '@rodzina/shared';
import type { ComponentProps } from 'react';
import type { PhotoImportReview } from './PhotoImportReview.js';
import { PhotoEventPreview } from './PhotoEventPreview.js';
import { clearAccountData } from '../../accountStorage.js';

const { prepare, recognize, native, android, generation } = vi.hoisted(() => ({
  prepare: vi.fn(),
  recognize: vi.fn(),
  native: vi.fn(),
  android: { value: false },
  generation: { value: 0 },
}));
vi.mock('./ocrImage.js', () => ({ prepareOcrImage: prepare }));
vi.mock('./ocrWeb.js', () => ({ recognizeOcrImage: recognize }));
vi.mock('../../platform.js', () => ({ getSessionGeneration: () => generation.value, isAndroid: () => android.value }));
vi.mock('./ocrNative.js', () => ({ recognizeNativePhoto: native }));
vi.mock('./PhotoImportReview.js', () => ({
  PhotoImportReview: ({ result, renderSource }: ComponentProps<typeof PhotoImportReview>) =>
    result?.proposals.map((proposal, index) => <div key={index}>{renderSource(proposal, index)}</div>),
}));

const document: OcrDocument = {
  image: { width: 1000, height: 1000 },
  lines: [
    { id: '1', text: 'Koncert rodzinny', box: { x: 0.1, y: 0.1, width: 0.7, height: 0.05 } },
    { id: '2', text: '12 listopada godz. 18:30', box: { x: 0.1, y: 0.16, width: 0.7, height: 0.05 } },
  ],
};
const file = new File(['image'], 'poster.png', { type: 'image/png' });
const select = () => fireEvent.change(screen.getByLabelText('Wybierz zdjęcie'), { target: { files: [file] } });
function show(key = 'account-a') {
  return (
    <MantineProvider env="test">
      <PhotoEventPreview key={key} members={[]} timezone="Europe/Warsaw" initialDate="2026-11-03" onClose={vi.fn()} />
    </MantineProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  generation.value = 0;
  android.value = false;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:poster'), revokeObjectURL: vi.fn() }));
  prepare.mockResolvedValue({ width: 1000, height: 1000, blob: new Blob() });
  recognize.mockResolvedValue(document);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('photo preview', () => {
  it('uses the native result and shared parser without browser decoding', async () => {
    android.value = true;
    native.mockResolvedValue({ document, preview: 'data:image/jpeg;base64,YQ==' });
    render(show());
    fireEvent.click(screen.getByRole('button', { name: 'Wybierz zdjęcie' }));
    expect(await screen.findByRole('heading', { name: 'Koncert rodzinny' })).toBeInTheDocument();
    expect(screen.getByText(/Brakuje roku/)).toBeInTheDocument();
    expect(screen.getByAltText('Podgląd wybranego zdjęcia')).toHaveAttribute('src', 'data:image/jpeg;base64,YQ==');
    expect(prepare).not.toHaveBeenCalled();
    expect(recognize).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Wybierz zdjęcie')).not.toBeInTheDocument();
  });
  it('handles native picker cancellation and allows another attempt after an error', async () => {
    android.value = true;
    native.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Nie można odczytać zdjęcia.'));
    render(show());
    fireEvent.click(screen.getByRole('button', { name: 'Wybierz zdjęcie' }));
    expect(await screen.findByText(/Wybór anulowany/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Wybierz zdjęcie' }));
    expect(await screen.findByText('Nie można odczytać zdjęcia.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wybierz zdjęcie' })).toBeEnabled();
  });
  it('aborts native OCR and ignores its late response on account cleanup', async () => {
    android.value = true;
    let resolve!: (value: unknown) => void;
    native.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render(show());
    fireEvent.click(screen.getByRole('button', { name: 'Wybierz zdjęcie' }));
    const signal = native.mock.calls[0]![0] as AbortSignal;
    await act(async () => {
      await clearAccountData('account-changed');
    });
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ document }));
    expect(screen.queryByRole('heading', { name: 'Koncert rodzinny' })).not.toBeInTheDocument();
  });
  it('shows a missing time only as a non-blocking warning', async () => {
    recognize.mockResolvedValue({
      image: document.image,
      lines: [
        { id: '1', text: 'Dogoterapia', box: { x: 0.1, y: 0.1, width: 0.7, height: 0.05 } },
        { id: '2', text: '21.10.2026', box: { x: 0.1, y: 0.2, width: 0.7, height: 0.05 } },
      ],
    });
    render(show());
    select();
    expect(await screen.findByText('Nie rozpoznano godziny', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText('Godzina: wymaga potwierdzenia')).not.toBeInTheDocument();
    expect(screen.queryByText(/Uzupełnij ją albo wybierz/)).not.toBeInTheDocument();
    expect(screen.getByText('Data: 2026-10-21')).toBeInTheDocument();
  });
  it('shows the inclusive date range and opening hours without a misleading single-day duration', async () => {
    recognize.mockResolvedValue({
      image: document.image,
      lines: [
        { id: 'title', text: 'Targi piwowarskie', box: { x: 0.1, y: 0.1, width: 0.6, height: 0.04 } },
        { id: 'range', text: '12-14 marca 2024', box: { x: 0.1, y: 0.2, width: 0.5, height: 0.03 } },
        { id: 'label', text: 'Godziny otwarcia:', box: { x: 0.1, y: 0.3, width: 0.5, height: 0.03 } },
        { id: 'hours', text: '10:00-17:00', box: { x: 0.1, y: 0.34, width: 0.5, height: 0.03 } },
      ],
    });
    render(show());
    select();
    expect(await screen.findByText('Data: 2024-03-12 – 2024-03-14 (włącznie)')).toBeInTheDocument();
    expect(screen.getByText('Godziny otwarcia: 10:00–17:00')).toBeInTheDocument();
    expect(screen.queryByText('Godzina: wymaga potwierdzenia')).not.toBeInTheDocument();
  });
  it('shows source and missing-year warning without guessing a date or offering save', async () => {
    render(show());
    select();
    expect(await screen.findByRole('heading', { name: 'Koncert rodzinny' })).toBeInTheDocument();
    expect(screen.getByText(/Brakuje roku/)).toBeInTheDocument();
    expect(screen.getByText('Data: 12.11 (rok wymaga potwierdzenia)')).toBeInTheDocument();
    expect(screen.queryByText('Tekst źródłowy')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zapisz' })).not.toBeInTheDocument();
  });

  it('handles empty results and preparation errors', async () => {
    recognize.mockResolvedValue({ image: document.image, lines: [] });
    render(show());
    select();
    expect(await screen.findByText(/Nie rozpoznano propozycji/)).toBeInTheDocument();
    prepare.mockRejectedValueOnce(new Error('Uszkodzony obraz'));
    select();
    expect(await screen.findByText('Uszkodzony obraz')).toBeInTheDocument();
  });

  it('cancels and ignores late results, releases previews, and permits a new selection', async () => {
    let resolve!: (value: OcrDocument) => void;
    recognize.mockImplementationOnce(
      () =>
        new Promise<OcrDocument>((done) => {
          resolve = done;
        }),
    );
    render(show());
    select();
    await waitFor(() => expect(recognize).toHaveBeenCalledOnce());
    const signal = recognize.mock.calls[0]![1] as AbortSignal;
    fireEvent.click(screen.getByRole('button', { name: 'Anuluj odczyt' }));
    expect(signal.aborted).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:poster');
    await act(async () => resolve(document));
    expect(screen.queryByRole('heading', { name: 'Koncert rodzinny' })).not.toBeInTheDocument();
    select();
    expect(await screen.findByRole('heading', { name: 'Koncert rodzinny' })).toBeInTheDocument();
  });

  it('reselection aborts the old run, account change unmounts and discards its results', async () => {
    const resolvers: Array<(value: OcrDocument) => void> = [];
    recognize.mockImplementation(() => new Promise<OcrDocument>((done) => resolvers.push(done)));
    const view = render(show());
    select();
    await waitFor(() => expect(recognize).toHaveBeenCalledTimes(1));
    const firstSignal = recognize.mock.calls[0]![1] as AbortSignal;
    select();
    await waitFor(() => expect(recognize).toHaveBeenCalledTimes(2));
    expect(firstSignal.aborted).toBe(true);
    const secondSignal = recognize.mock.calls[1]![1] as AbortSignal;
    generation.value++;
    view.rerender(show('account-b'));
    expect(secondSignal.aborted).toBe(true);
    await act(async () => resolvers.forEach((resolve) => resolve(document)));
    expect(screen.queryByRole('heading', { name: 'Koncert rodzinny' })).not.toBeInTheDocument();
    expect(screen.queryByAltText('Podgląd wybranego zdjęcia')).not.toBeInTheDocument();
  });

  it('account cleanup terminates OCR before the screen unmounts', async () => {
    let resolve!: (value: OcrDocument) => void;
    recognize.mockImplementation(
      () =>
        new Promise<OcrDocument>((done) => {
          resolve = done;
        }),
    );
    render(show());
    select();
    await waitFor(() => expect(recognize).toHaveBeenCalledOnce());
    const signal = recognize.mock.calls[0]![1] as AbortSignal;
    await act(async () => {
      await clearAccountData('account-changed');
    });
    expect(signal.aborted).toBe(true);
    expect(screen.queryByAltText('Podgląd wybranego zdjęcia')).not.toBeInTheDocument();
    await act(async () => resolve(document));
    expect(screen.queryByRole('heading', { name: 'Koncert rodzinny' })).not.toBeInTheDocument();
  });
});
