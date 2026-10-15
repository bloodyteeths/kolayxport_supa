/**
 * Wix product writes that the single PATCH cannot do: collection membership
 * and media (marketplace-editors §6.2, §7.2). Used by the `/api/wix/products`
 * action blocks and importable by the catalog-draft Wix executor (M6b-A).
 * Server-only (calls the Wix client), but no Prisma and no Next imports.
 */
import {
  WIX_ALL_PRODUCTS_COLLECTION_ID,
  wixProductMediaIds,
  type WixApiClient,
  type WixProductMediaInput,
} from './wixClient';
import {
  failResult,
  isPublicHttpsUrl,
  okResult,
  opCodeOfError,
  skippedResult,
  sortByIndex,
  type ProductOpResult,
} from './productOpResults';

/** Product media cap for the editor in v1 (marketplace-editors §3 row 1). */
export const WIX_MEDIA_MAX = 15;
/** Max collections changed per request. */
export const WIX_COLLECTIONS_MAX = 50;

/** `fieldPatch.media` entries (marketplace-editors §6.2). */
export type WixMediaOp =
  | { op: 'add'; url: string }
  /** Re-attach a file already in the site's Media Manager (not in the staged v2 key; API only). */
  | { op: 'add'; mediaId: string }
  | { op: 'remove'; mediaId: string }
  | { op: 'reorder'; ids: string[] };

/** Parse result; `code` is set when a URL was the problem (else the caller uses INVALID_INPUT). */
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; code?: 'INVALID_URL' };

function isId(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= 200;
}

/** Validate a list of ids (collection or media ids). */
export function parseIdList(raw: unknown, max: number): Parsed<string[]> {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'Expected a non-empty id list' };
  if (raw.length > max) return { ok: false, error: `At most ${max} ids` };
  const out: string[] = [];
  for (const v of raw) {
    if (!isId(v)) return { ok: false, error: 'Invalid id' };
    const id = v.trim();
    if (!out.includes(id)) out.push(id);
  }
  return { ok: true, value: out };
}

/** Validate `media_add` items: `{ url }` (public https) or `{ mediaId }`. */
export function parseWixMediaInputs(raw: unknown): Parsed<WixProductMediaInput[]> {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'Expected a non-empty media list' };
  if (raw.length > WIX_MEDIA_MAX) return { ok: false, error: `At most ${WIX_MEDIA_MAX} media items` };
  const out: WixProductMediaInput[] = [];
  for (const m of raw) {
    if (m && typeof m === 'object' && isId((m as any).mediaId)) out.push({ mediaId: String((m as any).mediaId).trim() });
    else if (m && typeof m === 'object' && isPublicHttpsUrl((m as any).url)) out.push({ url: (m as any).url });
    else return { ok: false, error: 'Each media item needs a public https url or a mediaId', code: 'INVALID_URL' };
  }
  return { ok: true, value: out };
}

/** Validate the staged `fieldPatch.media` op list. */
export function parseWixMediaOps(raw: unknown): Parsed<WixMediaOp[]> {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'Expected a non-empty op list' };
  if (raw.length > 100) return { ok: false, error: 'At most 100 media ops' };
  const out: WixMediaOp[] = [];
  for (const o of raw) {
    const op = o && typeof o === 'object' ? (o as any).op : undefined;
    if (op === 'add' && isPublicHttpsUrl((o as any).url)) out.push({ op: 'add', url: (o as any).url });
    else if (op === 'add' && (o as any).url === undefined && isId((o as any).mediaId)) out.push({ op: 'add', mediaId: String((o as any).mediaId).trim() });
    else if (op === 'remove' && isId((o as any).mediaId)) out.push({ op: 'remove', mediaId: String((o as any).mediaId).trim() });
    else if (op === 'reorder') {
      const ids = parseIdList((o as any).ids, 500);
      if (!ids.ok) return { ok: false, error: `reorder: ${ids.error}` };
      out.push({ op: 'reorder', ids: ids.value });
    } else if (op === 'add') return { ok: false, error: 'add needs a public https url', code: 'INVALID_URL' };
    else return { ok: false, error: 'Unknown or invalid media op' };
  }
  return { ok: true, value: out };
}

/**
 * Collection target set → what to add and remove. The automatic "All
 * products" collection is never added or removed.
 */
export function diffCollectionIds(current: unknown, target: string[]): { add: string[]; remove: string[] } {
  const cur = Array.isArray(current) ? current.filter((v): v is string => typeof v === 'string') : [];
  const tgt = Array.from(new Set(target));
  const keep = (id: string) => id !== WIX_ALL_PRODUCTS_COLLECTION_ID;
  return {
    add: tgt.filter((id) => keep(id) && !cur.includes(id)),
    remove: cur.filter((id) => keep(id) && !tgt.includes(id)),
  };
}

/**
 * Add or remove one product to/from each collection. One call per collection;
 * a failure on one collection does not stop the others.
 */
