import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventForm } from './EventForm.js';
import { wizardFromRrule } from '@rodzina/shared';

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

describe('EventForm', () => {
  it.each([false, true])('saves an explicit end date for all-day=%s', async (allDay) => {
    const save = vi.fn(async () => {});
    render(
      <MantineProvider env="test">
        <EventForm members={[]} initialDate="2026-10-24" pending={false} onSave={save} onCancel={() => {}} />
      </MantineProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^Tytuł/), { target: { value: 'Wyjazd' } });
    expect(screen.queryByLabelText('Data zakończenia')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Wielodniowe' }));
    fireEvent.change(screen.getByLabelText(/^Data zakończenia/), { target: { value: '2026-10-26' } });
    if (allDay) {
      fireEvent.click(screen.getByRole('switch', { name: 'Całodniowe' }));
      expect(screen.queryByLabelText('Godzina zakończenia')).not.toBeInTheDocument();
    } else {
      fireEvent.change(screen.getByLabelText(/^Godzina zakończenia/), { target: { value: '12:00' } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          startTime: allDay ? null : '09:00',
          durationMinutes: allDay ? 4320 : 3120,
        }),
      ),
    );
  });

  it('rejects an end before the start and resets duration when multi-day is disabled', async () => {
    const save = vi.fn(async () => {});
    render(
      <MantineProvider env="test">
        <EventForm members={[]} initialDate="2026-10-24" pending={false} onSave={save} onCancel={() => {}} />
      </MantineProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^Tytuł/), { target: { value: 'Wyjazd' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Wielodniowe' }));
    fireEvent.change(screen.getByLabelText(/^Data zakończenia/), { target: { value: '2026-10-24' } });
    fireEvent.change(screen.getByLabelText(/^Godzina zakończenia/), { target: { value: '08:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText(/Koniec musi być późniejszy/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Wielodniowe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ durationMinutes: 60 })));
  });
  it('uses the family timezone for an absolute shared reminder', async () => {
    const save = vi.fn(async () => {});
    render(
      <MantineProvider env="test">
        <EventForm
          members={[]}
          timezone="America/New_York"
          initialDate="2030-05-20"
          pending={false}
          onSave={save}
          onCancel={() => {}}
        />
      </MantineProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^Tytuł/), { target: { value: 'Spotkanie' } });
    fireEvent.click(screen.getByLabelText('Kiedy przypomnieć', { selector: 'input' }));
    fireEvent.click(screen.getByRole('option', { name: 'W wybranym dniu' }));
    fireEvent.change(screen.getByLabelText('Data przypomnienia'), { target: { value: '2030-05-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj przypomnienie' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Usuń przypomnienie' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          reminders: [{ type: 'absolute', remindAt: Date.parse('2030-05-20T13:00:00Z'), audience: 'participants' }],
        }),
      ),
    );
  });
  it('sends shared reminders in the event body and sends an empty array after removal', async () => {
    const save = vi.fn(async () => {});
    render(
      <MantineProvider env="test">
        <EventForm members={[]} initialDate="2026-10-12" pending={false} onSave={save} onCancel={() => {}} />
      </MantineProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^Tytuł/), { target: { value: 'Basen' } });
    fireEvent.click(screen.getByLabelText('Kiedy przypomnieć', { selector: 'input' }));
    fireEvent.click(screen.getByRole('option', { name: '15 minut przed' }));
    fireEvent.click(screen.getByLabelText('Odbiorcy', { selector: 'input' }));
    fireEvent.click(screen.getByRole('option', { name: 'Cała rodzina' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj przypomnienie' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Dodaj przypomnienie' })).not.toHaveAttribute('data-loading'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          reminders: [{ type: 'offset', offsetValue: 15, offsetUnit: 'minute', audience: 'family' }],
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Usuń przypomnienie' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ reminders: [] })));
  });
  it('creates a weekly Tuesday/Thursday series through the wizard', async () => {
    const save = vi.fn(async () => {});
    render(
      <MantineProvider env="test">
        <EventForm
          kind="recurring"
          members={[]}
          initialDate="2026-10-12"
          pending={false}
          onSave={save}
          onCancel={() => {}}
        />
      </MantineProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^Tytuł/), { target: { value: 'Zajęcia' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Poniedziałek' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Wtorek' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Czwartek' }));
    expect(screen.getByRole('status')).toHaveTextContent('co tydzień we wtorek i czwartek');
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'recurring', rrule: 'FREQ=WEEKLY;INTERVAL=1;WKST=MO;BYDAY=TU,TH' }),
      ),
    );
    expect(wizardFromRrule('FREQ=WEEKLY;INTERVAL=1;WKST=MO;BYDAY=TU,TH', '2026-10-12')?.weekdays).toEqual(['TU', 'TH']);
  });

  it('saves a monthly distant deadline as the first day with no time', async () => {
    const save = vi.fn(async () => {});
    render(
      <MantineProvider env="test">
        <EventForm
          kind="distant"
          members={[]}
          initialDate="2026-10-12"
          pending={false}
          onSave={save}
          onCancel={() => {}}
        />
      </MantineProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^Tytuł/), { target: { value: 'Kontrola' } });
    fireEvent.click(screen.getByLabelText('Dokładność terminu', { selector: 'input' }));
    fireEvent.click(screen.getByRole('option', { name: 'Tylko miesiąc' }));
    fireEvent.change(screen.getByLabelText(/^Data/), { target: { value: '2028-05' } });
    expect(screen.getByRole('switch', { name: 'Całodniowe' })).toBeDisabled();
    expect(screen.queryByLabelText(/^Godzina/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'distant',
          datePrecision: 'month',
          startDate: '2028-05-01',
          startTime: null,
          durationMinutes: null,
          rrule: null,
        }),
      ),
    );
  });
  it('creates a timed single event without sending reminder changes', async () => {
    const save = vi.fn(async () => {});
    render(
      <MantineProvider env="test">
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

  it.each(['', '14:30'])('saves a distant deadline with optional time "%s"', async (time) => {
    const save = vi.fn(async () => {});
    render(
      <MantineProvider env="test">
        <EventForm
          kind="distant"
          members={[]}
          initialDate="2028-05-12"
          pending={false}
          onSave={save}
          onCancel={() => {}}
        />
      </MantineProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^Tytuł/), { target: { value: 'Kontrola' } });
    const input = screen.getByLabelText('Godzina (opcjonalnie)');
    expect(input).toHaveValue('');
    expect(input).not.toBeRequired();
    if (time) fireEvent.change(input, { target: { value: time } });
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'distant',
          startDate: '2028-05-12',
          startTime: time || null,
          durationMinutes: time ? 60 : null,
        }),
      ),
    );
  });

  it('clears time and duration for all-day events', async () => {
    const save = vi.fn(async () => {});
    render(
      <MantineProvider env="test">
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
      <MantineProvider env="test">
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
