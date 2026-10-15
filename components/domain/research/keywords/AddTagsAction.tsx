// components/domain/research/keywords/AddTagsAction.tsx (research R2-B) — the Keyword explorer's three writes
// (research.md §3.4, §6.1). All of them write into KolayXport only:
//
//   tags  "Add N tags to…"  listing picker (own listings; `?listing` preselected) → current LIVE tags (export) →
//         mergeTagInput rules (13 × 20, no near-duplicates, no title-word overlap; tagMerge.ts) → over 13 → "Only 2 of
//         5 fit (13-tag limit). Replace weaker tags?" with the current tags weakest first (Top-48 use ascending) →
//         STAGED draft (listings staging adapter). Etsy: the added tags are auto-tracked (`checkNow: false`).
//   title "Add to title"    picker → current title → planTitleAdd (whole phrases, ≤ 140 Etsy / 80 eBay) → preview →
//         STAGED draft.
//   track "Track"           picker (Etsy) → POST /api/research/keywords/track (KolayXport rank rows; Etsy is only
//         read).
//
// Never sent: the toast says "Not sent yet" and its "Open" goes to the listings page's not-sent view, where
// "Send N changes to Etsy" picks the draft up.
import * as React from 'react';
import { useRouter } from 'next/router';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ds/overlay/Modal';
import { Combobox, type ComboboxOption } from '@/components/ds/inputs/Combobox';
import { FormField } from '@/components/ds/inputs/FormField';
import { Checkbox } from '@/components/ds/inputs/Checkbox';
import { Thumb } from '@/components/ds/data/Thumb';
import { useToast } from '@/components/ds/feedback/toast';
import { neutral } from '@/lib/ds/tokens';
import { readListingsCsv } from '@/lib/listings/csvImport';
import type { ListingRow, ListingsResponse } from '@/lib/listings/types';
import { createStagingAdapter } from '@/components/domain/listings/useStagedChanges';
import { stageBlockReason, type StageBlock } from '@/components/domain/research/products/StageToListingModal';
import { applyReplace, planTagAdd, weakestFirst } from '@/components/domain/research/products/tagMerge';
import { trackKeywords } from '@/lib/research/hooks/useKeywords';
import { TITLE_MAX, notSentHref, planTitleAdd, shorten, type TitlePlan } from './keywordModel';

export type KeywordActionMode = 'tags' | 'title' | 'track';

export type ListingTarget = { id: string; shopId: string; title?: string; thumbUrl?: string | null };

export type AddTagsActionProps = {
  open: boolean;
  onClose: () => void;
  mode: KeywordActionMode;
  mkt: 'etsy' | 'ebay';
  /** Selected keywords (English, lower-case as the pool returns them). */
  keywords: string[];
  /** Top-48 share per keyword/tag (lower-cased) for "weakest first". */
  shares?: Record<string, number>;
  /** `?listing` (or the panel's listing): preselected in the picker. */
  preselected?: ListingTarget | null;
  /** After a successful write (clear the selection, revalidate). */
  onDone?: (r: { mode: KeywordActionMode; listingId: string; count: number }) => void;
  /** Etsy: auto-track the tags added from here (spec §6.1). Default true. */
  autoTrack?: boolean;
};

type Picked = { row: ListingRow | null; id: string; shopId: string; title: string; thumbUrl: string | null };

/** Why a listing can't take this change (`research.picker.*`), or null. Title adds a "staged title" rule. Pure. */
export function keywordBlockReason(row: Pick<ListingRow, 'price' | 'editable' | 'sync'>, mode: KeywordActionMode): StageBlock | { key: 'stagedTitle' } | null {
  if (mode === 'track') return null;
  if (mode === 'title') {
    const sync = row.sync;
    if (sync?.status === 'syncing') return { key: 'syncing' };
    if (sync?.status === 'conflict') return { key: 'conflict' };
    if (sync?.queuedDelete) return { key: 'queuedDelete' };
    if (sync?.changedFields?.includes('title')) return { key: 'stagedTitle' };
    return null;
  }
  return stageBlockReason(row, { kind: 'tags', tags: [], shares: {} });
}

