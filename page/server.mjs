import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number(process.env.PAGE_PORT ?? 4177);
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/regulamin.html', ['regulamin.html', 'text/html; charset=utf-8']],
  ['/polityka-prywatnosci.html', ['polityka-prywatnosci.html', 'text/html; charset=utf-8']],
  ['/legal.css', ['legal.css', 'text/css; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/config.js', ['config.js', 'text/javascript; charset=utf-8']],
]);

const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  const file = files.get(path);
  if (!file || !['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await readFile(new URL(file[0], import.meta.url));
    response.writeHead(200, {
      'Content-Type': file[1],
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(500).end('Unable to read prototype file');
  }
});
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`Rodzina — local preview: http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
