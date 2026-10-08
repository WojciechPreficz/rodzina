import { createBrowserRouter } from 'react-router';
import { AppShell } from './components/AppShell.js';
import { EmptyPage } from './components/EmptyPage.js';
import { labels } from './i18n/pl.js';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <EmptyPage title={labels.calendar} /> },
      { path: 'zakupy', element: <EmptyPage title={labels.shopping} /> },
      { path: 'obiady', element: <EmptyPage title={labels.meals} /> },
      { path: 'wiecej', element: <EmptyPage title={labels.more} /> },
    ],
  },
]);