async function fetchListingRows(mkt: 'etsy' | 'ebay', q: string, store?: string): Promise<{ rows: ListingRow[]; storeId: string; stores: string[] }> {
  const sp = new URLSearchParams({ marketplace: mkt });
  if (q.trim()) sp.set('q', q.trim());
  if (store) sp.set('store', store);
  const res = await fetch(`/api/listings?${sp.toString()}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`listings ${res.status}`);
  const body = (await res.json()) as ListingsResponse;
  return { rows: body.rows ?? [], storeId: body.store?.id ?? '', stores: (body.stores ?? []).map((s) => s.id).filter(Boolean) };
}

/**
 * The user's own listings across EVERY connected shop: `/api/listings` without `store` only covers the default shop,
 * so the other shops in `body.stores` are queried too, and each row carries the shop it came from. Pure fetch; a shop
 * whose query fails is skipped (the default shop's failure throws).
 */
export async function fetchOwnListings(mkt: 'etsy' | 'ebay', q: string): Promise<{ row: ListingRow; shopId: string }[]> {
  const first = await fetchListingRows(mkt, q);
  const out = first.rows.map((row) => ({ row, shopId: first.storeId }));
  const others = first.stores.filter((id) => id !== first.storeId);
  if (!others.length) return out;
  const rest = await Promise.all(
    others.map((store) =>
      fetchListingRows(mkt, q, store)
        .then((r) => r.rows.map((row) => ({ row, shopId: r.storeId || store })))
        .catch(() => [] as { row: ListingRow; shopId: string }[]),
    ),
  );
  return out.concat(...rest);
}

/** The listing's LIVE tags + title from the export, or null when the export doesn't have it (never stage from empty state). */
async function fetchCurrent(mkt: 'etsy' | 'ebay', p: Picked): Promise<{ tags: string[]; title: string } | null> {
  const sp = new URLSearchParams({ marketplace: mkt, ids: p.id });
  if (p.shopId) sp.set('store', p.shopId);
  const res = await fetch(`/api/listings/export?${sp.toString()}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`export ${res.status}`);
  const cur = readListingsCsv(await res.text()).get(p.id);
  if (!cur) return null;
  const title = cur.title || p.row?.title || '';
  if (!title) return null;
  return { tags: cur.tags ?? [], title };
}

type Step =
  | { kind: 'pick' }
  | { kind: 'replace'; picked: Picked; current: string[]; add: string[]; need: number; remove: string[] }
  | { kind: 'title'; picked: Picked; plan: TitlePlan; current: string };

