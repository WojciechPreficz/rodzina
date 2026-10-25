import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
const state = vi.hoisted(() => ({ native: true, offline: true, user: true, isLoading: false }));
vi.mock('../../auth.js', () => ({
  useMe: () => ({ user: state.user, isLoading: state.isLoading }),
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../../platform.js', () => ({ isAndroid: () => state.native }));
vi.mock('../../connectivity.js', () => ({ useOffline: () => state.offline }));
vi.mock('../../components/AppShell.js', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../notifications/OfflineReminder.js', () => ({ OfflineReminder: () => <div>Zapisany alarm</div> }));
vi.mock('./DocumentDetailsPage.js', () => ({ DocumentDetailsPage: () => <div>Aktualny dokument</div> }));
import { DocumentRoute } from './DocumentRoute.js';
afterEach(() => {
  cleanup();
  state.native = true;
  state.offline = true;
  state.user = true;
});
it('opens the saved document alarm offline even before a web session is restored', () => {
  state.user = false;
  render(<DocumentRoute />);
  expect(screen.getByText('Zapisany alarm')).toBeInTheDocument();
});
it('shows current details for an authenticated Android session online', () => {
  state.offline = false;
  render(<DocumentRoute />);
  expect(screen.getByText('Aktualny dokument')).toBeInTheDocument();
});
it('keeps the website behind the normal authentication boundary', () => {
  state.native = false;
  render(<DocumentRoute />);
  expect(screen.getByText('Aktualny dokument')).toBeInTheDocument();
});
