import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventForm } from './EventForm.js';

beforeEach(() => {
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
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('EventForm', () => {
  it('creates a timed single event without sending reminder changes', async () => {
    const save = vi.fn(async () => {});
    render(
      <MantineProvider>
        <EventForm members={[]} initialDate="2026-10-12" pending={false} onSave={save} onCancel={() => {}} />
      </MantineProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^Tytuł/), { target: { value: 'Basen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        title: 'Basen',
        description: null,
        location: null,
        participantIds: [],
        startDate: '2026-10-12',
        startTime: '09:00',
        durationMinutes: 60,
        kind: 'single',
        datePrecision: 'day',
        rrule: null,
      }),
    );
  });

  it('clears time and duration for all-day events', async () => {
    const save = vi.fn(async () => {});
    render(
      <MantineProvider>
        <EventForm members={[]} initialDate="2026-10-12" pending={false} onSave={save} onCancel={() => {}} />
      </MantineProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^Tytuł/), { target: { value: 'Wycieczka' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Całodniowe' }));
    expect(screen.queryByLabelText(/^Godzina/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ startTime: null, durationMinutes: null })),
    );
  });

  it('rejects a whitespace-only title and displays API errors', async () => {
    const save = vi.fn(async () => {
      throw new Error('Nie udało się zapisać.');
    });
    render(
      <MantineProvider>
        <EventForm members={[]} initialDate="2026-10-12" pending={false} onSave={save} onCancel={() => {}} />
      </MantineProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^Tytuł/), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText('Podaj tytuł.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Tytuł/), { target: { value: 'Basen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nie udało się zapisać.');
  });
});
