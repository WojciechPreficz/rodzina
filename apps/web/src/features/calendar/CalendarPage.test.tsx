import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { CalendarPage } from './CalendarPage.js';

vi.mock('../../auth.js', () => ({ useMe: () => ({ family: { timezone: 'Europe/Warsaw' } }) }));
vi.mock('../family/familyQueries.js', () => ({ useMembersQuery: () => ({ data: [], error: null, isPending: false }) }));
vi.mock('@schedule-x/react', () => ({ useCalendarApp: () => ({}), ScheduleXCalendar: () => <div /> }));
vi.mock('./calendarQueries.js', () => ({
  useOccurrences: () => ({ data: [], error: null }),
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
  it.each(['Jednorazowe', 'Powtarzające się', 'Odległy termin'])('opens the %s form from the FAB', (mode) => {
    render(
      <MantineProvider>
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
    if (mode === 'Powtarzające się') expect(screen.getByLabelText('Zakończenie')).toBeInTheDocument();
    if (mode === 'Odległy termin') expect(screen.getByLabelText('Dokładność terminu')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Anuluj' }));
    expect(screen.getByRole('button', { name: 'Powtarzające się' })).toBeInTheDocument();
  });
});
