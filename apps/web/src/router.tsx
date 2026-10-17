import { createBrowserRouter } from 'react-router';
import { AuthProvider, ProtectedRoute, PublicOnlyRoute } from './auth.js';
import { AppShell } from './components/AppShell.js';
import { LoginPage, RegisterPage } from './components/AuthPages.js';
import { EmptyPage } from './components/EmptyPage.js';
import { MorePage } from './components/MorePage.js';
import { WelcomePage } from './components/WelcomePage.js';
import { labels } from './i18n/pl.js';
import { FamilyPage } from './features/family/FamilyPage.js';
import { ChildLoginPage, InvitationPage, ResetPasswordPage } from './components/JoinPages.js';
import { AuthLayout } from './components/AuthLayout.js';
import { CalendarPage } from './features/calendar/CalendarPage.js';
import { EventRoute } from './features/calendar/EventRoute.js';
import { NotificationsPage } from './features/notifications/NotificationsPage.js';
import { NativeNavigation } from './nativeNavigation.js';

export const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <>
        <NativeNavigation />
        <AuthProvider />
      </>
    ),
    children: [
      { path: 'kalendarz/wydarzenie/:eventId', element: <EventRoute /> },
      {
        element: <AuthLayout />,
        children: [
          { path: 'zaproszenie/:token', element: <InvitationPage /> },
          { path: 'reset-hasla/:token', element: <ResetPasswordPage /> },
          {
            element: <PublicOnlyRoute />,
            children: [
              { path: 'witaj', element: <WelcomePage /> },
              { path: 'register', element: <RegisterPage /> },
              { path: 'login', element: <LoginPage /> },
              { path: 'login-child', element: <ChildLoginPage /> },
            ],
          },
        ],
      },
      {
        element: <ProtectedRoute />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, element: <CalendarPage /> },
              { path: 'kalendarz', element: <CalendarPage /> },
              { path: 'zakupy', element: <EmptyPage title={labels.shopping} /> },
              { path: 'obiady', element: <EmptyPage title={labels.meals} /> },
              { path: 'wiecej', element: <MorePage /> },
              { path: 'wiecej/rodzina', element: <FamilyPage /> },
              { path: 'wiecej/powiadomienia', element: <NotificationsPage /> },
            ],
          },
        ],
      },
    ],
  },
]);
