import eslint from '@eslint/js';
import globals from 'globals';
import hooks from 'eslint-plugin-react-hooks';
import refresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const webSource = 'apps/web/src/';
const features = resolve(root, webSource, 'features');
const relativePath = (from, to) => relative(from, to).split(sep).join('/');
// Existing integrations pending their own public entry points. Each exception is one importer/target pair.
const featureImportExceptions = new Map(
  Object.entries({
    // Application wiring: routes, account stores, prefetch and the native scheduler.
    'router.tsx': [
      'meals/MealsPage.js',
      'family/FamilyPage.js',
      'calendar/CalendarPage.js',
      'calendar/EventRoute.js',
      'notifications/NotificationsPage.js',
      'updates/AndroidUpdates.js',
      'shopping/ShoppingPage.js',
      'tasks/TasksPage.js',
      'documents/DocumentsPage.js',
      'contacts/ContactsPage.js',
      'documents/DocumentRoute.js',
    ],
    'accountAdapters.ts': [
      'calendar/calendarOffline.js',
      'tasks/taskOffline.js',
      'shopping/shoppingOffline.js',
      'contacts/contactsOffline.js',
      'family/familyApi.js',
      'notifications/localSchedule.js',
      'meals/mealOffline.js',
    ],
    'AppSession.tsx': ['tasks/taskQueries.js', 'calendar/CalendarPrefetch.js', 'notifications/scheduleSync.js'],
    'platform.ts': ['notifications/localSchedule.js'],
    // Shared UI: shell notices, family validation and document count.
    'components/AppShell.tsx': ['updates/AndroidUpdates.js', 'documents/documentQueries.js'],
    'components/AuthLayout.tsx': ['updates/AndroidUpdates.js'],
    'components/JoinPages.tsx': ['family/familyRules.js'],
    'components/MorePage.tsx': ['updates/AndroidUpdates.js'],
    // Feature integrations: member lookups, reminders, daily cards and family-local dates.
    'features/calendar/CalendarPage.tsx': [
      'family/familyQueries.js',
      'notifications/NotificationBanner.js',
      'tasks/TodayTasks.js',
      'meals/TodayMeal.js',
    ],
    'features/calendar/EventDetailsPage.tsx': ['family/familyQueries.js', 'notifications/OfflineReminder.js'],
    'features/calendar/EventRoute.tsx': ['notifications/OfflineReminder.js', 'updates/AndroidUpdates.js'],
    'features/calendar/MyReminders.tsx': ['notifications/scheduleSync.js'],
    'features/calendar/PhotoImportReview.tsx': ['notifications/scheduleSync.js'],
    'features/calendar/calendarQueries.ts': ['notifications/scheduleSync.js'],
    'features/contacts/ContactsPage.tsx': ['notifications/scheduleSync.js'],
    'features/documents/DocumentDetailsPage.tsx': ['family/familyQueries.js'],
    'features/documents/DocumentReminders.tsx': ['notifications/scheduleSync.js'],
    'features/documents/DocumentRoute.tsx': ['notifications/OfflineReminder.js'],
    'features/documents/DocumentsPage.tsx': ['family/familyQueries.js', 'notifications/scheduleSync.js'],
    'features/documents/RenewDocument.tsx': ['notifications/scheduleSync.js'],
    'features/meals/MealsPage.tsx': ['calendar/toScheduleX.js'],
    'features/meals/TodayMeal.tsx': ['calendar/toScheduleX.js'],
    'features/notifications/NotificationsPage.tsx': ['updates/AndroidUpdates.js'],
    'features/notifications/localSchedule.ts': ['tasks/taskOffline.js'],
    'features/shopping/ShoppingPage.tsx': ['family/familyQueries.js'],
    'features/tasks/TaskForm.tsx': ['notifications/scheduleSync.js'],
    'features/tasks/TaskRecurrenceEditor.tsx': ['notifications/scheduleSync.js'],
    'features/tasks/TasksPage.tsx': ['family/familyQueries.js'],
    'features/tasks/taskQueries.ts': ['notifications/scheduleSync.js'],
    // Tests that set up or inspect offline stores, scheduling, and migration snapshots.
    'accountStorage.test.ts': [
      'tasks/taskStorage.js',
      'calendar/calendarOffline.js',
      'calendar/holidayLayers.js',
      'tasks/taskOffline.js',
      'shopping/shoppingOffline.js',
      'shopping/shoppingStorage.js',
      'contacts/contactsOffline.js',
    ],
    'auth-native.test.tsx': [
      'notifications/localSchedule.js',
      'shopping/shoppingStorage.js',
      'contacts/contactsOffline.js',
      'shopping/shoppingOffline.js',
    ],
    'features/family/familyOffline.test.tsx': ['shopping/shoppingOffline.js', 'shopping/shoppingStorage.js'],
    'features/meals/mealExport.test.tsx': ['shopping/shoppingOffline.js'],
    'features/meals/mealOffline.test.ts': ['shopping/shoppingStorage.js', 'shopping/shoppingOptimistic.js'],
    'features/notifications/localSchedule.test.ts': ['tasks/taskStorage.js', 'tasks/taskOffline.js'],
    'features/tasks/taskStorage.test.ts': ['contacts/contactsOffline.js'],
    'offlineFixtures.test.ts': [
      'tasks/taskStorage.js',
      'tasks/taskSchemas.js',
      'contacts/contactsOffline.js',
      'calendar/calendarOffline.js',
      'tasks/taskOffline.js',
      'shopping/shoppingOffline.js',
      'shopping/shoppingStorage.js',
    ],
    'offline/acceptance.test.ts': [
      'calendar/calendarOffline.js',
      'contacts/contactsOffline.js',
      'tasks/taskStorage.js',
      'tasks/taskOffline.js',
      'shopping/shoppingOffline.js',
      'shopping/shoppingStorage.js',
    ],
    'offline/database.test.ts': ['calendar/calendarOffline.js'],
    'offline/syncRequests.test.ts': [
      'tasks/taskAdapter.js',
      'shopping/shoppingAdapter.js',
      'shopping/shoppingStorage.js',
      'meals/mealOffline.js',
      'meals/mealDates.js',
    ],
    'platform.test.ts': ['notifications/localSchedule.js'],
    'e2e/calendar-offline.spec.ts': ['calendar/calendarOffline.js'],
    'e2e/offline-migration.spec.ts': ['calendar/calendarOffline.js'],
  }),
);

