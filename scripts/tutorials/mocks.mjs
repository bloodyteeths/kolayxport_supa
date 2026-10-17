// Browser-side request mocks and the external-host safety net used while recording (see README.md, "Mocks").
//
// A few screens call our own API routes that in turn call a marketplace live (the Etsy listing editor, the
// inbox, AI buttons). The demo account only has fake tokens, so for those the recording answers the
// browser's request with a synthetic JSON fixture instead (page.route). Nothing here touches the server.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { CONFIG, ROOT } from './lib.mjs';

export const FIXTURES = path.join(ROOT, 'scripts/tutorials/fixtures');

/**
 * Always on, for every tutorial: never let a stray click start a live pull or a send.
 * Each rule answers before the request reaches our server.
 */
const SAFETY_RULES = [
  { url: '**/api/orders/sync**', json: { ok: true, skipped: true } },
  { url: '**/api/orders/fullSync**', json: { ok: true, skipped: true } },
  { url: '**/api/finance/settlements**', method: 'POST', json: { ok: true } },
  { url: '**/api/research/price-gap/refresh**', json: { ok: true } },
  // Sends of staged drafts to a marketplace (Etsy, eBay, Trendyol, Shopify, Wix): never during a recording.
  { url: /\/api\/[a-z-]*drafts\/(?:[^/]+\/sync|bulk-sync)/, method: 'POST', json: { ok: true, skipped: true } },
  { url: '**/api/etgb/**', method: 'POST', json: { ok: true, skipped: true } },
  { url: '**/api/labels/**', method: 'POST', json: { ok: false, error: 'disabled while recording' }, status: 409 },
  { url: '**/api/messages?**', method: 'POST', json: { ok: true } },
];

/** Hosts the page may load from while recording. Every other non-local host is aborted. */
const DEFAULT_ALLOW_HOSTS = ['localhost', '127.0.0.1', 'fonts.googleapis.com', 'fonts.gstatic.com'];

// ---------------------------------------------------------------------------
// Fixture templating
//   "{{base}}"           → the app base URL (e.g. http://localhost:3100), anywhere inside a string
//   "{{ago:35m}}"        → ISO timestamp 35 minutes ago (units: s, m, h, d), anywhere inside a string
//   "{{unix-ago:3d}}"    → when it is the whole string value: a number (seconds since epoch), 3 days ago
//   "{{now}}"            → ISO timestamp now
//   "{{base64:path}}"    → when it is the whole string value: the base64 of a file (path relative to the repo
//                          root), e.g. a synthetic "AI generated" image
// ---------------------------------------------------------------------------
const UNIT = { s: 1e3, m: 6e4, h: 3.6e6, d: 8.64e7 };
const msAgo = (spec) => {
  const m = /^(\d+(?:\.\d+)?)([smhd])$/.exec(spec.trim());
  if (!m) throw new Error(`bad duration "${spec}" (use e.g. 35m, 3d)`);
  return Number(m[1]) * UNIT[m[2]];
};

export function expand(value, now = Date.now()) {
  if (typeof value === 'string') {
    const unix = /^\{\{unix-ago:([^}]+)\}\}$/.exec(value);
    if (unix) return Math.floor((now - msAgo(unix[1])) / 1000);
    const b64 = /^\{\{base64:([^}]+)\}\}$/.exec(value);
    if (b64) return fs.readFileSync(path.join(ROOT, b64[1].trim())).toString('base64');
    return value
      .replace(/\{\{base\}\}/g, CONFIG.baseUrl)
      .replace(/\{\{now\}\}/g, new Date(now).toISOString())
      .replace(/\{\{ago:([^}]+)\}\}/g, (_, d) => new Date(now - msAgo(d)).toISOString());
  }
  if (Array.isArray(value)) return value.map((v) => expand(v, now));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v, now)]));
  return value;
}

