import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { parseAndroidRelease } from '@rodzina/shared';
import type { AppConfig } from './config.js';

export function registerAndroidDownloads(app: FastifyInstance, config: AppConfig) {
  app.get('/downloads/android/:file', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const missing = () =>
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Wydanie Androida jest niedostępne.' } });
    const name = (request.params as { file: string }).file;
    if (
      !config.RODZINA_ANDROID_DOWNLOAD_DIR ||
      !/^(latest\.json|rodzina-\d+-\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?\.apk)$/.test(name)
    )
      return missing();
    try {
      const root = await realpath(config.RODZINA_ANDROID_DOWNLOAD_DIR);
      const resolveFile = async (filename: string) => {
        const file = await realpath(path.join(root, filename));
        if (path.dirname(file) !== root) throw new Error('Invalid download path');
        const info = await stat(file);
        if (!info.isFile() || !info.size) throw new Error('Missing download');
        return { file, info };
      };
      if (name === 'latest.json') {
        const metadata = await resolveFile(name);
        if (metadata.info.size > 4096) throw new Error('Invalid metadata size');
        const release = parseAndroidRelease(
          JSON.parse(await readFile(metadata.file, 'utf8')),
          config.RODZINA_PUBLIC_URL,
        );
        await resolveFile(path.basename(new URL(release.apkUrl).pathname));
        return reply.send(release);
      }
      const apk = await resolveFile(name);
      return reply
        .type('application/vnd.android.package-archive')
        .header('Content-Disposition', `attachment; filename="${name}"`)
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .header('Content-Length', apk.info.size)
        .send(createReadStream(apk.file));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        app.log.warn('Android release unavailable: invalid metadata or download directory.');
      }
      return missing();
    }
  });
}
