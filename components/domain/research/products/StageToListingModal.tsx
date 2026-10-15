// "Use $49 in a listing" / "Add 5 tags to a listing…" (research.md §3.4): pick one of your listings (DB cache via
// GET /api/listings), then STAGE the change as a draft through the listings staging adapters (M5
// useStagedChanges: Etsy → stageEtsyDraft, eBay → stageEbayDraft). Never sent: the listings page's
// "Send N changes" picks it up. Variation listings cannot take one price ("Has variations: change prices in the
// editor"). Tags over the 13 limit → replace weaker tags (Modal step 2, weakest by top-48 use first).
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
import { useDsFormat } from '@/components/ds/data/fmt';
import { neutral } from '@/lib/ds/tokens';
import { readListingsCsv } from '@/lib/listings/csvImport';
import type { ListingRow, ListingsResponse } from '@/lib/listings/types';
import { createStagingAdapter } from '@/components/domain/listings/useStagedChanges';
import { applyReplace, planTagAdd, weakestFirst } from './tagMerge';

export type StageMode =
  | { kind: 'price'; amount: number; currency: string }
  | { kind: 'tags'; tags: string[]; /** top-48 share per tag (lower-cased key) for "weakest first". */ shares: Record<string, number> };

export type StageToListingModalProps = {
  open: boolean;
  onClose: () => void;
  mkt: 'etsy' | 'ebay';
  mode: StageMode;
};

type Picked = { row: ListingRow; storeId: string };

const LISTINGS_HREF: Record<'etsy' | 'ebay', string> = { etsy: '/app/etsy-listings?view=not_sent', ebay: '/app/ebay-listings?view=not_sent' };

/** Why a listing can't take this staged change (i18n key under `research.picker`), or null when it can. Pure. */
export type StageBlock = { key: 'variations' | 'priceLocked' | 'currencyMismatch' | 'syncing' | 'conflict' | 'queuedDelete' | 'stagedTags'; params?: Record<string, string> };

export function stageBlockReason(row: Pick<ListingRow, 'price' | 'editable' | 'sync'>, mode: StageMode): StageBlock | null {
  const sync = row.sync;
  // A draft being sent or in conflict must be resolved in Listings first; a queued deletion is never extended.
  if (sync?.status === 'syncing') return { key: 'syncing' };
  if (sync?.status === 'conflict') return { key: 'conflict' };
  if (sync?.queuedDelete) return { key: 'queuedDelete' };
  if (mode.kind === 'price') {
    if (row.editable?.reason === 'variations') return { key: 'variations' };
    if (row.editable && row.editable.price === false) return { key: 'priceLocked' };
    // Research prices are in the research currency; never stage them on a listing priced in another one.
    const listed = row.price?.currency?.trim().toUpperCase();
    const research = mode.currency.trim().toUpperCase();
    if (!listed || listed !== research) return { key: 'currencyMismatch', params: { listed: listed || '—', research } };
    return null;
  }
  // Tags are merged into the LIVE tags (export = live values only); an unsent tag edit would be overwritten.
  if (sync?.changedFields?.includes('tags')) return { key: 'stagedTags' };
  return null;
}

