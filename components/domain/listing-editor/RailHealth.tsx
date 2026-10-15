// components/domain/listing-editor/RailHealth.tsx: "Listing health" in the editor's right rail (listing-editor
// §4.4). The score runs on the client on every change over the draft view (`scoreListing`, pure, < 1 ms); the
// header shows the last *sent* score with "78 → 86 after you send" when they differ (the list page shows the
// same sent-state number). Every fix goes back to the editor through `onFix`, which only focuses a field or
// opens an AI proposal: nothing is staged silently and nothing is sent (P6, §3.10).
// The same `useListingHealth` result feeds the header `ScoreMeter variant="cell"` at 900–1199 and on mobile.
import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { neutral as n, px, space } from '@/lib/ds/tokens';
import { ScoreMeter } from '@/components/ds/data/ScoreMeter';
import { ScorePanel } from '@/components/ds/data/ScorePanel';
import { scoreListing, type EbayScoreInput, type EtsyScoreInput } from '@/lib/listingScore';
import type { Check, ScoreResult } from '@/lib/listingScore/types';
import { decodeEntities, decodeEntityList } from '@/lib/text/decodeEntities';

export type HealthMarketplace = 'etsy' | 'ebay';
export type HealthInput<M extends HealthMarketplace> = M extends 'etsy' ? EtsyScoreInput : EbayScoreInput;

export interface ListingHealth {
  /** Draft view (what the seller sees in the form): drives the checks and fixes. */
  result: ScoreResult;
  /** Last sent state; null in create mode or before the remote listing loaded. */
  sentResult: ScoreResult | null;
  /** Number for meters: the sent score when there is one, else the draft score; null = not enough data. */
  score: number | null;
  /** Draft score when it differs from `score` ("78 → 86 after you send"); otherwise null. */
  afterScore: number | null;
}

/**
 * True when the listing has neither a photo nor a title yet (a fresh create form). Scoring empty strings and
 * empty lists would give a meaningless "3 / 100" with a wall of failing checks, so the rail shows
 * "Add a photo and a title to get a score" instead (listing-editor §3.2).
 */
export function lacksScoreBasis(input: Partial<EtsyScoreInput & EbayScoreInput> | null | undefined): boolean {
  if (!input) return true;
  const hasTitle = typeof input.title === 'string' && input.title.trim() !== '';
  const hasPhoto = (Array.isArray(input.images) && input.images.length > 0)
    || (typeof input.imageCount === 'number' && input.imageCount > 0);
  return !hasTitle && !hasPhoto;
}

/** Pure core of `useListingHealth` (tested). */
export function computeListingHealth<M extends HealthMarketplace>(
  marketplace: M,
  input: HealthInput<M>,
  sentInput?: HealthInput<M> | null,
): ListingHealth {
  const result = scoreListing(input as EtsyScoreInput & EbayScoreInput, marketplace);
  const sentResult = sentInput ? scoreListing(sentInput as EtsyScoreInput & EbayScoreInput, marketplace) : null;
  const draftScore = result.checksUsed > 0 && !lacksScoreBasis(input) ? result.score : null;
  const sentScore = sentResult && sentResult.checksUsed > 0 && !lacksScoreBasis(sentInput) ? sentResult.score : null;
  if (sentScore === null) return { result, sentResult, score: draftScore, afterScore: null };
  return { result, sentResult, score: sentScore, afterScore: draftScore !== null && draftScore !== sentScore ? draftScore : null };
}

/** Scores the draft view (and the sent view when given) once per change. Inputs should be memoized by the caller. */
export function useListingHealth<M extends HealthMarketplace>(
  marketplace: M,
  input: HealthInput<M>,
  sentInput?: HealthInput<M> | null,
): ListingHealth {
  return useMemo(() => computeListingHealth(marketplace, input, sentInput), [marketplace, input, sentInput]);
}

/**
 * Editor section of every `Check.fix.field` the scorers emit (`lib/listingScore/{etsy,ebay}.ts`), so `onFix`
 * can call `SectionNav`'s `scrollToSection(section)` and then focus `field`. Unknown fields → null.
 */
export const FIX_FIELD_SECTION: Record<string, string> = {
  photos: 'photos',
  video: 'photos',
  tags: 'tags',
  materials: 'tags',
  details: 'details',
  category: 'details',
  condition: 'details',
  conditionDescription: 'details',
  aspects: 'specifics',
  shipping: 'shipping',
  weight: 'shipping',
  processing: 'shipping',
  policies: 'shipping',
  package: 'shipping',
};

export type FixTarget =
  | { kind: 'field'; section: string; field: string }
  | { kind: 'action'; action: string }
  | null;

