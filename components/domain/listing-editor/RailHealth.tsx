// components/domain/listing-editor/RailHealth.tsx: "Listing health" in the editor's right rail (listing-editor
// §4.4). The score runs on the client on every change over the draft view (`scoreListing`, pure, < 1 ms); the
// header shows the last *sent* score with "78 → 86 after you send" when they differ (the list page shows the
// same sent-state number). Every fix goes back to the editor through `onFix`, which only focuses a field or
// opens an AI proposal: nothing is staged silently and nothing is sent (P6, §3.10).
// Usability pass (2026-10-15, founder: "I feel lost"): the rail shows the score and only the top 3 fixes in plain
// language, each with one small text "Fix" link (no wall of bordered buttons, "+9 pts" instead of a cryptic "+9");
// the other open checks and the n/a ones sit behind "Show all", passed checks stay collapsed.
// The same `useListingHealth` result feeds the header `ScoreMeter variant="cell"` at 900–1199 and on mobile.
import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { accent, focusRing, neutral as n, px, space, tone as toneTokens } from '@/lib/ds/tokens';
import { ScoreMeter } from '@/components/ds/data/ScoreMeter';
import { icons } from '@/lib/ds/icons';
import { scoreListing, type EbayScoreInput, type EtsyScoreInput } from '@/lib/listingScore';
import { sortChecks, type Check, type ScoreResult } from '@/lib/listingScore/types';
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

/** Open checks shown before "Show all". */
export const TOP_FIXES = 3;

export interface RailHealthProps {
  health: ListingHealth;
  /** Focus the field / open the AI proposal for this check (see `fixTarget`). Never stages or sends by itself. */
  onFix: (check: Check) => void;
  /** Check ids whose fix is running (AI writing): their link shows the DS "Working…" label. */
  busyFixIds?: string[];
  'data-testid'?: string;
}

const linkSx = {
  font: 'inherit',
  fontSize: 13,
  lineHeight: '18px',
  fontWeight: 500,
  color: accent[600],
  borderRadius: '4px',
  px: '2px',
  whiteSpace: 'nowrap',
  '&:hover': { color: accent[700], textDecoration: 'underline', textUnderlineOffset: '3px' },
  '&:focus-visible': { outline: 'none', boxShadow: focusRing },
  '&.Mui-disabled': { color: n[500] },
  '@media (pointer: coarse)': { minHeight: 44, px: '6px' },
} as const;

function Glyph({ status }: { status: Check['status'] }) {
  const ts = useTranslations('ds.score');
  const common = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const;
  if (status === 'fail') return <icons.fail {...common} color={toneTokens.danger.fg} />;
  if (status === 'warn') return <icons.warning {...common} color={toneTokens.warning.fg} />;
  if (status === 'pass') return <icons.check {...common} color={toneTokens.success.fg} />;
  return <Typography component="span" variant="micro" sx={{ color: n[500], whiteSpace: 'nowrap' }}>{ts('na')}</Typography>;
}

