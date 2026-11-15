// Self-hosted AquaNotes server: static files plus a small authenticated sync API.
// The server stores only vault metadata and encrypted note payloads.
import http from 'node:http';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const staticDir = resolve(root, args.find((a) => !a.startsWith('--')) || 'src');
const dataDir = join(root, 'data');
const dataFile = join(dataDir, 'sync.json');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT) || 8787;
const MAX_BODY = 2 * 1024 * 1024;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const dataKeyText = process.env.AQUANOTES_DATA_KEY || '';
if (!/^[0-9a-fA-F]{64}$/.test(dataKeyText)) {
  console.error('AQUANOTES_DATA_KEY must be a 64-character hexadecimal key. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}
const DATA_KEY = Buffer.from(dataKeyText, 'hex');

let state = { v: 1, users: {}, sessions: {} };
let saveQueue = Promise.resolve();
let migratePlaintext = false;
try {
  const stored = JSON.parse(await readFile(dataFile, 'utf8'));
  if (stored && stored.v === 2 && stored.alg === 'aes-256-gcm') {
    const decipher = createDecipheriv('aes-256-gcm', DATA_KEY, Buffer.from(stored.iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(stored.tag, 'base64url'));
    state = JSON.parse(Buffer.concat([decipher.update(Buffer.from(stored.ct, 'base64url')), decipher.final()]).toString('utf8'));
  } else { state = stored; migratePlaintext = true; }
} catch (e) {
  if (e.code !== 'ENOENT') { console.error('Cannot read encrypted sync data:', e.message); process.exit(1); }
}
if (!state || state.v !== 1 || !state.users || !state.sessions) state = { v: 1, users: {}, sessions: {} };

const b64 = (buf) => buf.toString('base64url');
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
const newToken = () => b64(randomBytes(32));
const emailOf = (value) => String(value || '').trim().toLowerCase();
function json(res, status, body, origin) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}) });
  res.end(JSON.stringify(body));
}
function cors(res, origin) {
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
}
function save() {
  saveQueue = saveQueue.then(async () => {
    await mkdir(dataDir, { recursive: true });
    const tmp = dataFile + '.tmp';
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', DATA_KEY, iv);
    const ct = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()]);
    const envelope = { v: 2, alg: 'aes-256-gcm', iv: b64(iv), tag: b64(cipher.getAuthTag()), ct: b64(ct) };
    await writeFile(tmp, JSON.stringify(envelope), 'utf8');
    await rename(tmp, dataFile);
  });
  return saveQueue;
}
if (migratePlaintext) await save();
function body(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0, text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { size += Buffer.byteLength(chunk); if (size > MAX_BODY) { reject(Object.assign(new Error('Payload too large'), { status: 413 })); req.destroy(); return; } text += chunk; });
    req.on('end', () => { try { resolveBody(text ? JSON.parse(text) : {}); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
}
function issueSession(user) {
  const token = newToken();
  state.sessions[tokenHash(token)] = { uid: user.id, created: Date.now() };
  return { token, user: { id: user.id, email: user.email } };
}
function auth(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const session = state.sessions[tokenHash(m[1])];
  if (!session) return null;
  return { tokenHash: tokenHash(m[1]), session, user: Object.values(state.users).find((u) => u.id === session.uid) };
}
function validDocId(id) { return id === 'meta' || id === 'settings' || /^n_[A-Za-z0-9_-]{1,120}$/.test(id); }
function cleanDoc(id, x) {
  const u = Number(x && x.u) || 0;
  if (id === 'meta') return { v: 1, salt: String(x.salt || ''), iter: Number(x.iter) || 0, check: x.check, prev: x.prev, chg: Number(x.chg) || undefined };
  if (x && x.del) return { u, del: true };
  if (!x || typeof x.iv !== 'string' || typeof x.ct !== 'string') return null;
  return { u, iv: x.iv, ct: x.ct };
}
function requireUser(req, res, origin) {
  const a = auth(req);
  if (!a || !a.user) { json(res, 401, { error: 'UNAUTHORIZED' }, origin); return null; }
  return a;
}
async function api(req, res, url, origin) {
  cors(res, origin);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return true; }
  if (url.pathname === '/api/health' && req.method === 'GET') { json(res, 200, { ok: true, service: 'aquanotes-sync' }, origin); return true; }
  if (url.pathname === '/api/auth/register' && req.method === 'POST') {
    try {
      const x = await body(req), email = emailOf(x.email), password = String(x.password || '');
      if (!email || !email.includes('@') || password.length < 8) return json(res, 400, { error: 'INVALID_INPUT' }, origin);
      if (state.users[email]) return json(res, 409, { error: 'EMAIL_TAKEN' }, origin);
      const salt = randomBytes(16).toString('hex');
      const user = { id: 'u_' + b64(randomBytes(12)), email, salt, hash: b64(scryptSync(password, salt, 32)), docs: {} };
      state.users[email] = user; const result = issueSession(user); await save(); return json(res, 201, result, origin);
    } catch (e) { return json(res, e.status || 500, { error: e.status ? e.message : 'SERVER_ERROR' }, origin); }
  }
  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const x = await body(req), email = emailOf(x.email), password = String(x.password || ''), user = state.users[email];
      if (!user || !timingSafeEqual(Buffer.from(user.hash), Buffer.from(b64(scryptSync(password, user.salt, 32)))) ) return json(res, 401, { error: 'INVALID_LOGIN' }, origin);
      return json(res, 200, issueSession(user), origin);
    } catch (e) { return json(res, e.status || 500, { error: e.status ? e.message : 'SERVER_ERROR' }, origin); }
  }
  const a = requireUser(req, res, origin); if (!a) return true;
  if (url.pathname === '/api/auth/me' && req.method === 'GET') { json(res, 200, { user: { id: a.user.id, email: a.user.email } }, origin); return true; }
  if (url.pathname === '/api/auth/logout' && req.method === 'POST') { delete state.sessions[a.tokenHash]; await save(); json(res, 200, { ok: true }, origin); return true; }
  if (url.pathname === '/api/sync/docs' && req.method === 'GET') {
    const docs = Object.entries(a.user.docs || {}).map(([id, data]) => ({ id, ...data })); json(res, 200, { docs }, origin); return true;
  }
  const match = url.pathname.match(/^\/api\/sync\/docs\/([^/]+)$/);
  if (match && !validDocId(match[1])) { json(res, 400, { error: 'INVALID_DOC_ID' }, origin); return true; }
  if (match && req.method === 'GET') { const data = a.user.docs[match[1]]; json(res, 200, data ? { exists: true, data } : { exists: false }, origin); return true; }
  if (match && req.method === 'PUT') {
    try {
      const x = await body(req), data = cleanDoc(match[1], x);
      if (!data || (match[1] === 'meta' && (!data.salt || !data.check || !data.iter))) return json(res, 400, { error: 'INVALID_DOCUMENT' }, origin);
      a.user.docs[match[1]] = data; await save(); json(res, 200, { ok: true }, origin); return true;
    } catch (e) { return json(res, e.status || 500, { error: e.status ? e.message : 'SERVER_ERROR' }, origin); }
  }
  if (match && req.method === 'DELETE') { delete a.user.docs[match[1]]; await save(); json(res, 200, { ok: true }, origin); return true; }
  json(res, 404, { error: 'NOT_FOUND' }, origin); return true;
}
async function staticFile(req, res, url) {
  let file = resolve(staticDir, '.' + decodeURIComponent(url.pathname));
  if (file !== staticDir && !file.startsWith(staticDir + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  if (file === staticDir || (await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
  try { const data = await readFile(file); res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(data); }
  catch { res.writeHead(404); res.end('Not found'); }
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const origin = req.headers.origin;
  if (url.pathname.startsWith('/api/')) return api(req, res, url, origin);
  return staticFile(req, res, url);
});
server.listen(port, host, () => console.log(`AquaNotes sync server\n  http://${host}:${port}\n  static: ${staticDir}\n  data: ${dataFile}`));
