import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HolidayDetails } from './HolidayDetails.js';
import { holidayLayersStorageKey, readHolidayLayers, saveHolidayLayers } from './holidayLayers.js';
import { polishHolidaysForYear } from './polishHolidays.js';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('defaults to both layers and restores independent device choices', () => {
  expect(readHolidayLayers()).toEqual({ publicHoliday: true, observance: true });
  saveHolidayLayers({ publicHoliday: true, observance: false });
  expect(readHolidayLayers()).toEqual({ publicHoliday: true, observance: false });
  localStorage.setItem(holidayLayersStorageKey, '{');
  expect(readHolidayLayers()).toEqual({ publicHoliday: true, observance: true });
  localStorage.setItem(holidayLayersStorageKey, '{"publicHoliday":false,"observance":"false"}');
  expect(readHolidayLayers()).toEqual({ publicHoliday: false, observance: true });
});

it('works when reading or writing device storage is denied', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied');
  });
  expect(readHolidayLayers()).toEqual({ publicHoliday: true, observance: true });
  expect(() => saveHolidayLayers({ publicHoliday: false, observance: false })).not.toThrow();
});

it.each([
  ['mothers-day', 'Dzień Matki', 'Nie jest ustawowym dniem wolnym od pracy'],
  ['christmas-eve', 'Wigilia Bożego Narodzenia', 'Dzień ustawowo wolny od pracy'],
  [
    'teachers-day',
    'Dzień Edukacji Narodowej (Dzień Nauczyciela)',
    'Dzień wolny od zajęć lekcyjnych. Szkoła może organizować zajęcia opiekuńcze.',
  ],
])('shows read-only details for %s', (key, name, description) => {
  render(
    <MantineProvider env="test">
      <HolidayDetails holiday={polishHolidaysForYear(2026).find((h) => h.key === key)!} onClose={() => {}} />
    </MantineProvider>,
  );
  expect(screen.getByRole('dialog', { name })).toBeVisible();
  expect(screen.getByText(description)).toBeVisible();
  expect(screen.queryByRole('button', { name: /Edytuj|Usuń|przypomnienie/ })).not.toBeInTheDocument();
});