function shorten(s: string, n = 32) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function StageToListingModal({ open, onClose, mkt, mode }: StageToListingModalProps) {
  const t = useTranslations('research');
  const fmt = useDsFormat();
  const toast = useToast();
  const router = useRouter();
  const rowsRef = React.useRef(new Map<string, Picked>());
  const [value, setValue] = React.useState<ComboboxOption | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [replace, setReplace] = React.useState<{ picked: Picked; current: string[]; add: string[]; need: number; remove: string[] } | null>(null);

  React.useEffect(() => {
    if (!open) {
      setValue(null);
      setReplace(null);
      setFailed(false);
      setBusy(false);
    }
  }, [open]);

  const reasonText = React.useCallback((b: StageBlock) => t(`picker.${b.key}`, b.params), [t]);

  const loadOptions = React.useCallback(
    async (query: string): Promise<ComboboxOption[]> => {
      const sp = new URLSearchParams({ marketplace: mkt });
      if (query.trim()) sp.set('q', query.trim());
      const res = await fetch(`/api/listings?${sp.toString()}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`listings ${res.status}`);
      const body = (await res.json()) as ListingsResponse;
      const storeId = body.store?.id ?? '';
      return (body.rows ?? []).map((row) => {
        rowsRef.current.set(row.id, { row, storeId });
        const block = stageBlockReason(row, mode);
        return {
          value: row.id,
          label: row.title,
          description: block ? reasonText(block) : row.price ? fmt.money(row.price.amount, row.price.currency) : undefined,
          leading: <Thumb src={row.thumbUrl} alt="" size={32} />,
          disabled: Boolean(block),
        };
      });
    },
    [mkt, mode, reasonText, fmt],
  );

  const done = (title: string, count: number) => {
    const msg = mode.kind === 'price' ? t('toast.priceStaged', { price: fmt.money(mode.amount, mode.currency), title: shorten(title) }) : t('toast.tagsAdded', { count, title: shorten(title) });
    toast.info(msg, { action: { label: t('toast.open'), onClick: () => void router.push(LISTINGS_HREF[mkt]) } });
    onClose();
  };

  const stage = async (picked: Picked, patch: { price?: number; tags?: string[] }) => {
    const adapter = createStagingAdapter(mkt, {
      marketplace: mkt,
      storeId: picked.storeId || null,
      currencyOf: () => picked.row.price?.currency,
    });
    await adapter.stage(picked.row.id, patch);
  };

  const currentTags = async (picked: Picked): Promise<{ tags: string[]; title: string }> => {
    const sp = new URLSearchParams({ marketplace: mkt, ids: picked.row.id });
    if (picked.storeId) sp.set('store', picked.storeId);
    const res = await fetch(`/api/listings/export?${sp.toString()}`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`export ${res.status}`);
    const cur = readListingsCsv(await res.text()).get(picked.row.id);
    return { tags: cur?.tags ?? [], title: cur?.title || picked.row.title };
  };

  const onPrimary = async () => {
    setFailed(false);
    setBusy(true);
    try {
      if (replace) {
        const final = applyReplace(replace.current, replace.add, replace.remove);
        await stage(replace.picked, { tags: final });
        done(replace.picked.row.title, replace.add.length);
        return;
      }
      const picked = value ? rowsRef.current.get(value.value) : undefined;
      if (!picked) return;
      // Re-check at send time (the option list may be stale): never stage a cross-currency or blocked change.
      if (stageBlockReason(picked.row, mode)) {
        setFailed(true);
        return;
      }
      if (mode.kind === 'price') {
        await stage(picked, { price: mode.amount });
        done(picked.row.title, 1);
        return;
      }
      const cur = await currentTags(picked);
      const plan = planTagAdd(cur.tags, mode.tags, cur.title);
      if (plan.add.length === 0) {
        toast.info(t('toast.tagsNothingNew', { title: shorten(picked.row.title) }));
        onClose();
        return;
      }
      if (plan.overflow > 0) {
        const shareOf = (tag: string) => mode.shares[tag.toLowerCase()] ?? 0;
        const order = weakestFirst(cur.tags, shareOf);
        setReplace({ picked, current: cur.tags, add: plan.add, need: plan.overflow, remove: order.slice(0, plan.overflow) });
        return;
      }
      await stage(picked, { tags: plan.merged });
      done(picked.row.title, plan.add.length);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const count = mode.kind === 'tags' ? mode.tags.length : 0;
  const title = mode.kind === 'price' ? t('action.usePrice', { price: fmt.money(mode.amount, mode.currency) }) : t('action.addTags', { count });

  if (replace) {
    const fits = replace.add.length - replace.need;
    const ok = replace.remove.length >= replace.need;
    const ordered = weakestFirst(replace.current, (tag) => (mode.kind === 'tags' ? mode.shares[tag.toLowerCase()] ?? 0 : 0));
    return (
      <Modal
        open={open}
        onClose={onClose}
        size="sm"
        title={t('tags.overLimit', { fit: Math.max(0, fits), count: replace.add.length })}
        primary={{
          id: 'replace',
          label: t('tags.replaceCta', { count: replace.remove.length }),
          onClick: () => void onPrimary(),
          loading: busy,
          disabled: !ok,
          disabledReason: ok ? undefined : t('tags.pickMore', { count: replace.need }),
        }}
        data-testid="research-replace-tags"
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {ordered.map((tag) => {
            const checked = replace.remove.includes(tag);
            return (
              <Checkbox
                key={tag}
                label={tag}
                checked={checked}
                onChange={(next) =>
                  setReplace((r) => (r ? { ...r, remove: next ? [...r.remove, tag] : r.remove.filter((x) => x !== tag) } : r))
                }
              />
            );
          })}
          {failed ? <Typography variant="caption" sx={{ color: 'error.main' }}>{t('toast.stageFailed')}</Typography> : null}
        </Box>
      </Modal>
    );
  }

  const picked = value ? rowsRef.current.get(value.value) : undefined;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      description={t('picker.note')}
      primary={{
        id: 'stage',
        label: mode.kind === 'price' ? t('picker.ctaPrice') : t('action.addTagsThis', { count }),
        onClick: () => void onPrimary(),
        loading: busy,
        disabled: !picked,
        disabledReason: picked ? undefined : t('picker.pickFirst'),
      }}
      data-testid="research-stage-modal"
    >
      <FormField label={t('picker.label', { marketplace: mkt === 'ebay' ? 'eBay' : 'Etsy' })}>
        <Combobox value={value} onChange={setValue} loadOptions={loadOptions} placeholder={t('picker.placeholder')} noOptionsText={t('picker.none')} data-testid="research-picker" />
      </FormField>
      {mode.kind === 'tags' ? (
        <Typography variant="caption" component="p" sx={{ mt: '8px', color: neutral[600] }}>
          {mode.tags.join(', ')}
        </Typography>
      ) : null}
      {failed ? (
        <Typography variant="caption" component="p" sx={{ mt: '8px', color: 'error.main' }} role="alert">
          {t('toast.stageFailed')}
        </Typography>
      ) : null}
    </Modal>
  );
}

export default StageToListingModal;
