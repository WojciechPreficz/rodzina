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
      'calendar/CalendarPage.js',
      'calendar/EventRoute.js',
      'documents/DocumentsPage.js',
      'documents/DocumentRoute.js',
    ],
    'accountAdapters.ts': ['calendar/calendarOffline.js', 'meals/mealOffline.js'],
    'AppSession.tsx': ['calendar/CalendarPrefetch.js'],
    // Shared UI: shell notices, family validation and document count.
    'components/AppShell.tsx': ['documents/documentQueries.js'],
    // Feature integrations: member lookups, reminders, daily cards and family-local dates.
    'features/calendar/CalendarPage.tsx': ['meals/TodayMeal.js'],
    'features/meals/MealsPage.tsx': ['calendar/toScheduleX.js'],
    'features/meals/TodayMeal.tsx': ['calendar/toScheduleX.js'],
    // Tests that set up or inspect offline stores, scheduling, and migration snapshots.
    'accountStorage.test.ts': ['calendar/calendarOffline.js', 'calendar/holidayLayers.js'],
    'offlineFixtures.test.ts': ['calendar/calendarOffline.js'],
    'offline/acceptance.test.ts': ['calendar/calendarOffline.js'],
    'offline/database.test.ts': ['calendar/calendarOffline.js'],
    'offline/syncRequests.test.ts': ['meals/mealOffline.js', 'meals/mealDates.js'],
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