// ---------------------------------------------------------------------------
// Rules
//   { url, method?, query?, body?, fixture? | json? | file? | empty? | passthrough?, status?, contentType? }
//   - url:      Playwright glob for the request URL (e.g. "**/api/clawd/etsy**")
//   - method:   only this HTTP method
//   - query:    every listed query param must equal this value
//   - body:     every listed top-level field of the JSON request body must equal this value
//   - fixture:  JSON file under scripts/tutorials/fixtures/ (templated, see above)
//   - json:     inline JSON body (templated)
//   - file:     serve a local file from ROOT, e.g. "public/demo/{path}" ({path} = request pathname)
//   - empty:    answer with an empty body (e.g. status 204)
//   - merge:    let the request reach our server, then deep-merge this object into its JSON response
//               (e.g. switch on a setting the seeded demo account has off, without writing to the DB)
//   - passthrough: let the request go to the server unchanged
//   - { use: <set> } loads scripts/tutorials/fixtures/<set>/mocks.yaml (a list of rules; fixture paths there
//     are relative to that folder)
// Rules are tried in order; the first match wins. No match → the request continues to the server.
// ---------------------------------------------------------------------------
export function resolveRules(list = [], base = FIXTURES) {
  const out = [];
  for (const r of list) {
    if (r && r.use) {
      const dir = path.join(FIXTURES, r.use);
      const file = path.join(dir, 'mocks.yaml');
      if (!fs.existsSync(file)) throw new Error(`mock set "${r.use}" not found (${path.relative(ROOT, file)})`);
      out.push(...resolveRules(yaml.load(fs.readFileSync(file, 'utf8')) || [], dir));
      continue;
    }
    if (!r?.url) throw new Error(`mock rule needs url: ${JSON.stringify(r)}`);
    out.push({ ...r, ...(r.fixture ? { fixture: path.resolve(base, r.fixture) } : {}) });
  }
  return out;
}

function matches(rule, req) {
  if (rule.method && req.method().toUpperCase() !== String(rule.method).toUpperCase()) return false;
  if (rule.query) {
    const u = new URL(req.url());
    for (const [k, v] of Object.entries(rule.query)) if (u.searchParams.get(k) !== String(v)) return false;
  }
  if (rule.body) {
    let b = null;
    try { b = req.postDataJSON(); } catch { b = null; }
    if (!b || typeof b !== 'object') return false;
    for (const [k, v] of Object.entries(rule.body)) if (b[k] !== v) return false;
  }
  return true;
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(out[k], v);
  return out;
}

async function answer(route, rule) {
  const status = rule.status || 200;
  if (rule.passthrough) return route.fallback();
  if (rule.merge) {
    const res = await route.fetch();
    let body;
    try { body = await res.json(); } catch { return route.fulfill({ response: res }); }
    return route.fulfill({ response: res, json: deepMerge(body, expand(rule.merge)) });
  }
  if (rule.empty) return route.fulfill({ status: rule.status || 204, body: '' });
  if (rule.file) {
    const p = path.join(ROOT, rule.file.replace('{path}', decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, '')));
    if (!fs.existsSync(p)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status, contentType: rule.contentType || 'image/jpeg', body: fs.readFileSync(p) });
  }
  const data = rule.fixture ? JSON.parse(fs.readFileSync(rule.fixture, 'utf8')) : rule.json ?? {};
  return route.fulfill({ status, contentType: rule.contentType || 'application/json', body: JSON.stringify(expand(data)) });
}

/**
 * Install the tutorial's mocks + the safety rules + the external-host block on a browser context.
 * Returns a summary object whose `blocked` set lists aborted hosts (printed after recording).
 */
export async function installMocks(ctx, tutorial = {}) {
  const rules = [...resolveRules(tutorial.mocks || []), ...SAFETY_RULES];
  const allow = new Set([...DEFAULT_ALLOW_HOSTS, new URL(CONFIG.baseUrl).hostname, ...(tutorial.allowHosts || [])]);
  const report = { blocked: new Set(), mocked: new Map() };

  // Safety net: abort every request to a host that is not local or explicitly allowed (marketplaces,
  // carriers, analytics…). Registered first, so it runs last: rules below can still serve a fake host.
  await ctx.route((url) => !allow.has(url.hostname), (route) => {
    report.blocked.add(new URL(route.request().url()).hostname);
    return route.abort('blockedbyclient');
  });

  // Group rules by URL glob, keep their order inside each group. Playwright runs the most recently
  // registered handler first, so register in reverse to keep "first rule wins" across groups too.
  const groups = new Map();
  for (const r of rules) { if (!groups.has(r.url)) groups.set(r.url, []); groups.get(r.url).push(r); }
  for (const [glob, list] of [...groups.entries()].reverse()) {
    await ctx.route(glob, async (route) => {
      const req = route.request();
      const rule = list.find((r) => matches(r, req));
      if (!rule) return route.fallback();
      if (!rule.passthrough) report.mocked.set(glob, (report.mocked.get(glob) || 0) + 1);
      return answer(route, rule);
    });
  }
  return report;
}
