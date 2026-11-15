import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
const { deadline } = load('deadline.js');
const iso = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

test('labels', () => {
  assert.equal(deadline.dueLabel({ due: iso(0) }), 'Due today');
  assert.equal(deadline.dueLabel({ due: iso(1) }), 'Due tomorrow');
  assert.equal(deadline.dueLabel({ due: iso(5) }), 'Due in 5 d');
  assert.equal(deadline.dueLabel({ due: iso(-2) }), 'Overdue 2 d');
  assert.equal(deadline.dueLabel({}), '');
});
test('paper gets wetter as the deadline gets closer', () => {
  const far = deadline.depthOf({ due: iso(30) }), mid = deadline.depthOf({ due: iso(4) }), near = deadline.depthOf({ due: iso(1) });
  assert.equal(far, 0); assert.ok(mid > 0.2 && mid < 0.7); assert.ok(near > mid && near < 1);
});
test('overdue notes are fully soaked, even when pinned', () => {
  assert.equal(deadline.depthOf({ due: iso(-1) }), 1);
  assert.equal(deadline.depthOf({ due: iso(-1), pinned: true }), 1);
});
test('notes without a deadline only get slightly damp, and pinned ones stay dry', () => {
  const old = Date.now() - 400 * 864e5;
  assert.ok(deadline.depthOf({ updated: old }) <= 0.35);
  assert.equal(deadline.depthOf({ updated: old, pinned: true }), 0);
});
