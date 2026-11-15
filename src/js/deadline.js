/* Deadline: due-date labels and how wet a floating note's paper is. Pure functions. */
(function () {
  window.WN = window.WN || {};

  function dueDate(n) { var p = (n.due || '').split('-'); return p.length === 3 ? new Date(+p[0], +p[1] - 1, +p[2]) : null; }
  function dueLabel(n) {
    var d = dueDate(n); if (!d) return '';
    var t0 = new Date(); t0.setHours(0, 0, 0, 0); var dd = Math.round((d - t0) / 864e5);
    return dd < 0 ? 'Overdue ' + (-dd) + ' d' : dd === 0 ? 'Due today' : dd === 1 ? 'Due tomorrow' : 'Due in ' + dd + ' d';
  }
  function depthOf(n) {
    var d = dueDate(n);
    if (d) { var left = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59) - Date.now(); return left <= 0 ? 1 : Math.max(0, Math.min(1, 1 - left / (7 * 864e5))); }
    if (n.pinned) return 0;
    var days = (Date.now() - Math.max(n.updated || 0, n.seen || 0)) / 864e5;
    return Math.min(0.35, days / 30 * 0.35);
  }

  WN.deadline = { dueDate: dueDate, dueLabel: dueLabel, depthOf: depthOf };
})();
