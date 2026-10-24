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
): { patches: Array<{ id: string; patch: StagePatch }>; overLimit: number; unknown: number; unsentTags: number } {
  const patches: Array<{ id: string; patch: StagePatch }> = [];
  let overLimit = 0;
  let unknown = 0;
  let unsentTags = 0;
  if (!tags.length) return { patches, overLimit, unknown, unsentTags };
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
    const res = applyTags(cur, tags, mode, max);
    if (res.overLimit) overLimit += 1;
    if (!sameTags(res.next, cur)) patches.push({ id: r.id, patch: { tags: res.next } });
  }
  return { patches, overLimit, unknown, unsentTags };
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

  React.useEffect(() => {
    if (open) {
      setTags([]);
      setBusy(false);
    }
  }, [open]);

  const plan = React.useMemo(() => planTagChanges(rows, currentTags, tags, mode, limits.max), [rows, currentTags, tags, mode, limits.max]);

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
        label: t('listings.tags.stage'),
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
          <Typography variant="caption" sx={{ color: neutral[600] }} data-testid="listings-tags-over-limit">
            {t('listings.tags.overLimit', { count: plan.overLimit, max: limits.max })}
          </Typography>
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
