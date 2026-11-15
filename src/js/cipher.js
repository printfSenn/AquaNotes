/* Cipher: AES-GCM + PBKDF2 helpers (WebCrypto). Pure functions, no DOM, no app state. */
(function () {
  window.WN = window.WN || {};
  var TE = new TextEncoder(), TD = new TextDecoder();

  function b64(buf) { var u = new Uint8Array(buf), s2 = ''; for (var i = 0; i < u.length; i++) s2 += String.fromCharCode(u[i]); return btoa(s2); }
  function unb64(t) { var b = atob(t), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function deriveKey(pass, salt, iter) {
    return crypto.subtle.importKey('raw', TE.encode(pass), 'PBKDF2', false, ['deriveKey']).then(function (km) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  function encJSON(key, obj, aad) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: TE.encode(aad) }, key, TE.encode(JSON.stringify(obj))).then(function (ct) { return { iv: b64(iv), ct: b64(ct) }; });
  }
  function decJSON(key, rec, aad) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv), additionalData: TE.encode(aad) }, key, unb64(rec.ct)).then(function (pt2) { return JSON.parse(TD.decode(pt2)); });
  }

  WN.cipher = { b64: b64, unb64: unb64, deriveKey: deriveKey, encJSON: encJSON, decJSON: decJSON };
})();
