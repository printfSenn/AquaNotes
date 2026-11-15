# AquaNotes

AquaNotes keeps encrypted notes floating on a pool of simulated water.
Move the mouse and the water ripples; the notes you leave alone slowly get wet and sink.

The notes UI runs in the browser. Local mode needs no dependency; optional cross-device sync uses the included self-hosted Node server.

## Quick start

```bash
npm run dev          # http://localhost:5173 , serves src/ and reloads the page when you save a file
npm run dev:open     # same, and opens the browser
npm run build        # writes dist/index.html and dist/index.secure.html
npm run preview      # builds, then serves dist/
npm run sync-server  # serves src/ and the sync API on http://localhost:8787
npm run sync-server:dist # serves the built app and sync API on http://localhost:8787
```

The sync server requires an encryption key for its own database file. Generate it once per installation and keep it safe; do not generate a new key on every restart:

```powershell
$env:AQUANOTES_DATA_KEY = (node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
npm run sync-server:dist
```

The key must be set again in each new terminal, or stored in the server's secret manager. Losing it makes the server's `data/sync.json` unreadable.

Needs Node 18 or newer, nothing else. No `npm install` is required (there are no dependencies).
The commands work from the project folder or from `src/`.
The server listens on localhost only. Use `PORT=3000 npm run dev` (or `$env:PORT=3000` in PowerShell) for another port.
Browsers treat `http://localhost` as a secure context, which the encryption needs. Do not open it from a plain `http://` address on another machine.

## Project layout

```
src/
  index.html          markup, links the css and js files below
  css/
    base.css          page, canvas, rim, top buttons
    notes.css         notes panel, editor, themes
    pool.css          pool view, floating cards, wet paper
    lock.css          ice lock screen and shatter pieces
  js/
    water.js          wave simulation + rendering   -> WN.water (disturb, sample, onStep)
    cipher.js         AES-GCM / PBKDF2 helpers      -> WN.cipher   (pure, unit tested)
    deadline.js       due dates and paper wetness   -> WN.deadline (pure, unit tested)
    ice.js            frost texture, cracks, shatter -> WN.ice
    app.js            notes, pool view, vault, lock screen, sync, change passphrase
tools/
  sync-server.mjs     self-hosted auth and encrypted sync API
build.mjs             inlines everything into dist/*.html
dist/
  index.html          single file, same as the published Claude artifact
  index.secure.html   same page + strict Content-Security-Policy (hashes, no network)
tests/                unit tests (node) and browser tests (python + playwright)
docs/SECURITY.md      threat model and the crypto design
```

Load order matters (classic scripts, one shared `WN` namespace): `water`, `cipher`, `deadline`, `ice`, `app`.
CSS files are concatenated in the order listed; later rules override earlier ones.
`app.js` is still one scope on purpose. The next step for a bigger project is to give it a state module and move to ES modules with a bundler.

## Features

- Wave simulation with refraction, caustics, sun glints; the water reacts to the mouse and to clicks.
- Notes: tags with colors (or none), folders, search, sort, pin, word goal, preview with checklists, focus mode, themes, font size.
- Pool view: notes become paper cards floating on the water. They ride the waves: they tilt with the surface, get pushed away by ripples from your clicks and mouse, twist a little, and settle where the water leaves them (pinned notes are moored and do not drift). You can still drag them. Cards with a deadline get wetter and tilt as the date gets closer, and are soaked and sinking when overdue.
- Encrypted vault: every note is encrypted before it is saved. Passphrase lock, auto-lock when idle, an ice lock screen that cracks and shatters when you unlock.
- Change passphrase (re-encrypts everything, updates the cloud copy, other devices ask for the new passphrase once).
- Sync across devices, ciphertext only. Run `npm run sync-server:dist`, register an account in Settings, and sign in on each device. Notes are encrypted in the browser before upload, and the server encrypts its entire `data/sync.json` file with AES-256-GCM at rest. Deploy it behind HTTPS for use outside localhost.

## Tests

```bash
pip install -r requirements.txt && playwright install chromium
npm test                         # build + unit tests + browser tests
```

- `tests/unit/` runs `cipher.js` and `deadline.js` in plain Node.
- `tests/test_vault.py`, `test_pool_physics.py`, `test_sync.py`, `test_passphrase.py`, and `test_paper.py` drive the real page; `tests/fakedb.py` stands in for the old artifact runtime.
- `tests/test_secure_csp.py` loads `dist/index.secure.html`, runs a full flow and fails on any CSP violation.
- `tools/capture_shatter.py` writes a montage of the shatter animation to `tools/shatter.png` (a sample is in `docs/`).

## Deploying on your own host

Serve `dist/index.secure.html` (rename it to `index.html`) over HTTPS and add headers:

```
Content-Security-Policy: <the same value as the <meta> tag in the file>
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cache-Control: no-store      (optional; notes are never fetched, only the page)
```

`frame-ancestors 'none'` only works as a header, not in the meta tag.
Read `docs/SECURITY.md` before relying on it: it states exactly what is and is not protected.
