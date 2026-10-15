/**
 * Shopify product image writes over the existing REST client methods
 * (`getProductImages`, `createProductImage`, `updateProductImage`,
 * `deleteProductImage`). Used by `/api/shopify/products?action=images` and
 * importable by the catalog-draft Shopify executor (M6b-A) for the staged
 * `fieldPatch.images` ops (marketplace-editors §6.3).
 * Server-only (calls the client), but no Prisma and no Next imports.
 */
import type { ShopifyClient } from './shopifyClient';
import {
  failResult,
  isPublicHttpsUrl,
  okResult,
  opCodeOfError,
  skippedResult,
  sortByIndex,
  type ProductOpResult,
} from './productOpResults';

/** Shopify's per-product image limit. */
export const SHOPIFY_IMAGES_MAX = 250;
export const SHOPIFY_ALT_MAX = 512;
/** Base64 characters per attachment (the route's body limit is 4 MB). */
export const SHOPIFY_ATTACHMENT_MAX_CHARS = 3_500_000;
export const SHOPIFY_IMAGE_OPS_MAX = 100;

export type ShopifyImageAdd = { op: 'add'; src?: string; attachment?: string; filename?: string; alt?: string; position?: number };
export type ShopifyImageOp =
  | ShopifyImageAdd
  | { op: 'delete'; id: string }
  | { op: 'reorder'; id: string; position: number }
  | { op: 'alt'; id: string; alt: string };

/** Parse result; `code` is set when a URL was the problem (else the caller uses INVALID_INPUT). */
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; code?: 'INVALID_URL' };

const isNumId = (v: unknown) => (typeof v === 'string' || typeof v === 'number') && /^\d{1,20}$/.test(String(v));
const isPos = (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= SHOPIFY_IMAGES_MAX;
const isAlt = (v: unknown) => typeof v === 'string' && v.length <= SHOPIFY_ALT_MAX;

/** Validate one image add (`src` xor `attachment`). Strips a `data:…;base64,` prefix. */
export function parseShopifyImageAdd(raw: any): Parsed<ShopifyImageAdd> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid image' };
  const hasSrc = raw.src !== undefined && raw.src !== null && raw.src !== '';
  const hasAtt = raw.attachment !== undefined && raw.attachment !== null && raw.attachment !== '';
  if (hasSrc === hasAtt) return { ok: false, error: 'Give either src or attachment' };
  const add: ShopifyImageAdd = { op: 'add' };
  if (hasSrc) {
    if (!isPublicHttpsUrl(raw.src)) return { ok: false, error: 'src must be a public https url', code: 'INVALID_URL' };
    add.src = raw.src;
  } else {
    if (typeof raw.attachment !== 'string') return { ok: false, error: 'attachment must be base64' };
    const b64 = raw.attachment.replace(/^data:[\w/+.-]+;base64,/, '').replace(/\s+/g, '');
    if (!b64 || b64.length > SHOPIFY_ATTACHMENT_MAX_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
      return { ok: false, error: 'attachment must be base64 (max ~2.5 MB)' };
    }
    add.attachment = b64;
    if (raw.filename !== undefined) {
      if (typeof raw.filename !== 'string' || !/^[\w.\- ]{1,255}$/.test(raw.filename)) return { ok: false, error: 'Invalid filename' };
      add.filename = raw.filename;
    }
  }
  if (raw.alt !== undefined) {
    if (!isAlt(raw.alt)) return { ok: false, error: `alt is at most ${SHOPIFY_ALT_MAX} characters` };
    add.alt = raw.alt;
  }
  if (raw.position !== undefined) {
    if (!isPos(raw.position)) return { ok: false, error: 'Invalid position' };
    add.position = raw.position;
  }
  return { ok: true, value: add };
}

/** Validate the staged `fieldPatch.images` op list. */
export function parseShopifyImageOps(raw: unknown): Parsed<ShopifyImageOp[]> {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'Expected a non-empty op list' };
  if (raw.length > SHOPIFY_IMAGE_OPS_MAX) return { ok: false, error: `At most ${SHOPIFY_IMAGE_OPS_MAX} image ops` };
  const out: ShopifyImageOp[] = [];
  for (let i = 0; i < raw.length; i++) {
    const o: any = raw[i];
    const op = o && typeof o === 'object' ? o.op : undefined;
    if (op === 'add') {
      const a = parseShopifyImageAdd(o);
      if (!a.ok) return { ok: false, error: `ops[${i}]: ${a.error}`, ...(a.code ? { code: a.code } : {}) };
      out.push(a.value);
    } else if (op === 'delete' && isNumId(o.id)) out.push({ op: 'delete', id: String(o.id) });
    else if (op === 'reorder' && isNumId(o.id) && isPos(o.position)) out.push({ op: 'reorder', id: String(o.id), position: o.position });
    else if (op === 'alt' && isNumId(o.id) && isAlt(o.alt)) out.push({ op: 'alt', id: String(o.id), alt: o.alt });
    else return { ok: false, error: `ops[${i}]: unknown or invalid image op` };
  }
  return { ok: true, value: out };
}

