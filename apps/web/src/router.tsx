import { createBrowserRouter } from 'react-router';
import { AuthProvider, ProtectedRoute, PublicOnlyRoute } from './auth.js';
import { AppShell } from './components/AppShell.js';
import { LoginPage, RegisterPage } from './components/AuthPages.js';
import { EmptyPage } from './components/EmptyPage.js';
import { MorePage } from './components/MorePage.js';
import { WelcomePage } from './components/WelcomePage.js';
import { labels } from './i18n/pl.js';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AuthProvider />,
    children: [
      {
        element: <PublicOnlyRoute />,
        children: [
          { path: 'witaj', element: <WelcomePage /> },
          { path: 'register', element: <RegisterPage /> },
          { path: 'login', element: <LoginPage /> },
        ],
      },
      {
        element: <ProtectedRoute />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, element: <EmptyPage title={labels.calendar} /> },
              { path: 'zakupy', element: <EmptyPage title={labels.shopping} /> },
              { path: 'obiady', element: <EmptyPage title={labels.meals} /> },
              { path: 'wiecej', element: <MorePage /> },
            ],
          },
        ],
      },
    ],
  },
]);