export async function applyWixCollectionChange(
  client: WixApiClient,
  productId: string,
  mode: 'add' | 'remove',
  collectionIds: string[],
): Promise<ProductOpResult[]> {
  const results: ProductOpResult[] = [];
  for (let i = 0; i < collectionIds.length; i++) {
    const cid = collectionIds[i];
    if (cid === WIX_ALL_PRODUCTS_COLLECTION_ID) {
      results.push(failResult(i, mode, 'COLLECTION_PROTECTED', cid));
      continue;
    }
    try {
      if (mode === 'add') await client.addProductsToCollection(cid, [productId]);
      else await client.removeProductsFromCollection(cid, [productId]);
      results.push(okResult(i, mode, cid));
    } catch (err) {
      results.push(failResult(i, mode, opCodeOfError(err), cid));
    }
  }
  return results;
}

/**
 * Apply staged media ops in a safe order: removes, then adds, then the latest
 * reorder. Ids that are no longer on the product are skipped (not failed);
 * duplicate removes are ignored; a reorder keeps only ids still present and
 * appends media it does not mention (e.g. just added) in their current order.
 * Capacity (`WIX_MEDIA_MAX`) is checked before any add, counting only the
 * removes that succeeded. A reorder refused for choice-linked media fails with
 * `MEDIA_CHOICE_LINKED` (nothing written); a reorder whose restore failed
 * fails with `MEDIA_RESTORE_FAILED` (params carry the original media ids).
 */
export async function applyWixMediaOps(
  client: WixApiClient,
  productId: string,
  ops: WixMediaOp[],
): Promise<{ results: ProductOpResult[]; mediaIds: string[] }> {
  const results: ProductOpResult[] = [];
  const product = await client.getProduct(productId);
  const current = wixProductMediaIds(product);

  const removeIdx: number[] = [];
  const removeIds: string[] = [];
  const addIdx: number[] = [];
  let reorderIdx = -1;
  ops.forEach((op, i) => {
    if (op.op === 'remove') {
      if (!current.includes(op.mediaId)) results.push(skippedResult(i, 'remove', 'NOT_FOUND', op.mediaId));
      else if (removeIds.includes(op.mediaId)) results.push(okResult(i, 'remove', op.mediaId, { skipped: true }));
      else {
        removeIds.push(op.mediaId);
        removeIdx.push(i);
      }
    } else if (op.op === 'add') addIdx.push(i);
    else {
      if (reorderIdx >= 0) results.push(okResult(reorderIdx, 'reorder', undefined, { skipped: true }));
      reorderIdx = i;
    }
  });

  // Capacity counts only removes that actually succeeded (a failed remove
  // leaves its media on the product), so it is worked out after the remove.
  let removed = 0;
  if (removeIds.length) {
    try {
      await client.removeProductMedia(productId, removeIds);
      removed = removeIds.length;
      removeIdx.forEach((i, k) => results.push(okResult(i, 'remove', removeIds[k])));
    } catch (err) {
      const code = opCodeOfError(err);
      removeIdx.forEach((i, k) => results.push(failResult(i, 'remove', code, removeIds[k])));
    }
  }

  const room = Math.max(0, WIX_MEDIA_MAX - (current.length - removed));
  const addsAllowed = addIdx.slice(0, room);
  for (const i of addIdx.slice(room)) results.push(failResult(i, 'add', 'TOO_MANY', undefined, { max: WIX_MEDIA_MAX }));

  if (addsAllowed.length) {
    const media: WixProductMediaInput[] = addsAllowed.map((i) => {
      const a = ops[i] as Extract<WixMediaOp, { op: 'add' }>;
      return 'url' in a ? { url: a.url } : { mediaId: a.mediaId };
    });
    try {
      await client.addProductMedia(productId, media);
      addsAllowed.forEach((i, k) => results.push(okResult(i, 'add', 'mediaId' in media[k] ? (media[k] as { mediaId: string }).mediaId : undefined)));
    } catch (err) {
      const code = opCodeOfError(err);
      addsAllowed.forEach((i, k) => results.push(failResult(i, 'add', code, 'mediaId' in media[k] ? (media[k] as { mediaId: string }).mediaId : undefined)));
    }
  }

  const changed = removed > 0 || addsAllowed.length > 0;
  let mediaIds = current;
  if (changed || reorderIdx >= 0) {
    try {
      mediaIds = wixProductMediaIds(await client.getProduct(productId));
    } catch {
      mediaIds = removed ? current.filter((id) => !removeIds.includes(id)) : current;
    }
  }

  if (reorderIdx >= 0) {
    const wanted = (ops[reorderIdx] as { ids: string[] }).ids.filter((id) => mediaIds.includes(id));
    const order = [...wanted, ...mediaIds.filter((id) => !wanted.includes(id))];
    if (order.every((id, k) => id === mediaIds[k])) {
      results.push(okResult(reorderIdx, 'reorder', undefined, { skipped: true }));
    } else {
      try {
        const r = await client.reorderProductMedia(productId, order);
        mediaIds = r.order;
        results.push(okResult(reorderIdx, 'reorder'));
      } catch (err) {
        results.push(failResult(reorderIdx, 'reorder', opCodeOfError(err), undefined, (err as any)?.params));
      }
    }
  }

  return { results: sortByIndex(results), mediaIds };
}
