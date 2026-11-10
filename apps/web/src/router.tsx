import { LegacyRecoveryGate } from './offline/LegacyRecoveryGate.js';
import { AppSession } from './AppSession.js';
import { createBrowserRouter } from 'react-router';
import { ProtectedRoute, PublicOnlyRoute } from './auth.js';
import { AppShell } from './components/AppShell.js';
import { LoginPage, RegisterPage } from './components/AuthPages.js';
import { MorePage } from './components/MorePage.js';
import { WelcomePage } from './components/WelcomePage.js';
import { MealsPage } from './features/meals/index.js';
import { FamilyPage } from './features/family/index.js';
import { ChildLoginPage, InvitationPage, ResetPasswordPage } from './components/JoinPages.js';
import { AuthLayout } from './components/AuthLayout.js';
import { CalendarPage, EventRoute } from './features/calendar/index.js';
import { NotificationsPage } from './features/notifications/index.js';
import { NativeNavigation } from './nativeNavigation.js';
import { AndroidUpdateMonitor } from './features/updates/index.js';
import { ShoppingPage } from './features/shopping/index.js';
import { TasksPage } from './features/tasks/index.js';
import { DocumentsPage, DocumentRoute } from './features/documents/index.js';
import { ContactsPage } from './features/contacts/index.js';
import { NotFoundLayout, NotFoundPage } from './components/NotFoundPage.js';
import { ForgotPasswordPage } from './components/PasswordRecovery.js';
import { ConfirmRegistrationPage } from './components/ConfirmRegistration.js';

export const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <LegacyRecoveryGate>
        <NativeNavigation />
        <AndroidUpdateMonitor />
        <AppSession />
      </LegacyRecoveryGate>
    ),
    children: [
      {
        element: <NotFoundLayout />,
        children: [{ path: '*', element: <NotFoundPage /> }],
      },
      { path: 'kalendarz/wydarzenie/:eventId', element: <EventRoute /> },
      { path: 'dokumenty/:documentId', element: <DocumentRoute /> },
      {
        element: <AuthLayout />,
        children: [
          { path: 'zaproszenie/:token', element: <InvitationPage /> },
          { path: 'reset-hasla/:token', element: <ResetPasswordPage /> },
          { path: 'nie-pamietam-hasla', element: <ForgotPasswordPage /> },
          { path: 'potwierdz-rodzine', element: <ConfirmRegistrationPage /> },
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
              { path: 'kontakty', element: <ContactsPage /> },
              { path: 'obiady', element: <MealsPage /> },
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
