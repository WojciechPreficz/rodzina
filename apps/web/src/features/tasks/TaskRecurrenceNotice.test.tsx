import { cleanup, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach, expect, it, vi } from 'vitest';
import { TaskRecurrenceNotice } from './TaskRecurrenceNotice.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('announces a successor only while completion is pending', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  const { rerender } = render(
    <MantineProvider>
      <TaskRecurrenceNotice pending />
    </MantineProvider>,
  );
  expect(screen.getByRole('status').textContent).toBe('Kolejne zadanie po synchronizacji.');
  rerender(
    <MantineProvider>
      <TaskRecurrenceNotice pending={false} />
    </MantineProvider>,
  );
  expect(screen.queryByRole('status')).toBeNull();
});
