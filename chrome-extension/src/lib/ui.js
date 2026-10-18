/**
 * KolayXport — shared research UI ("Blade" brand) for the Etsy, eBay and Amazon overlays
 * and the popup. One look everywhere: an ink top bar with metric chips, a light strip under
 * each listing card, white side panels, status pills, an "estimate" tag, skeleton shimmer
 * and an "i" button that explains every derived number ("Nasıl hesaplandı?").
 *
 * - Styles: `ensureStyles(root)` puts the CSS into a shadow root (top bars) or, once, into
 *   the page <head> (card strips, panels). Every rule is scoped under `.kx-ui`, so host pages
 *   are not touched; no `!important` outside shadow roots.
 * - Fonts: Plus Jakarta Sans 800 (headings, numbers) and Instrument Sans (text), bundled as
 *   woff2 subsets and registered through the FontFace API (an ArrayBuffer, so no page CSP
 *   applies). Until they load, and if they never do: system-ui. Never a serif.
 * - Everything is DOM-built; data only ever goes into textContent / attributes.
 * - "i" explanations: one delegated listener per window shows a single tooltip (its own
 *   shadow host) on hover, keyboard focus and click; Escape or a click elsewhere closes it.
 * - Expanded/collapsed state of the top bar's "More" row and of the side panels persists in
 *   chrome.storage.local (`kx_ui_more`, `kx_ui_panel_collapsed`).
 */
