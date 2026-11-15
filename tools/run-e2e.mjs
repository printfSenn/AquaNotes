// Runs the browser tests with whichever Python is installed (python3, python or py on Windows).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const python = ['python3', 'python', 'py'].find((c) => spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0);
if (!python) { console.error('Python was not found. Install Python 3, then: pip install -r requirements.txt && playwright install chromium'); process.exit(1); }
if (process.argv.includes('--check')) { console.log('python command:', python); process.exit(0); }
for (const t of ['test_vault.py', 'test_pool_physics.py', 'test_sync.py', 'test_passphrase.py', 'test_secure_csp.py', 'test_paper.py']) {
  console.log('\n=== ' + t);
  const r = spawnSync(python, [join('tests', t)], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) { console.error('FAILED: ' + t); process.exit(r.status || 1); }
}
console.log('\nAll browser tests passed.');
