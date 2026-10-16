import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { localDateTimeToUtc } from '@rodzina/shared';
import { ReminderPicker } from './ReminderPicker.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
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
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  vi.unstubAllGlobals();
});

it('creates a calendar month offset', async () => {
  const add = vi.fn();
  render(
    <MantineProvider env="test">
      <ReminderPicker onAdd={add} />
    </MantineProvider>,
  );
  fireEvent.click(screen.getByLabelText('Kiedy przypomnieć', { selector: 'input' }));
  fireEvent.click(screen.getByRole('option', { name: 'Własne wyprzedzenie' }));
  fireEvent.change(screen.getByLabelText('Liczba jednostek przed'), { target: { value: '3' } });
  fireEvent.click(screen.getByLabelText('Jednostka wyprzedzenia', { selector: 'input' }));
  fireEvent.click(screen.getByRole('option', { name: 'miesięcy' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dodaj przypomnienie' }));
  await waitFor(() =>
    expect(add).toHaveBeenCalledWith({ type: 'offset', offsetValue: 3, offsetUnit: 'month', audience: 'participants' }),
  );
});

it('validates an absolute date and converts family wall time through shared time logic', async () => {
  const add = vi.fn();
  render(
    <MantineProvider env="test">
      <ReminderPicker onAdd={add} />
    </MantineProvider>,
  );
  fireEvent.click(screen.getByLabelText('Kiedy przypomnieć', { selector: 'input' }));
  fireEvent.click(screen.getByRole('option', { name: 'W wybranym dniu' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dodaj przypomnienie' }));
  expect(add).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('Podaj poprawne');
  fireEvent.change(screen.getByLabelText('Data przypomnienia'), { target: { value: '2028-03-27' } });
  fireEvent.change(screen.getByLabelText('Godzina przypomnienia'), { target: { value: '17:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Dodaj przypomnienie' }));
  await waitFor(() =>
    expect(add).toHaveBeenCalledWith({
      type: 'absolute',
      remindAt: localDateTimeToUtc('2028-03-27', '17:00', 'Europe/Warsaw'),
      audience: 'participants',
    }),
  );
});
