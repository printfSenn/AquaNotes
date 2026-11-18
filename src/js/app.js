/* App: notes, pool view, encrypted vault, lock screen, sync and passphrase change.
   Everything here shares one scope on purpose; the pure parts live in cipher.js / deadline.js / ice.js
   and the water simulation in water.js. */
try { (function () {
var Water = WN.water, Cipher = WN.cipher, Due = WN.deadline, Ice = WN.ice, Paper = WN.paper;
var b64 = Cipher.b64, unb64 = Cipher.unb64, deriveKey = Cipher.deriveKey, encJSON = Cipher.encJSON, decJSON = Cipher.decJSON;
var dueDate = Due.dueDate, dueLabel = Due.dueLabel, depthOf = Due.depthOf;
var KEY = 'water-notes-v1', notes = [], now = null, qs = '', tagF = '', tm = 0, armed = 0, sortBy = 'recent', trash = null, preview = false, trashTm = 0, folderF = '';
var $ = function (i) { return document.getElementById(i); };
var list = $('list'), chips = $('chips'), body = $('body'), tagsIn = $('tags'), st = $('st'), wcEl = $('wc');
var pinB = $('pinb'), delB = $('delb');
notes = [];
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function save() { persist(); }
function ago(t) {
  var s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function titleOf(n) { return n.body.split('\n')[0].trim() || 'New note'; }
function snip(n) { return (n.body.split('\n').slice(1).join(' ').trim() || (n.tags.length ? '#' + n.tags.join(' #') : 'No more text')).slice(0, 60); }
function visible() {
  var s = qs.toLowerCase();
  return notes.filter(function (n) {
    return (!tagF || n.tags.indexOf(tagF) > -1) && folderOk(n) && (!s || (n.body + ' ' + n.tags.join(' ') + ' ' + (n.folder || '')).toLowerCase().indexOf(s) > -1);
  }).sort(function (a, b) {
    var d = sortBy === 'az' ? titleOf(a).toLowerCase().localeCompare(titleOf(b).toLowerCase())
      : sortBy === 'due' ? (a.due || '9999').localeCompare(b.due || '9999') : sortBy === 'created' ? (b.created || b.updated) - (a.created || a.updated) : b.updated - a.updated;
    return (+!!b.pinned - +!!a.pinned) || d;
  });
}
function renderTags() {
  renderFolders();
  var all = [];
  notes.forEach(function (n) { n.tags.forEach(function (t) { if (all.indexOf(t) < 0) all.push(t); }); });
  all.sort(); if (tagF && all.indexOf(tagF) < 0) tagF = '';
  chips.textContent = ''; renderSwatches();
  if (!all.length) return;
  ['All'].concat(all).forEach(function (t) {
    var b = document.createElement('button'); b.textContent = t === 'All' ? 'All' : '#' + t;
    if (t !== 'All') { var tc = tagColor(t); if (tc) { b.style.boxShadow = 'inset 3px 0 0 ' + tc; if (t === tagF) { b.style.background = tc; b.style.color = '#0a2a3c'; b.style.borderColor = tc; } } }
    if ((t === 'All' && !tagF) || t === tagF) b.className = 'on';
    b.onclick = function () { tagF = t === 'All' ? '' : t; renderTags(); renderList(); };
    chips.appendChild(b);
  });
}
function renderList() {
  var nb = notes.length; notes = notes.filter(function (n) { return n === now || n.body.trim() || n.tags.length; }); if (notes.length !== nb) quietSave();
  var v = visible(); list.textContent = '';
  $('cnt2').textContent = (v.length === notes.length ? notes.length : v.length + ' of ' + notes.length) + (notes.length === 1 ? ' note' : ' notes');
  v.forEach(function (n) {
    var d = document.createElement('div'); d.className = 'item' + (now && n.id === now.id ? ' sel' : '');
    var t = document.createElement('div'); t.className = 'it'; t.textContent = (n.pinned ? '\u2605 ' : '') + titleOf(n);
    n.tags.forEach(function (tg) { var tcol = tagColor(tg); if (!tcol) return; var dt = document.createElement('span'); dt.className = 'dot'; dt.style.background = tcol; t.appendChild(dt); });
    var s = document.createElement('div'); s.className = 'is'; s.textContent = (n.folder ? n.folder + ' \u00b7 ' : '') + (n.due ? dueLabel(n) : ago(n.updated)) + ' \u00b7 ' + snip(n);
    d.appendChild(t); d.appendChild(s); d.onclick = function () { now = n; fill(); renderList(); };
    list.appendChild(d);
  });
  if (!v.length) { var e = document.createElement('div'); e.className = 'none'; e.textContent = notes.length ? 'No matches' : 'No notes yet'; list.appendChild(e); }
  renderPool();
}
function count() {
  var w = body.value.trim().split(/\s+/).filter(Boolean).length, g = now && now.goal ? now.goal : 0;
  wcEl.textContent = g ? w + ' / ' + g + ' words' : w + (w === 1 ? ' word' : ' words');
  var bf = $('barfill'); bf.style.width = g ? Math.min(100, w / g * 100) + '%' : '0'; bf.className = g && w >= g ? 'ok' : ''; $('bar').hidden = !g;
}
function fill() {
  body.value = now ? now.body : ''; tagsIn.value = now ? now.tags.join(', ') : ''; $('folder').value = now ? (now.folder || '') : ''; $('goal').value = now && now.goal ? now.goal : ''; $('due').value = now ? (now.due || '') : ''; setEditorEnabled(!!now);
  pinB.textContent = now && now.pinned ? 'Unpin' : 'Pin';
  st.textContent = now ? 'Edited ' + ago(now.updated) : ''; count(); renderPreview();
}
function dirty() {
  now.updated = Date.now(); st.textContent = 'Saving...'; clearTimeout(tm);
  tm = setTimeout(function () { save(); renderList(); renderTags(); }, 400);
}
function ripple() { Water.disturb(Water.GW / 2, Water.GH / 2, 5, 260); }
function newNote(fx, fy) {
  if (now && !now.body.trim()) { if (poolMode) openDrawer(); body.focus(); return; }
  var n = { id: uid(), body: '', tags: [], pinned: false, updated: Date.now(), created: Date.now(), folder: folderF && folderF !== '__none' ? folderF : '' };
  place(n, fx, fy); notes.push(n); now = n; qs = ''; tagF = ''; $('q').value = '';
  save(); fill(); renderList(); renderTags(); body.focus(); ripple(); if (poolMode) openDrawer();
}
function flash(m) { st.textContent = m; setTimeout(function () { if (now) st.textContent = 'Edited ' + ago(now.updated); }, 1500); }
function fallbackCopy() { try { body.select(); document.execCommand('copy'); flash('Copied'); } catch (e) { flash('Select the text and copy it'); } }

body.oninput = function () { if (!now) return; now.body = body.value; count(); dirty(); };
tagsIn.oninput = function () {
  if (!now) return; var out = [];
  tagsIn.value.split(',').forEach(function (t) { t = t.trim().toLowerCase().replace(/^#/, ''); if (t && out.indexOf(t) < 0) out.push(t); });
  now.tags = out; dirty();
};
$('q').oninput = function () { qs = this.value; renderList(); };
$('newb').onclick = function () { newNote(); };
pinB.onclick = function () { if (!now) return; now.pinned = !now.pinned; pinB.textContent = now.pinned ? 'Unpin' : 'Pin'; dirty(); renderList(); };
$('copyb').onclick = function () {
  if (!now) return;
  try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(now.body).then(function () { flash('Copied'); }, fallbackCopy); return; } } catch (e) {}
  fallbackCopy();
};
delB.onclick = function () {
  if (!now) return;
  if (!armed) { delB.textContent = 'Sure?'; delB.classList.add('armed'); armed = setTimeout(function () { delB.textContent = 'Delete'; delB.classList.remove('armed'); armed = 0; }, 2500); return; }
  clearTimeout(armed); armed = 0; delB.textContent = 'Delete'; delB.classList.remove('armed');
  trash = now; notes = notes.filter(function (n) { return n !== now; });
  now = visible()[0] || notes[0] || null; save();
  if (!now) { fill(); renderList(); renderTags(); toastUndo(); return; }
  fill(); renderList(); renderTags(); ripple(); toastUndo();
};

var pv = $('pv'), prevB = $('prevb'), toast = $('toast'), imp = $('imp'), impBox = $('impbox');
function showToast(msg, undo, label, sticky) {
  toast.textContent = msg + ' ';
  if (undo) { var b = document.createElement('button'); b.textContent = label || 'Undo'; b.onclick = undo; toast.appendChild(b); }
  toast.hidden = false; clearTimeout(trashTm);
  trashTm = setTimeout(function () { toast.hidden = true; trash = null; }, sticky ? 30000 : 7000);
}
function toastUndo() {
  showToast('Note deleted.', function () {
    if (!trash) return;
    trash.updated = Date.now(); notes.push(trash); now = trash; trash = null; toast.hidden = true; save(); fill(); renderList(); renderTags();
  });
}
function inline(text, parent) {
  text.split(/(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)]+)/g).forEach(function (p) {
    if (!p) return; var el;
    if (p.slice(0, 2) === '**' && p.length > 4) { el = document.createElement('strong'); el.textContent = p.slice(2, -2); }
    else if (p.charAt(0) === '`' && p.length > 2) { el = document.createElement('code'); el.textContent = p.slice(1, -1); }
    else if (/^https?:\/\//.test(p)) { el = document.createElement('a'); el.textContent = p; el.href = p; el.target = '_blank'; el.rel = 'noopener noreferrer'; }
    else el = document.createTextNode(p);
    parent.appendChild(el);
  });
}
function toggleLine(i, on) {
  var lines = now.body.split('\n');
  lines[i] = lines[i].replace(/\[[ xX]\]/, on ? '[x]' : '[ ]');
  now.body = lines.join('\n'); body.value = now.body; dirty(); renderPreview();
}
function renderPreview() { if (preview && now) renderInto(pv, now.body, true); else pv.textContent = ''; }
function renderInto(el, text, live) {
  el.textContent = '';
  text.split('\n').forEach(function (line, i) {
    var d = document.createElement('div'), m;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { d.className = 'h' + m[1].length; inline(m[2], d); }
    else if ((m = /^\s*[-*]\s+\[([ xX])\]\s?(.*)$/.exec(line))) {
      d.className = 'chk';
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = m[1] !== ' ';
      if (live) cb.onchange = function () { toggleLine(i, cb.checked); }; else cb.disabled = true;
      var sp = document.createElement('span'); if (cb.checked) sp.className = 'done'; inline(m[2], sp);
      d.appendChild(cb); d.appendChild(sp);
    }
    else if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) { d.appendChild(document.createTextNode('\u2022 ')); inline(m[1], d); }
    else if (!line.trim()) d.className = 'gap';
    else inline(line, d);
    el.appendChild(d);
  });
}
function setPreview(on) { preview = on; body.hidden = on; pv.hidden = !on; prevB.textContent = on ? 'Edit' : 'Preview'; renderPreview(); }
prevB.onclick = function () { setPreview(!preview); };
$('sort').onchange = function () { sortBy = this.value; renderList(); };
$('expb').onclick = function () {
  var json = JSON.stringify(notes, null, 1);
  function manual() { impBox.hidden = false; imp.value = json; imp.focus(); imp.select(); showToast('Copy the text from the box.'); }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).then(function () { showToast('Copied ' + notes.length + ' notes as backup.'); }, manual); return;
    }
  } catch (e) {}
  manual();
};
$('impb').onclick = function () { impBox.hidden = !impBox.hidden; if (!impBox.hidden) { imp.value = ''; imp.focus(); } };
$('cancelb').onclick = function () { impBox.hidden = true; };
$('mergeb').onclick = function () {
  var data; try { data = JSON.parse(imp.value); } catch (e) { data = null; }
  if (!Array.isArray(data)) { showToast('That is not valid backup text.'); return; }
  var added = 0;
  data.forEach(function (x) {
    if (!x || typeof x.body !== 'string') return;
    var rec = { id: typeof x.id === 'string' && x.id ? x.id : uid(), body: x.body,
      tags: Array.isArray(x.tags) ? x.tags.filter(function (t) { return typeof t === 'string'; }) : [],
      pinned: !!x.pinned, folder: typeof x.folder === 'string' ? x.folder : '', goal: +x.goal || 0, due: typeof x.due === 'string' ? x.due : '', updated: +x.updated || Date.now(), created: +x.created || +x.updated || Date.now() };
    var ex = notes.filter(function (n) { return n.id === rec.id; })[0];
    if (!ex) { notes.push(rec); added++; }
    else if (rec.updated > ex.updated) { ex.body = rec.body; ex.tags = rec.tags; ex.pinned = rec.pinned; ex.folder = rec.folder; ex.goal = rec.goal; ex.due = rec.due; ex.updated = rec.updated; added++; }
  });
  impBox.hidden = true; save(); fill(); renderList(); renderTags(); showToast('Imported ' + added + (added === 1 ? ' note.' : ' notes.'));
};
document.addEventListener('keydown', function (e) {
  var k = (e.key || '').toLowerCase();
  if (!unlocked) return;
  if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); $('q').focus(); $('q').select(); }
  else if (e.altKey && k === 'n') { e.preventDefault(); newNote(); }
  else if (e.altKey && k === 'l') { e.preventDefault(); lockNow(); }
  else if (k === 'escape' && document.activeElement === $('q')) { $('q').value = ''; qs = ''; renderList(); }
  else if (k === 'escape' && app.classList.contains('focus')) setFocus(false);
});