/**
 * Apply image ops against the live image list:
 * deletes → adds → alt/position updates (one PUT per image, ascending target
 * position so Shopify's shifting lands every image where it was asked).
 * Ids not on the product are skipped, duplicate deletes ignored, and only the
 * latest alt and latest position per image are written. Each write is
 * independent: one failure never stops the rest. Capacity is checked after the deletes,
 * counting only the deletes that succeeded.
 */
export async function applyShopifyImageOps(
  client: ShopifyClient,
  productId: string,
  ops: ShopifyImageOp[],
): Promise<{ results: ProductOpResult[]; images: any[] }> {
  const results: ProductOpResult[] = [];
  const live = await client.getProductImages(productId);
  const liveIds = live.map((img: any) => String(img.id));

  const deletes: { i: number; id: string }[] = [];
  const adds: { i: number; add: ShopifyImageAdd }[] = [];
  const updates = new Map<string, { alt?: { i: number; v: string }; pos?: { i: number; v: number } }>();

  ops.forEach((op, i) => {
    if (op.op === 'add') {
      adds.push({ i, add: op });
      return;
    }
    if (!liveIds.includes(op.id)) {
      results.push(skippedResult(i, op.op, 'NOT_FOUND', op.id));
      return;
    }
    if (op.op === 'delete') {
      if (deletes.some((d) => d.id === op.id)) results.push(okResult(i, 'delete', op.id, { skipped: true }));
      else deletes.push({ i, id: op.id });
      return;
    }
    const u = updates.get(op.id) || {};
    if (op.op === 'alt') {
      if (u.alt) results.push(okResult(u.alt.i, 'alt', op.id, { skipped: true }));
      u.alt = { i, v: op.alt };
    } else {
      if (u.pos) results.push(okResult(u.pos.i, 'reorder', op.id, { skipped: true }));
      u.pos = { i, v: op.position };
    }
    updates.set(op.id, u);
  });

  // An image that is being deleted needs no alt/position update.
  for (const d of deletes) {
    const u = updates.get(d.id);
    if (!u) continue;
    if (u.alt) results.push(okResult(u.alt.i, 'alt', d.id, { skipped: true }));
    if (u.pos) results.push(okResult(u.pos.i, 'reorder', d.id, { skipped: true }));
    updates.delete(d.id);
  }

  // Capacity counts only deletes that actually succeeded.
  let deleted = 0;
  for (const d of deletes) {
    try {
      await client.deleteProductImage(productId, d.id);
      deleted++;
      results.push(okResult(d.i, 'delete', d.id));
    } catch (err) {
      results.push(failResult(d.i, 'delete', opCodeOfError(err), d.id));
    }
  }

  const room = Math.max(0, SHOPIFY_IMAGES_MAX - (liveIds.length - deleted));
  for (const a of adds.slice(room)) results.push(failResult(a.i, 'add', 'TOO_MANY', undefined, { max: SHOPIFY_IMAGES_MAX }));

  for (const a of adds.slice(0, room)) {
    const image = {
      ...(a.add.src !== undefined ? { src: a.add.src } : {}),
      ...(a.add.attachment !== undefined ? { attachment: a.add.attachment } : {}),
      ...(a.add.filename !== undefined ? { filename: a.add.filename } : {}),
      ...(a.add.alt !== undefined ? { alt: a.add.alt } : {}),
      ...(a.add.position !== undefined ? { position: a.add.position } : {}),
    };
    try {
      const created = await client.createProductImage(productId, image);
      results.push(okResult(a.i, 'add', created?.id != null ? String(created.id) : undefined));
    } catch (err) {
      results.push(failResult(a.i, 'add', opCodeOfError(err)));
    }
  }

  const ordered = Array.from(updates.entries()).sort(
    ([, x], [, y]) => (x.pos?.v ?? Number.MAX_SAFE_INTEGER) - (y.pos?.v ?? Number.MAX_SAFE_INTEGER),
  );
  for (const [id, u] of ordered) {
    const body: { alt?: string; position?: number } = {};
    if (u.alt) body.alt = u.alt.v;
    if (u.pos) body.position = u.pos.v;
    try {
      await client.updateProductImage(productId, id, body);
      if (u.alt) results.push(okResult(u.alt.i, 'alt', id));
      if (u.pos) results.push(okResult(u.pos.i, 'reorder', id));
    } catch (err) {
      const code = opCodeOfError(err);
      if (u.alt) results.push(failResult(u.alt.i, 'alt', code, id));
      if (u.pos) results.push(failResult(u.pos.i, 'reorder', code, id));
    }
  }

  let images = live;
  if (deletes.length || adds.length || updates.size) {
    try {
      images = await client.getProductImages(productId);
    } catch {
      /* the caller re-reads on the next pull */
    }
  }
  return { results: sortByIndex(results), images };
}
