import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProtectedRoute } from './auth.js';

const state = vi.hoisted(() => ({ android: false, user: null as null | object, isLoading: false }));
vi.mock('./sessionContext.js', async (original) => ({
  ...(await original<typeof import('./sessionContext.js')>()),
  useMe: () => state,
}));
vi.mock('./platform.js', async (original) => ({
  ...(await original<typeof import('./platform.js')>()),
  isAndroid: () => state.android,
}));

beforeEach(() => {
  state.android = false;
  state.user = null;
  state.isLoading = false;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Destination() {
  const location = useLocation();
  return <span>{location.pathname + location.search}</span>;
}
function show(path = '/') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<span>Calendar</span>} />
          <Route path="/zadania/:id" element={<span>Tasks</span>} />
        </Route>
        <Route path="/witaj" element={<Destination />} />
        <Route path="/login" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  );
}

it('preserves the welcome page for a signed-out Android user', () => {
  state.android = true;
  show();
  expect(screen.getByText('/witaj')).toBeInTheDocument();
});
it.each([false, true])('preserves the calendar for a signed-in user (Android: %s)', (android) => {
  state.android = android;
  state.user = {};
  show();
  expect(screen.getByText('Calendar')).toBeInTheDocument();
});
it('waits for session initialization before redirecting', () => {
  state.isLoading = true;
  show();
  expect(screen.queryByText('Calendar')).not.toBeInTheDocument();
});
it('keeps deep links through login with their query parameters', () => {
  show('/zadania/list-1?zadanie=task-1');
  expect(screen.getByText('/login?next=%2Fzadania%2Flist-1%3Fzadanie%3Dtask-1')).toBeInTheDocument();
});
