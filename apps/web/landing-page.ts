import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

const assets = new Map([
  ['index.html', 'text/html; charset=utf-8'],
  ['styles.css', 'text/css; charset=utf-8'],
  ['app.js', 'text/javascript; charset=utf-8'],
  ['config.js', 'text/javascript; charset=utf-8'],
]);

function readAsset(name: string) {
  if (name === 'config.js') return 'window.APP_BASE_URL = window.location.origin;\n';
  return readFileSync(new URL(`../../page/${name}`, import.meta.url), 'utf8');
}

export function landingPage(): Plugin {
  return {
    name: 'family-landing-page',
    generateBundle() {
      for (const name of assets.keys()) {
        this.emitFile({ type: 'asset', fileName: `strona/${name}`, source: readAsset(name) });
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (url.pathname === '/strona') {
          response.writeHead(302, { Location: `/strona/${url.search}` });
          response.end();
          return;
        }
        if (!url.pathname.startsWith('/strona/')) return next();
        const name = url.pathname.slice('/strona/'.length) || 'index.html';
        const type = assets.get(name);
        if (!type || !['GET', 'HEAD'].includes(request.method ?? '')) {
          response.writeHead(404).end();
          return;
        }
        response.setHeader('Content-Type', type);
        response.setHeader('Cache-Control', 'no-store');
        response.end(request.method === 'HEAD' ? undefined : readAsset(name));
      });
    },
  };
}
