import { App } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { PluginListenerHandle } from '@capacitor/core';
import { sanitizeNextPath } from './api.js';
import { labels } from './i18n/pl.js';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { isAndroid } from './platform.js';

export function NativeNavigation() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!isAndroid()) return;
    // Subscribe after RouterProvider has mounted, so retained launch actions cannot
    // navigate before its layout-effect subscription is installed.
    const navigation = installNativeNavigation((path) => {
      if (typeof path === 'number') void navigate(path);
      else void navigate(path);
    });
    void navigation.ready.catch(() => undefined);
    return () => navigation.dispose();
  }, [navigate]);
  return null;
}

export function appLinkPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    if (url.origin !== 'https://rodzina.preficze.pl' || url.username || url.password) return null;
    if (!/^\/(zaproszenie|reset-hasla)\/[a-zA-Z0-9_-]+$/.test(url.pathname)) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

export function notificationPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || sanitizeNextPath(raw) !== raw) return null;
  return /^\/kalendarz\/wydarzenie\/[a-zA-Z0-9_-]+\?data=\d{4}-\d{2}-\d{2}$/.test(raw) ||
    /^\/zadania\/[a-zA-Z0-9_-]+\?zadanie=[a-zA-Z0-9_-]+$/.test(raw)
    ? raw
    : null;
}

// Shared by modal close buttons, Escape, native Back and router navigation.
const guards: Array<() => boolean> = [];
export function addNavigationGuard(guard: () => boolean) {
  guards.push(guard);
  return () => {
    const index = guards.indexOf(guard);
    if (index >= 0) guards.splice(index, 1);
  };
}
export function allowNavigation() {
  return guards.at(-1)?.() ?? true;
}

export function installNativeNavigation(navigate: (path: string | number) => void) {
  let disposed = false;
  let urlRevision = 0;
  const handles: PluginListenerHandle[] = [];
  const editedForms = new WeakSet<HTMLFormElement>();
  const changed = (event: Event) => {
    if (!(event.target instanceof Element)) return;
    const form = event.target.closest('form');
    if (form && !form.dataset.navigationGuard) editedForms.add(form);
  };
  const allowOtherForms = (container: Element | Document) => {
    const edited = [...container.querySelectorAll('form')].filter((form) => editedForms.has(form));
    if (edited.length && !confirmDiscard()) return false;
    for (const form of edited) editedForms.delete(form);
    return true;
  };
  document.addEventListener('input', changed);
  document.addEventListener('change', changed);
  const register = async (pending: Promise<PluginListenerHandle>) => {
    const handle = await pending;
    if (disposed) await handle.remove();
    else handles.push(handle);
  };
  const open = (path: string | null) => {
    if (!disposed && path && allowNavigation() && allowOtherForms(document)) navigate(path);
  };
  const ready = Promise.all([
    register(
      App.addListener('appUrlOpen', ({ url }) => {
        urlRevision += 1;
        open(appLinkPath(url));
      }),
    ),
    register(
      LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
        urlRevision += 1;
        open(notificationPath(notification.extra?.url));
      }),
    ),
    register(
      App.addListener('backButton', () => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && active.matches('input, textarea, [contenteditable="true"]')) {
          active.blur();
          return;
        }
        // Let Mantine close the top modal using its normal guarded onClose.
        const dialog = [...document.querySelectorAll('[role="dialog"]')].at(-1);
        if (dialog) {
          if (!allowOtherForms(dialog)) return;
          dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          return;
        }
        if (!allowNavigation() || !allowOtherForms(document)) return;
        if (window.history.state?.idx > 0) navigate(-1);
        else if (!['/', '/kalendarz', '/witaj', '/login'].includes(window.location.pathname)) navigate('/kalendarz');
        else void App.minimizeApp();
      }),
    ),
  ]).then(async () => {
    const launch = await App.getLaunchUrl();
    if (urlRevision === 0) open(appLinkPath(launch?.url));
  });
  return {
    ready,
    dispose() {
      disposed = true;
      document.removeEventListener('input', changed);
      document.removeEventListener('change', changed);
      for (const handle of handles) void handle.remove();
    },
  };
}

export const confirmDiscard = () => window.confirm(labels.androidNavigation.discard);