/** One check: glyph · plain-language label (+N pts, subtle) · one text link. */
function FixRow({ check, onFix, busy }: { check: Check; onFix: (c: Check) => void; busy: boolean }) {
  const tRoot = useTranslations();
  const t = useTranslations('listingEditor.health');
  const ts = useTranslations('ds.score');
  const label = tRoot(check.label, check.params ?? {});
  const fixLabel = check.fix ? tRoot(check.fix.label) : null;
  const open = check.status === 'fail' || check.status === 'warn';
  // Open checks say "Fix"; an n/a check's link names what it does ("Check price") since nothing is wrong yet.
  const linkText = busy ? ts('fixRunning') : open ? t('fix') : fixLabel;
  const gain = check.gain ?? 0;
  return (
    <Box
      component="li"
      data-check-id={check.id}
      data-status={check.status}
      sx={{ display: 'grid', gridTemplateColumns: '16px minmax(0, 1fr) auto', columnGap: '8px', alignItems: 'start', py: '6px' }}
    >
      <Box sx={{ display: 'inline-flex', pt: '1px' }} title={ts(`status.${check.status}`)}>
        <Glyph status={check.status} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="dense" component="span" sx={{ color: check.status === 'na' ? n[500] : n[800] }}>
          <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            {ts(`status.${check.status}`)}
          </Box>
          {label}
        </Typography>
        {open && gain > 0 ? (
          <Typography variant="caption" component="span" sx={{ display: 'block', color: n[500], fontVariantNumeric: 'tabular-nums' }}>
            {t('gain', { points: gain })}
          </Typography>
        ) : null}
        {check.status === 'na' && check.naReason ? (
          <Typography variant="caption" component="span" sx={{ display: 'block', color: n[500] }}>
            {tRoot(check.naReason)}
          </Typography>
        ) : null}
      </Box>
      {check.fix && check.status !== 'pass' && linkText ? (
        <ButtonBase
          onClick={() => onFix(check)}
          disabled={busy}
          title={open && fixLabel ? fixLabel : undefined}
          aria-label={open && fixLabel && !busy ? t('fixAria', { fix: fixLabel }) : undefined}
          data-testid={`rail-fix-${check.id}`}
          sx={linkSx}
        >
          {linkText}
        </ButtonBase>
      ) : <span />}
    </Box>
  );
}

const listSx = { listStyle: 'none', m: 0, p: 0 } as const;

export function RailHealth({ health, onFix, busyFixIds = [], 'data-testid': testId }: RailHealthProps) {
  const t = useTranslations('listingEditor.health');
  const ts = useTranslations('ds.score');
  const { result, score, afterScore } = health;
  const [showAll, setShowAll] = useState(false);
  const [showPasses, setShowPasses] = useState(false);

  const listing = sortChecks(result.checks).filter((c) => (c.group ?? 'listing') === 'listing');
  const open = listing.filter((c) => c.status === 'fail' || c.status === 'warn');
  const passes = listing.filter((c) => c.status === 'pass');
  const nas = listing.filter((c) => c.status === 'na');
  const top = open.slice(0, TOP_FIXES);
  const rest = [...open.slice(TOP_FIXES), ...nas];
  const row = (c: Check) => <FixRow key={c.id} check={c} onFix={onFix} busy={busyFixIds.includes(c.id)} />;

  return (
    <Box data-testid={testId ?? 'rail-health'} sx={{ display: 'flex', flexDirection: 'column', gap: px(space[2]) }}>
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
      {score !== null ? (
        <>
          {top.length ? (
            <Box component="ul" sx={listSx} aria-label={t('topFixes')} data-testid="rail-health-top">
              {top.map(row)}
            </Box>
          ) : null}
          {showAll && rest.length ? (
            <Box component="ul" sx={listSx} data-testid="rail-health-rest">
              {rest.map(row)}
            </Box>
          ) : null}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: '12px', rowGap: '4px' }}>
            {rest.length ? (
              <ButtonBase onClick={() => setShowAll((v) => !v)} aria-expanded={showAll} data-testid="rail-health-showall" sx={{ ...linkSx, color: n[700] }}>
                {showAll ? t('showLess') : t('showAll', { count: rest.length })}
              </ButtonBase>
            ) : null}
            {passes.length && !showPasses ? (
              <ButtonBase onClick={() => setShowPasses(true)} data-testid="rail-health-passes" sx={{ ...linkSx, color: n[600], fontWeight: 400, gap: '4px' }}>
                <icons.check size={14} strokeWidth={1.75} aria-hidden color={toneTokens.success.fg} />
                {ts('passesCollapsed', { count: passes.length })}
              </ButtonBase>
            ) : null}
          </Box>
          {showPasses && passes.length ? (
            <Box component="ul" sx={listSx} data-testid="rail-health-passed">
              {passes.map(row)}
            </Box>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}

export default RailHealth;
