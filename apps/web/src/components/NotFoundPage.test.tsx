import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { matchRoutes, MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NotFoundLayout, NotFoundPage } from './NotFoundPage.js';
import { router } from '../router.js';

const session = vi.hoisted(() => ({ user: null as null | { displayName: string; role: string }, isLoading: false }));
vi.mock('../sessionContext.js', async (original) => ({
  ...(await original<typeof import('../sessionContext.js')>()),
  useMe: () => session,
}));

beforeEach(() => {
  session.user = null;
  session.isLoading = false;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function showPage() {
  render(
    <MantineProvider>
      <MemoryRouter initialEntries={['/nieznana/strona']}>
        <Routes>
          <Route element={<NotFoundLayout />}>
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
}

it('shows the public layout with an internal calendar link', () => {
  showPage();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Nie znaleźliśmytej strony.');
  expect(screen.getByRole('link', { name: 'Wróć do kalendarza' })).toHaveAttribute('href', '/kalendarz');
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  expect(document.querySelector('main.auth-layout')).toBeInTheDocument();
});

it('keeps application navigation for a signed-in user without selecting a destination', () => {
  session.user = { displayName: 'Anna', role: 'admin' };
  showPage();
  expect(screen.getByRole('navigation', { name: 'Nawigacja główna' })).toBeInTheDocument();
  expect(document.querySelector('[aria-current="page"]')).not.toBeInTheDocument();
});

it('waits for the session before choosing a layout', () => {
  session.isLoading = true;
  showPage();
  expect(screen.getByLabelText('Wczytywanie strony')).toBeInTheDocument();
  expect(screen.queryByRole('heading')).not.toBeInTheDocument();
});

it.each(['/nieznana', '/nieznana/zagniezdzona', '/kalendarz/nieznana'])('matches unknown address %s', (path) => {
  expect(matchRoutes(router.routes, path)?.at(-1)?.route.path).toBe('*');
});

it.each([
  ['/zaproszenie/token', 'zaproszenie/:token'],
  ['/reset-hasla/token', 'reset-hasla/:token'],
  ['/kalendarz/wydarzenie/event-1', 'kalendarz/wydarzenie/:eventId'],
  ['/zadania/list-1', 'zadania/:listId'],
  ['/login', 'login'],
  ['/kalendarz', 'kalendarz'],
])('preserves specific route %s', (path, pattern) => {
  expect(matchRoutes(router.routes, path)?.at(-1)?.route.path).toBe(pattern);
});
