/**
 * KolayXport — overlay timing marks (debug only).
 *
 * Off unless the page's localStorage has `kx_debug` set (any value except '0' / 'false'):
 *   localStorage.kx_debug = '1'   // in the etsy.com / ebay.com / amazon.* console, then reload
 *
 * Each overlay calls mark(surface, label) at its milestones (start, first_paint, core, full, ...).
 * A mark logs `[KX perf] <surface> <label> +<ms since the surface's start> (@<performance.now()>)`,
 * records a User Timing mark `kx:<surface>:<label>` (visible in the DevTools Performance panel) and
 * is kept in window.__KX_PERF.log for copy-paste. Never throws, never touches the network.
 */
(function (root) {
  'use strict';

  var starts = {};
  var log = [];

  function now() {
    try { return root.performance && root.performance.now ? root.performance.now() : Date.now(); } catch (_) { return Date.now(); }
  }

  function enabled() {
    try {
      var v = root.localStorage && root.localStorage.getItem('kx_debug');
      return !!v && v !== '0' && v !== 'false';
    } catch (_) {
      return false;
    }
  }

  /** Restart a surface's clock (a new page view / SPA navigation). */
  function start(surface) {
    starts[surface] = now();
    mark(surface, 'start');
  }

  function mark(surface, label, extra) {
    if (!enabled()) return;
    var t = now();
    if (starts[surface] === undefined) starts[surface] = t;
    var since = Math.round(t - starts[surface]);
    var entry = { surface: surface, label: label, sinceStartMs: since, at: Math.round(t) };
    if (extra !== undefined) entry.extra = extra;
    log.push(entry);
    if (log.length > 500) log.shift();
    try { if (root.performance && root.performance.mark) root.performance.mark('kx:' + surface + ':' + label); } catch (_) { /* old browsers */ }
    try { console.log('[KX perf] ' + surface + ' ' + label + ' +' + since + 'ms (@' + Math.round(t) + 'ms)', extra !== undefined ? extra : ''); } catch (_) { /* no console */ }
  }

  root.__KX_PERF = { enabled: enabled, start: start, mark: mark, log: log };
})(typeof window !== 'undefined' ? window : this);
