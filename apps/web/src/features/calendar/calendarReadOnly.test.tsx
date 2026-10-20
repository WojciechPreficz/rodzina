import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { useCalendarMutations, useCalendarOnlineMutation } from './calendarQueries.js';
import { EventForm } from './EventForm.js';
import { reportTransportFailure } from '../../connectivity.js';
import { createEvent, deleteEvent, updateEvent } from './calendarApi.js';

const state = vi.hoisted(() => ({ confirmed: true }));
vi.mock('../../auth.js', () => ({ useMe: () => ({ familyConfirmed: state.confirmed }) }));
vi.mock('./calendarApi.js', () => ({ createEvent: vi.fn(), deleteEvent: vi.fn(), updateEvent: vi.fn() }));
const clients: QueryClient[] = [];
function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient();
  clients.push(client);
  return (
    <QueryClientProvider client={client}>
      <MantineProvider env="test">
        <MemoryRouter>{children}</MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>
  );
}
beforeEach(() => {
  state.confirmed = true;
  onlineManager.setOnline(true);
  reportTransportFailure(false);
  vi.clearAllMocks();
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
  clients.forEach((client) => client.clear());
  clients.length = 0;
  onlineManager.setOnline(true);
  reportTransportFailure(false);
  vi.unstubAllGlobals();
});
it.each(['create', 'update', 'remove'] as const)(
  'rejects %s without creating a paused or retrying mutation',
  async (kind) => {
    const { result } = renderHook(() => useCalendarMutations(), { wrapper: Wrapper });
    // Even an action whose callback was captured online must check current connectivity.
    const mutate = result.current[kind].mutateAsync;
    onlineManager.setOnline(false);
    await act(async () => {
      await expect(mutate({} as never)).rejects.toThrow('Dostępne po połączeniu');
    });
    expect(createEvent).not.toHaveBeenCalled();
    expect(updateEvent).not.toHaveBeenCalled();
    expect(deleteEvent).not.toHaveBeenCalled();
    onlineManager.setOnline(true);
    expect(
      clients.flatMap((client) => client.getMutationCache().getAll()).some((mutation) => mutation.state.isPaused),
    ).toBe(false);
  },
);
it.each(['unconfirmed', 'transport'])('rejects personal reminder writes when %s', async (mode) => {
  if (mode === 'unconfirmed') state.confirmed = false;
  else reportTransportFailure(true);
  const action = vi.fn();
  const { result } = renderHook(() => useCalendarOnlineMutation(action), { wrapper: Wrapper });
  await act(async () => {
    await expect(result.current.mutateAsync('reminder')).rejects.toThrow('Dostępne po połączeniu');
  });
  expect(action).not.toHaveBeenCalled();
});
it.each(['single', 'recurring', 'distant'] as const)(
  'blocks an already open %s form and shared reminder controls on connection loss',
  (kind) => {
    const save = vi.fn();
    render(
      <Wrapper>
        <EventForm kind={kind} initialDate="2026-10-20" members={[]} pending={false} onSave={save} onCancel={vi.fn()} />
      </Wrapper>,
    );
    fireEvent.change(screen.getByLabelText(/^Tytuł/), { target: { value: 'Test' } });
    act(() => onlineManager.setOnline(false));
    expect(screen.getByRole('button', { name: 'Zapisz' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dodaj przypomnienie' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('button', { name: 'Zapisz' }).closest('form')!);
    expect(save).not.toHaveBeenCalled();
  },
);
