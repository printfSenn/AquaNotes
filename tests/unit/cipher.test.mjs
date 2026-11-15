import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
const { cipher } = load('cipher.js');
const salt = new Uint8Array(16).fill(7);

test('encrypt then decrypt round-trips', async () => {
  const key = await cipher.deriveKey('correct horse battery', salt, 1000);
  const rec = await cipher.encJSON(key, { body: 'secret', tags: ['a'] }, 'n_1');
  assert.deepEqual(await cipher.decJSON(key, rec, 'n_1'), { body: 'secret', tags: ['a'] });
  assert.ok(!JSON.stringify(rec).includes('secret'));
});
test('a wrong passphrase cannot decrypt', async () => {
  const key = await cipher.deriveKey('correct horse battery', salt, 1000), bad = await cipher.deriveKey('wrong passphrase!', salt, 1000);
  const rec = await cipher.encJSON(key, { x: 1 }, 'check');
  await assert.rejects(cipher.decJSON(bad, rec, 'check'));
});
test('a ciphertext bound to one note id does not decrypt as another', async () => {
  const key = await cipher.deriveKey('correct horse battery', salt, 1000);
  const rec = await cipher.encJSON(key, { x: 1 }, 'n_1');
  await assert.rejects(cipher.decJSON(key, rec, 'n_2'));
});
test('tampering with the ciphertext is detected', async () => {
  const key = await cipher.deriveKey('correct horse battery', salt, 1000);
  const rec = await cipher.encJSON(key, { x: 1 }, 'n_1'), raw = cipher.unb64(rec.ct); raw[0] ^= 1;
  await assert.rejects(cipher.decJSON(key, { iv: rec.iv, ct: cipher.b64(raw) }, 'n_1'));
});
test('every encryption uses a fresh IV', async () => {
  const key = await cipher.deriveKey('correct horse battery', salt, 1000);
  const a = await cipher.encJSON(key, { x: 1 }, 'n_1'), b = await cipher.encJSON(key, { x: 1 }, 'n_1');
  assert.notEqual(a.iv, b.iv); assert.notEqual(a.ct, b.ct);
});
