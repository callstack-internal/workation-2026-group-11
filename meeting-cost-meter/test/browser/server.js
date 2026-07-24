// Minimal allowlisted server for visual QA. It deliberately cannot serve
// rates.json, ingest inputs, environment files, or any other workspace data.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const FILES = new Map([
  ['/', ['test/browser/harness.html', 'text/html; charset=utf-8']],
  ['/harness.js', ['test/browser/harness.js', 'text/javascript; charset=utf-8']],
  ['/shared/settings.js', ['extension/shared/settings.js', 'text/javascript; charset=utf-8']],
  ['/content/cost.js', ['extension/content/cost.js', 'text/javascript; charset=utf-8']],
  ['/content/currency.js', ['extension/content/currency.js', 'text/javascript; charset=utf-8']],
  ['/content/overlay.js', ['extension/content/overlay.js', 'text/javascript; charset=utf-8']],
]);

const server = http.createServer((req, res) => {
  const entry = FILES.get(new URL(req.url, 'http://localhost').pathname);
  if (!entry) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const [relativePath, contentType] = entry;
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(path.join(ROOT, relativePath)).pipe(res);
});

server.listen(4173, '127.0.0.1', () => {
  console.log('Meeting Cost visual harness: http://127.0.0.1:4173/');
});
