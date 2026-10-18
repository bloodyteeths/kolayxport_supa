// Prints the files manifest.json references (one per line). Used by build.sh.
const fs = require('fs');
const path = require('path');
const dir = process.argv[2] || __dirname;
const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const files = new Set(['manifest.json']);
const add = (f) => { if (f) files.add(f.replace(/^\.\//, '')); };

Object.values(m.icons || {}).forEach(add);
(m.content_scripts || []).forEach(cs => { (cs.js || []).forEach(add); (cs.css || []).forEach(add); });
if (m.background && m.background.service_worker) {
  add(m.background.service_worker);
  // Content scripts the worker registers at runtime (chrome.scripting, optional hosts) are not in the manifest:
  // pick up every 'src/….js' literal in the worker.
  const sw = fs.readFileSync(path.join(dir, m.background.service_worker), 'utf8');
  for (const match of sw.matchAll(/['"](src\/[\w./-]+\.js)['"]/g)) add(match[1]);
}
if (m.action) {
  Object.values(m.action.default_icon || {}).forEach(add);
  if (m.action.default_popup) {
    const popup = m.action.default_popup;
    add(popup);
    // Local assets referenced from the popup HTML (src= / href=), relative to it.
    const html = fs.readFileSync(path.join(dir, popup), 'utf8');
    for (const match of html.matchAll(/\b(?:src|href)\s*=\s*"([^"]+)"/g)) {
      const ref = match[1];
      if (/^(https?:|data:|#|mailto:)/.test(ref)) continue;
      add(path.posix.normalize(path.posix.join(path.posix.dirname(popup), ref)));
    }
  }
}
(m.web_accessible_resources || []).forEach(w => (w.resources || []).forEach(add));

const missing = [...files].filter(f => !fs.existsSync(path.join(dir, f)));
if (missing.length) {
  console.error('Missing files referenced by manifest: ' + missing.join(', '));
  process.exit(1);
}
console.log([...files].sort().join('\n'));
