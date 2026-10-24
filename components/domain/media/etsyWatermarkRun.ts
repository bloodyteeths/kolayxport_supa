// components/domain/media/etsyWatermarkRun.ts — watermark / restore Etsy listings without Photo Studio (the listing
// editor on a phone, where Photo Studio shows "use a bigger screen"). Same plan and staging as Photo Studio:
// planOperation → server-rendered copies → staged upload at the slot + staged delete of the photo there, so nothing
// reaches Etsy until Send and "Geri al" works. Restore only replaces the photo we placed (server-side match).
import {
  DEFAULT_PLAN_INPUT,
  buildListingPhotoView,
  planOperation,
  type ListingPhotoView,
  type WatermarkOriginals,
} from '@/components/domain/photo-studio/studioModel';
import { fetchListingImages, fetchShopDrafts, stageBatchMedia, stageFile } from '@/components/domain/photo-studio/studioApi';
import { fetchWatermarkOriginal, listWatermarkOriginals, matchWatermarkOriginals, watermarkPhoto } from '@/lib/media/watermarkClient';
import type { WatermarkSpec } from '@/lib/media/watermarkSpec';

export type EtsyWatermarkResult = { staged: number; failed: number; changed: number; previewUrl: string | null };

async function loadViews(shopId: string, listingIds: string[]): Promise<Map<string, ListingPhotoView>> {
  const drafts = await fetchShopDrafts(shopId).catch(() => new Map());
  const views = new Map<string, ListingPhotoView>();
  for (const id of listingIds) {
    const imgs = await fetchListingImages(shopId, id).catch(() => null);
    if (imgs) views.set(id, buildListingPhotoView(imgs, drafts.get(id)));
  }
  return views;
}

/** The first photo the run would touch (dialog preview). */
export async function etsyWatermarkPreviewUrl(shopId: string, listingId: string): Promise<string | null> {
  const views = await loadViews(shopId, [listingId]);
  const plan = planOperation({ ...DEFAULT_PLAN_INPUT, op: 'watermark', wmAll: true }, [{ id: listingId, title: '' }], views);
  return plan.marks[0]?.refUrl ?? null;
}

/** spec = watermark every photo; null = restore the stored originals ("Filigranı kaldır"). */
export async function runEtsyWatermark(shopId: string, listingIds: string[], spec: WatermarkSpec | null): Promise<EtsyWatermarkResult> {
  const views = await loadViews(shopId, listingIds);
  const refs = listingIds.map((id) => ({ id, title: '' }));
  let originals: WatermarkOriginals = new Map();
  if (spec) {
    const rows = await listWatermarkOriginals('etsy', listingIds);
    originals = groupRows(rows);
  } else {
    const rows = await matchWatermarkOriginals('etsy', listingIds.map((id) => ({
      listingId: id,
      photos: (views.get(id)?.tiles ?? []).flatMap((t, i) => (t.imageId != null && !t.pending && t.src ? [{ imageId: t.imageId, rank: i + 1, url: t.src }] : [])),
    })));
    originals = groupRows(rows);
  }
  const plan = planOperation({ ...DEFAULT_PLAN_INPUT, op: spec ? 'watermark' : 'removeWatermark', wmAll: true }, refs, views, originals);
  let staged = 0;
  let failed = 0;
  const deletes = new Map<string, number[]>();
  for (const job of plan.marks) {
    try {
      const name = `${job.listingId}-${job.rank}`;
      const file = job.restore || !spec
        ? await fetchWatermarkOriginal(job.refUrl, name)
        : await watermarkPhoto(job.refUrl, spec, name, undefined, { origin: { marketplace: 'etsy', listingId: job.listingId, rank: job.rank } });
      await stageFile({ shopId, listingId: job.listingId, file, kind: 'image', operation: 'upload', rank: job.rank });
      deletes.set(job.listingId, [...(deletes.get(job.listingId) ?? []), job.targetImageId]);
      staged += 1;
    } catch {
      failed += 1;
    }
  }
  const items = Array.from(deletes, ([listingId, ids]) => ({ listingId, media: ids.map((id) => ({ kind: 'image' as const, operation: 'delete' as const, etsyMediaId: id })) }));
  if (items.length) await stageBatchMedia(shopId, items, () => undefined);
  const changed = plan.skipped.filter((s) => s.reason === 'photoChanged').length;
  return { staged, failed, changed, previewUrl: plan.marks[0]?.refUrl ?? null };
}

function groupRows(rows: { id: string; listingId: string; rank: number; match?: { imageId: number; rank: number } | null }[]): WatermarkOriginals {
  const m = new Map<string, { id: string; rank: number; match?: { imageId: number; rank: number } | null }[]>();
  for (const r of rows) m.set(r.listingId, [...(m.get(r.listingId) ?? []), { id: r.id, rank: r.rank, match: r.match }]);
  return m;
}
