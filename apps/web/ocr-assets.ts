import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';

const require = createRequire(import.meta.url);
const root = (name: string) => path.dirname(require.resolve(`${name}/package.json`));

export function ocrAssets() {
  const files = new Map<string, Buffer>();
  const add = (name: string, source: string) => files.set(name, readFileSync(source));
  const engine = root('tesseract.js');
  const core = root('tesseract.js-core');
  const polish = root('@tesseract.js-data/pol');
  const version = (directory: string) =>
    JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')).version as string;
  add('worker.min.js', path.join(engine, 'dist/worker.min.js'));
  add('worker-licenses.txt', path.join(engine, 'dist/worker.min.js.LICENSE.txt'));
  add('tesseract-license.txt', path.join(engine, 'LICENSE.md'));
  add('core-license.txt', path.join(core, 'LICENSE'));
  add('pol.traineddata.gz', path.join(polish, '4.0.0_best_int/pol.traineddata.gz'));
  for (const variant of ['', '-simd', '-lstm', '-simd-lstm']) {
    // These distributions embed WASM and select SIMD only when supported.
    add(`tesseract-core${variant}.wasm.js`, path.join(core, `tesseract-core${variant}.wasm.js`));
  }
  files.set(
    'notices.txt',
    Buffer.from(
      [
        'Tesseract.js: https://github.com/naptha/tesseract.js (Apache-2.0; tesseract-license.txt)',
        'Tesseract.js-core: https://github.com/naptha/tesseract.js-core (Apache-2.0; core-license.txt)',
        'Polish traineddata: https://github.com/naptha/tessdata (Apache-2.0; core-license.txt)',
        '@tesseract.js-data/pol packaging: MIT, Balearica, jeromewu; package.json included below.',
        readFileSync(path.join(polish, 'package.json'), 'utf8'),
        'Bundled dependencies: worker-licenses.txt',
        `Versions: Tesseract.js ${version(engine)}, core ${version(core)}, Polish data package ${version(polish)}.`,
        'MIT packaging license: Copyright (c) Balearica and jeromewu',
        'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
        'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.',
        'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
      ].join('\n'),
    ),
  );
  const hash = createHash('sha256');
  for (const [name, source] of files) hash.update(name).update(source);
  const base = `/ocr/${hash.digest('hex').slice(0, 16)}`;
  const manifest = JSON.stringify({ base, files: [...files.keys()] });
  const plugin: Plugin = {
    name: 'local-ocr-assets',
    config: () => ({ define: { __OCR_ASSET_BASE__: JSON.stringify(base) } }),
    generateBundle() {
      for (const [name, source] of files)
        this.emitFile({ type: 'asset', fileName: `${base.slice(1)}/${name}`, source });
      this.emitFile({ type: 'asset', fileName: 'ocr/manifest.json', source: manifest });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split('?')[0];
        if (pathname === '/ocr/manifest.json') {
          response.setHeader('Content-Type', 'application/json');
          response.end(manifest);
          return;
        }
        if (!pathname?.startsWith(`${base}/`)) return next();
        const source = files.get(pathname.slice(base.length + 1));
        if (!source) {
          response.statusCode = 404;
          response.end();
          return;
        }
        response.setHeader(
          'Content-Type',
          pathname.endsWith('.js') ? 'application/javascript' : 'application/octet-stream',
        );
        response.end(source);
      });
    },
  };
  return plugin;
}
