import eslint from '@eslint/js';
import globals from 'globals';
import hooks from 'eslint-plugin-react-hooks';
import refresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const webSource = 'apps/web/src/';
const offline = resolve(root, webSource, 'offline');
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
      'updates/AndroidUpdates.js',
      'shopping/ShoppingPage.js',
      'documents/DocumentsPage.js',
      'contacts/ContactsPage.js',
      'documents/DocumentRoute.js',
    ],
    'accountAdapters.ts': [
      'calendar/calendarOffline.js',
      'shopping/shoppingOffline.js',
      'contacts/contactsOffline.js',
      'family/familyApi.js',
      'meals/mealOffline.js',
    ],
    'AppSession.tsx': ['calendar/CalendarPrefetch.js'],
    // Shared UI: shell notices, family validation and document count.
    'components/AppShell.tsx': ['updates/AndroidUpdates.js', 'documents/documentQueries.js'],
    'components/AuthLayout.tsx': ['updates/AndroidUpdates.js'],
    'components/JoinPages.tsx': ['family/familyRules.js'],
    'components/MorePage.tsx': ['updates/AndroidUpdates.js'],
    // Feature integrations: member lookups, reminders, daily cards and family-local dates.
    'features/calendar/CalendarPage.tsx': ['family/familyQueries.js', 'meals/TodayMeal.js'],
    'features/calendar/EventDetailsPage.tsx': ['family/familyQueries.js'],
    'features/calendar/EventRoute.tsx': ['updates/AndroidUpdates.js'],
    'features/documents/DocumentDetailsPage.tsx': ['family/familyQueries.js'],
    'features/documents/DocumentsPage.tsx': ['family/familyQueries.js'],
    'features/meals/MealsPage.tsx': ['calendar/toScheduleX.js'],
    'features/meals/TodayMeal.tsx': ['calendar/toScheduleX.js'],
    'features/notifications/NotificationsPage.tsx': ['updates/AndroidUpdates.js'],
    'features/shopping/ShoppingPage.tsx': ['family/familyQueries.js'],
    'features/tasks/TasksPage.tsx': ['family/familyQueries.js'],
    // Tests that set up or inspect offline stores, scheduling, and migration snapshots.
    'accountStorage.test.ts': [
      'calendar/calendarOffline.js',
      'calendar/holidayLayers.js',
      'shopping/shoppingOffline.js',
      'shopping/shoppingStorage.js',
      'contacts/contactsOffline.js',
    ],
    'auth-native.test.tsx': [
      'shopping/shoppingStorage.js',
      'contacts/contactsOffline.js',
      'shopping/shoppingOffline.js',
    ],
    'features/family/familyOffline.test.tsx': ['shopping/shoppingOffline.js', 'shopping/shoppingStorage.js'],
    'features/meals/mealExport.test.tsx': ['shopping/shoppingOffline.js'],
    'features/meals/mealOffline.test.ts': ['shopping/shoppingStorage.js', 'shopping/shoppingOptimistic.js'],
    'features/tasks/taskStorage.test.ts': ['contacts/contactsOffline.js'],
    'offlineFixtures.test.ts': [
      'contacts/contactsOffline.js',
      'calendar/calendarOffline.js',
      'shopping/shoppingOffline.js',
      'shopping/shoppingStorage.js',
    ],
    'offline/acceptance.test.ts': [
      'calendar/calendarOffline.js',
      'contacts/contactsOffline.js',
      'shopping/shoppingOffline.js',
      'shopping/shoppingStorage.js',
    ],
    'offline/database.test.ts': ['calendar/calendarOffline.js'],
    'offline/syncRequests.test.ts': [
      'shopping/shoppingAdapter.js',
      'shopping/shoppingStorage.js',
      'meals/mealOffline.js',
      'meals/mealDates.js',
    ],
    'e2e/calendar-offline.spec.ts': ['calendar/calendarOffline.js'],
    'e2e/offline-migration.spec.ts': ['calendar/calendarOffline.js'],
  }),
);

const importVisitors = (check) => ({
  ImportDeclaration: (node) => check(node.source),
  ExportNamedDeclaration: (node) => check(node.source),
  ExportAllDeclaration: (node) => check(node.source),
  ImportExpression: (node) => check(node.source),
  TSImportType: (node) => check(node.source),
  TSExternalModuleReference: (node) => check(node.expression),
});

const publicOfflineImports = {
  meta: { schema: [] },
  create(context) {
    const filename = context.physicalFilename;
    if (relativePath(features, filename).startsWith('../')) return {};
    return importVisitors((source) => {
      if (typeof source?.value !== 'string' || !/^\.\.?\//.test(source.value)) return;
      const target = relativePath(offline, resolve(dirname(filename), source.value));
      if (target === '..' || target.startsWith('../') || /^(?:index|OfflineNotice)(?:\.[cm]?[jt]sx?)?$/.test(target))
        return;
      if (/\.test\.[jt]sx?$/.test(filename) && /^testing(?:\.[cm]?[jt]sx?)?$/.test(target)) return;
      context.report({ node: source, message: 'Import offline functionality through the public offline index.' });
    });
  },
};

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
    return importVisitors(check);
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
    plugins: {
      architecture: {
        rules: {
          'public-feature-imports': publicFeatureImports,
          'public-offline-imports': publicOfflineImports,
        },
      },
    },
    rules: {
      'architecture/public-feature-imports': 'error',
      'architecture/public-offline-imports': 'error',
    },
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
