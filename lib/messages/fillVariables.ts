// lib/messages/fillVariables.ts — messages §2.4 / §6.4 (group G3). Saved replies store `{customer}`,
// `{product}` and `{order}` literally; they are filled on the client when a reply is inserted.
// A variable without data stays as the literal token, and the composer blocks Send with
// "Replace {order} before sending" (G6 uses `findUnfilledTokens`). Pure, unit-tested.

export const SAVED_REPLY_VARIABLES = ['customer', 'product', 'order'] as const;
export type SavedReplyVariable = (typeof SAVED_REPLY_VARIABLES)[number];

/**
 * What the open thread knows. G6 builds it:
 * - `customerName`: `UnifiedConversation.customerName` (empty → `{customer}` stays unfilled)
 * - `productTitle`: Trendyol `productInfo.title`; Wix the first item name of the newest order
 * - `orderNumber`: Wix newest order number (`orderContext[0].orderNumber` or `orderRef`)
 */
export interface FillContext {
  customerName?: string | null;
  productTitle?: string | null;
  orderNumber?: string | null;
}

export interface FillResult {
  text: string;
  /** Variables that had no data and stay as `{token}` in `text` (deduplicated, in first-seen order). */
  unfilled: SavedReplyVariable[];
}

const TOKEN_RE = /\{(customer|product|order)\}/g;

export function tokenOf(v: SavedReplyVariable): string {
  return `{${v}}`;
}

/** First name for `{customer}`: the first word of the display name ("Mehmet Y." → "Mehmet"). */
export function firstName(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  if (!n) return '';
  return n.split(/\s+/)[0];
}

function valueFor(v: SavedReplyVariable, ctx: FillContext): string {
  if (v === 'customer') return firstName(ctx.customerName);
  if (v === 'product') return (ctx.productTitle ?? '').trim();
  const order = (ctx.orderNumber ?? '').trim();
  return order ? (order.startsWith('#') ? order : `#${order}`) : '';
}

export function fillVariables(body: string, ctx: FillContext): FillResult {
  const unfilled: SavedReplyVariable[] = [];
  const text = body.replace(TOKEN_RE, (match, name: SavedReplyVariable) => {
    const value = valueFor(name, ctx);
    if (value) return value;
    if (!unfilled.includes(name)) unfilled.push(name);
    return match;
  });
  return { text, unfilled };
}

/** Tokens still in the composer text, e.g. `['{order}']` (for the send-time check). */
export function findUnfilledTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN_RE)) if (!out.includes(m[0])) out.push(m[0]);
  return out;
}

/**
 * Inserts `insert` into `current` at the selection. Without a selection (or with the caret at the end of
 * non-empty text) it appends on a new line, so a saved reply never glues onto the last word.
 * Returns the new text and the caret position after the inserted text.
 */
export function insertAtCaret(
  current: string,
  insert: string,
  selectionStart?: number | null,
  selectionEnd?: number | null,
  opts: { newLineWhenAppending?: boolean } = {},
): { text: string; caret: number } {
  const newLine = opts.newLineWhenAppending ?? true;
  const hasSel = typeof selectionStart === 'number' && selectionStart >= 0 && selectionStart <= current.length;
  if (!hasSel || (newLine && selectionStart === current.length && selectionEnd === current.length)) {
    if (!current) return { text: insert, caret: insert.length };
    const sep = !newLine || current.endsWith('\n') ? '' : '\n';
    const text = `${current}${sep}${insert}`;
    return { text, caret: text.length };
  }
  const start = selectionStart as number;
  const end = typeof selectionEnd === 'number' && selectionEnd >= start ? Math.min(selectionEnd, current.length) : start;
  const text = current.slice(0, start) + insert + current.slice(end);
  return { text, caret: start + insert.length };
}