const publicFeatureImports = {
  meta: { schema: [] },
  create(context) {
    const filename = context.physicalFilename;
    const path = relativePath(root, filename);
    const importer = path.startsWith(webSource) ? path.slice(webSource.length) : path;
    const ownFeature = relativePath(features, filename).split('/')[0];
    function check(source) {
      if (typeof source?.value !== 'string' || !/^\.\.?\//.test(source.value)) return;
      const target = relativePath(features, resolve(dirname(filename), source.value));
      const [feature, ...parts] = target.split('/');
      if (feature === '..' || feature === ownFeature || !parts.length) return;
      if (/^index(?:\.[cm]?[jt]sx?)?$/.test(parts.join('/'))) return;
      if (featureImportExceptions.get(importer)?.includes(target)) return;
      context.report({ node: source, message: `Import feature "${feature}" through its public index entry point.` });
    }
    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      TSImportType: (node) => check(node.source),
      TSExternalModuleReference: (node) => check(node.expression),
    };
  },
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-android/**',
      '**/node_modules/**',
      'android/**',
      '.android-tools/**',
      'release.zip',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { architecture: { rules: { 'public-feature-imports': publicFeatureImports } } },
    rules: { 'architecture/public-feature-imports': 'error' },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': hooks,
      'react-refresh': refresh,
    },
    rules: {
      ...hooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['apps/api/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "TSNonNullExpression > MemberExpression[object.name='request'][property.name=/^(user|familyId)$/]",
          message: 'Use requireUser(request) to validate the session before accessing user or familyId.',
        },
      ],
    },
  },
  {
    files: ['**/*.mjs', '**/*.cjs'],
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
