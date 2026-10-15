// components/domain/listing-editor/AiFillCard.tsx — listing-editor §3.2 "Start faster", §4.3 "Whole listing (create)",
// §10 Group H. The only create-only block: it sits under the photo strip of an empty workspace and disappears after
// the first field edit or photo (the frame decides: render it while `mode === 'create'` and nothing is touched).
//
// One AI run fills PROPOSALS, never fields: each field gets its own FieldSuggestion card, and this card offers
// [Use all] once something is ready. Proposals no section shows from this `ai` instance (eBay: the frame's
// instance is not wired into the eBay sections; `inlineKeys`) are listed here, one card per field, so
// [Use all] never applies a value the seller has not seen. Honest labels:
//  - eBay: "Fill from photos" (identify_product reads the seller's photos → research → title → category → item
//    specifics → price → description, the old creator's 7-step autofill). Without a photo it uses the one-line
//    "What are you selling?" text instead.
//  - Etsy: the Etsy AI endpoints read text, not images (listing-editor §4.3), so the button says "Fill with AI" and
//    needs the one-line description; category stays a manual pick in v1. No claim the photos were read.
import { useState } from 'react';
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ds/inputs/Button';
import { FormField } from '@/components/ds/inputs/FormField';
import { TextField } from '@/components/ds/inputs/TextField';
import { Banner } from '@/components/ds/feedback/Banner';
import { FieldSuggestion } from '@/components/ds/inputs/FieldSuggestion';
import { useFormatters } from '@/lib/format';
import { icons } from '@/lib/ds/icons';
import { neutral, accent, tone, radius } from '@/lib/ds/tokens';
import { FILL_KEYS, FILL_LABEL_KEY, fillCredits, ownImageUrls, type AiCategory, type AiPriceBand, type FillKey, type UseListingAI } from './useListingAI';

export const SEED_MAX = 120;

export interface AiFillCardProps {
  ai: UseListingAI;
  /** Photo URLs already in the workspace (eBay identify_product reads own-hosted ones). */
  photoUrls?: string[];
  /** Opens ProfilesModal in apply mode. Omit to hide the button. */
  onApplyProfile?: () => void;
  /** Opens the "copy an existing listing" picker (→ `new?copy=<id>`). Omit to hide the button. */
  onCopyExisting?: () => void;
  /**
   * Proposals this card shows itself because no section renders them from this `ai` instance.
   * Default: eBay → every fill key (eBay sections run their own AI); Etsy → none (Title / Tags show theirs).
   */
  inlineKeys?: readonly FillKey[];
  'data-testid'?: string;
}

