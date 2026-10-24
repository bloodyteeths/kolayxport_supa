// components/domain/listings/bulk/AddTagsModal.tsx — listings-grid §6.3 "Add tags" (Modal sm).
// TagInput (Etsy 13 × 20 chars, Shopify unlimited) + Mode [Add · Remove · Replace all]. Preview "6 listings
// would go over 13 tags, so extra tags are not added". STAGES the full new tag list per listing.
// A listing whose current tags are unknown (`currentTags` returns null) is skipped and counted: staging a
// tag list without knowing the current one would silently replace the seller's tags. The current tags come
// from the export (live values only), so a listing whose open draft already edits tags is skipped and counted
// too: its staged tags would be overwritten by "live tags + new tags". Those are changed in the editor.
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Modal } from '@/components/ds/overlay/Modal';
import { FormField } from '@/components/ds/inputs/FormField';
import { RadioGroup } from '@/components/ds/inputs/RadioGroup';
import { TagInput } from '@/components/ds/inputs/TagInput';
import { Button } from '@/components/ds/inputs/Button';
import { neutral } from '@/lib/ds/tokens';
import type { ListingRow, StagePatch } from '@/lib/listings/types';
import type { ListingsT } from '../columns';
import { TemplateStepSaver } from './TemplateStepSaver';

export type TagMode = 'add' | 'remove' | 'replace';

const keyOf = (tag: string) => tag.trim().toLocaleLowerCase();

/** New tag list for one listing (pure, unit-tested). `overLimit` = some tags were not added because of `max`. */
export function applyTags(current: string[], tags: string[], mode: TagMode, max: number | null): { next: string[]; overLimit: boolean } {
  const clean = tags.map((t) => t.trim()).filter(Boolean);
  if (mode === 'remove') {
    const drop = new Set(clean.map(keyOf));
    return { next: current.filter((t) => !drop.has(keyOf(t))), overLimit: false };
  }
  const base = mode === 'replace' ? [] : [...current];
  const seen = new Set(base.map(keyOf));
  let overLimit = false;
  for (const t of clean) {
    if (seen.has(keyOf(t))) continue;
    if (max !== null && base.length >= max) {
      overLimit = true;
      continue;
    }
    base.push(t);
    seen.add(keyOf(t));
  }
  return { next: base, overLimit };
}

function sameTags(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((t, i) => keyOf(t) === keyOf(b[i]));
}

export function planTagChanges(
  rows: ListingRow[],
  currentTags: (row: ListingRow) => string[] | null,
  tags: string[],
  mode: TagMode,
  max: number | null,
  /** Add mode: tags removed from each listing first, to make room (the 13-tag limit). */
  removeFirst: string[] = [],
): { patches: Array<{ id: string; patch: StagePatch }>; overLimit: number; unknown: number; unsentTags: number; fullIds: string[] } {
  const patches: Array<{ id: string; patch: StagePatch }> = [];
  const fullIds: string[] = [];
  let overLimit = 0;
  let unknown = 0;
  let unsentTags = 0;
  if (!tags.length) return { patches, overLimit, unknown, unsentTags, fullIds };
  for (const r of rows) {
    if (r.sync && r.sync.status !== 'synced' && r.sync.changedFields.includes('tags')) {
      unsentTags += 1;
      continue;
    }
    const cur = currentTags(r);
    if (cur === null) {
      unknown += 1;
      continue;
    }
    const base = mode === 'add' && removeFirst.length ? applyTags(cur, removeFirst, 'remove', max).next : cur;
    const res = applyTags(base, tags, mode, max);
    if (res.overLimit) { overLimit += 1; fullIds.push(r.id); }
    if (!sameTags(res.next, cur)) patches.push({ id: r.id, patch: { tags: res.next } });
  }
  return { patches, overLimit, unknown, unsentTags, fullIds };
}

/** Pure: the tags most common on these listings (suggestions for "remove first"). */
export function commonTags(lists: Array<string[] | null>, limit = 12): string[] {
  const counts = new Map<string, { tag: string; n: number }>();
  for (const l of lists) for (const tag of l ?? []) {
    const k = tag.trim().toLocaleLowerCase();
    const cur = counts.get(k);
    counts.set(k, { tag: cur?.tag ?? tag, n: (cur?.n ?? 0) + 1 });
  }
  return Array.from(counts.values()).sort((a, b) => b.n - a.n).slice(0, limit).map((x) => x.tag);
}

export type AddTagsModalProps = {
  open: boolean;
  onClose: () => void;
  rows: ListingRow[];
  limits: { max: number | null; maxLength: number | null };
  currentTags: (row: ListingRow) => string[] | null;
  onStage: (patches: Array<{ id: string; patch: StagePatch }>) => Promise<{ ok: string[]; failed: string[] }>;
  /** Etsy: show "Save as template step" (saved bulk-edit templates). */
  templates?: boolean;
  t: ListingsT;
};

