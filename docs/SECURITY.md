# Security notes

## What it protects

Notes are protected **at rest**: in the browser's storage and in the cloud copy. Someone who copies your browser profile,
or who can read the cloud database, sees only ciphertext.

## What it does not protect against

- **Malicious or modified page code.** The code that asks for your passphrase is the code that decrypts. Whoever can change the
  page (an editor of the artifact, a compromised host, an XSS bug) can read what you type. The strict CSP build limits network
  access but cannot defend against a page that was replaced.
- Malware or keyloggers on your device, and someone watching your screen while it is unlocked.
- A weak passphrase. There is no server to rate-limit guesses; the only brake is the key-derivation cost.
- Anything you export: **Export (plain text)** copies notes unencrypted to the clipboard.

## Design

| Part | Choice |
| --- | --- |
| Key derivation | PBKDF2-HMAC-SHA256, 600,000 iterations, 16-byte random salt (WebCrypto) |
| Encryption | AES-256-GCM, fresh random 96-bit IV for every record |
| Binding | the document id is used as additional authenticated data, so a ciphertext cannot be moved to another note |
| Passphrase check | a small "check" record encrypted with the key; a wrong passphrase fails authentication, nothing is stored about the passphrase |
| Recovery | none. Forget the passphrase and the notes cannot be opened |

Storage layout (`water-vault-v1` in localStorage, and the same documents in the cloud collection):

```
meta        { v, salt, iter, check{iv,ct} }                   not secret
settings    { u, iv, ct }                                      tag colors, encrypted
n_<id>      { u, iv, ct }   or   { u, del: true }              one document per note, or a deletion marker
```

**Stored unencrypted:** salt and iteration count, document ids, last-modified timestamps, the number of notes, deletion markers,
and a few non-sensitive preferences (theme, font size, auto-lock minutes, whether sync is on). Tag names, folders, titles,
text and deadlines are inside the encrypted records.

## Behaviour worth knowing

- **Lock** encrypts anything pending, drops the key and the notes from memory, clears the editor, the list, the cards and any
  backup text box, and stops the water. JavaScript cannot guarantee that every copy of a string is wiped from memory at once.
- **Auto-lock** after 1, 5, 15 or 30 minutes without input (also checked when the tab becomes visible again).
- **Wrong passphrase**: after three failures there is a growing wait. This is only friction in the UI; it does not stop someone
  who attacks the stored data directly.
- **Change passphrase** needs the vault unlocked, asks for the current passphrase again, and with sync on requires that this
  device is connected and fully synced. It builds the new vault first, publishes the new `meta` and notes, and if any write fails it
  puts the old ones back. Other devices see that `meta.prev` points to their salt and offer to switch to the new passphrase.
- **Sync** is last-writer-wins per note using the plain timestamp, with deletion markers. Documents that fail to decrypt are
  ignored. Deleting the cloud copy from one device while another still syncs makes the other upload its notes again, so turn sync
  off there first.
- **Content-Security-Policy build** (`dist/index.secure.html`): no network (`connect-src 'none'`), scripts and styles allowed only
  by hash, no `unsafe-inline` or `unsafe-eval`, images only from `data:`.

## Ideas for hardening further

- Replace PBKDF2 with a memory-hard KDF (Argon2id) compiled to WebAssembly.
- Keep the key in a non-extractable `CryptoKey` only (already the case) and add a "lock on blur" option.
- Subresource-integrity and signed releases if the page is hosted by someone else.
- A real backend with accounts is only worth it if you need sharing or recovery; end-to-end encryption can stay as is.
