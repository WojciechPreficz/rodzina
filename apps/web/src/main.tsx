import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider, createTheme } from '@mantine/core';
import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import '@mantine/core/styles.css';
import { RouterProvider } from 'react-router/dom';
import { createQueryClient } from './queryClient.js';
import { router } from './router.js';
import { isAndroid } from './platform.js';
import { allowNavigation } from './nativeNavigation.js';
import { retireLegacyPwa } from './retireLegacyPwa.js';
import './native.css';

const theme = createTheme({
  primaryColor: 'teal',
  fontFamily: 'system-ui, sans-serif',
});

const queryClient = createQueryClient();
onlineManager.setOnline(navigator.onLine);
router.getBlocker('forms', () => !allowNavigation());
router.subscribe((state) => {
  const blocker = state.blockers.get('forms');
  if (blocker?.state === 'blocked') blocker.reset();
});
if (isAndroid()) {
  document.documentElement.classList.add('android-insets');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme}>
        <RouterProvider router={router} />
      </MantineProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);

if (!isAndroid() && import.meta.env.MODE !== 'android' && 'serviceWorker' in navigator && import.meta.env.PROD) {
  void retireLegacyPwa().catch(() => {
    /* Retry cleanup on the next visit without blocking the website. */
  });
}
