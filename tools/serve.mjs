// Tiny static server with no dependencies.
//   node tools/serve.mjs src --live     development: serves src/, reloads the browser when a file changes
//   node tools/serve.mjs dist           preview the built single file
// Options: --open (open the browser), PORT=5173 (env). Listens on localhost only.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { extname, resolve, sep, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const dir = resolve(root, args.find((a) => !a.startsWith('--')) || 'src');
const live = args.includes('--live'), openBrowser = args.includes('--open');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const clients = new Set();
const reloadTag = '<script>new EventSource("/__reload").onmessage=function(){location.reload()}</script>';

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (live && url.pathname === '/__reload') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': connected\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    let file = resolve(dir, '.' + decodeURIComponent(url.pathname));
    if (file !== dir && !file.startsWith(dir + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
    let body = await readFile(file);
    if (live && file.endsWith('index.html')) body = Buffer.from(body.toString('utf8').replace('</body>', reloadTag + '</body>'));
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
});

if (live) {
  let timer;
  const ping = () => { clearTimeout(timer); timer = setTimeout(() => clients.forEach((c) => c.write('data: reload\n\n')), 120); };
  try { watch(dir, { recursive: true }, ping); } catch { watch(dir, ping); }
}

function listen(port, tries = 0) {
  server.once('error', (e) => { if (e.code === 'EADDRINUSE' && tries < 10) listen(port + 1, tries + 1); else { console.error(e.message); process.exit(1); } });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/`;
    console.log(`Serving ${dir}\n  ${url}${live ? '   (live reload on)' : ''}\nPress Ctrl+C to stop.`);
    if (openBrowser) exec(process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`);
  });
}
listen(Number(process.env.PORT) || 5173);