export function AddTagsModal({ open, onClose, rows, limits, currentTags, onStage, templates, t }: AddTagsModalProps) {
  const [tags, setTags] = React.useState<string[]>([]);
  const [mode, setMode] = React.useState<TagMode>('add');
  const [busy, setBusy] = React.useState(false);
  const [removeFirst, setRemoveFirst] = React.useState<string[]>([]);
  const [showRemove, setShowRemove] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setTags([]);
      setBusy(false);
      setRemoveFirst([]);
      setShowRemove(false);
    }
  }, [open]);

  const plan = React.useMemo(
    () => planTagChanges(rows, currentTags, tags, mode, limits.max, mode === 'add' ? removeFirst : []),
    [rows, currentTags, tags, mode, limits.max, removeFirst],
  );
  // Full listings (no room for every new tag): name them and offer a way out instead of a dead end.
  const fullRows = React.useMemo(() => rows.filter((r) => plan.fullIds.includes(r.id)), [rows, plan.fullIds]);
  const suggestions = React.useMemo(() => commonTags(fullRows.map((r) => currentTags(r))).filter((x) => !removeFirst.some((y) => y.toLocaleLowerCase() === x.toLocaleLowerCase())), [fullRows, currentTags, removeFirst]);

  const stage = async () => {
    if (!plan.patches.length || busy) return;
    setBusy(true);
    try {
      await onStage(plan.patches);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={t('listings.bulk.addTags')}
      primary={{
        id: 'stageTags',
        label: t('listings.tags.stageCount', { count: plan.patches.length }),
        onClick: () => void stage(),
        loading: busy,
        disabled: plan.patches.length === 0,
        disabledReason: plan.patches.length === 0 ? t('listings.price.nothingToStage') : undefined,
      }}
      data-testid="listings-add-tags"
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <FormField label={t('listings.tags.label')}>
          <TagInput
            value={tags}
            onChange={setTags}
            maxLength={limits.maxLength ?? undefined}
            max={mode === 'replace' && limits.max !== null ? limits.max : undefined}
          />
        </FormField>
        <FormField label={t('listings.price.modeLabel')}>
          <RadioGroup<TagMode>
            value={mode}
            onChange={setMode}
            direction="row"
            options={(['add', 'remove', 'replace'] as const).map((m) => ({ value: m, label: t(`listings.tags.mode.${m}`) }))}
          />
        </FormField>
        {plan.overLimit > 0 && limits.max !== null ? (
          <Box sx={{ p: '10px 12px', borderRadius: '8px', bgcolor: '#FFF7ED', border: '1px solid #FED7AA', display: 'flex', flexDirection: 'column', gap: '8px' }} data-testid="listings-tags-over-limit">
            <Typography variant="body2" sx={{ color: '#9A3412', fontWeight: 600 }}>
              {/* After removing some tags, say which listings are STILL full (why the stage count is lower). */}
              {mode === 'add' && removeFirst.length > 0
                ? t('listings.tags.stillFull', { count: plan.overLimit })
                : t('listings.tags.fullTitle', { count: plan.overLimit, max: limits.max })}
            </Typography>
            <Typography variant="caption" sx={{ color: '#9A3412' }}>
              {fullRows.slice(0, 3).map((r) => r.title).join(' · ')}{fullRows.length > 3 ? ` · +${fullRows.length - 3}` : ''}
            </Typography>
            {mode === 'add' ? (
              <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <Button variant="secondary" size="sm" onClick={() => setShowRemove(true)} data-testid="tags-remove-first-open">{t('listings.tags.removeFirstCta')}</Button>
                <Button variant="ghost" size="sm" onClick={() => setMode('replace')} data-testid="tags-switch-replace">{t('listings.tags.switchReplaceCta')}</Button>
              </Box>
            ) : null}
          </Box>
        ) : null}
        {mode === 'add' && (showRemove || removeFirst.length > 0) ? (
          <FormField label={t('listings.tags.removeFirstLabel')} helper={t('listings.tags.removeFirstHelp')}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <TagInput value={removeFirst} onChange={setRemoveFirst} maxLength={limits.maxLength ?? undefined} />
              {suggestions.length ? (
                <Box sx={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }} data-testid="tags-remove-suggestions">
                  {suggestions.map((s) => (
                    <Button key={s} variant="ghost" size="sm" onClick={() => setRemoveFirst((cur) => [...cur, s])}>{`− ${s}`}</Button>
                  ))}
                </Box>
              ) : null}
            </Box>
          </FormField>
        ) : null}
        {plan.unknown > 0 ? (
          <Typography variant="caption" sx={{ color: neutral[600] }}>
            {t('listings.tags.unknownSkipped', { count: plan.unknown })}
          </Typography>
        ) : null}
        {plan.unsentTags > 0 ? (
          <Typography variant="caption" sx={{ color: neutral[600] }} data-testid="listings-tags-unsent-skipped">
            {t('listings.tags.unsentSkipped', { count: plan.unsentTags })}
          </Typography>
        ) : null}
        {templates ? <TemplateStepSaver step={tags.length ? { kind: 'tags', mode, tags } : null} /> : null}
      </Box>
    </Modal>
  );
}

export default AddTagsModal;
