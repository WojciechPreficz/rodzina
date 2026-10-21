import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { CalendarPage } from './CalendarPage.js';
vi.mock('../notifications/NotificationBanner.js', () => ({ NotificationBanner: () => null }));

vi.mock('../../auth.js', () => ({ useMe: () => ({ family: { timezone: 'Europe/Warsaw' } }) }));
vi.mock('../family/familyQueries.js', () => ({
  useMembersQuery: () => ({
    data: [
      { id: 'anna', displayName: 'Anna', color: '#2F9E44' },
      { id: 'piotr', displayName: 'Piotr', color: '#1C7ED6' },
    ],
    error: null,
    isPending: false,
  }),
}));
vi.mock('@schedule-x/react', () => ({ useCalendarApp: () => ({}), ScheduleXCalendar: () => <div /> }));
vi.mock('./calendarQueries.js', () => ({
  useCalendarReadOnly: () => false,
  calendarOnlineHint: 'Dostępne po połączeniu z internetem',
  useOccurrences: () => ({
    coverage: 'complete',
    data: [
      {
        eventId: 'event-1',
        occurrenceDate: '2026-10-19',
        title: 'Basen',
        startUtc: Date.parse('2026-10-19T15:00:00Z'),
        endUtc: Date.parse('2026-10-19T16:00:00Z'),
        participants: [{ id: 'anna', displayName: 'Anna', color: '#2F9E44' }],
      },
    ],
    error: null,
  }),
  useDistantEvents: () => ({ data: [], error: null }),
  useCalendarMutations: () => ({ create: { isPending: false } }),
}));

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

describe('calendar creation modes', () => {
  it.each(['Jednorazowe', 'Powtarzające się', 'Odległy termin'])('opens the full %s form from the calendar', (mode) => {
    render(
      <MantineProvider env="test">
        <MemoryRouter>
          <CalendarPage />
        </MemoryRouter>
      </MantineProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj wydarzenie' }));
    for (const name of ['Jednorazowe', 'Powtarzające się', 'Odległy termin'])
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: mode }));
    expect(screen.getByLabelText(/^Tytuł/)).toBeInTheDocument();
    if (mode === 'Powtarzające się')
      expect(screen.getByLabelText('Zakończenie', { selector: 'input' })).toBeInTheDocument();
    if (mode === 'Odległy termin')
      expect(screen.getByLabelText('Dokładność terminu', { selector: 'input' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Anuluj' }));
    expect(screen.getByRole('button', { name: 'Dodaj wydarzenie' })).toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
});

describe('calendar member filters', () => {
  it('toggles multiple members and restores all events when the last filter is removed', () => {
    render(
      <MantineProvider env="test">
        <MemoryRouter>
          <CalendarPage />
        </MemoryRouter>
      </MantineProvider>,
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    const anna = screen.getByRole('button', { name: 'Anna' });
    const piotr = screen.getByRole('button', { name: 'Piotr' });
    const emptyMessage = 'Brak wydarzeń w wybranym zakresie.';
    expect(anna).toHaveAttribute('aria-pressed', 'false');
    expect(piotr).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Wszyscy domownicy')).toBeInTheDocument();

    fireEvent.click(piotr);
    expect(piotr).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Wszyscy domownicy')).not.toBeInTheDocument();
    expect(screen.getByText(emptyMessage)).toBeInTheDocument();

    fireEvent.click(anna);
    expect(anna).toHaveAttribute('aria-pressed', 'true');
    expect(piotr).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();

    fireEvent.click(anna);
    expect(anna).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(emptyMessage)).toBeInTheDocument();
    fireEvent.click(piotr);
    expect(piotr).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Wszyscy domownicy')).toBeInTheDocument();
    expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();
  });
});
