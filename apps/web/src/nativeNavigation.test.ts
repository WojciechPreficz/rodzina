import { afterEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({
  listeners: new Map<string, (data: never) => void>(),
  launch: vi.fn(),
  minimize: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (name, callback) => {
      f.listeners.set(name, callback);
      return { remove: f.remove };
    }),
    getLaunchUrl: f.launch,
    minimizeApp: f.minimize,
  },
}));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    addListener: vi.fn(async (name, callback) => {
      f.listeners.set(name, callback);
      return { remove: f.remove };
    }),
  },
}));
import {
  appLinkPath,
  notificationPath,
  installNativeNavigation,
  addNavigationGuard,
  addNativeBackHandler,
} from './nativeNavigation.js';
import { sanitizeNextPath } from './api.js';
afterEach(() => {
  f.listeners.clear();
  vi.clearAllMocks();
  document.body.innerHTML = '';
});
const url = '/kalendarz/wydarzenie/event-1?data=2026-10-20';
it('returns to a page catalog before history, after keyboard, dialogs and guards', async () => {
  f.launch.mockResolvedValue(undefined);
  const navigate = vi.fn();
  const nav = installNativeNavigation(navigate);
  await nav.ready;
  const catalog = vi.fn();
  const remove = addNativeBackHandler(catalog);
  const back = () => f.listeners.get('backButton')!({} as never);
  document.body.innerHTML = '<input />';
  document.querySelector('input')!.focus();
  back();
  expect(catalog).not.toHaveBeenCalled();
  const unguard = addNavigationGuard(() => false);
  back();
  expect(catalog).not.toHaveBeenCalled();
  unguard();
  document.body.innerHTML = '<div role="dialog"></div>';
  back();
  expect(catalog).not.toHaveBeenCalled();
  document.body.innerHTML = '';
  back();
  expect(catalog).toHaveBeenCalledOnce();
  expect(navigate).not.toHaveBeenCalled();
  remove();
  back();
  expect(catalog).toHaveBeenCalledOnce();
  nav.dispose();
});
it('rejects external URLs, backslashes, encoded escapes and control characters in next and notifications', () => {
  for (const unsafe of [
    'https://evil.test',
    '//evil.test',
    '/\\evil.test',
    '/%5cevil.test',
    '/%2fevil.test',
    '/\nevil.test',
    'javascript:alert(1)',
  ]) {
    expect(sanitizeNextPath(unsafe)).toBe('/');
    expect(notificationPath(unsafe)).toBeNull();
  }
  expect(sanitizeNextPath(url)).toBe(url);
  expect(notificationPath(url)).toBe(url);
  expect(notificationPath('/wiecej')).toBeNull();
  expect(notificationPath('/zadania/list-1?zadanie=task-1')).toBe('/zadania/list-1?zadanie=task-1');
  for (const path of ['/zadania/list-1', '/zadania/list-1?zadanie=', '/zadania/list-1?zadanie=task-1&evil=1']) {
    expect(notificationPath(path)).toBeNull();
  }
});
it('only accepts invitation and reset HTTPS links on the configured domain', () => {
  for (const kind of ['zaproszenie', 'reset-hasla']) {
    expect(appLinkPath(`https://rodzina.preficze.pl/${kind}/token`)).toBe(`/${kind}/token`);
  }
  for (const raw of [
    'https://evil.test/zaproszenie/token',
    'http://rodzina.preficze.pl/zaproszenie/token',
    'https://rodzina.preficze.pl.evil.test/reset-hasla/token',
    'https://rodzina.preficze.pl/kalendarz',
    'https://evil@rodzina.preficze.pl/zaproszenie/token',
  ])
    expect(appLinkPath(raw)).toBeNull();
});
it('handles launch links and retained notification actions without a stale launch replacing the occurrence', async () => {
  let finish!: (value: { url: string }) => void;
  f.launch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const navigate = vi.fn();
  const nav = installNativeNavigation(navigate);
  await vi.waitFor(() => expect(f.launch).toHaveBeenCalled());
  f.listeners.get('localNotificationActionPerformed')!({ notification: { extra: { url } } } as never);
  finish({ url: 'https://rodzina.preficze.pl/zaproszenie/old' });
  await nav.ready;
  expect(navigate).toHaveBeenCalledExactlyOnceWith(url);
  f.listeners.get('localNotificationActionPerformed')!({
    notification: { extra: { url: 'https://evil.test' } },
  } as never);
  expect(navigate).toHaveBeenCalledTimes(1);
  nav.dispose();
  expect(f.remove).toHaveBeenCalledTimes(3);
});
it('opens the cold-start app link and delivers warm links', async () => {
  f.launch.mockResolvedValue({ url: 'https://rodzina.preficze.pl/reset-hasla/token' });
  const navigate = vi.fn();
  const nav = installNativeNavigation(navigate);
  await nav.ready;
  expect(navigate).toHaveBeenCalledWith('/reset-hasla/token');
  f.listeners.get('appUrlOpen')!({ url: 'https://rodzina.preficze.pl/zaproszenie/new' } as never);
  expect(navigate).toHaveBeenLastCalledWith('/zaproszenie/new');
  nav.dispose();
});
it('Back first blurs the keyboard input, respects dirty forms and closes modal dialogs with Escape', async () => {
  f.launch.mockResolvedValue(undefined);
  const navigate = vi.fn();
  const nav = installNativeNavigation(navigate);
  await nav.ready;
  const back = () => f.listeners.get('backButton')!({} as never);
  document.body.innerHTML = '<input />';
  const input = document.querySelector('input')!;
  input.focus();
  back();
  expect(document.activeElement).not.toBe(input);
  const unguard = addNavigationGuard(() => false);
  back();
  expect(navigate).not.toHaveBeenCalled();
  expect(f.minimize).not.toHaveBeenCalled();
  unguard();
  document.body.innerHTML = '<div role="dialog"></div>';
  const key = vi.fn();
  document.addEventListener('keydown', key, { once: true });
  back();
  expect(key).toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
  nav.dispose();
});
it('protects other edited native forms before closing a dialog or accepting an App Link', async () => {
  f.launch.mockResolvedValue(undefined);
  const navigate = vi.fn();
  const nav = installNativeNavigation(navigate);
  await nav.ready;
  document.body.innerHTML = '<div role="dialog"><form><input /></form></div>';
  document.querySelector('input')!.dispatchEvent(new Event('input', { bubbles: true }));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const key = vi.fn();
  document.addEventListener('keydown', key);
  f.listeners.get('backButton')!({} as never);
  expect(key).not.toHaveBeenCalled();
  f.listeners.get('appUrlOpen')!({ url: 'https://rodzina.preficze.pl/zaproszenie/token' } as never);
  expect(navigate).not.toHaveBeenCalled();
  expect(confirm).toHaveBeenCalledTimes(2);
  confirm.mockRestore();
  document.removeEventListener('keydown', key);
  nav.dispose();
});