/** Plain one-line preview of eBay HTML descriptions (the field keeps the HTML). */
function previewText(html: string, max = 320): string {
  const s = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export function AiFillCard({ ai, photoUrls, onApplyProfile, onCopyExisting, inlineKeys, 'data-testid': testId = 'le-ai-fill-card' }: AiFillCardProps) {
  const t = useTranslations('listingEditor');
  const tRoot = useTranslations();
  const fmt = useFormatters();
  const [seed, setSeed] = useState('');
  const isEbay = ai.marketplace === 'ebay';
  const canReadPhotos = isEbay && ownImageUrls(photoUrls).length > 0;
  const btn = ai.buttonState('fill');
  const running = ai.fill.running;
  const ready = FILL_KEYS.filter((k) => ai.proposals[k]?.status === 'ready'
    && !(k === 'price' && !(ai.proposals[k]?.value as AiPriceBand | undefined)?.usable)).length;
  const seedOk = seed.trim().length >= 3;
  const canRun = canReadPhotos || seedOk;
  const mp = isEbay ? 'eBay' : 'Etsy';
  const costLabel = t('ai.cost', { count: fillCredits(ai.marketplace, canReadPhotos) });
  const shownHere: readonly FillKey[] = inlineKeys ?? (isEbay ? FILL_KEYS : []);

  /** Display value of a proposal (the field gets the raw value on Use). */
  const display = (k: FillKey, v: unknown): string | string[] => {
    if (k === 'price') {
      const b = v as AiPriceBand | undefined;
      return b && b.suggested != null ? fmt.money(b.suggested, b.currency) : '';
    }
    if (k === 'category') return (v as AiCategory | undefined)?.name ?? '';
    if (k === 'condition') {
      const c = String(v ?? '');
      return tRoot.has(`listings.condition.${c}`) ? tRoot(`listings.condition.${c}`) : c;
    }
    if (k === 'specifics' && v && typeof v === 'object') return Object.entries(v as Record<string, string[]>).map(([n, vals]) => `${n}: ${vals.join(', ')}`);
    if (k === 'description' && typeof v === 'string') return isEbay ? previewText(v) : v;
    if (Array.isArray(v)) return v.map(String);
    return typeof v === 'string' ? v : '';
  };

  const inlineCards: ReactNode[] = [];
  for (const k of shownHere) {
    const p = ai.proposals[k];
    if (!p || p.status === 'idle') continue;
    const base = ai.suggestionProps(k);
    if (!base) continue;
    // A band in another currency offers no Use (and Use all skips it): nothing to show here.
    if (k === 'price' && p.status === 'ready' && !(p.value as AiPriceBand | undefined)?.usable) continue;
    inlineCards.push(
      <Box key={k} sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }} data-testid={`le-ai-fill-proposal-${k}`}>
        <Box sx={{ fontSize: 13, lineHeight: '20px', fontWeight: 500, color: neutral[800] }}>{tRoot(FILL_LABEL_KEY[k])}</Box>
        <FieldSuggestion
          {...base}
          value={p.status === 'ready' ? display(k, p.value) : ''}
          data-testid={`le-ai-fill-suggestion-${k}`}
        />
      </Box>,
    );
  }

  const start = () => {
    if (!canRun || running) return;
    void ai.fillListing({ seed: seed.trim() || undefined, imageUrls: photoUrls });
  };

  const done = ai.fill.steps.filter((s) => s.status === 'done' || s.status === 'error' || s.status === 'skipped').length;
  const total = ai.fill.steps.filter((s) => s.status !== 'skipped').length || ai.fill.steps.length;
  const current = ai.fill.steps.find((s) => s.status === 'running');

  return (
    <Box
      component="section"
      aria-labelledby="le-start-faster-title"
      data-testid={testId}
      sx={{ display: 'flex', flexDirection: 'column', gap: '12px', p: '16px', borderRadius: `${radius.md}px`, border: `1px solid ${neutral[200]}`, bgcolor: neutral[0], maxWidth: 720 }}
    >
      <Box id="le-start-faster-title" component="h3" sx={{ m: 0, fontSize: 16, lineHeight: '24px', fontWeight: 600, color: neutral[900] }}>
        {t('start.title')}
      </Box>

      <FormField
        label={t('start.seedLabel')}
        optional={canReadPhotos}
        helper={isEbay ? t('ai.fillFromPhotosHelp') : t('ai.fillFromTextHelp')}
        counter={{ value: seed.length, max: SEED_MAX }}
      >
        <TextField
          value={seed}
          onChange={(v) => setSeed(v.slice(0, SEED_MAX))}
          placeholder={t('start.seedPlaceholder')}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); start(); } }}
          disabled={running}
          maxLength={SEED_MAX}
          data-testid="le-ai-fill-seed"
        />
      </FormField>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
        <Button
          variant="secondary"
          size="md"
          icon={icons.ai}
          onClick={start}
          loading={running}
          loadingLabel={t('ai.writing')}
          disabled={!canRun || btn.disabled}
          disabledReason={btn.disabled ? btn.disabledReason : isEbay ? t('start.needSeedOrPhoto') : t('start.needSeed')}
          aria-label={`${isEbay && canReadPhotos ? t('ai.fillFromPhotos') : t('ai.fillWithAi')} · ${costLabel}`}
          data-testid="le-ai-fill-run"
        >
          {isEbay && canReadPhotos ? t('ai.fillFromPhotos') : t('ai.fillWithAi')}
        </Button>
        <Box component="span" sx={{ fontSize: 12, lineHeight: '16px', color: neutral[500] }} data-testid="le-ai-fill-cost">{costLabel}</Box>
        {ready > 0 && !running ? (
          <Button variant="secondary" size="md" onClick={() => ai.applyAll()} data-testid="le-ai-fill-use-all">
            {t('ai.useAllCount', { count: ready })}
          </Button>
        ) : null}
        <Box sx={{ flex: 1 }} />
        {onApplyProfile ? (
          <Button variant="ghost" size="md" onClick={onApplyProfile} data-testid="le-start-apply-profile">{t('start.applyProfile')}</Button>
        ) : null}
        {onCopyExisting ? (
          <Button variant="ghost" size="md" onClick={onCopyExisting} data-testid="le-start-copy">{t('start.copyExisting')}</Button>
        ) : null}
      </Box>

      {running ? (
        <Box role="status" aria-live="polite" sx={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 13, lineHeight: '20px', color: accent[700] }} data-testid="le-ai-fill-progress">
          <icons.ai size={14} aria-hidden />
          <span>{t('start.progress', { done, total, step: current ? t(`start.step.${current.id}`) : '' })}</span>
        </Box>
      ) : null}

      {inlineCards.length ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }} data-testid="le-ai-fill-proposals">{inlineCards}</Box>
      ) : null}

      {!running && ai.fill.error ? <Banner tone="warning" title={ai.fill.error} data-testid="le-ai-fill-error" /> : null}

      {!running && ai.fill.steps.length > 0 && !ai.fill.error ? (
        <Box role="status" sx={{ fontSize: 13, lineHeight: '20px', color: ready ? neutral[700] : tone.warning.fg }} data-testid="le-ai-fill-summary">
          {ready ? t('start.review', { count: ready }) : t('start.nothing', { marketplace: mp })}
        </Box>
      ) : null}

      <Box sx={{ fontSize: 12, lineHeight: '16px', color: neutral[500] }}>{t('start.english')}</Box>
    </Box>
  );
}

export default AiFillCard;
