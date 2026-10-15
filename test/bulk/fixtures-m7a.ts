// Shared fixtures for the M7-A paste/fill tests: Etsy-like rows and grid columns (no React).
import type { GridCellSpec, GridMessages } from '@/lib/bulk/paste';

export type Row = { id: string; title: string; price: number; quantity: number; tags: string[]; section: string; variations?: boolean; managed?: boolean; currency: string };

export const messages: GridMessages = {
  invalidNumber: () => 'Enter a number',
  wholeNumber: () => 'Enter a whole number',
  enterValue: () => 'Enter a value',
  currency: (c) => `Currency doesn't match this shop (${c})`,
  tooLong: (max, length) => `max ${max} (${length})`,
  tagTooLong: (tag, length, max) => `${tag} ${length}/${max}`,
  tagOverLimit: (max) => `${max} tags is the limit`,
  noOption: (v) => `no option ${v}`,
  tagInvalid: (t) => `bad tag ${t}`,
};

export const columns: GridCellSpec<Row>[] = [
  { key: 'thumb', header: '', field: 'thumb', type: 'thumb' },
  {
    key: 'title', header: 'Title', field: 'title', type: 'text-edit', counter: 140,
    validate: (v) => (typeof v === 'string' && v.length > 140 ? "Etsy's limit is 140" : typeof v === 'string' && !v ? 'Enter a title' : null),
  },
  {
    key: 'price', header: 'Price', field: 'price', type: 'money-edit', currency: (r) => r.currency,
    editable: (r) => (r.variations ? { reason: 'Has variations' } : true),
    validate: (v) => (typeof v === 'number' && v < 0.2 ? "Etsy's minimum price is $0.20" : null),
  },
  {
    key: 'qty', header: 'Qty', field: 'quantity', type: 'int-edit', value: (r) => r.quantity,
    editable: (r) => (r.variations ? { reason: 'Has variations' } : r.managed ? { reason: 'Stock sync manages this quantity' } : true),
    validate: (v) => (typeof v === 'number' && (v < 0 || v > 999) ? '0–999' : null),
  },
  { key: 'tags', header: 'Tags', field: 'tags', type: 'tags-edit', maxTags: 13, maxTagLength: 20 },
  { key: 'section', header: 'Section', field: 'shop_section_id', type: 'select-edit', value: (r) => r.section, options: [{ value: '1', label: 'Blankets' }, { value: '2', label: 'Boxes' }] },
  { key: 'health', header: 'Health', field: 'health', type: 'score' },
];

export function makeRows(n: number, extra: (i: number) => Partial<Row> = () => ({})): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `L${i + 1}`, title: `Listing ${i + 1}`, price: 10 + i, quantity: i % 50, tags: ['a', 'b'], section: '1', currency: 'USD', ...extra(i),
  }));
}

export const getRowId = (r: Row) => r.id;

/** The bulk-grid §9 Sheet: Title | Price | Qty × 200 with 5 `'`/`&` titles, 3 comma decimals, 2 bad prices, 1 long title. */
export function acceptanceSheet(): string {
  const lines: string[] = [];
  for (let i = 0; i < 200; i += 1) {
    let title = `New title ${i + 1}`;
    if (i < 5) title = `Mom's Gift & Keepsake ${i + 1}`;
    if (i === 10) title = 'x'.repeat(141);
    let price = `${20 + i}.99`;
    if (i >= 20 && i < 23) price = '12,50';
    if (i === 30) price = '0.10';
    if (i === 31) price = 'abc';
    lines.push([title, price, String(i % 100)].join('\t'));
  }
  return `${lines.join('\r\n')}\r\n`;
}