/** What a fix asks the editor to do: focus a field in a section, or run an action that only makes a proposal. */
export function fixTarget(check: Pick<Check, 'fix'>): FixTarget {
  const fix = check.fix;
  if (!fix) return null;
  if (fix.action) return { kind: 'action', action: fix.action };
  if (fix.field) {
    const section = FIX_FIELD_SECTION[fix.field];
    return section ? { kind: 'field', section, field: fix.field } : null;
  }
  return null;
}

/** Etsy listing values as the editor holds them (Etsy API names), before mapping to the scorer input. */
export interface EtsyHealthSource {
  title?: string | null;
  description?: string | null;
  tags?: string[] | null;
  materials?: string[] | null;
  /** Photos in staged order. `removed` = staged delete (not counted). null/undefined = photos not loaded. */
  photos?: Array<{ alt?: string | null; removed?: boolean }> | null;
  /** null/undefined = videos not loaded (or failed): the video check is `na`. */
  hasVideo?: boolean | null;
  /** Required taxonomy properties and how many have a value; null = properties not loaded (or failed). */
  requiredAttributes?: { required: number; filled: number } | null;
  /** false = shop profiles not loaded yet (or failed): the shipping check is `na`. */
  shippingLoaded?: boolean;
  shippingProfileId?: string | number | null;
  processingMin?: number | null;
  /** Etsy processing profile (readiness state); counts as processing set. */
  readinessStateId?: string | number | null;
  itemWeight?: number | null;
  price?: number | null;
  /** Research band (p25–p75); null = no research data → `price_market` is `na`, never a warning. */
  market?: { p25: number; p75: number } | null;
}

function present(v: unknown): boolean {
  return v !== null && v !== undefined && String(v).trim() !== '' && String(v) !== '0';
}

/** Editor values → `EtsyScoreInput`. Text is entity-decoded (idempotent) so encoded cache text scores like Etsy shows it. */
export function etsyScoreInputFromSource(src: EtsyHealthSource): EtsyScoreInput {
  const photos = Array.isArray(src.photos) ? src.photos.filter((p) => p && !p.removed).map((p) => ({ alt: p.alt ?? null })) : undefined;
  const hasProfile = present(src.shippingProfileId);
  return {
    title: typeof src.title === 'string' ? decodeEntities(src.title) : src.title,
    description: typeof src.description === 'string' ? decodeEntities(src.description) : src.description,
    tags: Array.isArray(src.tags) ? decodeEntityList(src.tags) : src.tags,
    materials: Array.isArray(src.materials) ? decodeEntityList(src.materials) : src.materials,
    images: photos,
    hasVideo: typeof src.hasVideo === 'boolean' ? src.hasVideo : undefined,
    attributes: src.requiredAttributes ?? undefined,
    shipping: src.shippingLoaded === false
      ? undefined
      : {
          hasProfile,
          hasProcessing: present(src.readinessStateId) || (typeof src.processingMin === 'number' && src.processingMin >= 0) || hasProfile,
          hasWeight: typeof src.itemWeight === 'number' && src.itemWeight > 0,
        },
    price: typeof src.price === 'number' && Number.isFinite(src.price) ? src.price : undefined,
    market: src.market ?? undefined,
  };
}

export interface RailHealthProps {
  health: ListingHealth;
  /** Focus the field / open the AI proposal for this check (see `fixTarget`). Never stages or sends by itself. */
  onFix: (check: Check) => void;
  /** Check ids whose fix is running (AI writing): their button shows the DS "Working…" label. */
  busyFixIds?: string[];
  'data-testid'?: string;
}

export function RailHealth({ health, onFix, busyFixIds, 'data-testid': testId }: RailHealthProps) {
  const t = useTranslations('listingEditor.health');
  const ts = useTranslations('ds.score');
  const { result, score, afterScore } = health;

  return (
    <Box data-testid={testId ?? 'rail-health'} sx={{ display: 'flex', flexDirection: 'column', gap: px(space[3]) }}>
      {score === null ? (
        <Box>
          <Typography component="h3" variant="titleSm" sx={{ m: 0, color: n[800] }}>{ts('title')}</Typography>
          {result.checksUsed === 0 && (
            <Typography component="p" variant="caption" sx={{ m: 0, color: n[500] }}>
              {ts('scoredOn', { used: result.checksUsed, total: result.checksTotal })}
            </Typography>
          )}
          <Typography component="p" variant="dense" sx={{ m: 0, mt: px(space[1]), color: n[600] }}>{t('empty')}</Typography>
        </Box>
      ) : (
        <ScoreMeter
          variant="panel"
          score={score}
          afterScore={afterScore}
          checksUsed={result.checksUsed}
          checksTotal={result.checksTotal}
        />
      )}
      {score !== null && <ScorePanel result={result} onFix={onFix} busyFixIds={busyFixIds} hideHeader />}
    </Box>
  );
}

export default RailHealth;
