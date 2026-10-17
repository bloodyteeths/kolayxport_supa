// Parses docs/gtm/feature-inventory.md §1 (server-only). Used by /ozellikler and scripts/gtm/check-claims.ts,
// so the public feature list and the claim check read the same source of truth.
import fs from 'fs';
import path from 'path';

export interface InventoryRow {
  id: string;
  area: string;
  tr: string;
  en: string;
  where: string;
  maturity: string;
  /** production | beta | partial | stub | none (first word of the maturity cell). */
  level: 'production' | 'beta' | 'partial' | 'stub' | 'none' | 'other';
  plan: string;
}

const FILE = path.join(process.cwd(), 'docs/gtm/feature-inventory.md');

export function readInventory(): InventoryRow[] {
  const src = fs.readFileSync(FILE, 'utf8');
  const start = src.indexOf('## 1. Feature table');
  const end = src.indexOf('\n## 2.', start);
  const body = src.slice(start, end > 0 ? end : undefined);
  const rows: InventoryRow[] = [];
  let area = '';
  for (const line of body.split('\n')) {
    const h = /^### (.+)$/.exec(line);
    if (h) { area = h[1].trim(); continue; }
    const m = /^\| `([a-z0-9-]+)` \|/.exec(line);
    if (!m) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    const maturity = cells[4] || '';
    const first = maturity.split(/[\s(]/)[0].toLowerCase();
    const level = (['production', 'beta', 'partial', 'stub', 'none'].includes(first) ? first : 'other') as InventoryRow['level'];
    rows.push({ id: m[1], area, tr: cells[1], en: cells[2], where: cells[3], maturity, level, plan: cells[5] || '' });
  }
  return rows;
}

/** Ids that public copy may reference (anything but stub/none). */
export function claimableIds(): Set<string> {
  return new Set(readInventory().filter((r) => r.level !== 'stub' && r.level !== 'none').map((r) => r.id));
}
