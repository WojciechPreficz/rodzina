import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = async (name) => JSON.parse(await readFile(path.join(root, name), 'utf8'));

export function releaseManifest(api) {
  return {
    name: 'rodzina-release',
    version: api.version,
    private: true,
    type: 'module',
    engines: { node: '>=22' },
    // Shared workspace code and its dependencies are bundled into the API.
    dependencies: Object.fromEntries(Object.entries(api.dependencies).filter(([name]) => name !== '@rodzina/shared')),
  };
}

// Project only locked runtime nodes; never ask the registry to resolve a range.
export function releaseLock(manifest, source) {
  if (source.lockfileVersion !== 3) throw new Error('Expected monorepo lockfile version 3.');
  const selected = new Map();
  function resolve(from, name) {
    let current = from;
    while (true) {
      const candidate = `${current ? `${current}/` : ''}node_modules/${name}`;
      if (source.packages[candidate]) return candidate;
      if (!current) throw new Error(`Missing locked runtime dependency: ${name} from ${from}`);
      current = path.posix.dirname(current);
      if (current === '.') current = '';
    }
  }
  function visit(from, dependencies, optional = false) {
    for (const name of Object.keys(dependencies ?? {})) {
      const location = resolve(from, name);
      const node = source.packages[location];
      if (node.link || !node.integrity || !node.resolved?.startsWith('https://'))
        throw new Error(`Runtime dependency must be an integrity-locked registry package: ${location}`);
      if (selected.has(location) && (selected.get(location) === false || optional)) continue;
      selected.set(location, optional);
      const required = { ...node.dependencies };
      for (const dependency of Object.keys(node.optionalDependencies ?? {})) delete required[dependency];
      for (const dependency of Object.keys(node.peerDependencies ?? {})) {
        if (!node.peerDependenciesMeta?.[dependency]?.optional)
          required[dependency] = node.peerDependencies[dependency];
      }
      visit(location, required, optional);
      visit(location, node.optionalDependencies, true);
    }
  }
  visit('apps/api', manifest.dependencies);
  const packages = {
    '': {
      name: manifest.name,
      version: manifest.version,
      engines: manifest.engines,
      dependencies: manifest.dependencies,
    },
  };
  for (const [location, optional] of [...selected].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const target = location.replace(/^apps\/api\//, '');
    if (!target.startsWith('node_modules/') || packages[target])
      throw new Error(`Cannot relocate runtime dependency without a collision: ${location}`);
    const node = { ...source.packages[location] };
    for (const flag of ['dev', 'devOptional', 'optional', 'peer']) delete node[flag];
    if (optional) node.optional = true;
    packages[target] = node;
  }
  return { name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages };
}

export function validateReleaseContract(api, source, manifest, lock) {
  if (!isDeepStrictEqual(api.dependencies, source.packages['apps/api'].dependencies))
    throw new Error('API manifest differs from the monorepo lockfile. Run npm install first.');
  if (!isDeepStrictEqual(manifest, releaseManifest(api)) || !isDeepStrictEqual(lock, releaseLock(manifest, source)))
    throw new Error('Release dependencies are stale. Run npm run release:lock and commit both release package files.');
}

export async function validateReleaseFiles() {
  validateReleaseContract(
    await json('apps/api/package.json'),
    await json('package-lock.json'),
    await json('scripts/release/package.json'),
    await json('scripts/release/package-lock.json'),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const api = await json('apps/api/package.json');
  const source = await json('package-lock.json');
  const manifest = releaseManifest(api);
  const lock = releaseLock(manifest, source);
  validateReleaseContract(api, source, manifest, lock);
  await mkdir(path.join(root, 'scripts/release'), { recursive: true });
  for (const [name, value] of [
    ['package.json', manifest],
    ['package-lock.json', lock],
  ])
    await writeFile(path.join(root, 'scripts/release', name), `${JSON.stringify(value, null, 2)}\n`);
  console.log('Release manifest and lockfile updated from the monorepo lockfile.');
}