export function AddTagsAction({ open, onClose, mode, mkt, keywords, shares = {}, preselected, onDone, autoTrack = true }: AddTagsActionProps) {
  const t = useTranslations('research');
  const toast = useToast();
  const router = useRouter();
  const rowsRef = React.useRef(new Map<string, Picked>());
  const [value, setValue] = React.useState<ComboboxOption | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState<string | null>(null);
  const [step, setStep] = React.useState<Step>({ kind: 'pick' });

  // Seed the picker ONCE per open (or when the preselected listing itself changes): the parent re-renders on every
  // progressive poll, and re-seeding then would silently replace the listing the user picked.
  const preRef = React.useRef(preselected);
  preRef.current = preselected;
  const preId = preselected?.id ?? null;
  React.useEffect(() => {
    if (!open) {
      setValue(null);
      setStep({ kind: 'pick' });
      setFailed(null);
      setBusy(false);
      return;
    }
    const pre = preRef.current;
    if (pre && pre.id === preId) {
      const p: Picked = { row: null, id: pre.id, shopId: pre.shopId, title: pre.title ?? pre.id, thumbUrl: pre.thumbUrl ?? null };
      rowsRef.current.set(p.id, p);
      setValue({ value: p.id, label: p.title, leading: <Thumb src={p.thumbUrl} alt="" size={32} /> });
    }
  }, [open, preId]);

  const reasonText = React.useCallback((b: { key: string; params?: Record<string, string> }) => t(`picker.${b.key}`, b.params), [t]);

  const loadOptions = React.useCallback(
    async (query: string): Promise<ComboboxOption[]> => {
      const found = await fetchOwnListings(mkt, query);
      return found.map(({ row, shopId }) => {
        rowsRef.current.set(row.id, { row, id: row.id, shopId, title: row.title, thumbUrl: row.thumbUrl });
        const block = keywordBlockReason(row, mode);
        return {
          value: row.id,
          label: row.title,
          description: block ? reasonText(block) : undefined,
          leading: <Thumb src={row.thumbUrl} alt="" size={32} />,
          disabled: Boolean(block),
        };
      });
    },
    [mkt, mode, reasonText],
  );

  const openListings = () => void router.push(notSentHref(mkt));

  /** Re-check a preselected listing (its row was never loaded) before writing. */
  const ensureRow = async (p: Picked): Promise<Picked> => {
    if (p.row) return p;
    try {
      // No shop known (`?listing` without `shop`): look in every connected shop, not only the default one.
      const hit = p.shopId
        ? await fetchListingRows(mkt, p.id, p.shopId).then((r) => {
            const row = r.rows.find((x) => x.id === p.id);
            return row ? { row, shopId: p.shopId || r.storeId } : undefined;
          })
        : (await fetchOwnListings(mkt, p.id)).find((x) => x.row.id === p.id);
      const row = hit?.row ?? null;
      return { ...p, row, shopId: p.shopId || hit?.shopId || '', title: row?.title ?? p.title, thumbUrl: row?.thumbUrl ?? p.thumbUrl };
    } catch {
      return p;
    }
  };

  const stage = async (p: Picked, patch: { tags?: string[]; title?: string }) => {
    const adapter = createStagingAdapter(mkt, { marketplace: mkt, storeId: p.shopId || null, currencyOf: () => p.row?.price?.currency });
    await adapter.stage(p.id, patch);
  };

  const finishTags = async (p: Picked, final: string[], added: string[]) => {
    await stage(p, { tags: final });
    let tracked = false;
    if (mkt === 'etsy' && autoTrack && added.length && p.shopId) {
      try {
        const r = await trackKeywords({ listingId: p.id, shopId: p.shopId, keywords: added.slice(0, 13), listingTitle: p.title, checkNow: false });
        tracked = r.data.tracked > 0;
      } catch {
        tracked = false; // tracking is a bonus; the staged tags are what matter
      }
    }
    const msg = tracked ? t('kw.tagsAddedTracked', { count: added.length, title: shorten(p.title) }) : t('toast.tagsAdded', { count: added.length, title: shorten(p.title) });
    toast.info(msg, { action: { label: t('toast.open'), onClick: openListings } });
    onDone?.({ mode: 'tags', listingId: p.id, count: added.length });
    onClose();
  };

  const onPrimary = async () => {
    setFailed(null);
    setBusy(true);
    try {
      if (step.kind === 'replace') {
        await finishTags(step.picked, applyReplace(step.current, step.add, step.remove), step.add);
        return;
      }
      if (step.kind === 'title') {
        await stage(step.picked, { title: step.plan.title });
        toast.info(t('kw.titleStaged', { count: step.plan.added.length, title: shorten(step.picked.title) }), { action: { label: t('toast.open'), onClick: openListings } });
        onDone?.({ mode: 'title', listingId: step.picked.id, count: step.plan.added.length });
        onClose();
        return;
      }
      const raw = value ? rowsRef.current.get(value.value) : undefined;
      if (!raw) return;
      const picked = await ensureRow(raw);
      // A listing we couldn't resolve has no known sync state: never stage on it blind (the block checks need the row).
      if (!picked.row && mode !== 'track') {
        setFailed(t('kw.listingNotFound'));
        return;
      }
      const block = picked.row ? keywordBlockReason(picked.row, mode) : null;
      if (block) {
        setFailed(reasonText(block));
        return;
      }
      if (mode === 'track') {
        if (!picked.shopId) {
          setFailed(t('toast.stageFailed'));
          return;
        }
        const r = await trackKeywords({ listingId: picked.id, shopId: picked.shopId, keywords: keywords.slice(0, 13), listingTitle: picked.title });
        toast.info(t('kw.trackedToast', { count: r.data.tracked, title: shorten(picked.title) }));
        onDone?.({ mode: 'track', listingId: picked.id, count: r.data.tracked });
        onClose();
        return;
      }
      const cur = await fetchCurrent(mkt, picked);
      if (!cur) {
        // Missing from the export: staging from "no tags" would replace every live tag when sent.
        setFailed(t('kw.listingNotFound'));
        return;
      }
      if (mode === 'title') {
        const plan = planTitleAdd(cur.title, keywords, TITLE_MAX[mkt]);
        if (!plan.added.length) {
          setFailed(t('kw.titleNothingNew'));
          return;
        }
        setStep({ kind: 'title', picked: { ...picked, title: cur.title }, plan, current: cur.title });
        return;
      }
      const plan = planTagAdd(cur.tags, keywords, cur.title);
      if (plan.add.length === 0) {
        // Say why: a tag that repeats a title word is dropped by the tag rules, not "already there".
        const inTitle = plan.rejected.length > 0 && plan.rejected.every((r) => r.reason === 'title_overlap');
        toast.info(inTitle ? t('kw.tagsInTitle', { title: shorten(picked.title) }) : t('toast.tagsNothingNew', { title: shorten(picked.title) }));
        onClose();
        return;
      }
      if (plan.overflow > 0) {
        const order = weakestFirst(cur.tags, (tag) => shares[tag.toLowerCase()] ?? 0);
        setStep({ kind: 'replace', picked, current: cur.tags, add: plan.add, need: plan.overflow, remove: order.slice(0, plan.overflow) });
        return;
      }
      await finishTags(picked, plan.merged, plan.add);
    } catch {
      setFailed(mode === 'track' ? t('kw.trackFailed') : t('toast.stageFailed'));
    } finally {
      setBusy(false);
    }
  };

  const errorLine = failed ? (
    <Typography variant="caption" component="p" role="alert" sx={{ m: 0, mt: '8px', color: 'error.main' }} data-testid="kw-action-error">
      {failed}
    </Typography>
  ) : null;

  if (step.kind === 'replace') {
    const fits = step.add.length - step.need;
    const ok = step.remove.length >= step.need;
    const ordered = weakestFirst(step.current, (tag) => shares[tag.toLowerCase()] ?? 0);
    return (
      <Modal
        open={open}
        onClose={onClose}
        size="sm"
        title={t('tags.overLimit', { fit: Math.max(0, fits), count: step.add.length })}
        primary={{
          id: 'replace',
          label: t('tags.replaceCta', { count: step.remove.length }),
          onClick: () => void onPrimary(),
          loading: busy,
          disabled: !ok,
          disabledReason: ok ? undefined : t('tags.pickMore', { count: step.need }),
        }}
        data-testid="kw-replace-tags"
      >
        <Typography variant="caption" component="p" sx={{ m: 0, mb: '8px', color: neutral[600] }}>{t('kw.replaceHint')}</Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {ordered.map((tag) => (
            <Checkbox
              key={tag}
              label={tag}
              checked={step.remove.includes(tag)}
              onChange={(next) =>
                setStep((s) => (s.kind === 'replace' ? { ...s, remove: next ? [...s.remove, tag] : s.remove.filter((x) => x !== tag) } : s))
              }
            />
          ))}
        </Box>
        {errorLine}
      </Modal>
    );
  }

  if (step.kind === 'title') {
    const max = TITLE_MAX[mkt];
    return (
      <Modal
        open={open}
        onClose={onClose}
        size="md"
        title={t('kw.titlePreviewTitle')}
        description={t('picker.note')}
        primary={{ id: 'stage-title', label: t('kw.stageTitle'), onClick: () => void onPrimary(), loading: busy }}
        data-testid="kw-title-preview"
      >
        <Typography variant="caption" component="p" sx={{ m: 0, color: neutral[600] }}>{t('kw.titleNew', { count: step.plan.title.length, max })}</Typography>
        <Typography variant="body2" component="p" lang="en" sx={{ m: 0, mt: '4px', color: neutral[900] }} data-testid="kw-title-new">{step.plan.title}</Typography>
        {step.plan.skipped.length ? (
          <Typography variant="caption" component="p" sx={{ m: 0, mt: '8px', color: neutral[600] }}>
            {t('kw.titleSkipped', { list: step.plan.skipped.map((s) => s.keyword).join(', ') })}
          </Typography>
        ) : null}
        {errorLine}
      </Modal>
    );
  }

  const count = keywords.length;
  const title = mode === 'track' ? t('kw.trackTitle', { count }) : mode === 'title' ? t('action.addToTitle') : t('action.addTags', { count });
  const cta = mode === 'track' ? t('action.track') : mode === 'title' ? t('kw.previewTitle') : preselected ? t('action.addTagsThis', { count }) : t('kw.addTagsCta', { count });
  const pickedOk = Boolean(value && rowsRef.current.get(value.value));
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      description={mode === 'track' ? t('kw.trackNote') : t('picker.note')}
      primary={{
        id: `kw-${mode}`,
        label: cta,
        onClick: () => void onPrimary(),
        loading: busy,
        disabled: !pickedOk || count === 0,
        disabledReason: pickedOk ? (count === 0 ? t('kw.selectFirst') : undefined) : t('picker.pickFirst'),
      }}
      data-testid="kw-action-modal"
    >
      <FormField label={t('picker.label', { marketplace: mkt === 'ebay' ? 'eBay' : 'Etsy' })}>
        <Combobox value={value} onChange={setValue} loadOptions={loadOptions} placeholder={t('picker.placeholder')} noOptionsText={t('picker.none')} data-testid="kw-picker" />
      </FormField>
      <Typography variant="caption" component="p" lang="en" sx={{ m: 0, mt: '8px', color: neutral[600] }}>{keywords.join(', ')}</Typography>
      {mode === 'tags' && mkt === 'etsy' && autoTrack ? (
        <Typography variant="caption" component="p" sx={{ m: 0, mt: '4px', color: neutral[500] }}>{t('kw.autoTrackNote')}</Typography>
      ) : null}
      {errorLine}
    </Modal>
  );
}

export default AddTagsAction;
