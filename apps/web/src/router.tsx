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
import { AndroidUpdateMonitor } from './features/updates/AndroidUpdates.js';
import { ShoppingPage } from './features/shopping/ShoppingPage.js';
import { TasksPage } from './features/tasks/TasksPage.js';
import { DocumentsPage } from './features/documents/DocumentsPage.js';
import { NotFoundLayout, NotFoundPage } from './components/NotFoundPage.js';

export const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <>
        <NativeNavigation />
        <AndroidUpdateMonitor />
        <AuthProvider />
      </>
    ),
    children: [
      {
        element: <NotFoundLayout />,
        children: [{ path: '*', element: <NotFoundPage /> }],
      },
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
              { path: 'zadania', element: <TasksPage /> },
              { path: 'zadania/:listId', element: <TasksPage /> },
              { path: 'zakupy', element: <ShoppingPage /> },
              { path: 'dokumenty', element: <DocumentsPage /> },
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
