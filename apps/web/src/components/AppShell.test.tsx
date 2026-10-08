import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { AppShell } from './AppShell.js';

describe('AppShell', () => {
  it('shows all four primary navigation destinations', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    render(
      <MantineProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<span>Kalendarz</span>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );

    const navigation = screen.getByRole('navigation', { name: 'Nawigacja główna' });
    expect(navigation).toHaveTextContent('Kalendarz');
    expect(navigation).toHaveTextContent('Zakupy');
    expect(navigation).toHaveTextContent('Obiady');
    expect(navigation).toHaveTextContent('Więcej');
  });
});