var app = document.querySelector('.app');
var PKEY = 'water-notes-prefs-v1', prefs = { theme: 'water', fs: 15, tagColors: {}, tagMode: 'auto' };
try { var sp = JSON.parse(localStorage.getItem(PKEY) || '{}'); if (sp && typeof sp === 'object') for (var pk in sp) prefs[pk] = sp[pk]; } catch (e) {}
if (!prefs.tagColors || typeof prefs.tagColors !== 'object') prefs.tagColors = {};
var SYNC_KEY = 'aquanotes-sync-v1', syncAuth = null;
try { syncAuth = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null'); } catch (e) { syncAuth = null; }
if (!syncAuth || typeof syncAuth !== 'object') syncAuth = null;
var PALETTE = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#9775fa', '#f783ac'];
function savePrefs() { try { var c = {}; for (var k in prefs) if (k !== 'tagColors') c[k] = prefs[k]; localStorage.setItem(PKEY, JSON.stringify(c)); } catch (e) {} persist(); }
function tagColor(t) {
  var sc = prefs.tagColors[t]; if (sc === 'none') return null; if (sc) return sc; if (prefs.tagMode === 'none') return null;
  var h = 0; for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function applyPrefs() {
  if (prefs.theme === 'night') { prefs.theme = 'dark'; prefs.night = true; }
  app.classList.toggle('light', prefs.theme === 'light'); app.classList.toggle('dark', prefs.theme === 'dark');
  Water.style = prefs.wstyle === 'pond' ? 'pond' : 'pool'; Water.pads = prefs.pads !== false; Water.night = !!prefs.night; Water.rain = !!prefs.rain; Water.koi = prefs.koi !== false; Water.depth = prefs.depth !== false;
  document.body.classList.toggle('night', !!prefs.night); document.body.classList.toggle('pond', prefs.wstyle === 'pond');
  $('wstyle').value = prefs.wstyle === 'pond' ? 'pond' : 'pool'; $('padsc').checked = prefs.pads !== false; $('nightc').checked = !!prefs.night; $('rainc').checked = !!prefs.rain; $('koic').checked = prefs.koi !== false; $('depthc').checked = prefs.depth !== false;
  app.style.setProperty('--fs', prefs.fs + 'px');
  $('theme').value = prefs.theme; $('fs').value = prefs.fs; $('fsv').textContent = prefs.fs + ' px'; $('tagmode').value = prefs.tagMode === 'none' ? 'none' : 'auto'; $('autolock').value = String(prefs.autolock || 5); $('syncon').checked = prefs.sync !== false; renderSyncAuth();
}
function renderSwatches() {
  var sw = $('sw'); sw.textContent = ''; sw.hidden = !tagF; if (!tagF) return;
  var lab = document.createElement('span'); lab.textContent = '#' + tagF + ' color'; sw.appendChild(lab);
  var nb = document.createElement('button'); nb.className = 'swb none' + (tagColor(tagF) === null ? ' sel' : ''); nb.textContent = '\u00d7'; nb.title = 'No color';
  nb.onclick = function () { prefs.tagColors[tagF] = 'none'; savePrefs(); renderTags(); renderList(); };
  sw.appendChild(nb);
  PALETTE.forEach(function (c) {
    var b = document.createElement('button'); b.className = 'swb' + (tagColor(tagF) === c ? ' sel' : ''); b.style.background = c; b.title = c;
    b.onclick = function () { prefs.tagColors[tagF] = c; savePrefs(); renderTags(); renderList(); };
    sw.appendChild(b);
  });
}
function folderOk(n) { return !folderF || (folderF === '__none' ? !n.folder : n.folder === folderF); }
function renderFolders() {
  var fl = [], sel = $('fsel'), dl = $('folders');
  notes.forEach(function (n) { if (n.folder && fl.indexOf(n.folder) < 0) fl.push(n.folder); });
  fl.sort(); if (folderF && folderF !== '__none' && fl.indexOf(folderF) < 0) folderF = '';
  sel.textContent = ''; dl.textContent = '';
  [['', 'All folders'], ['__none', 'No folder']].concat(fl.map(function (f) { return [f, '\u25b8 ' + f]; })).forEach(function (o) {
    var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; sel.appendChild(op);
  });
  fl.forEach(function (f) { var op = document.createElement('option'); op.value = f; dl.appendChild(op); });
  sel.value = folderF;
}
function setFocus(on) {
  app.classList.toggle('focus', on); document.body.classList.toggle('focusing', on); syncLayout();
  $('focusb').textContent = on ? 'Exit focus' : 'Focus'; if (on) { if (preview) setPreview(false); body.focus(); }
}
$('focusb').onclick = function () { setFocus(!app.classList.contains('focus')); };
$('fsel').onchange = function () { folderF = this.value; renderList(); };
$('folder').oninput = function () { if (!now) return; now.folder = this.value.trim(); dirty(); };
$('goal').oninput = function () { if (!now) return; var g = parseInt(this.value, 10); now.goal = g > 0 ? g : 0; count(); dirty(); };
function closeSettings() { $('setbox').hidden = true; app.classList.remove('settings-open'); }
$('setb').onclick = function () { var open = $('setbox').hidden; $('setbox').hidden = !open; app.classList.toggle('settings-open', open); };
$('setclose').onclick = closeSettings;
function setSetTab(t) {
  $('setnotes').hidden = t !== 'notes'; $('setpool').hidden = t !== 'pool';
  $('settabn').classList.toggle('pri', t === 'notes'); $('settabp').classList.toggle('pri', t === 'pool');
}
$('settabn').onclick = function () { setSetTab('notes'); }; $('settabp').onclick = function () { setSetTab('pool'); };
[['nightc', 'night'], ['rainc', 'rain'], ['koic', 'koi'], ['depthc', 'depth'], ['padsc', 'pads']].forEach(function (p) { $(p[0]).onchange = function () { prefs[p[1]] = this.checked; applyPrefs(); savePrefs(); }; });
$('wstyle').onchange = function () { prefs.wstyle = this.value; applyPrefs(); savePrefs(); };
$('theme').onchange = function () { prefs.theme = this.value; applyPrefs(); savePrefs(); };
$('fs').oninput = function () { prefs.fs = +this.value; applyPrefs(); savePrefs(); };
$('tagmode').onchange = function () { prefs.tagMode = this.value; savePrefs(); renderTags(); renderList(); };
applyPrefs();

var poolMode = false, cardEls = {}, CWD = 168, CHT = 96;
function c01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function byId(id) { return notes.filter(function (n) { return n.id === id; })[0]; }
function quietSave() { persist(); }
function place(n, fx, fy) {
  if (fx != null) { n.px = c01(fx); n.py = c01(fy); return; }
  var W = window.innerWidth, H = window.innerHeight, tries = 0, ok;
  do {
    n.px = 0.04 + Math.random() * 0.8; n.py = 0.05 + Math.random() * 0.85; ok = true;
    notes.forEach(function (o) { if (o !== n && o.px != null && Math.abs((o.px - n.px) * W) < 180 && Math.abs((o.py - n.py) * H) < 100) ok = false; });
  } while (!ok && ++tries < 30);
}
function openDrawer() { app.classList.remove('off'); $('tog').textContent = 'Hide notes'; }
function syncLayout() { app.classList.toggle('drawer', poolMode && !app.classList.contains('focus')); }
function openCard(n) { now = n; n.seen = Date.now(); quietSave(); openDrawer(); fill(); renderList(); }
function wake(x0, y0, x1, y1) {
  var dx = x1 - x0, dy = y1 - y0, dist = Math.sqrt(dx * dx + dy * dy); if (dist < 0.5) return;
  var C = Water.CELL, nx = dx / dist, ny = dy / dist, steps = Math.min(10, Math.max(1, Math.ceil(dist / (C * 2)))), v = Math.min(dist, 40);
  var amt = (14 + v * 1.4) / Math.sqrt(steps), rad = 2.2 + v * 0.045, ext = Math.abs(nx) * CWD / 2 + Math.abs(ny) * CHT / 2, lat = Math.abs(ny) * CWD / 2 + Math.abs(nx) * CHT / 2;
  for (var s = 1; s <= steps; s++) {
    var px = x0 + dx * s / steps, py = y0 + dy * s / steps;
    for (var k = -1; k <= 1; k++) {
      var lx = -ny * lat * 0.75 * k, ly = nx * lat * 0.75 * k;
      Water.disturb((px + nx * ext + lx) / C, (py + ny * ext + ly) / C, rad, amt * (k ? 0.7 : 1));
      Water.disturb((px - nx * ext + lx) / C, (py - ny * ext + ly) / C, rad * 1.1, -amt * 0.45);
    }
  }
}
function bindCard(el, id) {
  var down = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0, wx = null, wy = 0;
  el.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    commitDrift(id);
    var r = el.getBoundingClientRect(); down = true; moved = false; sx = e.clientX; sy = e.clientY; ox = e.clientX - r.left; oy = e.clientY - r.top;
    try { el.setPointerCapture(e.pointerId); } catch (x) {}
    e.preventDefault();
  });
  el.addEventListener('pointermove', function (e) {
    if (!down) return;
    if (!moved) {
      if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) < 5) return;
      moved = true; el.classList.add('drag'); Water.disturb(e.clientX / Water.CELL, e.clientY / Water.CELL, 3, 120);
    }
    var W = window.innerWidth, H = window.innerHeight;
    el.style.left = Math.min(Math.max(18, e.clientX - ox), W - CWD - 18) + 'px';
    el.style.top = Math.min(Math.max(64, e.clientY - oy), H - CHT - 46) + 'px';
    var ccx = parseFloat(el.style.left) + CWD / 2, ccy = parseFloat(el.style.top) + CHT / 2;
    if (wx !== null) wake(wx, wy, ccx, ccy);
    wx = ccx; wy = ccy;
  });
  function end(e, cancelled) {
    if (!down) return; down = false; wx = null; el.classList.remove('drag');
    try { el.releasePointerCapture(e.pointerId); } catch (x) {}
    var n = byId(id); if (!n) return;
    if (moved) {
      var W = window.innerWidth, H = window.innerHeight, x = parseFloat(el.style.left), y = parseFloat(el.style.top);
      n.px = c01((x - 18) / Math.max(1, W - CWD - 36)); n.py = c01((y - 64) / Math.max(1, H - CHT - 110)); n.seen = Date.now();
      quietSave(); Water.disturb((x + CWD / 2) / Water.CELL, (y + CHT / 2) / Water.CELL, 3, 60); var ph = physOf(id); ph.vx = ph.vy = ph.wz = 0; ph.settle = performance.now(); renderPool();
    } else if (!cancelled) openCard(n);
  }
  el.addEventListener('pointerup', function (e) { end(e, false); });
  el.addEventListener('pointercancel', function (e) { end(e, true); });
}
function renderPool() {
  if (!poolMode) return;
  if (!document.documentElement.style.getPropertyValue('--paper')) document.documentElement.style.setProperty('--paper', 'url(' + Paper.texture() + ')');
  var pl = $('pool'), changed = false, keep = {}, W = window.innerWidth, H = window.innerHeight;
  notes.forEach(function (n) { if (n.px == null) { place(n); changed = true; } });
  if (changed) quietSave();
  visible().forEach(function (n) {
    keep[n.id] = 1; var el = cardEls[n.id];
    if (!el) {
      el = cardEls[n.id] = document.createElement('div'); el.className = 'card';
      var ci = document.createElement('div'); ci.className = 'cin';
      ['ct', 'cs', 'cm'].forEach(function (c) { var d = document.createElement('div'); d.className = c; ci.appendChild(d); });
      var wl = document.createElement('div'); wl.className = 'wl'; ci.appendChild(wl);
      var pin = document.createElement('div'); pin.className = 'pin'; ci.appendChild(pin);
      el.appendChild(ci); bindCard(el, n.id); pl.appendChild(el);
    }
    var cin = el.firstChild, d = depthOf(n), col = null;
    n.tags.some(function (tg) { col = tagColor(tg); return !!col; });
    if (!el.classList.contains('drag')) {
      el.style.left = (18 + n.px * Math.max(0, W - CWD - 36)) + 'px'; el.style.top = (64 + n.py * Math.max(0, H - CHT - 110)) + 'px';
    }
    cin.children[0].textContent = (n.pinned ? '\u2605 ' : '') + titleOf(n).replace(/^#+\s*/, '');
    cin.children[1].textContent = n.body.split('\n').slice(1).join(' ').trim().slice(0, 70);
    cin.children[2].textContent = ago(n.updated);
    var ps = Paper.style(n.id), rr = Math.round(ps.tone[0] - 125 * d), gg = Math.round(ps.tone[1] - 82 * d), bb = Math.round(ps.tone[2] - 62 * d);
    var layers = ['linear-gradient(135deg, rgba(255,255,255,.4), rgba(255,255,255,0) 42%, rgba(0,40,80,.07))'];
      if (ps.crease) { var cp = ps.crease.pos; layers.push('linear-gradient(' + ps.crease.ang + 'deg, rgba(0,0,0,0) ' + (cp - 0.6) + '%, rgba(60,50,40,.17) ' + cp + '%, rgba(255,255,255,.6) ' + (cp + 0.7) + '%, rgba(0,0,0,0) ' + (cp + 1.4) + '%)', 'linear-gradient(' + ps.crease.ang + 'deg, rgba(0,0,0,.035) ' + cp + '%, rgba(255,255,255,.05) ' + cp + '%)'); }
      if (ps.curl) layers.push('radial-gradient(circle at 100% ' + (ps.curl === 'br' ? '100%' : '0%') + ', rgba(0,0,0,0) 0, rgba(0,0,0,0) 9px, rgba(40,30,20,.14) 12px, rgba(255,255,255,.38) 15px, rgba(0,0,0,0) 23px)');
      if (d > 0.04) layers.push('repeating-linear-gradient(118deg, rgba(0,60,100,' + (0.08 * d).toFixed(3) + ') 0 5px, rgba(255,255,255,0) 5px 13px)', 'repeating-linear-gradient(62deg, rgba(0,50,90,' + (0.06 * d).toFixed(3) + ') 0 7px, rgba(255,255,255,0) 7px 19px)');
      cin.style.background = layers.join(',') + ',rgba(' + rr + ',' + gg + ',' + bb + ',' + (0.96 - 0.3 * d).toFixed(2) + ')';
      cin.style.setProperty('--px', ps.px + 'px'); cin.style.setProperty('--py', ps.py + 'px');
      cin.style.clipPath = 'polygon(' + Paper.edge(n.id, d) + ')';
      cin.children[4].style.display = n.pinned ? 'block' : 'none';
    cin.style.boxShadow = col ? 'inset 4px 0 0 ' + col : 'none';
    el.style.setProperty('--d', d.toFixed(3)); el.style.setProperty('--ink', (d * 0.9).toFixed(2) + 'px');
    cin.children[3].style.display = d > 0.03 ? 'block' : 'none';
    var side = (parseInt(n.id.slice(-2), 36) % 2) ? 1 : -1;
    el.style.opacity = (1 - 0.4 * d).toFixed(2); el.style.filter = 'drop-shadow(0 1px 1.5px rgba(0,30,50,' + (0.3 - 0.15 * d).toFixed(2) + '))' + (now && now.id === n.id ? ' drop-shadow(0 0 3px #4dabf7) drop-shadow(0 0 9px rgba(77,171,247,.8))' : '');
    el.style.transform = 'translateY(' + (d * 7).toFixed(1) + 'px) rotate(' + (side * d * 6).toFixed(1) + 'deg) scale(' + (1 - 0.12 * d).toFixed(3) + ')';
    cin.children[2].textContent = (n.due ? dueLabel(n) : ago(n.updated)) + (d > 0.85 ? ' \u00b7 sinking' : d > 0.5 ? ' \u00b7 soaked' : d > 0.2 ? ' \u00b7 damp' : '');
    el.title = d > 0.05 ? (n.due ? 'Deadline ' + n.due + ': the closer it gets, the wetter the paper.' : 'Untouched for a while. Open or edit it to dry it off.') : '';
    el.classList.toggle('sel', !!now && now.id === n.id);
  });
  Object.keys(cardEls).forEach(function (id) { if (!keep[id]) { cardEls[id].remove(); delete cardEls[id]; } });
}
// ---------- floating physics: the paper rides the water ----------
// Each card samples the wave field around it. It tilts with the surface slope, is pushed away from strong waves
// and down the slope, twists when the surface shears across it, and settles where the water leaves it.
// Pinned notes are "moored": they bob and tilt but do not drift.
var FLOAT = { push: 4, slope: 170, drag: 0.955, vmax: 280, torque: 200, tilt: 0.04, lift: 0.05 };
var phys = {}, lastPhys = 0, calmUser = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
function physOf(id) { return phys[id] || (phys[id] = { ox: 0, oy: 0, vx: 0, vy: 0, rz: 0, wz: 0, tx: 0, ty: 0, ph: Math.random() * 6.283, calm: 0 }); }
function clampv(v, a, b) { return v < a ? a : v > b ? b : v; }
function commitDrift(id) {
  var el = cardEls[id], n = byId(id), s = phys[id];
  if (!el || !n || !s || (Math.abs(s.ox) < 0.5 && Math.abs(s.oy) < 0.5)) return;
  var W = window.innerWidth, H = window.innerHeight;
  var x = clampv(parseFloat(el.style.left) + s.ox, 18, W - CWD - 18), y = clampv(parseFloat(el.style.top) + s.oy, 64, H - CHT - 46);
  el.style.left = x + 'px'; el.style.top = y + 'px'; s.ox = 0; s.oy = 0;
  n.px = c01((x - 18) / Math.max(1, W - CWD - 36)); n.py = c01((y - 64) / Math.max(1, H - CHT - 110)); quietSave();
}
function stepCards() {
  if (!poolMode || !unlocked || Water.frozen) return;
  var t0 = performance.now(), dt = Math.min(0.05, (t0 - lastPhys) / 1000 || 0.016), t = t0 / 1000, W = window.innerWidth, H = window.innerHeight;
  lastPhys = t0;
  Object.keys(cardEls).forEach(function (id) {
    var el = cardEls[id], n = byId(id); if (!el || !n) return;
    var s = physOf(id), cin = el.firstChild, dragging = el.classList.contains('drag'), amp = calmUser ? 0.25 : 1;
    var left = parseFloat(el.style.left) || 0, top = parseFloat(el.style.top) || 0;
    if (dragging) { s.vx = s.vy = s.wz = 0; commitDrift(id); }
    var cx = left + CWD / 2 + s.ox, cy = top + CHT / 2 + s.oy, hw = 60, hh = 34;
    var hl = Water.sample(cx - hw, cy), hr = Water.sample(cx + hw, cy), ht = Water.sample(cx, cy - hh), hb = Water.sample(cx, cy + hh), hc = Water.sample(cx, cy);
    var sx = (hr - hl) / (2 * hw), sy = (hb - ht) / (2 * hh);
    if (!dragging) {
      var ex = (hr * hr - hl * hl) / (2 * hw), ey = (hb * hb - ht * ht) / (2 * hh);                // wave energy gradient pushes the paper away from the waves
      var gr = clampv((t0 - (s.settle || 0)) / 2000, 0, 1); gr *= gr;                                                          // just let go: the water takes a moment to start pushing again
      s.vx = (s.vx + (-ex * FLOAT.push - sx * FLOAT.slope) * gr * dt) * FLOAT.drag; s.vy = (s.vy + (-ey * FLOAT.push - sy * FLOAT.slope) * gr * dt) * FLOAT.drag;
      var sp = Math.hypot(s.vx, s.vy); if (sp > FLOAT.vmax) { s.vx *= FLOAT.vmax / sp; s.vy *= FLOAT.vmax / sp; }
      if (!n.pinned) {
        s.ox += s.vx * dt; s.oy += s.vy * dt;
        var minx = 18 - left, maxx = W - CWD - 18 - left, miny = 64 - top, maxy = H - CHT - 46 - top;
        if (s.ox < minx) { s.ox = minx; s.vx = Math.abs(s.vx) * 0.3; } else if (s.ox > maxx) { s.ox = maxx; s.vx = -Math.abs(s.vx) * 0.3; }
        if (s.oy < miny) { s.oy = miny; s.vy = Math.abs(s.vy) * 0.3; } else if (s.oy > maxy) { s.oy = maxy; s.vy = -Math.abs(s.vy) * 0.3; }
        if (sp < 3 && (Math.abs(s.ox) > 4 || Math.abs(s.oy) > 4)) { if (++s.calm > 30) { commitDrift(id); s.calm = 0; } } else s.calm = 0;     // settled: remember the new place
      }
      var shear = ((Water.sample(cx + hw, cy + hh) - Water.sample(cx - hw, cy + hh)) - (Water.sample(cx + hw, cy - hh) - Water.sample(cx - hw, cy - hh))) / (2 * hw);
      s.wz = (s.wz + (shear * FLOAT.torque * gr - s.rz * 3) * dt) * 0.96; s.rz = clampv(s.rz + s.wz * dt, -35, 35);                   // twist, and slowly straighten out
    }
    s.tx += (clampv(-Math.atan(sy * FLOAT.tilt * 10) * 57.3, -26, 26) - s.tx) * 0.35; s.ty += (clampv(Math.atan(sx * FLOAT.tilt * 10) * 57.3, -26, 26) - s.ty) * 0.35;
    var bob = Math.sin(t * 1.3 + s.ph) * 1.6, sway = Math.sin(t * 0.9 + s.ph * 1.7) * 0.9;                                   // never completely still
    s.dax = dragging ? 0 : s.tx * amp + Math.sin(t * 1.1 + s.ph) * 1.2; s.day = dragging ? 0 : s.ty * amp + Math.sin(t * 0.8 + s.ph * 2) * 1.2; s.daz = dragging ? 0 : s.rz * amp + sway; s.dsc = 1 + clampv(hc * 0.0016, -0.05, 0.05);
    cin.style.transform = dragging ? '' : 'translate(' + s.ox.toFixed(1) + 'px,' + (s.oy + bob - clampv(hc * FLOAT.lift, -5, 5)).toFixed(1) + 'px) perspective(700px) rotateX(' +
      (s.tx * amp + Math.sin(t * 1.1 + s.ph) * 1.2).toFixed(2) + 'deg) rotateY(' + (s.ty * amp + Math.sin(t * 0.8 + s.ph * 2) * 1.2).toFixed(2) + 'deg) rotateZ(' + (s.rz * amp + sway).toFixed(2) +
      'deg) scale(' + (1 + clampv(hc * 0.0016, -0.05, 0.05)).toFixed(3) + ')';
  });
}
Water.onStep(stepCards);
var SH_O = [0, 0];
// outline of a card (rounded corners, rough edge when wet), as points around its centre
function cardOutline(id, d) {
  var j = Paper.style(id).jit, k = 0.5 + d * 1.6, hw = CWD / 2, hh = CHT / 2, r = 12, cs = [[1, -1], [1, 1], [-1, 1], [-1, -1]], arcs = [], pts = [], q = 0, c, a, ang, cx, cy, jv, i;
  for (c = 0; c < 4; c++) {
    cx = cs[c][0] * (hw - r); cy = cs[c][1] * (hh - r); arcs[c] = [];
    for (a = 0; a <= 4; a++) { ang = (-90 + c * 90 + a * 22.5) * Math.PI / 180; jv = j[q++ % 40] * k * 0.9; arcs[c].push([cx + (r + jv) * Math.cos(ang), cy + (r + jv) * Math.sin(ang)]); }
  }
  for (c = 0; c < 4; c++) {
    var A = arcs[c], B = arcs[(c + 1) % 4], e = A[A.length - 1], f = B[0];
    for (i = 0; i < A.length; i++) pts.push(A[i]);
    for (i = 1; i <= 3; i++) { jv = j[q++ % 40] * k * 0.9; var u = i / 4, mx = e[0] + (f[0] - e[0]) * u, my = e[1] + (f[1] - e[1]) * u, nl = Math.sqrt(mx * mx / (hw * hw) + my * my / (hh * hh)) || 1; pts.push([mx + jv * mx / (hw * nl) * 0.6, my + jv * my / (hh * nl) * 0.6]); }
  }
  return pts;
}
// the shadow follows the real paper: its outline, tilt and twist, its height above the floor, and the way the rippling surface bends the view of the floor.
// Dry paper floats high and throws a soft offset shadow. Wet paper sits lower: a tighter shadow that gets diffuse, faint and wobbly as it soaks and sinks.
function drawShadows(ctx) {
  if (!poolMode || !unlocked || document.body.classList.contains('focusing')) return;
  var dpr = Water.canvas.width / Math.max(1, window.innerWidth), FAR = 4000, RAD = Math.PI / 180;
  Object.keys(cardEls).forEach(function (id) {
    var el = cardEls[id], s = phys[id] || { ox: 0, oy: 0, dax: 0, day: 0, daz: 0, dsc: 1 };
    var left = parseFloat(el.style.left), top = parseFloat(el.style.top); if (isNaN(left) || isNaN(top)) return;
    var dragging = el.classList.contains('drag'), d = parseFloat(el.style.getPropertyValue('--d')) || 0, op = parseFloat(el.style.opacity); if (isNaN(op)) op = 1;
    var side = (parseInt(id.slice(-2), 36) % 2) ? 1 : -1, ecx = left + CWD / 2, ecy = top + CHT / 2;
    var L = Water.shadowDir(ecx + s.ox, ecy + s.oy), sunk = d > 0.85 ? Math.min(1, (d - 0.85) / 0.15) : 0;
    var lift = (dragging ? 36 : 20) * (1 - 0.8 * d), wob = dragging ? 0.6 : 1 + 1.2 * d + sunk;
    var ax = dragging ? 0 : s.dax * RAD, ay = dragging ? 0 : s.day * RAD, az = dragging ? 0 : s.daz * RAD, sc = dragging ? 1 : s.dsc;
    var esc = dragging ? 1.05 : 1 - 0.12 * d, erot = dragging ? 0 : side * d * 6 * RAD, ety = dragging ? 0 : d * 7;
    var cax = Math.cos(ax), sax = Math.sin(ax), cay = Math.cos(ay), say = Math.sin(ay), caz = Math.cos(az), saz = Math.sin(az), cer = Math.cos(erot), ser = Math.sin(erot);
    var ox = dragging ? 0 : s.ox, oy = dragging ? 0 : s.oy, pts = cardOutline(id, d), path = [], i, wm = 5 + 5 * d + 3 * sunk;
    for (i = 0; i < pts.length; i++) {
      var x = pts[i][0] * sc, y = pts[i][1] * sc, x1 = x * caz - y * saz, y1 = x * saz + y * caz;            // rotateZ
      var x2 = x1 * cay, z2 = -x1 * say;                                                                       // rotateY
      var y3 = y1 * cax - z2 * sax, z3 = y1 * sax + z2 * cax, pf = 700 / (700 - z3);                          // rotateX, perspective
      var px = (x2 * pf + ox) * esc, py = (y3 * pf + oy) * esc, rx = px * cer - py * ser, ry = px * ser + py * cer + ety;
      var h = lift + z3 * 0.45; if (h < 1) h = 1;                                                              // raised corners throw longer shadows
      var wx = ecx + rx + L.x * h * L.len * 1.4, wy = ecy + ry + L.y * h * L.len * 1.4;
      Water.refract(wx, wy, SH_O);
      var wxo = SH_O[0] * wob, wyo = SH_O[1] * wob; wxo = wxo > wm ? wm : wxo < -wm ? -wm : wxo; wyo = wyo > wm ? wm : wyo < -wm ? -wm : wyo;
      path.push(wx + wxo, wy + wyo);
    }
    var a = op * L.k * (0.4 - 0.1 * d + sunk * 0.06), soft = 7 + lift * 0.5 + d * 12 + sunk * 6, tight = d < 0.7 ? a * 0.75 * (1 - d / 0.7) : 0;
    ctx.save(); ctx.beginPath(); ctx.moveTo(path[0] - FAR, path[1]);
    for (i = 2; i < path.length; i += 2) ctx.lineTo(path[i] - FAR, path[i + 1]);
    ctx.closePath(); ctx.fillStyle = '#000';
    ctx.shadowColor = 'rgba(' + Math.round(sunk * 4) + ',' + Math.round(16 + sunk * 30) + ',' + Math.round(28 + sunk * 32) + ',' + Math.min(0.9, a).toFixed(3) + ')';
    ctx.shadowBlur = soft * dpr; ctx.shadowOffsetX = FAR * dpr; ctx.shadowOffsetY = 0; ctx.fill();
    if (tight > 0.01) { ctx.shadowColor = 'rgba(0,16,28,' + tight.toFixed(3) + ')'; ctx.shadowBlur = 2.5 * dpr; ctx.shadowOffsetX = (FAR - L.x * lift * 0.3) * dpr; ctx.shadowOffsetY = -L.y * lift * 0.3 * dpr; ctx.fill(); }
    ctx.restore();
  });
}
Water.onDraw(drawShadows);
function setPool(on) {
  poolMode = on; prefs.pool = on; savePrefs();
  $('pool').hidden = !on; $('poolb').textContent = on ? 'List view' : 'Pool view';
  if (on) { app.classList.add('off'); $('tog').textContent = 'Show notes'; } else { app.classList.remove('off'); $('tog').textContent = 'Hide notes'; }
  syncLayout(); renderPool();
}
$('poolb').onclick = function () {
  setPool(!poolMode);
  if (poolMode) showToast('Drag notes around. Double-click the water for a new note.');
};
Water.canvas.addEventListener('dblclick', function (e) {
  if (!unlocked) return;
  if (!poolMode) return;
  newNote((e.clientX - 18 - CWD / 2) / Math.max(1, window.innerWidth - CWD - 36), (e.clientY - 64 - CHT / 2) / Math.max(1, window.innerHeight - CHT - 110));
});
window.addEventListener('resize', renderPool);
setInterval(function () { if (poolMode) renderPool(); }, 60000);
if (prefs.pool) setPool(true);

function setEditorEnabled(on) {
  [body, tagsIn, $('folder'), $('goal'), $('due'), $('prevb'), pinB, $('copyb'), delB, $('focusb')].forEach(function (el) { el.disabled = !on; });
  body.placeholder = on ? 'Write an idea. The first line becomes the title.' : 'No notes yet. Press + New to start one.';
  if (!on && preview) setPreview(false);
  if (!on && app.classList.contains('focus')) setFocus(false);
}
// ================= VAULT: encryption, ice lock, sync =================
var VKEY = 'water-vault-v1', LEGACY = 'water-notes-v1', ITER = 600000;
var vault = null, vkey = null, unlocked = false, pt = 0, flushP = Promise.resolve(), lastSer = {}, lastSet = '';
var fails = 0, blockedUntil = 0, lastAct = Date.now(), mode = 'checking', remoteMeta = null, legacyNotes = [], resetTm = 0, frzTm = 0, delTm = 0;
var chBusy = false, changing = false;
var lockEl = $('lock'), pw = $('pw'), pw2 = $('pw2'), ub = $('unlockb'), rb = $('resetb'), lmsg = $('lm');
var cloud = { col: null, unsub: null, q: Promise.resolve(), applyQ: Promise.resolve() }, cloudP = null;

function did(id) { return 'n_' + id; }
function norm(n) { n.tags = Array.isArray(n.tags) ? n.tags : []; n.body = typeof n.body === 'string' ? n.body : ''; n.updated = +n.updated || Date.now(); n.created = +n.created || n.updated; n.due = typeof n.due === 'string' ? n.due : ''; return n; }
function isBlank(n) { return !n.body.trim() && !n.tags.length; }
function ser(n) { var c = {}; for (var k in n) if (k !== 'rev') c[k] = n[k]; return JSON.stringify(c); }
function readVault() { try { var v = JSON.parse(localStorage.getItem(VKEY)); if (v && v.v === 1 && v.salt && v.check && v.notes) return v; } catch (e) {} return null; }
function writeVault() { try { localStorage.setItem(VKEY, JSON.stringify(vault)); return true; } catch (e) { st.textContent = 'Could not save in this browser'; return false; } }
function readLegacy() { try { var a = JSON.parse(localStorage.getItem(LEGACY) || '[]'); return Array.isArray(a) ? a.filter(function (n) { return n && typeof n === 'object' && n.id; }).map(norm) : []; } catch (e) { return []; } }
function welcomeNote() { return norm({ id: uid(), body: 'Welcome\nYour notes are encrypted with your passphrase before they are saved. Tag them, pin the important ones, give them a deadline, and drag them around in Pool view.', tags: ['welcome'], pinned: false, updated: Date.now() }); }

// ---------- saving: encrypt only what changed ----------
function persist() { if (!unlocked || changing) return; clearTimeout(pt); pt = setTimeout(flush, 350); }
function flush() { flushP = flushP.then(doFlush, doFlush); return flushP; }
function doFlush() {
  if (!vkey || !vault) return Promise.resolve();
  var jobs = [], changed = [], live = {}, key = vkey, now2 = Date.now();
  notes.forEach(function (n) {
    if (isBlank(n)) return;
    var d = did(n.id), sj = ser(n); live[d] = 1;
    if (lastSer[n.id] === sj && vault.notes[d] && !vault.notes[d].del) return;
    lastSer[n.id] = sj; n.rev = now2;
    jobs.push(encJSON(key, n, d).then(function (r) { vault.notes[d] = { u: n.rev, iv: r.iv, ct: r.ct }; changed.push(d); }));
  });
  Object.keys(vault.notes).forEach(function (d) { var e = vault.notes[d]; if (!e.del && !live[d]) { vault.notes[d] = { u: now2, del: 1 }; delete lastSer[d.slice(2)]; changed.push(d); } });
  var sj2 = JSON.stringify(prefs.tagColors || {});
  if (sj2 !== lastSet) { lastSet = sj2; jobs.push(encJSON(key, { tagColors: prefs.tagColors || {} }, 'settings').then(function (r) { vault.settings = { u: Date.now(), iv: r.iv, ct: r.ct }; changed.push('settings'); })); }
  return Promise.all(jobs).then(function () {
    if (changed.length) { if (writeVault()) st.textContent = 'Saved'; changed.forEach(pushDoc); }
  }, function () { st.textContent = 'Could not encrypt this note'; });
}

// ---------- loading ----------
function loadLocal() {
  var ids = Object.keys(vault.notes).filter(function (d) { return !vault.notes[d].del; }), bad = 0;
  return Promise.all(ids.map(function (d) {
    var e = vault.notes[d];
    return decJSON(vkey, e, d).then(function (n) { if (!n || did(n.id) !== d) { bad++; return null; } norm(n); n.rev = e.u; return n; }, function () { bad++; return null; });
  })).then(function (arr) {
    notes = arr.filter(Boolean); notes.forEach(function (n) { lastSer[n.id] = ser(n); });
    var sp = vault.settings ? decJSON(vkey, vault.settings, 'settings').then(function (x) { return (x && x.tagColors) || {}; }, function () { return {}; }) : Promise.resolve(prefs.tagColors || {});
    return sp.then(function (tc) {
      prefs.tagColors = tc; lastSet = vault.settings ? JSON.stringify(tc) : '';
      if (bad) setTimeout(function () { showToast(bad + (bad === 1 ? ' note' : ' notes') + ' could not be decrypted.'); }, 600);
    });
  });
}
function joinFromCloud(meta) {
  return getCloud().then(function (c) {
    if (!c) throw new Error('offline');
    return c.db.collection('data/users/' + c.uid).get().then(function (snap) {
      vault = { v: 1, salt: meta.salt, iter: meta.iter, check: meta.check, notes: {}, settings: null };
      snap.docs.forEach(function (d) {
        var x = d.data(); if (!x || d.id === 'meta') return;
        var e = x.del ? { u: +x.u || 0, del: 1 } : { u: +x.u || 0, iv: x.iv, ct: x.ct };
        if (d.id === 'settings') { if (!x.del) vault.settings = e; } else if (d.id.indexOf('n_') === 0) vault.notes[d.id] = e;
      });
      return loadLocal().then(writeVault);
    });
  });
}

// ---------- lock screen with ice ----------
function lm(t, bad) { lmsg.textContent = t || ''; lmsg.className = 'lm' + (bad ? ' bad' : ''); }
function cfgLock(m) {
  mode = m; var create = m === 'create', dead = m === 'checking' || m === 'fatal';
  $('lt').textContent = { create: 'Create your vault', join: 'Unlock your synced vault', checking: 'Checking for a synced vault', fatal: 'Cannot encrypt here', unlock: 'Notes locked' }[m];
  $('ls').textContent = { create: 'Your notes are encrypted with this passphrase before they are saved. There is no recovery: if you forget it, they cannot be opened.' + (legacyNotes.length ? ' Notes already on this device will be encrypted too.' : ''),
    join: 'Enter the passphrase you chose on your other device.', checking: 'One moment...', fatal: '', unlock: 'Enter your passphrase to melt the ice.' }[m];
  pw.autocomplete = create ? 'new-password' : 'current-password';
  pw2.hidden = !create; $('meter').hidden = !create; ub.textContent = create ? 'Create vault' : 'Unlock';
  ub.disabled = dead; pw.disabled = dead; pw2.disabled = dead;
  rb.hidden = !(m === 'unlock' || m === 'join');
  rb.textContent = m === 'join' ? 'Forgot passphrase? Delete the cloud copy and start fresh' : 'Forgot passphrase? Erase notes on this device';
}
Ice.init(lockEl);
function setInert(on) { ['app', 'pool', 'tog', 'poolb', 'lockb'].forEach(function (id) { var el = id === 'app' ? app : $(id); if (el) el.inert = on; }); }
function showLock(m, animate) {
  cfgLock(m); pw.value = ''; pw2.value = ''; lm(''); setInert(true);
  lockEl.hidden = false; lockEl.classList.remove('freezing', 'melting');
  if (animate) { void lockEl.offsetWidth; lockEl.classList.add('freezing'); }
  clearTimeout(frzTm); frzTm = setTimeout(function () { if (!unlocked) Water.frozen = true; }, animate ? 1200 : 1500);
  setTimeout(function () { try { if (!pw.disabled) pw.focus(); } catch (e) {} }, animate ? 800 : 80);
}
function hideLock() { Water.frozen = false; clearTimeout(frzTm); setInert(false); Ice.shatter(lockEl); }
function wipeUI() {
  notes = []; now = null; trash = null; preview = false; folderF = ''; tagF = ''; qs = ''; lastSer = {}; lastSet = ''; prefs.tagColors = {};
  $('q').value = ''; body.hidden = false; pv.hidden = true; prevB.textContent = 'Preview'; toast.hidden = true; impBox.hidden = true; imp.value = ''; closeSettings();
  ['chcur', 'chnew', 'chnew2'].forEach(function (id) { $(id).value = ''; }); $('chpanel').hidden = true; chMsg('');
  setFocus(false); fill(); renderList(); renderTags();
  Object.keys(cardEls).forEach(function (id) { cardEls[id].remove(); delete cardEls[id]; }); phys = {};
}
function lockNow() {
  if (!unlocked || changing) return Promise.resolve();
  unlocked = false; clearTimeout(pt);
  return flush().catch(function () {}).then(function () { stopCloud(); vkey = null; wipeUI(); vault = readVault(); showLock(vault ? 'unlock' : 'create', true); });
}

// ---------- creating and unlocking ----------
function wrong() {
  fails++; var wait = fails >= 3 ? Math.min(30000, Math.pow(2, fails - 3) * 1000) : 0; blockedUntil = Date.now() + wait;
  lm('Wrong passphrase.' + (wait ? ' Wait ' + Math.ceil(wait / 1000) + ' s before trying again.' : ''), true); pw.value = '';
  setBusy(false); pw.focus();
}
function setBusy(on, label) { ub.disabled = on; pw.disabled = on; pw2.disabled = on; if (label) lm(label); }
function finishUnlock(created) {
  unlocked = true; fails = 0; pw.value = ''; pw2.value = ''; lastAct = Date.now();
  var have = {}; notes.forEach(function (n) { have[n.id] = 1; });
  legacyNotes.forEach(function (n) { if (!have[n.id]) notes.push(n); });
  if (created && !notes.length) notes.push(welcomeNote());
  now = visible()[0] || notes[0] || null;
  applyPrefs(); fill(); renderList(); renderTags(); hideLock();
  var hadLegacy = legacyNotes.length > 0; legacyNotes = [];
  flush().then(function () { if (hadLegacy || created) { try { localStorage.removeItem(LEGACY); } catch (e) {} } });
  savePrefs(); startCloud();
}
function submit() {
  if (mode === 'checking' || mode === 'fatal') return;
  var left = blockedUntil - Date.now(); if (left > 0) { lm('Too many tries. Wait ' + Math.ceil(left / 1000) + ' s.', true); return; }
  var p = pw.value;
  if (mode === 'create') {
    if (p.length < 8) { lm('Use at least 8 characters.', true); return; }
    if (p !== pw2.value) { lm('The two passphrases do not match.', true); return; }
    setBusy(true, 'Freezing your vault...');
    var salt = crypto.getRandomValues(new Uint8Array(16));
    deriveKey(p, salt, ITER).then(function (k) {
      return encJSON(k, { ok: 'water' }, 'check').then(function (chk) {
        vkey = k; vault = { v: 1, salt: b64(salt), iter: ITER, check: chk, notes: {}, settings: null }; notes = [];
        finishUnlock(true);
      });
    }).catch(function () { setBusy(false, 'Could not create the vault.'); });
    return;
  }
  if (!p) return;
  setBusy(true, 'Melting the ice...');
  var meta = mode === 'join' ? remoteMeta : vault;
  deriveKey(p, unb64(meta.salt), meta.iter).then(function (k) {
    return decJSON(k, meta.check, 'check').then(function () {
      vkey = k;
      return (mode === 'join' ? joinFromCloud(meta) : loadLocal()).then(function () { finishUnlock(false); });
    }, function () { wrong(); });
  }).catch(function () { vkey = null; setBusy(false, 'Could not open the vault.'); });
}
ub.onclick = submit;
pw.onkeydown = pw2.onkeydown = function (e) { if (e.key === 'Enter') submit(); };
pw.oninput = function () {
  if (mode !== 'create') return;
  var n = pw.value.length, f = $('meterfill'); f.style.width = Math.min(100, n / 16 * 100) + '%';
  f.style.background = n < 8 ? '#e5484d' : n < 12 ? '#f5a524' : n < 16 ? '#9acd32' : '#2fb344';
};
rb.onclick = function () {
  if (!resetTm) { rb.textContent = 'Click again to confirm. This cannot be undone.'; resetTm = setTimeout(function () { resetTm = 0; cfgLock(mode); }, 5000); return; }
  clearTimeout(resetTm); resetTm = 0; rb.disabled = true;
  var joinMode = mode === 'join';
  try { localStorage.removeItem(VKEY); localStorage.removeItem(LEGACY); } catch (e) {}
  (joinMode ? wipeCloud() : Promise.resolve()).then(function () { rb.disabled = false; vault = null; bootVault(); });
};
function bootVault() {
  if (!(window.crypto && window.crypto.subtle)) { showLock('fatal'); lm('This browser cannot encrypt notes here. Open the page in a current browser over https.', true); return; }
  vault = readVault();
  if (vault) { showLock('unlock'); return; }
  legacyNotes = readLegacy(); showLock('checking');
  var done = false;
  function go(meta) { if (done) return; done = true; remoteMeta = meta; showLock(meta ? 'join' : 'create'); }
  getCloud().then(function (c) {
    if (!c) return go(null);
    return c.db.collection('data/users/' + c.uid).doc('meta').get().then(function (m) { go(m.exists ? m.data() : null); }, function () { go(null); });
  }, function () { go(null); });
}

// ---------- auto-lock ----------
function bump() { lastAct = Date.now(); }
['pointerdown', 'keydown', 'input', 'wheel', 'touchstart'].forEach(function (ev) { window.addEventListener(ev, bump, { passive: true }); });
window.addEventListener('pointermove', function () { var t = Date.now(); if (t - lastAct > 1000) lastAct = t; }, { passive: true });
function checkIdle() { if (unlocked && Date.now() - lastAct > (prefs.autolock || 5) * 60000) lockNow(); }
setInterval(checkIdle, 5000);
document.addEventListener('visibilitychange', function () { if (!document.hidden) checkIdle(); });
$('lockb').onclick = lockNow;
$('autolock').onchange = function () { prefs.autolock = +this.value; savePrefs(); };

// ---------- sync: only ciphertext ever leaves the browser ----------
function setSync(t) { $('syncst').textContent = t; }
function syncOrigin(value) {
  var s = (value || '').trim().replace(/\/+$/, '');
  if (s.slice(-4) === '/api') s = s.slice(0, -4);
  return s || window.location.origin;
}
function syncInput(prefix) {
  return { email: $(prefix + 'Email').value.trim(), password: $(prefix + 'Password').value, server: $(prefix + 'Server').value.trim() };
}
function syncMessage(prefix, text, bad) {
  var el = $(prefix === 'sync' ? 'syncAuthMsg' : 'lockSyncMsg'); if (!el) return;
  el.textContent = text || ''; el.className = prefix === 'sync' ? 'syncmsg' + (bad ? ' bad' : '') : 'lock-sync-msg' + (bad ? ' bad' : '');
}
function renderSyncAuth() {
  var a = syncAuth || {}, ids = ['syncEmail', 'lockSyncEmail'], pids = ['syncServer', 'lockSyncServer'];
  ids.forEach(function (id) { if ($(id) && a.email && !$(id).value) $(id).value = a.email; });
  pids.forEach(function (id) { if ($(id) && a.base && !$(id).value) $(id).value = a.base; });
  if ($('syncAuthMsg') && a.email) $('syncAuthMsg').textContent = 'Connected as ' + a.email;
}
function saveSyncAuth(a) { syncAuth = a; try { localStorage.setItem(SYNC_KEY, JSON.stringify(a)); } catch (e) {} renderSyncAuth(); }
function apiUrl(path, server) { return syncOrigin(server || (syncAuth && syncAuth.base)) + '/api' + path; }
function apiRequest(path, opts, server, noAuth) {
  opts = opts || {}; var headers = opts.headers || {};
  headers['Content-Type'] = 'application/json';
  if (!noAuth && syncAuth && syncAuth.token) headers.Authorization = 'Bearer ' + syncAuth.token;
  opts.headers = headers;
  return fetch(apiUrl(path, server), opts).then(function (r) { return r.text().then(function (text) { var data = {}; try { data = text ? JSON.parse(text) : {}; } catch (e) {} if (!r.ok) { var err = new Error(data.error || 'Request failed'); err.code = data.error || ('HTTP_' + r.status); throw err; } return data; }); });
}
function syncAuthAction(kind, prefix) {
  var x = syncInput(prefix), msg = prefix === 'sync' ? 'syncAuthMsg' : 'lockSyncMsg';
  if (!x.email || x.email.indexOf('@') < 1) return syncMessage(prefix, 'Enter a valid email.', true);
  if (x.password.length < 8) return syncMessage(prefix, 'Use a password with at least 8 characters.', true);
  var b = $(msg); if (b) b.textContent = kind === 'register' ? 'Creating account...' : 'Signing in...';
  apiRequest('/auth/' + kind, { method: 'POST', body: JSON.stringify({ email: x.email, password: x.password }) }, x.server, true).then(function (d) {
    saveSyncAuth({ token: d.token, uid: d.user.id, email: d.user.email, base: syncOrigin(x.server) });
    cloudP = null; stopCloud(); syncMessage(prefix, 'Connected as ' + d.user.email);
    if (unlocked) startCloud(); else if (mode === 'checking' || mode === 'create' || mode === 'join') bootVault();
  }).catch(function (e) { syncMessage(prefix, e.code === 'EMAIL_TAKEN' ? 'That email is already registered.' : e.code === 'INVALID_LOGIN' ? 'Email or password is incorrect.' : 'Could not connect to sync server.', true); });
}
function syncLogout() { stopCloud(); cloudP = null; syncAuth = null; try { localStorage.removeItem(SYNC_KEY); } catch (e) {} renderSyncAuth(); syncMessage('sync', 'Signed out.'); syncMessage('lockSync', 'Signed out.'); if (unlocked) setSync('Sync is off.'); }
function snapshot(docs) { return { docs: docs.map(function (d) { return { id: d.id, data: function () { return d.data; } }; }), size: docs.length, empty: !docs.length }; }
function syncCollection() {
  return {
    doc: function (id) {
      var path = '/sync/docs/' + encodeURIComponent(id);
      return {
        get: function () { return apiRequest(path).then(function (d) { return { exists: !!d.exists, data: function () { return d.data; } }; }); },
        set: function (d) { return apiRequest(path, { method: 'PUT', body: JSON.stringify(d) }); },
        delete: function () { return apiRequest(path, { method: 'DELETE' }); }
      };
    },
    get: function () { return apiRequest('/sync/docs').then(function (d) { return snapshot(d.docs || []); }); },
    onSnapshot: function (next, fail) {
      var stopped = false, last = '';
      function poll() {
        if (stopped) return;
        apiRequest('/sync/docs').then(function (d) {
          if (stopped) return;
          var docs = d.docs || [], sig = JSON.stringify(docs);
          if (sig !== last) { last = sig; next(snapshot(docs)); }
          setTimeout(poll, 2500);
        }).catch(function (e) { if (!stopped && fail) fail(e); if (!stopped) setTimeout(poll, 5000); });
      }
      poll(); return function () { stopped = true; };
    }
  };
}
function getCloud() {
  if (cloudP) return cloudP;
  if (!syncAuth || !syncAuth.token) { cloudP = Promise.resolve(null); return cloudP; }
  cloudP = Promise.resolve({ db: { collection: function () { return syncCollection(); } }, uid: syncAuth.uid });
  return cloudP;
}
function stopCloud() { if (cloud.unsub) { try { cloud.unsub(); } catch (e) {} } cloud.unsub = null; cloud.col = null; cloud.q = Promise.resolve(); cloud.applyQ = Promise.resolve(); cloud.paused = false; cloud.warned = false; }
function pushDoc(d) {
  if (!cloud.col || cloud.paused) return;
  var col = cloud.col;
  cloud.q = cloud.q.then(function () {
    if (!vault || cloud.col !== col || cloud.paused) return;
    var e = d === 'settings' ? vault.settings : vault.notes[d]; if (!e) return;
    return col.doc(d).set(e.del ? { u: e.u, del: true } : { u: e.u, iv: e.iv, ct: e.ct });
  }).catch(function (err) { setSync('Sync problem: ' + ((err && err.code) || 'unknown') + '. Notes stay safe on this device.'); });
}
function startCloud() {
  stopCloud();
  if (prefs.sync === false) { setSync('Sync is off.'); return; }
  setSync('Looking for sync...');
  getCloud().then(function (c) {
    if (!c) { setSync('Sync is not available in this environment.'); return; }
    var col = c.db.collection('data/users/' + c.uid);
    return col.doc('meta').get().then(function (m) {
      if (!unlocked) return;
      if (m.exists) {
        var d = m.data();
        if (d.salt !== vault.salt || d.iter !== vault.iter) { cloud.col = col; cloud.paused = true; pauseForChange(d); cloud.unsub = col.onSnapshot(onCloud, function (e) { setSync('Sync stopped: ' + (e && e.code)); }); return; }
      } else { col.doc('meta').set({ v: 1, salt: vault.salt, iter: vault.iter, check: vault.check }); }
      cloud.col = col; if (!prefs.cloudUsed) { prefs.cloudUsed = true; savePrefs(); }
      cloud.unsub = col.onSnapshot(onCloud, function (e) { setSync('Sync stopped: ' + (e && e.code)); });
    });
  }).catch(function () { setSync('Sync could not start.'); });
}
function onCloud(snap) {
  var col = cloud.col;
  cloud.applyQ = cloud.applyQ.then(function () {
    if (changing || !unlocked || !vkey || !vault || cloud.col !== col) return;
    var md = null; snap.docs.forEach(function (d) { if (d.id === 'meta') md = d.data(); });
    if (md && (md.salt !== vault.salt || md.iter !== vault.iter)) { cloud.paused = true; return pauseForChange(md); }
    cloud.paused = false; cloud.warned = false;
    var remote = {}, work = [];
    snap.docs.forEach(function (d) { if (d.id !== 'meta') remote[d.id] = d.data() || {}; });
    Object.keys(remote).forEach(function (id) {
      if (id !== 'settings' && id.indexOf('n_') !== 0) return;
      var loc = id === 'settings' ? vault.settings : vault.notes[id];
      if (!loc || (+remote[id].u || 0) > loc.u) work.push(applyRemote(id, remote[id]));
    });
    var ids = Object.keys(vault.notes); if (vault.settings) ids.push('settings');
    ids.forEach(function (id) { var loc = id === 'settings' ? vault.settings : vault.notes[id]; if (!remote[id] || loc.u > (+remote[id].u || 0)) pushDoc(id); });
    return Promise.all(work).then(function (res) {
      if (res.some(Boolean)) {
        writeVault(); if (!now || !byId(now.id)) now = visible()[0] || null;
        renderList(); renderTags();
        var ae = document.activeElement; if (ae !== body && ae !== tagsIn && ae !== $('folder') && ae !== $('goal') && ae !== $('due')) fill();
      }
      setSync('Synced at ' + new Date().toLocaleTimeString());
    });
  }).catch(function () { setSync('Sync problem. Notes stay safe on this device.'); });
}
function applyRemote(id, r) {
  var u = +r.u || 0;
  if (id === 'settings') {
    if (r.del) return Promise.resolve(false);
    return decJSON(vkey, r, 'settings').then(function (x) { prefs.tagColors = (x && x.tagColors) || {}; lastSet = JSON.stringify(prefs.tagColors); vault.settings = { u: u, iv: r.iv, ct: r.ct }; return true; }, function () { return false; });
  }
  var nid = id.slice(2);
  if (r.del) {
    for (var i = 0; i < notes.length; i++) if (notes[i].id === nid) { notes.splice(i, 1); break; }
    vault.notes[id] = { u: u, del: 1 }; delete lastSer[nid]; return Promise.resolve(true);
  }
  return decJSON(vkey, r, id).then(function (n) {
    if (!n || did(n.id) !== id) return false;
    norm(n); n.rev = u;
    var ex = byId(n.id);
    if (ex && ex === now && document.activeElement === body && ex.body !== n.body) return false;
    if (ex) { Object.keys(ex).forEach(function (k) { delete ex[k]; }); Object.keys(n).forEach(function (k) { ex[k] = n[k]; }); } else notes.push(n);
    vault.notes[id] = { u: u, iv: r.iv, ct: r.ct }; lastSer[n.id] = ser(n); return true;
  }, function () { return false; });
}
function wipeCloud() {
  stopCloud();
  return getCloud().then(function (c) {
    if (!c) return 0;
    var col = c.db.collection('data/users/' + c.uid);
    return col.get().then(function (snap) { var p = Promise.resolve(); snap.docs.forEach(function (d) { p = p.then(function () { return col.doc(d.id).delete(); }); }); return p.then(function () { return snap.size; }); });
  }).catch(function () { return 0; });
}
$('syncon').onchange = function () { prefs.sync = this.checked; savePrefs(); if (this.checked) startCloud(); else { stopCloud(); setSync('Sync is off.'); } };
$('syncLogin').onclick = function () { syncAuthAction('login', 'sync'); };
$('syncRegister').onclick = function () { syncAuthAction('register', 'sync'); };
$('syncLogout').onclick = syncLogout;
$('lockSyncLogin').onclick = function () { syncAuthAction('login', 'lockSync'); };
$('lockSyncRegister').onclick = function () { syncAuthAction('register', 'lockSync'); };
$('delcloud').onclick = function () {
  var b = this;
  if (!delTm) { b.textContent = 'Click again to delete'; delTm = setTimeout(function () { b.textContent = 'Delete cloud copy'; delTm = 0; }, 4000); return; }
  clearTimeout(delTm); delTm = 0; b.textContent = 'Delete cloud copy';
  prefs.sync = false; $('syncon').checked = false; savePrefs();
  wipeCloud().then(function (n) { setSync('Cloud copy deleted (' + n + ' items). Sync is off.'); });
};
$('due').onchange = function () { if (!now) return; now.due = this.value || ''; dirty(); renderPool(); };

// ---------- change passphrase ----------
function chMsg(t, bad) { var el = $('chm'); if (!el) return; el.textContent = t || ''; el.className = 'chm' + (bad ? ' bad' : ''); }
function pauseForChange(md) {
  setSync('Paused: the passphrase was changed on another device.');
  if (cloud.warned) return; cloud.warned = true;
  if (md && md.prev === vault.salt) showToast('Your passphrase was changed on another device.', function () { rejoin(md); }, 'Use new passphrase', true);
  else showToast('Sync paused: your cloud copy uses a different passphrase.');
}
function rejoin(md) {
  unlocked = false; clearTimeout(pt); stopCloud();
  flush().catch(function () {}).then(function () {
    vkey = null; wipeUI(); remoteMeta = md; vault = null; try { localStorage.removeItem(VKEY); } catch (e) {}
    showLock('join', true);
  });
}
function cloudReady() {
  var col = cloud.col;
  return cloud.q.then(function () { return col.doc('meta').get(); }).then(function (m) {
    var d = m.exists ? m.data() : null;
    if (!d || d.salt !== vault.salt || d.iter !== vault.iter) throw { soft: 'The cloud copy does not match this device. Sync has to be working first.' };
    return col.get();
  }).then(function (snap) {
    var behind = 0;
    snap.docs.forEach(function (d) {
      if (d.id !== 'settings' && d.id.indexOf('n_') !== 0) return;
      var x = d.data() || {}, loc = d.id === 'settings' ? vault.settings : vault.notes[d.id];
      if (!x.del && (!loc || (+x.u || 0) > loc.u)) behind++;
    });
    if (behind) throw { soft: 'This device is not fully synced yet (' + behind + ' item' + (behind === 1 ? '' : 's') + ' waiting). Wait a few seconds and try again.' };
  });
}
function reencrypt(nk) {
  var nv = { v: 1, salt: b64(nk.salt), iter: ITER, check: nk.check, notes: {}, settings: null }, t = Date.now(), jobs = [];
  Object.keys(vault.notes).forEach(function (d) { if (vault.notes[d].del) nv.notes[d] = vault.notes[d]; });
  notes.forEach(function (n) {
    if (isBlank(n)) return; var d = did(n.id); n.rev = t;
    jobs.push(encJSON(nk.key, n, d).then(function (r) { nv.notes[d] = { u: t, iv: r.iv, ct: r.ct }; }));
  });
  jobs.push(encJSON(nk.key, { tagColors: prefs.tagColors || {} }, 'settings').then(function (r) { nv.settings = { u: t, iv: r.iv, ct: r.ct }; }));
  return Promise.all(jobs).then(function () { return { vault: nv, key: nk.key }; });
}
function retry(fn) { var n = 0; function go() { return fn().catch(function (e) { if (++n >= 3) throw e; return new Promise(function (r) { setTimeout(r, 400); }).then(go); }); } return go(); }
function pushNewVault(nv, ov) {
  var col = cloud.col, written = [];
  var newMeta = { v: 1, salt: nv.salt, iter: nv.iter, check: nv.check, prev: ov.salt, chg: Date.now() };
  var oldMeta = { v: 1, salt: ov.salt, iter: ov.iter, check: ov.check };
  var p = col.doc('meta').set(newMeta);
  Object.keys(nv.notes).filter(function (d) { return !nv.notes[d].del; }).concat(['settings']).forEach(function (d) {
    p = p.then(function () { var e = d === 'settings' ? nv.settings : nv.notes[d]; written.push(d); return col.doc(d).set({ u: e.u, iv: e.iv, ct: e.ct }); });
  });
  return p.catch(function () {
    var q = Promise.resolve();
    written.forEach(function (d) {
      var e = d === 'settings' ? ov.settings : ov.notes[d];
      q = q.then(function () { return retry(function () { return e && !e.del ? col.doc(d).set({ u: e.u, iv: e.iv, ct: e.ct }) : col.doc(d).delete(); }); });
    });
    q = q.then(function () { return retry(function () { return col.doc('meta').set(oldMeta); }); });
    return q.then(function () { throw { soft: 'The cloud update failed, so nothing was changed.' }; },
      function () { throw { soft: 'The cloud update failed and could not be undone. Your notes are safe on this device. Use "Delete cloud copy", then turn sync on again.' }; });
  });
}
function changePass() {
  if (!unlocked || chBusy) return;
  var cur = $('chcur').value, nw = $('chnew').value, nw2 = $('chnew2').value, left = blockedUntil - Date.now();
  if (left > 0) return chMsg('Too many tries. Wait ' + Math.ceil(left / 1000) + ' s.', true);
  if (!cur) return chMsg('Enter your current passphrase.', true);
  if (nw.length < 8) return chMsg('The new passphrase needs at least 8 characters.', true);
  if (nw === cur) return chMsg('The new passphrase must be different from the current one.', true);
  if (nw !== nw2) return chMsg('The two new passphrases do not match.', true);
  var syncOn = prefs.sync !== false && !!prefs.cloudUsed;
  if (syncOn && (!cloud.col || cloud.paused)) return chMsg(cloud.paused ? 'Sync is paused. Resolve that first.' : 'Sync is on but not connected. Connect first, or turn sync off.', true);
  chBusy = true; changing = true; $('chgo').disabled = true; chMsg('Checking your current passphrase...');
  var oldVault = vault;
  deriveKey(cur, unb64(vault.salt), vault.iter).then(function (k) {
    return decJSON(k, vault.check, 'check').then(function () { return true; }, function () { return false; });
  }).then(function (ok) {
    if (!ok) { fails++; blockedUntil = Date.now() + (fails >= 3 ? Math.min(30000, Math.pow(2, fails - 3) * 1000) : 0); throw { soft: 'The current passphrase is wrong.' }; }
    fails = 0; chMsg(syncOn ? 'Checking that everything is synced...' : 'Creating the new key...');
    return syncOn ? cloudReady() : null;
  }).then(function () {
    chMsg('Creating the new key...');
    var salt = crypto.getRandomValues(new Uint8Array(16));
    return deriveKey(nw, salt, ITER).then(function (k2) { return encJSON(k2, { ok: 'water' }, 'check').then(function (chk) { return { salt: salt, key: k2, check: chk }; }); });
  }).then(function (nk) {
    chMsg('Re-encrypting your notes...');
    return flush().then(function () { return reencrypt(nk); });
  }).then(function (nv) {
    if (!syncOn) return nv;
    chMsg('Updating the cloud copy...');
    return pushNewVault(nv.vault, oldVault).then(function () { return nv; });
  }).then(function (nv) {
    vault = nv.vault; vkey = nv.key; writeVault();
    ['chcur', 'chnew', 'chnew2'].forEach(function (id) { $(id).value = ''; }); $('chpanel').hidden = true; chMsg('');
    changing = false; chBusy = false; $('chgo').disabled = false; persist();
    if (syncOn) setSync('Synced at ' + new Date().toLocaleTimeString());
    showToast(syncOn ? 'Passphrase changed. Your other devices will ask for the new one.' : 'Passphrase changed on this device.' + (prefs.cloudUsed && prefs.sync === false ? ' An older cloud copy still uses the old passphrase.' : ''));
  }).catch(function (e) {
    changing = false; chBusy = false; $('chgo').disabled = false; persist();
    chMsg(e && e.soft ? e.soft : 'Could not change the passphrase. Nothing was changed.', true);
  });
}
$('chtog').onclick = function () { var h = $('chpanel').hidden; $('chpanel').hidden = !h; if (h) { $('chcur').focus(); } chMsg(''); };
$('chcancel').onclick = function () { if (chBusy) return; ['chcur', 'chnew', 'chnew2'].forEach(function (id) { $(id).value = ''; }); $('chpanel').hidden = true; chMsg(''); };
$('chgo').onclick = changePass;
['chcur', 'chnew', 'chnew2'].forEach(function (id) { $(id).onkeydown = function (e) { if (e.key === 'Enter') changePass(); }; });
$('chnew').oninput = function () { var n = this.value.length, f = $('chmeter'); f.style.width = Math.min(100, n / 16 * 100) + '%'; f.style.background = n < 8 ? '#e5484d' : n < 12 ? '#f5a524' : n < 16 ? '#9acd32' : '#2fb344'; };

document.getElementById('tog').onclick = function () {
  var off = document.querySelector('.app').classList.toggle('off');
  this.textContent = off ? 'Show notes' : 'Hide notes';
};

bootVault();
})(); } catch (err) { var se = document.getElementById('st'); if (se) se.textContent = 'Error: ' + err.message; }