(function () {
  'use strict';

  if (typeof window !== 'undefined' && window.__KX_UI) return;

  // ---------------------------------------------------------------------------
  // Language (lib/lang.js) and copy
  // ---------------------------------------------------------------------------
  function lang() {
    try {
      var L = window.__KX_LANG;
      return (L && L.get()) || 'tr';
    } catch (_) {
      return 'tr';
    }
  }

  var COPY = {
    tr: {
      more: 'Daha fazla',
      less: 'Daha az',
      fullAnalysis: 'Tam analiz',
      howTitle: 'Nasıl hesaplandı?',
      infoLabel: 'Nasıl hesaplandı: {label}',
      formula: 'Hesap',
      source: 'Kaynak',
      confidence: 'Güven',
      conf_high: 'yüksek',
      conf_medium: 'orta',
      conf_low: 'düşük',
      conf_exact: 'kesin (olduğu gibi okunur)',
      confTag_high: 'yüksek güven',
      confTag_medium: 'orta güven',
      confTag_low: 'düşük güven',
      kind_estimated: 'tahmini',
      kind_measured: 'ölçüldü',
      kind_insufficient: 'yetersiz veri',
      est: 'tahmini',
      collapse: 'Paneli daralt',
      expand: 'Paneli genişlet',
      src_etsyApi: 'Etsy API',
      src_etsyPage: 'bu Etsy sayfası',
      src_ebayApi: 'eBay API',
      src_ebayPage: 'bu eBay sayfası',
      src_amazonFigure: "Amazon'un kendi rakamı",
      src_amazonApi: 'resmi Amazon API (SP-API)',
      src_amazonPage: 'bu Amazon sayfası',
      src_model: 'KolayXport tahmin modeli',
      src_kx: 'KolayXport sunucusu',
      verdict_high: 'Rekabet yüksek: yeni bir ürün için zorlu bir pazar',
      verdict_medium: 'Rekabet orta: güçlü bir ilanla yer bulunabilir',
      verdict_low: 'Rekabet düşük: girmek için iyi bir fırsat olabilir',
      demand_high: 'ilanların çoğu satış yapıyor',
      demand_low: 'satış yapan ilan az',
      vsCheaper: 'tipik fiyattan %{n} ucuz',
      vsPricier: 'tipik fiyattan %{n} pahalı',
      vsSame: 'tipik fiyatta',
    },
    en: {
      more: 'More',
      less: 'Less',
      fullAnalysis: 'Full analysis',
      howTitle: 'How is this calculated?',
      infoLabel: 'How is this calculated: {label}',
      formula: 'Formula',
      source: 'Source',
      confidence: 'Confidence',
      conf_high: 'high',
      conf_medium: 'medium',
      conf_low: 'low',
      conf_exact: 'exact (read as shown)',
      confTag_high: 'high confidence',
      confTag_medium: 'medium confidence',
      confTag_low: 'low confidence',
      kind_estimated: 'estimate',
      kind_measured: 'measured',
      kind_insufficient: 'not enough data',
      est: 'estimate',
      collapse: 'Collapse panel',
      expand: 'Expand panel',
      src_etsyApi: 'Etsy API',
      src_etsyPage: 'this Etsy page',
      src_ebayApi: 'eBay API',
      src_ebayPage: 'this eBay page',
      src_amazonFigure: "Amazon's own figure",
      src_amazonApi: 'official Amazon API (SP-API)',
      src_amazonPage: 'this Amazon page',
      src_model: 'KolayXport estimate model',
      src_kx: 'KolayXport server',
      verdict_high: 'High competition: a tough market for a new product',
      verdict_medium: 'Medium competition: room for a strong listing',
      verdict_low: 'Low competition: could be a good opening',
      demand_high: 'most listings are selling',
      demand_low: 'few listings are selling',
      vsCheaper: '{n}% below typical price',
      vsPricier: '{n}% above typical price',
      vsSame: 'at the typical price',
    },
  };

  function t(key, vars) {
    var l = lang();
    var s = (COPY[l] && COPY[l][key]) || COPY.en[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(String(vars[k])); });
    return s;
  }

  /**
   * Turkish case suffix for "N'i / N'si / N'ü …" after a number ("17 ilandan 11'i").
   * Picks the vowel from the last spoken word of the number.
   */
  function trOf(n) {
    n = Math.abs(Math.round(Number(n) || 0));
    var units = { 1: "'i", 2: "'si", 3: "'ü", 4: "'ü", 5: "'i", 6: "'sı", 7: "'si", 8: "'i", 9: "'u" };
    var tens = { 1: "'u", 2: "'si", 3: "'u", 4: "'ı", 5: "'si", 6: "'ı", 7: "'i", 8: "'i", 9: "'ı" };
    if (n === 0) return "'ı";
    if (n % 10) return units[n % 10];
    if (n % 100) return tens[(n % 100) / 10];
    if (n % 1000) return "'ü"; // yüz
    if (n % 1000000) return "'i"; // bin
    return "'u"; // milyon
  }

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------
  var FONT_BODY = "'KX Instrument', 'Instrument Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  var FONT_DISPLAY = "'KX Jakarta', 'Plus Jakarta Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

  var CSS = [
    '.kx-ui, .kx-tip {',
    '  --kx-ink: #0B1220; --kx-ink-2: #111A2E; --kx-ink-soft: #3A465A; --kx-muted: #556072;',
    '  --kx-paper: #F7F8FB; --kx-white: #FFFFFF; --kx-line: rgba(11,18,32,.12);',
    '  --kx-blue: #2F5BFF; --kx-blue-hover: #2449E0; --kx-cyan: #00C6FF; --kx-soft: #8FA8FF;',
    '  --kx-green: #16a34a; --kx-amber: #d97706; --kx-red: #dc2626;',
    '  --kx-green-text: #15803d; --kx-amber-text: #b45309; --kx-red-text: #b91c1c;',
    '  --kx-font: ' + FONT_BODY + ';',
    '  --kx-font-display: ' + FONT_DISPLAY + ';',
    '  font-family: var(--kx-font); font-style: normal; font-weight: 400; letter-spacing: normal;',
    '  text-transform: none; text-align: left; color: var(--kx-ink); box-sizing: border-box;',
    '  -webkit-font-smoothing: antialiased;',
    '}',
    '.kx-ui *, .kx-ui *::before, .kx-ui *::after, .kx-tip * { box-sizing: border-box; font-family: inherit; }',
    '.kx-ui [hidden], .kx-ui[hidden] { display: none; }',
    '.kx-ui .kx-num, .kx-ui .kx-chip-value, .kx-ui .kx-metric-value { font-variant-numeric: tabular-nums; }',
    '.kx-ui .kx-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }',

    /* Mark */
    '.kx-ui .kx-mark { display: inline-flex; flex: 0 0 auto; width: 20px; height: 18px; line-height: 0; }',
    '.kx-ui .kx-mark svg { width: 100%; height: 100%; display: block; }',

    /* Buttons, links, focus */
    '.kx-ui button { font: inherit; color: inherit; margin: 0; text-transform: none; }',
    '.kx-ui a:focus-visible, .kx-ui button:focus-visible { outline: 2px solid var(--kx-blue); outline-offset: 2px; }',
    '.kx-ui.kx-topbar a:focus-visible, .kx-ui.kx-topbar button:focus-visible { outline-color: var(--kx-soft); }',

    /* Top bar */
    '.kx-ui.kx-topbar { display: block; margin: 8px; padding: 0; background: var(--kx-ink); color: #fff;',
    '  border-radius: 12px; box-shadow: 0 10px 28px -14px rgba(11,18,32,.55); font-size: 13px; line-height: 1.3; overflow: hidden; }',
    '.kx-ui.kx-topbar[data-kx-limited] { background: transparent; box-shadow: none; overflow: visible; }',
    '.kx-ui .kx-topbar-main { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 5px 8px 5px 12px; }',
    '.kx-ui .kx-topbar-id { display: flex; align-items: center; gap: 9px; flex: 0 1 auto; min-width: 0; max-width: 36%; }',
    '.kx-ui .kx-topbar-text { display: flex; flex-direction: column; min-width: 0; }',
    '.kx-ui .kx-topbar-title { font-family: var(--kx-font-display); font-weight: 800; font-size: 13px; line-height: 16px;',
    '  letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #fff; }',
    '.kx-ui .kx-verdict { display: flex; align-items: center; gap: 5px; font-size: 11px; line-height: 14px; color: rgba(255,255,255,.8);',
    '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }',
    '.kx-ui .kx-verdict > span:last-child { overflow: hidden; text-overflow: ellipsis; }',
    '.kx-ui .kx-chips { display: flex; align-items: center; flex: 1 1 auto; min-width: 0; overflow-x: auto; scrollbar-width: none; }',
    '.kx-ui .kx-chips::-webkit-scrollbar { display: none; }',
    '.kx-ui .kx-chip { display: flex; flex-direction: column; justify-content: center; flex: 0 0 auto; padding: 0 12px;',
    '  border-left: 1px solid rgba(255,255,255,.12); white-space: nowrap; }',
    '.kx-ui .kx-chips > .kx-chip:first-child { border-left: 0; padding-left: 4px; }',
    '.kx-ui .kx-chip-label { display: flex; align-items: center; gap: 4px; font-size: 10.5px; line-height: 14px; font-weight: 500; color: rgba(255,255,255,.74); }',
    '.kx-ui .kx-chip-value { display: block; min-height: 18px; font-family: var(--kx-font-display); font-weight: 800; font-size: 14px;',
    '  line-height: 18px; letter-spacing: -.01em; color: #fff; }',
    '.kx-ui .kx-chip-value .kx-sub { font-family: var(--kx-font); font-weight: 500; font-size: 11px; color: rgba(255,255,255,.74); letter-spacing: 0; }',
    '.kx-ui .kx-chip-value .kx-pill, .kx-ui .kx-chip-value .kx-conf { vertical-align: 1px; margin-left: 4px; }',
    '.kx-ui .kx-chip-value .kx-pill:first-child { margin-left: 0; }',
    '.kx-ui .kx-topbar-actions { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; margin-left: auto; }',
    '.kx-ui .kx-more-btn { appearance: none; display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 10px; border-radius: 999px;',
    '  border: 1px solid rgba(255,255,255,.22); background: transparent; color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }',
    '.kx-ui .kx-more-btn:hover { background: rgba(255,255,255,.08); }',
    '.kx-ui .kx-caret-ch { display: inline-block; width: 6px; height: 6px; margin: -3px 1px 0 2px; border: solid currentColor;',
    '  border-width: 0 1.6px 1.6px 0; transform: rotate(45deg); transition: transform .15s ease; }',
    '.kx-ui .kx-more-btn[aria-expanded="true"] .kx-caret-ch { transform: rotate(-135deg); margin-top: 3px; }',
    '.kx-ui .kx-cta { display: inline-flex; align-items: center; height: 28px; padding: 0 12px; border-radius: 999px; background: var(--kx-blue);',
    '  color: #fff; font-size: 12px; font-weight: 600; text-decoration: none; white-space: nowrap; cursor: pointer; border: 0; }',
    '.kx-ui .kx-cta:hover { background: var(--kx-blue-hover); color: #fff; text-decoration: none; }',
    '.kx-ui .kx-topbar-more { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 0; padding: 8px 12px 10px;',
    '  border-top: 1px solid rgba(255,255,255,.08); background: var(--kx-ink-2); }',
    '.kx-ui .kx-topbar-more[hidden] { display: none; }',
    '.kx-ui .kx-topbar-more > .kx-chip:first-child { border-left: 0; padding-left: 4px; }',
    '.kx-ui .kx-topbar-more .kx-note { flex: 1 1 100%; padding: 0 4px; font-size: 11.5px; line-height: 1.45; color: rgba(255,255,255,.76); white-space: normal; }',
    '.kx-ui.kx-topbar .kx-err { font-size: 11.5px; color: #fca5a5; }',
    '.kx-ui .kx-msg { padding: 12px 14px; font-size: 12.5px; color: rgba(255,255,255,.82); }',

    /* Pills, dots, tags */
    '.kx-ui .kx-dot { display: inline-block; flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; background: var(--kx-dot, #94a3b8); }',
    '.kx-ui .kx-pill, .kx-ui .kx-conf { display: inline-flex; align-items: center; gap: 5px; padding: 0 8px 0 6px; border-radius: 999px;',
    '  font-family: var(--kx-font); font-size: 11px; font-weight: 600; line-height: 18px; letter-spacing: 0; white-space: nowrap;',
    '  background: var(--kx-pill-bg, rgba(11,18,32,.06)); color: var(--kx-pill-fg, var(--kx-ink-soft)); }',
    '.kx-ui .kx-tone-good { --kx-dot: var(--kx-green); --kx-pill-bg: rgba(22,163,74,.10); --kx-pill-fg: var(--kx-green-text); }',
    '.kx-ui .kx-tone-warn { --kx-dot: var(--kx-amber); --kx-pill-bg: rgba(217,119,6,.10); --kx-pill-fg: var(--kx-amber-text); }',
    '.kx-ui .kx-tone-bad { --kx-dot: var(--kx-red); --kx-pill-bg: rgba(220,38,38,.09); --kx-pill-fg: var(--kx-red-text); }',
    '.kx-ui .kx-tone-neutral { --kx-dot: #94a3b8; --kx-pill-bg: rgba(11,18,32,.06); --kx-pill-fg: var(--kx-ink-soft); }',
    '.kx-ui .kx-conf { background: rgba(11,18,32,.05); color: var(--kx-ink-soft); font-weight: 500; }',
    '.kx-ui.kx-topbar .kx-tone-good { --kx-dot: #4ade80; --kx-pill-bg: rgba(74,222,128,.14); --kx-pill-fg: #86efac; }',
    '.kx-ui.kx-topbar .kx-tone-warn { --kx-dot: #fbbf24; --kx-pill-bg: rgba(251,191,36,.14); --kx-pill-fg: #fcd34d; }',
    '.kx-ui.kx-topbar .kx-tone-bad { --kx-dot: #f87171; --kx-pill-bg: rgba(248,113,113,.15); --kx-pill-fg: #fca5a5; }',
    '.kx-ui.kx-topbar .kx-tone-neutral { --kx-dot: #94a3b8; --kx-pill-bg: rgba(255,255,255,.10); --kx-pill-fg: rgba(255,255,255,.85); }',
    '.kx-ui.kx-topbar .kx-conf { background: rgba(255,255,255,.10); color: rgba(255,255,255,.85); }',
    '.kx-ui .kx-est { display: inline-block; padding: 0 5px; border-radius: 4px; border: 1px solid currentColor; font-family: var(--kx-font);',
    '  font-size: 9.5px; font-weight: 700; line-height: 13px; letter-spacing: .02em; color: var(--kx-amber-text); white-space: nowrap; }',
    '.kx-ui.kx-topbar .kx-est { color: #fcd34d; }',

    /* Status text colours (words always accompany them) */
    '.kx-ui .kx-green { color: var(--kx-green-text); }',
    '.kx-ui .kx-orange { color: var(--kx-amber-text); }',
    '.kx-ui .kx-red { color: var(--kx-red-text); }',
    '.kx-ui .kx-best { color: var(--kx-amber-text); font-weight: 700; }',
    '.kx-ui .kx-muted { color: var(--kx-muted); font-weight: 400; }',
    '.kx-ui.kx-topbar .kx-green { color: #86efac; } .kx-ui.kx-topbar .kx-orange { color: #fcd34d; } .kx-ui.kx-topbar .kx-red { color: #fca5a5; }',

    /* "i" button */
    '.kx-ui .kx-info { appearance: none; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;',
    '  width: 15px; height: 15px; min-width: 15px; padding: 0; margin: 0 0 0 1px; border: 1px solid currentColor; border-radius: 50%;',
    '  background: transparent; color: inherit; opacity: .72; cursor: help; vertical-align: middle; box-shadow: none;',
    '  min-height: 0; max-width: none; text-indent: 0; letter-spacing: 0; text-transform: none; float: none; position: static;',
    '  font-family: var(--kx-font-display); font-size: 9.5px; font-weight: 800; line-height: 1; text-decoration: none; }',
    '.kx-ui .kx-info::before { content: "i"; }',
    '.kx-ui .kx-info:hover, .kx-ui .kx-info:focus-visible, .kx-ui .kx-info[aria-expanded="true"] { opacity: 1; }',

    /* Card strip */
    '.kx-ui.kx-strip { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 6px; min-height: 26px; margin: 4px 0 0; padding: 4px 8px;',
    '  background: var(--kx-paper); border: 1px solid var(--kx-line); border-radius: 8px; color: var(--kx-ink-soft);',
    '  font-size: 11.5px; font-weight: 500; line-height: 1.35; font-variant-numeric: tabular-nums; }',
    '.kx-ui.kx-strip .kx-mark { width: 13px; height: 12px; margin-right: 1px; }',
    '.kx-ui.kx-strip .kx-sep { color: rgba(11,18,32,.3); font-weight: 400; }',
    '.kx-ui.kx-strip .kx-strong { color: var(--kx-ink); font-weight: 700; }',
    '.kx-ui.kx-strip .kx-tag { display: inline-block; padding: 0 5px; border-radius: 4px; background: rgba(11,18,32,.07); color: var(--kx-ink-soft); font-size: 10px; font-weight: 700; line-height: 15px; }',
    '.kx-ui.kx-strip .kx-ai-btn, .kx-ui .kx-ai-btn { appearance: none; display: inline-flex; align-items: center; height: 20px; padding: 0 8px;',
    '  border: 0; border-radius: 999px; background: var(--kx-blue); color: #fff; font-size: 10.5px; font-weight: 700; cursor: pointer; }',
    '.kx-ui.kx-strip .kx-ai-btn { margin-left: auto; }',
    '.kx-ui .kx-ai-btn:hover { background: var(--kx-blue-hover); }',

    /* Side panel */
    '.kx-ui.kx-panel { display: block; margin: 12px 0; padding: 12px 14px 14px; background: var(--kx-white); color: var(--kx-ink);',
    '  border: 1px solid var(--kx-line); border-radius: 16px; box-shadow: 0 1px 2px rgba(11,18,32,.05), 0 14px 30px -18px rgba(11,18,32,.28);',
    '  font-size: 12.5px; line-height: 1.5; }',
    '.kx-ui .kx-panel-head { display: flex; align-items: center; gap: 8px; min-height: 26px; flex-wrap: wrap; }',
    '.kx-ui .kx-panel-title { font-family: var(--kx-font-display); font-weight: 800; font-size: 13.5px; letter-spacing: -.01em; color: var(--kx-ink); }',
    '.kx-ui .kx-panel-head-extra { display: flex; align-items: center; gap: 6px 14px; flex-wrap: wrap; margin-top: 8px; font-size: 12px; color: var(--kx-ink-soft); }',
    '.kx-ui .kx-lines { display: flex; flex-direction: column; gap: 5px; }',
    '.kx-ui .kx-lines > div { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 6px; }',
    '.kx-ui .kx-metrics-grid.kx-wide { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }',
    '.kx-ui .kx-break { flex-basis: 100%; height: 0; }',
    '.kx-ui.kx-strip .kx-conf { font-size: 10.5px; line-height: 16px; padding: 0 7px 0 5px; }',
    '.kx-ui .kx-caret { appearance: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; margin-left: auto;',
    '  padding: 0; border: 1px solid var(--kx-line); border-radius: 8px; background: var(--kx-white); color: var(--kx-ink); cursor: pointer; line-height: 1; }',
    '.kx-ui .kx-caret:hover { background: var(--kx-paper); }',
    '.kx-ui .kx-caret .kx-caret-ch { margin: -3px 0 0; }',
    '.kx-ui .kx-caret[aria-expanded="false"] .kx-caret-ch { transform: rotate(-45deg); margin: 0 2px 0 0; }',
    '.kx-ui .kx-panel-body { margin-top: 10px; display: flex; flex-direction: column; gap: 10px; }',
    '.kx-ui.kx-panel[data-kx-collapsed] .kx-panel-body { display: none; }',
    '.kx-ui.kx-panel[data-kx-limited] { padding: 0; border: 0; box-shadow: none; background: transparent; }',
    '.kx-ui .kx-section-label { font-size: 11px; font-weight: 600; color: var(--kx-muted); margin-bottom: 4px; }',
    '.kx-ui .kx-sales { background: var(--kx-paper); border-radius: 12px; padding: 10px 12px; }',
    '.kx-ui .kx-sales-top { display: flex; align-items: center; gap: 6px 8px; flex-wrap: wrap; }',
    '.kx-ui .kx-sales-value { font-family: var(--kx-font-display); font-weight: 800; font-size: 20px; line-height: 26px; letter-spacing: -.02em; color: var(--kx-ink); font-variant-numeric: tabular-nums; }',
    '.kx-ui .kx-sales-rev { font-size: 12.5px; font-weight: 600; color: var(--kx-ink-soft); margin-top: 2px; }',
    '.kx-ui .kx-sales-how, .kx-ui .kx-sales-plain { font-size: 12px; color: var(--kx-ink-soft); margin-top: 4px; line-height: 1.45; }',
    '.kx-ui .kx-sales-meta { font-size: 11px; color: var(--kx-muted); margin-top: 4px; }',
    '.kx-ui .kx-stats-row { display: flex; align-items: center; gap: 4px 8px; flex-wrap: wrap; }',
    '.kx-ui .kx-stats-row .kx-sep, .kx-ui .kx-panel .kx-sep { color: rgba(11,18,32,.3); }',
    '.kx-ui .kx-signal { color: var(--kx-green-text); font-weight: 600; }',
    '.kx-ui .kx-metrics-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 6px; }',
    '.kx-ui .kx-metric { display: flex; flex-direction: column; gap: 1px; min-width: 0; padding: 7px 9px; background: var(--kx-paper); border-radius: 10px; }',
    '.kx-ui .kx-metric-label { display: flex; align-items: center; gap: 4px; font-size: 10.5px; line-height: 14px; font-weight: 500; color: var(--kx-muted); }',
    '.kx-ui .kx-metric-value { display: block; min-height: 20px; font-family: var(--kx-font-display); font-weight: 800; font-size: 14px; line-height: 20px; color: var(--kx-ink); }',
    '.kx-ui .kx-tags { display: flex; flex-wrap: wrap; gap: 4px; }',
    '.kx-ui .kx-tag-pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; background: var(--kx-paper); border: 1px solid var(--kx-line); color: var(--kx-ink-soft); }',
    '.kx-ui .kx-seo-bar { display: inline-flex; align-items: center; gap: 6px; }',
    '.kx-ui .kx-seo-track { display: inline-block; width: 64px; height: 6px; border-radius: 3px; background: rgba(11,18,32,.1); overflow: hidden; vertical-align: middle; }',
    '.kx-ui .kx-seo-fill { display: block; height: 100%; border-radius: 3px; }',
    '.kx-ui .kx-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }',
    '.kx-ui .kx-list li { margin: 0; padding: 0 0 0 12px; position: relative; color: var(--kx-ink-soft); }',
    '.kx-ui .kx-list li::before { content: ""; position: absolute; left: 2px; top: .62em; width: 4px; height: 4px; border-radius: 50%; background: var(--kx-blue); }',
    '.kx-ui .kx-box { background: var(--kx-paper); border-radius: 12px; padding: 9px 11px; }',
    '.kx-ui .kx-actions { display: flex; gap: 6px; flex-wrap: wrap; }',
    '.kx-ui .kx-btn-ghost { appearance: none; display: inline-flex; align-items: center; height: 30px; padding: 0 12px; border-radius: 999px;',
    '  border: 1px solid var(--kx-line); background: var(--kx-white); color: var(--kx-ink); font-size: 12px; font-weight: 600; cursor: pointer; }',
    '.kx-ui .kx-btn-ghost:hover { background: var(--kx-paper); }',
    '.kx-ui .kx-actions .kx-cta { height: 30px; }',
    '.kx-ui .kx-foot { font-size: 10.5px; color: var(--kx-muted); text-align: center; }',

    /* Skeleton shimmer */
    '@keyframes kx-shimmer { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }',
    '.kx-ui .kx-skel { display: inline-block; vertical-align: middle; height: .95em; min-width: 3.2em; border-radius: 4px;',
    '  background: linear-gradient(90deg, #e6e9f0 25%, #f3f5f9 50%, #e6e9f0 75%); background-size: 200% 100%; animation: kx-shimmer 1.2s ease-in-out infinite; }',
    '.kx-ui.kx-topbar .kx-skel { background: linear-gradient(90deg, rgba(255,255,255,.12) 25%, rgba(255,255,255,.28) 50%, rgba(255,255,255,.12) 75%); background-size: 200% 100%; }',
    '.kx-ui .kx-skel-wide { min-width: 6.5em; }',
    '.kx-ui .kx-skel-xwide { min-width: 16em; max-width: 100%; }',
    '@media (prefers-reduced-motion: reduce) { .kx-ui .kx-skel { animation: none; } .kx-ui .kx-caret-ch { transition: none; } }',

    /* Tooltip ("Nasıl hesaplandı?") */
    '.kx-tip { position: fixed; z-index: 2147483647; top: 0; left: 0; width: max-content; max-width: 300px; padding: 10px 12px;',
    '  background: #0B1220; color: #fff; border: 1px solid rgba(143,168,255,.25); border-radius: 12px; box-shadow: 0 16px 36px -10px rgba(11,18,32,.55);',
    '  font-size: 12.5px; line-height: 1.45; pointer-events: auto; }',
    '.kx-tip[hidden] { display: none; }',
    '.kx-tip .kx-tip-h { margin: 0 0 4px; font-family: var(--kx-font-display); font-weight: 800; font-size: 12px; color: #8FA8FF; letter-spacing: -.005em; }',
    '.kx-tip .kx-tip-p { margin: 0 0 6px; color: #fff; }',
    '.kx-tip .kx-tip-f { margin: 0 0 6px; font-size: 11.5px; color: rgba(255,255,255,.76); }',
    '.kx-tip .kx-tip-f b { color: rgba(255,255,255,.9); font-weight: 600; }',
    '.kx-tip .kx-tip-m { display: flex; flex-wrap: wrap; gap: 2px 12px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,.12); font-size: 11px; color: rgba(255,255,255,.76); }',
    '.kx-tip .kx-tip-m b { color: #fff; font-weight: 600; }',
  ].join('\n');

  var STYLE_ATTR = 'data-kx-ui';

  /** Put the UI CSS into a shadow root, or once into the page <head> (Document). */
  function ensureStyles(root) {
    root = root || document;
    loadFonts();
    installInfo();
    try {
      if (root.nodeType === 9) { // Document
        if (root.getElementById('kx-ui-css')) return;
        var s = root.createElement('style');
        s.id = 'kx-ui-css';
        s.setAttribute(STYLE_ATTR, '1');
        s.textContent = CSS;
        (root.head || root.documentElement).appendChild(s);
        return;
      }
      if (root.querySelector && root.querySelector('style[' + STYLE_ATTR + ']')) return;
      var doc = root.ownerDocument || document;
      var st = doc.createElement('style');
      st.setAttribute(STYLE_ATTR, '1');
      st.textContent = CSS;
      root.insertBefore ? root.insertBefore(st, root.firstChild) : root.appendChild(st);
    } catch (_) { /* styling is best effort */ }
  }

  // ---------------------------------------------------------------------------
  // Fonts (bundled woff2 subsets, registered once per document)
  // ---------------------------------------------------------------------------
  var FONTS = [
    { family: 'KX Jakarta', file: 'fonts/jakarta-700-800.woff2', weight: '700 800' },
    { family: 'KX Instrument', file: 'fonts/instrument-sans-400-600.woff2', weight: '400 600' },
  ];
  var fontsStarted = false;

  function loadFonts() {
    if (fontsStarted) return;
    fontsStarted = true;
    try {
      if (typeof FontFace === 'undefined' || !document.fonts || typeof fetch !== 'function') return;
      if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.getURL !== 'function') return;
      FONTS.forEach(function (f) {
        fetch(chrome.runtime.getURL(f.file))
          .then(function (r) { return r.ok ? r.arrayBuffer() : null; })
          .then(function (buf) {
            if (!buf) return;
            var face = new FontFace(f.family, buf, { weight: f.weight, style: 'normal', display: 'swap' });
            return face.load().then(function (loaded) { document.fonts.add(loaded); });
          })
          .catch(function () { /* system-ui fallback */ });
      });
    } catch (_) { /* system-ui fallback */ }
  }

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------
  function docOf(x) {
    if (!x) return document;
    if (x.nodeType === 9) return x;
    return x.ownerDocument || document;
  }

  function el(doc, tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function append(parent, child) {
    if (child === undefined || child === null || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(parent, c); }); return; }
    if (typeof child === 'object' && child.nodeType) parent.appendChild(child);
    else parent.appendChild(parent.ownerDocument.createTextNode(String(child)));
  }

  // ---------------------------------------------------------------------------
  // The mark (X with the blade). Inline SVG, no remote asset. Decorative inside a
  // labelled wrapper; no <title>, so it adds no text to the overlay.
  // ---------------------------------------------------------------------------
  var uid = 0;
  var MARK_VIEWBOX = '-7.2 -15.5 72.8 65.5';
  var MARK_STEM = 'M-3.9 0 L31 48 L47.1 48 L12.2 0 Z';
  var MARK_BLADE = 'M12.3 48 L63.5 -13.1 L63.2 -13.5 L-5.2 48 Z';

  function markSvg(doc, dark) {
    var NS = 'http://www.w3.org/2000/svg';
    var id = 'kxm' + (++uid);
    var svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', MARK_VIEWBOX);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var defs = doc.createElementNS(NS, 'defs');
    var grad = doc.createElementNS(NS, 'linearGradient');
    grad.setAttribute('id', id);
    grad.setAttribute('gradientUnits', 'userSpaceOnUse');
    grad.setAttribute('x1', '4.2'); grad.setAttribute('y1', '48');
    grad.setAttribute('x2', '63.4'); grad.setAttribute('y2', '-13.3');
    [['0', '#2F5BFF'], ['1', '#00C6FF']].forEach(function (s) {
      var stop = doc.createElementNS(NS, 'stop');
      stop.setAttribute('offset', s[0]);
      stop.setAttribute('stop-color', s[1]);
      grad.appendChild(stop);
    });
    defs.appendChild(grad);
    svg.appendChild(defs);
    var stem = doc.createElementNS(NS, 'path');
    stem.setAttribute('fill', dark ? '#FFFFFF' : '#0B1220');
    stem.setAttribute('d', MARK_STEM);
    var blade = doc.createElementNS(NS, 'path');
    blade.setAttribute('fill', 'url(#' + id + ')');
    blade.setAttribute('d', MARK_BLADE);
    svg.appendChild(stem);
    svg.appendChild(blade);
    return svg;
  }

  /** `dark`: the white-stem version for ink surfaces. */
  function mark(doc, dark) {
    doc = docOf(doc);
    var wrap = el(doc, 'span', 'kx-mark');
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', 'KolayXport');
    wrap.setAttribute('data-kx-mark', dark ? 'dark' : 'light');
    wrap.appendChild(markSvg(doc, dark));
    return wrap;
  }

  // ---------------------------------------------------------------------------
  // Small components
  // ---------------------------------------------------------------------------
  /** tone: 'good' | 'warn' | 'bad' | 'neutral'. Text is always shown next to the colour. */
  function pill(doc, text, tone) {
    doc = docOf(doc);
    var p = el(doc, 'span', 'kx-pill kx-tone-' + (tone || 'neutral'));
    var dot = el(doc, 'span', 'kx-dot');
    dot.setAttribute('aria-hidden', 'true');
    p.appendChild(dot);
    p.appendChild(el(doc, 'span', null, text));
    return p;
  }

  /** Competition level → tone. Low competition is good for a seller. */
  function competitionTone(level) {
    var l = String(level || '').toLowerCase();
    return l === 'low' ? 'good' : l === 'medium' ? 'warn' : l === 'high' ? 'bad' : 'neutral';
  }

  function confidenceTone(c) {
    return c === 'high' ? 'good' : c === 'medium' ? 'warn' : c === 'low' ? 'bad' : 'neutral';
  }

  /** "tahmini/estimate" tag. */
  function est(doc, text) {
    doc = docOf(doc);
    var n = el(doc, 'span', 'kx-est', text || t('est'));
    n.setAttribute('data-kx-est', '1');
    return n;
  }

  /** Words for a sales kind + confidence: "tahmini, orta güven" / "ölçüldü, yüksek güven". */
  function confText(kind, confidence) {
    var k = kind === 'measured' ? 'kind_measured' : kind === 'estimated' ? 'kind_estimated' : 'kind_insufficient';
    var s = t(k);
    if (confidence && kind !== 'insufficient' && COPY.en['confTag_' + confidence]) s += ', ' + t('confTag_' + confidence);
    return s;
  }

  /** Confidence tag: a dot coloured by confidence and the words (never colour alone). */
  function conf(doc, kind, confidence) {
    doc = docOf(doc);
    var tone = kind === 'insufficient' || !kind ? 'neutral' : confidenceTone(confidence);
    var n = el(doc, 'span', 'kx-conf kx-tone-' + tone);
    n.setAttribute('data-kx-conf', confidence || '');
    var dot = el(doc, 'span', 'kx-dot');
    dot.setAttribute('aria-hidden', 'true');
    n.appendChild(dot);
    n.appendChild(el(doc, 'span', null, confText(kind, confidence)));
    return n;
  }

  /** "tipik fiyattan %30 ucuz" for a percentage difference vs the typical (median) price. */
  function vsTypical(pct) {
    if (pct === null || pct === undefined || !Number.isFinite(Number(pct))) return null;
    var n = Math.abs(Math.round(Number(pct)));
    if (n === 0) return { text: t('vsSame'), tone: 'neutral', pct: 0 };
    return pct < 0 ? { text: t('vsCheaper', { n: n }), tone: 'good', pct: pct } : { text: t('vsPricier', { n: n }), tone: 'warn', pct: pct };
  }

  /**
   * One-line verdict from the competition level (and a demand share where we have one).
   * Honest by construction: it only restates the level; it never promises sales.
   * demandShare: share of listings with sales (0..1) or null.
   */
  function verdict(level, demandShare) {
    var l = String(level || '').toLowerCase();
    if (l !== 'low' && l !== 'medium' && l !== 'high') return null;
    var text = t('verdict_' + l);
    if (demandShare !== null && demandShare !== undefined && Number.isFinite(demandShare)) {
      if (demandShare >= 0.5) text += '; ' + t('demand_high');
      else if (demandShare < 0.2) text += '; ' + t('demand_low');
    }
    return { text: text, tone: competitionTone(l), level: l };
  }

  // ---------------------------------------------------------------------------
  // "i" — how is this calculated?
  // explain = { label, plain, formula, source: key | [keys], confidence: 'high'|'medium'|'low'|'exact' }
  // ---------------------------------------------------------------------------
  function sourceText(src) {
    var list = Array.isArray(src) ? src : src ? [src] : [];
    return list.map(function (s) { return COPY.en['src_' + s] ? t('src_' + s) : String(s); }).join(' + ');
  }

  function info(doc, explain) {
    doc = docOf(doc);
    explain = explain || {};
    var b = el(doc, 'button', 'kx-info');
    b.type = 'button';
    b.title = ''; // an empty title stops a parent's native tooltip from doubling ours
    b.setAttribute('data-kx-info', '1');
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-label', explain.label ? t('infoLabel', { label: explain.label }) : t('howTitle'));
    if (explain.plain) b.setAttribute('data-kx-plain', String(explain.plain));
    if (explain.formula) b.setAttribute('data-kx-formula', String(explain.formula));
    var src = sourceText(explain.source);
    if (src) b.setAttribute('data-kx-source', src);
    if (explain.confidence) b.setAttribute('data-kx-confidence', String(explain.confidence));
    return b;
  }

  function escAttr(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  /** Same button as markup, for overlays that build their HTML as a template (escaped). */
  function infoHtml(explain) {
    var b = info(document, explain);
    var attrs = ['type="button"', 'class="kx-info"', 'title=""'];
    Array.prototype.forEach.call(b.attributes, function (a) {
      if (a.name === 'type' || a.name === 'class' || a.name === 'title') return;
      attrs.push(a.name + '="' + escAttr(a.value) + '"');
    });
    return '<button ' + attrs.join(' ') + '></button>';
  }

  /** The mark as markup (static, no data). */
  function markHtml(dark) {
    var id = 'kxm' + (++uid);
    return '<span class="kx-mark" role="img" aria-label="KolayXport" data-kx-mark="' + (dark ? 'dark' : 'light') + '">' +
      '<svg viewBox="' + MARK_VIEWBOX + '" aria-hidden="true" focusable="false"><defs><linearGradient id="' + id +
      '" gradientUnits="userSpaceOnUse" x1="4.2" y1="48" x2="63.4" y2="-13.3"><stop offset="0" stop-color="#2F5BFF"/>' +
      '<stop offset="1" stop-color="#00C6FF"/></linearGradient></defs><path fill="' + (dark ? '#FFFFFF' : '#0B1220') + '" d="' + MARK_STEM +
      '"/><path fill="url(#' + id + ')" d="' + MARK_BLADE + '"/></svg></span>';
  }

  // Tooltip: one host per document, its own shadow root.
  var tipState = { btn: null, pinned: false, hideTimer: null, refocus: false };

  function tipEls(doc) {
    var host = doc.getElementById('kx-ui-tip');
    if (!host) {
      host = doc.createElement('div');
      host.id = 'kx-ui-tip';
      host.setAttribute('style', 'all: initial; position: fixed; top: 0; left: 0; z-index: 2147483647; display: block;');
      var shadow = host.attachShadow({ mode: 'open' });
      var st = doc.createElement('style');
      st.setAttribute(STYLE_ATTR, '1');
      st.textContent = CSS;
      shadow.appendChild(st);
      var box = doc.createElement('div');
      box.className = 'kx-tip';
      box.id = 'kx-tip-box';
      box.setAttribute('role', 'tooltip');
      box.setAttribute('aria-live', 'polite');
      box.hidden = true;
      shadow.appendChild(box);
      (doc.body || doc.documentElement).appendChild(host);
    }
    return { host: host, box: host.shadowRoot.getElementById('kx-tip-box') };
  }

  function fillTip(doc, box, btn) {
    box.textContent = '';
    box.lang = lang();
    box.appendChild(el(doc, 'div', 'kx-tip-h', t('howTitle')));
    var plain = btn.getAttribute('data-kx-plain');
    var formula = btn.getAttribute('data-kx-formula');
    if (plain) box.appendChild(el(doc, 'p', 'kx-tip-p', plain));
    if (formula) {
      var f = el(doc, 'p', 'kx-tip-f');
      f.appendChild(el(doc, 'b', null, t('formula') + ': '));
      f.appendChild(doc.createTextNode(formula));
      box.appendChild(f);
    }
    var src = btn.getAttribute('data-kx-source');
    var c = btn.getAttribute('data-kx-confidence');
    if (src || c) {
      var m = el(doc, 'div', 'kx-tip-m');
      if (src) {
        var s = el(doc, 'span');
        s.appendChild(el(doc, 'b', null, t('source') + ': '));
        s.appendChild(doc.createTextNode(src));
        m.appendChild(s);
      }
      if (c) {
        var cc = el(doc, 'span');
        cc.appendChild(el(doc, 'b', null, t('confidence') + ': '));
        cc.appendChild(doc.createTextNode(COPY.en['conf_' + c] ? t('conf_' + c) : c));
        m.appendChild(cc);
      }
      box.appendChild(m);
    }
  }

  function placeTip(box, btn) {
    try {
      var r = btn.getBoundingClientRect();
      var vw = window.innerWidth || 1024;
      var vh = window.innerHeight || 768;
      var w = Math.min(300, vw - 16);
      var left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, vw - w - 8));
      box.style.maxWidth = w + 'px';
      box.style.left = left + 'px';
      var h = box.offsetHeight || 120;
      var below = r.bottom + 8;
      var top = below + h > vh - 8 && r.top - h - 8 > 8 ? r.top - h - 8 : below;
      box.style.top = Math.max(8, top) + 'px';
    } catch (_) { /* jsdom / detached */ }
  }

  function showTip(btn, pinned) {
    var doc = btn.ownerDocument || document;
    clearTimeout(tipState.hideTimer);
    var els = tipEls(doc);
    if (tipState.btn && tipState.btn !== btn) tipState.btn.setAttribute('aria-expanded', 'false');
    tipState.btn = btn;
    tipState.pinned = !!pinned;
    fillTip(doc, els.box, btn);
    els.box.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    placeTip(els.box, btn);
  }

  function hideTip() {
    clearTimeout(tipState.hideTimer);
    if (tipState.btn) tipState.btn.setAttribute('aria-expanded', 'false');
    var doc = (tipState.btn && tipState.btn.ownerDocument) || document;
    tipState.btn = null;
    tipState.pinned = false;
    var host = doc.getElementById('kx-ui-tip');
    var box = host && host.shadowRoot && host.shadowRoot.getElementById('kx-tip-box');
    if (box) box.hidden = true;
  }

  function infoFrom(e) {
    var path = e.composedPath ? e.composedPath() : [e.target];
    for (var i = 0; i < path.length && i < 8; i++) {
      var n = path[i];
      if (n && n.nodeType === 1 && n.classList && n.classList.contains('kx-info')) return n;
    }
    return null;
  }

  function inTip(e) {
    var path = e.composedPath ? e.composedPath() : [e.target];
    for (var i = 0; i < path.length; i++) if (path[i] && path[i].id === 'kx-ui-tip') return true;
    return false;
  }

  var installed = false;
  function installInfo() {
    if (installed || typeof window === 'undefined' || !window.addEventListener) return;
    installed = true;
    window.addEventListener('mouseover', function (e) {
      var b = infoFrom(e);
      if (b) { if (!(tipState.pinned && tipState.btn === b)) showTip(b, tipState.pinned && tipState.btn === b); return; }
      if (inTip(e)) clearTimeout(tipState.hideTimer);
    }, true);
    window.addEventListener('mouseout', function (e) {
      var b = infoFrom(e);
      if ((b || inTip(e)) && tipState.btn && !tipState.pinned) {
        clearTimeout(tipState.hideTimer);
        tipState.hideTimer = setTimeout(hideTip, 150);
      }
    }, true);
    window.addEventListener('focusin', function (e) {
      var b = infoFrom(e);
      if (b && !tipState.refocus) showTip(b, false);
    }, true);
    window.addEventListener('focusout', function (e) {
      var b = infoFrom(e);
      if (b && tipState.btn === b && !tipState.pinned) hideTip();
    }, true);
    window.addEventListener('click', function (e) {
      var b = infoFrom(e);
      if (b) {
        // The card strip can sit inside a listing link: never navigate or open the listing.
        e.preventDefault();
        e.stopPropagation();
        if (tipState.btn === b && tipState.pinned) hideTip();
        else showTip(b, true);
        return;
      }
      if (tipState.btn && !inTip(e)) hideTip();
    }, true);
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && tipState.btn) {
        var b = tipState.btn;
        hideTip();
        // Keep keyboard focus on the "i" without reopening the tooltip.
        tipState.refocus = true;
        try { b.focus(); } catch (_) { /* detached */ }
        tipState.refocus = false;
      }
    }, true);
    window.addEventListener('scroll', function () { if (tipState.btn && !tipState.pinned) hideTip(); }, true);
  }

  // ---------------------------------------------------------------------------
  // Preferences (expanded "More" row, collapsed panels)
  // ---------------------------------------------------------------------------
  var PREF_KEYS = { more: 'kx_ui_more', panel: 'kx_ui_panel_collapsed' };
  var prefs = { more: false, panel: false };
  var prefListeners = [];

  function storage() {
    try { return (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) || null; } catch (_) { return null; }
  }

  /** Register a live element that follows a preference; dead ones are dropped as we go. */
  function track(l) {
    if (prefListeners.length > 40) prefListeners = prefListeners.filter(function (x) { return x.alive(); });
    prefListeners.push(l);
  }

  function applyPrefs() {
    prefListeners = prefListeners.filter(function (l) { return l.alive(); });
    prefListeners.forEach(function (l) { try { l.apply(); } catch (_) { /* detached */ } });
  }

  function readPrefs() {
    var st = storage();
    if (!st || typeof st.get !== 'function') return;
    try {
      st.get([PREF_KEYS.more, PREF_KEYS.panel], function (r) {
        try { void (chrome.runtime && chrome.runtime.lastError); } catch (_) { /* ignore */ }
        r = r || {};
        if (typeof r[PREF_KEYS.more] === 'boolean') prefs.more = r[PREF_KEYS.more];
        if (typeof r[PREF_KEYS.panel] === 'boolean') prefs.panel = r[PREF_KEYS.panel];
        applyPrefs();
      });
    } catch (_) { /* defaults */ }
  }

  function setPref(name, value) {
    prefs[name] = !!value;
    applyPrefs();
    var st = storage();
    if (!st || typeof st.set !== 'function') return;
    var o = {};
    o[PREF_KEYS[name]] = !!value;
    try {
      var p = st.set(o);
      if (p && typeof p.catch === 'function') p.catch(function () { /* ignore */ });
    } catch (_) { /* session only */ }
  }

  readPrefs();
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area && area !== 'local') return;
        var hit = false;
        ['more', 'panel'].forEach(function (k) {
          var c = changes && changes[PREF_KEYS[k]];
          if (c && typeof c.newValue === 'boolean' && c.newValue !== prefs[k]) { prefs[k] = c.newValue; hit = true; }
        });
        if (hit) applyPrefs();
      });
    }
  } catch (_) { /* other tabs keep their state */ }

  // ---------------------------------------------------------------------------
  // Chips and the top bar
  // ---------------------------------------------------------------------------
  /**
   * Metric chip: label above value.
   * o = { label, value (string | Node | [..]), info (explain), est (bool|string), tone, key, className }
   */
  function chip(doc, o) {
    doc = docOf(doc);
    o = o || {};
    var c = el(doc, 'div', 'kx-chip kx-bar-item' + (o.className ? ' ' + o.className : ''));
    if (o.key) c.setAttribute('data-kx-chip', o.key);
    var lab = el(doc, 'span', 'kx-chip-label kx-bar-label');
    lab.appendChild(el(doc, 'span', null, o.label));
    if (o.est) lab.appendChild(est(doc, typeof o.est === 'string' ? o.est : undefined));
    if (o.info) lab.appendChild(info(doc, Object.assign({ label: o.label }, o.info)));
    c.appendChild(lab);
    var v = el(doc, 'span', 'kx-chip-value kx-bar-value' + (o.tone ? ' kx-' + o.tone : ''));
    append(v, o.value === undefined || o.value === null ? '—' : o.value);
    c.appendChild(v);
    if (o.title) c.title = o.title;
    return c;
  }

  /**
   * Fill a top bar. o = {
   *   title, verdict: { text, tone } | null | Node (placeholder), chips: [Node], more: [Node],
   *   link: { href, text }, state: 'partial' | 'full', extra: [Node] (before the actions)
   * }
   * The second row ("More") is always in the DOM (hidden when collapsed), so nothing jumps
   * and its numbers stay readable by assistive tech when opened.
   */
  function topBar(bar, o) {
    var doc = docOf(bar);
    o = o || {};
    bar.textContent = '';
    bar.removeAttribute('data-kx-limited');
    bar.classList.add('kx-ui', 'kx-topbar');
    bar.lang = lang();
    if (o.state) bar.dataset.kxState = o.state;

    var main = el(doc, 'div', 'kx-topbar-main');
    var id = el(doc, 'div', 'kx-topbar-id');
    id.appendChild(mark(doc, true));
    var txt = el(doc, 'div', 'kx-topbar-text');
    var title = el(doc, 'span', 'kx-topbar-title', o.title || 'KolayXport');
    title.title = o.title || '';
    txt.appendChild(title);
    if (o.verdict && o.verdict.nodeType) {
      var vp = el(doc, 'span', 'kx-verdict');
      vp.appendChild(o.verdict);
      txt.appendChild(vp);
    } else if (o.verdict && o.verdict.text) {
      var v = el(doc, 'span', 'kx-verdict kx-tone-' + (o.verdict.tone || 'neutral'));
      v.setAttribute('data-kx-verdict', o.verdict.level || '');
      v.title = o.verdict.text;
      var dot = el(doc, 'span', 'kx-dot');
      dot.setAttribute('aria-hidden', 'true');
      v.appendChild(dot);
      v.appendChild(el(doc, 'span', null, o.verdict.text));
      txt.appendChild(v);
    }
    id.appendChild(txt);
    main.appendChild(id);

    var chips = el(doc, 'div', 'kx-chips');
    append(chips, o.chips || []);
    main.appendChild(chips);

    var actions = el(doc, 'div', 'kx-topbar-actions');
    append(actions, o.extra || []);
    var moreItems = (o.more || []).filter(Boolean);
    var moreRow = null;
    if (moreItems.length) {
      moreRow = el(doc, 'div', 'kx-topbar-more');
      moreRow.id = (bar.id || bar.className.split(' ')[0] || 'kx-bar') + '-more';
      moreRow.setAttribute('data-kx-more', '1');
      append(moreRow, moreItems);
      var btn = el(doc, 'button', 'kx-more-btn');
      btn.type = 'button';
      btn.setAttribute('data-kx-more-toggle', '1');
      btn.setAttribute('aria-controls', moreRow.id);
      var label = el(doc, 'span');
      var ch = el(doc, 'span', 'kx-caret-ch');
      ch.setAttribute('aria-hidden', 'true');
      btn.appendChild(label);
      btn.appendChild(ch);
      var apply = function () {
        var open = prefs.more;
        moreRow.hidden = !open;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        label.textContent = open ? t('less') : t('more');
      };
      apply();
      track({ alive: function () { return moreRow.isConnected; }, apply: apply });
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        setPref('more', !prefs.more);
      });
      actions.appendChild(btn);
    }
    if (o.link && o.link.href) {
      var a = el(doc, 'a', 'kx-cta kx-btn', o.link.text || t('fullAnalysis'));
      a.href = o.link.href;
      a.target = '_blank';
      a.rel = 'noopener';
      actions.appendChild(a);
    }
    main.appendChild(actions);
    bar.appendChild(main);
    if (moreRow) bar.appendChild(moreRow);
    return { main: main, chips: chips, more: moreRow, actions: actions };
  }

  /** A note line for the "More" row (source, sample sizes). */
  function note(doc, text, cls) {
    return el(docOf(doc), 'div', 'kx-note' + (cls ? ' ' + cls : ''), text);
  }

  /** Simple message in a top bar (loading / error before any numbers). */
  function barMessage(bar, text) {
    var doc = docOf(bar);
    bar.textContent = '';
    bar.removeAttribute('data-kx-limited');
    bar.classList.add('kx-ui', 'kx-topbar');
    var main = el(doc, 'div', 'kx-topbar-main');
    main.appendChild(mark(doc, true));
    main.appendChild(el(doc, 'span', 'kx-msg', text));
    bar.appendChild(main);
  }

  // ---------------------------------------------------------------------------
  // Side panel
  // ---------------------------------------------------------------------------
  /**
   * Fill a panel element: header (mark, title, extra nodes, collapse caret) + body.
   * Returns the body element. The collapsed state is shared by all panels and persisted.
   */
  function panel(elm, o) {
    var doc = docOf(elm);
    o = o || {};
    elm.textContent = '';
    elm.removeAttribute('data-kx-limited');
    elm.classList.add('kx-ui', 'kx-panel');
    elm.lang = lang();
    var head = el(doc, 'div', 'kx-panel-head kx-stats-header');
    head.appendChild(mark(doc, false));
    if (o.title) head.appendChild(el(doc, 'span', 'kx-panel-title', o.title));
    var caret = el(doc, 'button', 'kx-caret kx-collapse-btn');
    caret.type = 'button';
    caret.setAttribute('data-kx-collapse', '1');
    var ch = el(doc, 'span', 'kx-caret-ch');
    ch.setAttribute('aria-hidden', 'true');
    caret.appendChild(ch);
    head.appendChild(caret);
    elm.appendChild(head);
    if (o.extra && o.extra.length) {
      // A summary line under the title; it stays visible when the panel is collapsed.
      var ex = el(doc, 'div', 'kx-panel-head-extra');
      append(ex, o.extra);
      elm.appendChild(ex);
    }
    var body = el(doc, 'div', 'kx-panel-body');
    body.id = (elm.id || 'kx-panel') + '-body';
    caret.setAttribute('aria-controls', body.id);
    elm.appendChild(body);
    var apply = function () {
      var collapsed = prefs.panel;
      if (collapsed) elm.setAttribute('data-kx-collapsed', '1'); else elm.removeAttribute('data-kx-collapsed');
      caret.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      caret.setAttribute('aria-label', collapsed ? t('expand') : t('collapse'));
    };
    apply();
    track({ alive: function () { return body.isConnected; }, apply: apply });
    caret.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      setPref('panel', !prefs.panel);
    });
    return body;
  }

  /** Panel metric tile: label (+ i) above value. */
  function metric(doc, o) {
    doc = docOf(doc);
    o = o || {};
    var m = el(doc, 'span', 'kx-metric');
    if (o.key) m.setAttribute('data-kx-metric', o.key);
    var lab = el(doc, 'span', 'kx-metric-label');
    lab.appendChild(el(doc, 'span', null, o.label));
    if (o.est) lab.appendChild(est(doc, typeof o.est === 'string' ? o.est : undefined));
    if (o.info) lab.appendChild(info(doc, Object.assign({ label: o.label }, o.info)));
    m.appendChild(lab);
    var v = el(doc, 'span', 'kx-metric-value' + (o.tone ? ' kx-' + o.tone : ''));
    append(v, o.value === undefined || o.value === null ? '—' : o.value);
    m.appendChild(v);
    return m;
  }

  /** Shimmer placeholder element (`wide`: true | 'x'). */
  function skel(doc, wide) {
    var n = el(docOf(doc), 'span', 'kx-skel' + (wide === 'x' ? ' kx-skel-xwide' : wide ? ' kx-skel-wide' : ''));
    n.setAttribute('aria-hidden', 'true');
    n.setAttribute('data-kx-skel', '1');
    return n;
  }

  /** Line break inside a card strip: the headline figure on line 1, the rest on line 2. */
  function lineBreak(doc) {
    var b = el(docOf(doc), 'span', 'kx-break');
    b.setAttribute('aria-hidden', 'true');
    return b;
  }

  /** Card strip under a listing card (light DOM). Adds the brand classes to `row`. */
  function strip(row) {
    row.classList.add('kx-ui', 'kx-strip');
    return row;
  }

  var api = {
    CSS: CSS,
    FONT_BODY: FONT_BODY,
    FONT_DISPLAY: FONT_DISPLAY,
    ensureStyles: ensureStyles,
    loadFonts: loadFonts,
    t: t,
    trOf: trOf,
    get lang() { return lang(); },
    mark: mark,
    markHtml: markHtml,
    pill: pill,
    est: est,
    conf: conf,
    confText: confText,
    competitionTone: competitionTone,
    confidenceTone: confidenceTone,
    vsTypical: vsTypical,
    verdict: verdict,
    info: info,
    infoHtml: infoHtml,
    sourceText: sourceText,
    chip: chip,
    topBar: topBar,
    note: note,
    barMessage: barMessage,
    panel: panel,
    metric: metric,
    strip: strip,
    skel: skel,
    lineBreak: lineBreak,
    showTip: showTip,
    hideTip: hideTip,
    prefs: prefs,
    setPref: setPref,
    PREF_KEYS: PREF_KEYS,
  };
  if (typeof window !== 'undefined') window.__KX_UI = api;
})();
