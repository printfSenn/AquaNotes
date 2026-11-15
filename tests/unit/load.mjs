// Loads one of the classic browser scripts into a sandbox and returns the WN namespace it defines.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
export function load(name) {
  const ctx = { TextEncoder, TextDecoder, crypto: globalThis.crypto, btoa, atob, console, Uint8Array, JSON, Date, Math };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(readFileSync(join(here, '..', '..', 'src', 'js', name), 'utf8'), ctx);
  return ctx.WN;
}
