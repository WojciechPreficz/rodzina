import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { DistantEvents } from './DistantEvents.js';

vi.mock('./calendarQueries.js', () => ({
  useDistantEvents: () => ({
    data: [
      {
        id: 'monthly',
        title: 'Kontrola',
        startDate: '2028-05-01',
        datePrecision: 'month',
        participants: [{ id: 'anna' }],
      },
      { id: 'daily', title: 'Przegląd', startDate: '2028-05-12', datePrecision: 'day', participants: [] },
    ],
    error: null,
  }),
}));
vi.mock('./toScheduleX.js', () => ({ todayInTimezone: () => '2026-10-12' }));
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('distant deadlines', () => {
  it('shows the month, countdown and a details link, and respects participant filters', () => {
    const view = render(
      <MantineProvider>
        <MemoryRouter>
          <DistantEvents timezone="Europe/Warsaw" selected={[]} />
        </MemoryRouter>
      </MantineProvider>,
    );
    expect(screen.getByText('maj 2028')).toBeInTheDocument();
    expect(screen.getAllByText('za 1 rok i 7 mies.')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Kontrola/ })).toHaveAttribute('href', '/kalendarz/wydarzenie/monthly');
    view.rerender(
      <MantineProvider>
        <MemoryRouter>
          <DistantEvents timezone="Europe/Warsaw" selected={['anna']} />
        </MemoryRouter>
      </MantineProvider>,
    );
    expect(screen.queryByText('Przegląd')).not.toBeInTheDocument();
    view.rerender(
      <MantineProvider>
        <MemoryRouter>
          <DistantEvents timezone="Europe/Warsaw" selected={['other']} />
        </MemoryRouter>
      </MantineProvider>,
    );
    expect(screen.getByText('Brak nadchodzących odległych terminów.')).toBeInTheDocument();
  });
});
