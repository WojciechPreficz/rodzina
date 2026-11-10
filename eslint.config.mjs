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
const apiModules = resolve(root, 'apps/api/src/modules');
const relativePath = (from, to) => relative(from, to).split(sep).join('/');
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
    const ownFeature = relativePath(features, filename).split('/')[0];
    function check(source) {
      if (typeof source?.value !== 'string' || !/^\.\.?\//.test(source.value)) return;
      const target = relativePath(features, resolve(dirname(filename), source.value));
      const [feature, ...parts] = target.split('/');
      if (feature === '..' || feature === ownFeature || !parts.length) return;
      if (/^index(?:\.[cm]?[jt]sx?)?$/.test(parts.join('/'))) return;
      context.report({ node: source, message: `Import feature "${feature}" through its public index entry point.` });
    }
    return importVisitors(check);
  },
};

const privateApiRepositories = {
  meta: { schema: [] },
  create(context) {
    const filename = context.physicalFilename;
    const ownModule = relativePath(apiModules, filename).split('/')[0];
    return importVisitors((source) => {
      if (typeof source?.value !== 'string' || !/^\.\.?\//.test(source.value)) return;
      const target = relativePath(apiModules, resolve(dirname(filename), source.value));
      const [module, ...parts] = target.split('/');
      if (module === '..' || module === ownModule || !/(?:^|[/-])repository(?:\.[cm]?[jt]s)?$/.test(parts.join('/')))
        return;
      context.report({ node: source, message: `Use a service or a public port from API module "${module}".` });
    });
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
          'private-api-repositories': privateApiRepositories,
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
    files: ['apps/api/src/modules/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: { 'architecture/private-api-repositories': 'error' },
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
