// Inlines css/ and js/ into single-file builds:
//   dist/index.html         same behaviour as the published Claude artifact
//   dist/index.secure.html  same page + a strict Content-Security-Policy (hashes of the inline code, no network)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, 'src', p), 'utf8');

let html = read('index.html');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">\n?/g, (_, f) => `<style>\n${read(f)}</style>\n`);
html = html.replace(/<script src="([^"]+)"><\/script>\n?/g, (_, f) => `<script>\n${read(f)}</script>\n`);

html = html.replace(/<link rel="(icon|apple-touch-icon)"( type="[^"]+")? href="([^"]+)">/g, (_, rel, type, f) => {
  const mime = f.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
  return `<link rel="${rel}"${type || ''} href="data:${mime};base64,${readFileSync(join(root, 'src', f)).toString('base64')}">`;
});

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'index.html'), html);

const hashes = (tag) => [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))]
  .map((m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`).join(' ');
const csp = [
  "default-src 'none'",
  `script-src ${hashes('script')}`,
  `style-src ${hashes('style')}`,
  'img-src data:',
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
const secure = html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${csp}">`);
writeFileSync(join(root, 'dist', 'index.secure.html'), secure);
console.log(`built dist/index.html (${(html.length / 1024).toFixed(0)} KB) and dist/index.secure.html`);
