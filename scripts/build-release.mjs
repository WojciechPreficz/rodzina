import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = await mkdtemp(path.join(tmpdir(), 'rodzina-release-'));

try {
  await mkdir(stage, { recursive: true });
  await cp(path.join(root, 'apps/api/server.cjs'), path.join(stage, 'server.cjs'));
  await cp(path.join(root, 'apps/api/dist'), path.join(stage, 'dist'), { recursive: true });
  await cp(path.join(root, 'apps/api/drizzle'), path.join(stage, 'drizzle'), { recursive: true });
  await cp(path.join(root, 'apps/web/dist'), path.join(stage, 'public'), { recursive: true });

  const apiPackage = JSON.parse(await readFile(path.join(root, 'apps/api/package.json'), 'utf8'));
  const productionPackage = {
    name: 'rodzina-release',
    version: apiPackage.version,
    private: true,
    type: 'module',
    engines: { node: '>=22' },
    dependencies: apiPackage.dependencies,
  };
  await import('node:fs/promises').then(({ writeFile }) =>
    writeFile(path.join(stage, 'package.json'), `${JSON.stringify(productionPackage, null, 2)}\n`),
  );

  const archiveFiles = {};
  async function addDirectory(directory, prefix = '') {
    for (const entry of await (await import('node:fs/promises')).readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      const archivePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await addDirectory(fullPath, archivePath);
      else archiveFiles[archivePath] = new Uint8Array(await readFile(fullPath));
    }
  }
  await addDirectory(stage);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(root, 'release.zip'), zipSync(archiveFiles, { level: 9 }));
  console.log(`Paczka release.zip utworzona (${Object.keys(archiveFiles).length} plików).`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
