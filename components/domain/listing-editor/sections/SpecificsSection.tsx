// components/domain/listing-editor/sections/SpecificsSection.tsx — listing-editor §2.1 #3 "Item specifics" (eBay,
// M6 Group D). Required aspects first, then recommended, then the seller's own, from `item_aspects` for the chosen
// category. Each aspect is a `Combobox` (SELECTION_ONLY), a creatable `Combobox` (FREE_TEXT with suggestions) or a
// `TextField`; values ≤ 65 characters (lib/ebay/payloadRules). The whole map is the `aspects` field of the eBay
// adapter (encoded string): this section only calls `setField('aspects', …)`, the engine stages it.
// "✦ Fill item specifics" shows a proposal list (each aspect Use / Skip, Use all): AI never overwrites silently.
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page/Section';
import { Button } from '@/components/ds/inputs/Button';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { PanelSkeleton } from '@/components/ds/state/Skeletons';
import { useToast } from '@/components/ds/feedback/toast';
import { icons } from '@/lib/ds/icons';
import { accent, neutral, radius } from '@/lib/ds/tokens';
import { ASPECT_VALUE_MAX } from '@/lib/ebay/payloadRules';
import { fieldAnchorId, sectionAnchorId } from '@/lib/listingEditor/sections';
import type { ListingFacts, ListingSectionProps } from '@/lib/listingEditor/types';
import ItemSpecificsEditor, {
  missingRequiredAspects,
  setAspectValues,
  type AspectMetadata,
} from '@/components/ebay/ItemSpecificsEditor';
import { decodeAspects, encodeAspects, type EbayEditorFields } from '../adapters/ebay';
import { useListingEditor } from '../useListingDraft';

/** The AI hand-off for "Fill item specifics" (frame maps `useListingAI('ebay')` onto it). */
export interface SpecificsAi {
  /** Starts `suggest_aspects` for the given names (required first). */
  run: (aspectNames: string[]) => void;
  loading: boolean;
  /** Ready proposals per aspect name (already sanitized ≤ 65 chars), or null when there is no card. */
  proposals: Record<string, string[]> | null;
  /** `true` = default "didn't come out right" line; a string = translated cause. */
  error?: boolean | string;
  /** "Based on …" (translated). */
  basis?: string;
  dismiss: () => void;
  /** Optional writers (useListingAI `acceptAspect` / `skipAspect` / `apply('specifics')`); the section writes itself without them. */
  accept?: (name: string) => void;
  skip?: (name: string) => void;
  acceptAll?: () => void;
  disabled?: boolean;
  disabledReason?: string;
}

export interface SpecificsSectionProps extends Partial<ListingSectionProps> {
  ai?: SpecificsAi | null;
}

type AspectLoad = { status: 'idle' | 'loading' | 'ready' | 'error'; required: AspectMetadata[]; recommended: AspectMetadata[] };

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** `item_aspects` response → required / recommended metadata (malformed rows dropped). */
export function parseItemAspects(data: unknown): { required: AspectMetadata[]; recommended: AspectMetadata[] } {
  const list = (data as { aspects?: unknown[] } | null)?.aspects;
  const rows: AspectMetadata[] = (Array.isArray(list) ? list : [])
    .filter((a): a is AspectMetadata => {
      const x = a as AspectMetadata | null;
      return Boolean(x && typeof x.localizedAspectName === 'string' && x.localizedAspectName && x.aspectConstraint);
    })
    .map((a) => ({
      localizedAspectName: a.localizedAspectName,
      aspectConstraint: {
        aspectRequired: Boolean(a.aspectConstraint.aspectRequired),
        aspectMode: a.aspectConstraint.aspectMode === 'SELECTION_ONLY' ? 'SELECTION_ONLY' : 'FREE_TEXT',
        aspectValues: Array.isArray(a.aspectConstraint.aspectValues)
          ? a.aspectConstraint.aspectValues.filter((v) => v && typeof v.localizedValue === 'string')
          : undefined,
      },
    }));
  return {
    required: rows.filter((a) => a.aspectConstraint.aspectRequired),
    recommended: rows.filter((a) => !a.aspectConstraint.aspectRequired),
  };
}

/** Aspect names whose values differ from the live listing (per-aspect dirty marker). */
export function changedAspectNames(current: Record<string, string[]>, remote: Record<string, string[]> | null): string[] {
  if (!remote) return [];
  const names = new Set([...Object.keys(current), ...Object.keys(remote)]);
  return Array.from(names).filter((n) => JSON.stringify(current[n] ?? []) !== JSON.stringify(remote[n] ?? []));
}

/**
 * Proposal list rows: only aspects whose suggestion differs from what the field already has, values ≤ 65 chars,
 * no blank or non-string values (AI output guard, feedback_ai_response_safety).
 */
export function proposalRows(proposals: unknown, current: Record<string, string[]>): Array<{ name: string; values: string[] }> {
  if (!proposals || typeof proposals !== 'object' || Array.isArray(proposals)) return [];
  const rows: Array<{ name: string; values: string[] }> = [];
  for (const [name, raw] of Object.entries(proposals as Record<string, unknown>)) {
    if (!name.trim()) continue;
    const values = (Array.isArray(raw) ? raw : [raw])
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter((v) => v && v.length <= ASPECT_VALUE_MAX);
    if (!values.length) continue;
    if (JSON.stringify(values) === JSON.stringify(current[name] ?? [])) continue;
    rows.push({ name, values });
  }
  return rows;
}

/** The `specifics` score facts are derived by the frame from the field; this one feeds the required count. */
export function specificsFact(aspects: Record<string, string[]>, required: AspectMetadata[], recommended: AspectMetadata[]) {
  const filledRecommended = recommended.filter((a) => (aspects[a.localizedAspectName] ?? []).some((v) => v.trim())).length;
  return {
    required: required.length,
    filled: required.length - missingRequiredAspects(aspects, required).length,
    recommended: recommended.length,
    recommendedFilled: filledRecommended,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Section
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function SpecificsSection({ id = 'specifics', ai }: SpecificsSectionProps) {
  const t = useTranslations('listingEditor');
  const root = useTranslations();
  const toast = useToast();
  const ed = useListingEditor<EbayEditorFields>();
  const { readOnly, mode, reportFacts } = ed;
  const f = ed.view.fields;
  const aspects = React.useMemo(() => decodeAspects(f.aspects), [f.aspects]);
  const remoteAspects = React.useMemo(() => (ed.remote ? decodeAspects(ed.remote.aspects) : null), [ed.remote]);
  const categoryId = String(f.categoryId ?? '');
  const [load, setLoad] = React.useState<AspectLoad>({ status: 'idle', required: [], recommended: [] });
  const [reloadKey, setReloadKey] = React.useState(0);
  const [skipped, setSkipped] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (!categoryId) {
      setLoad({ status: 'idle', required: [], recommended: [] });
      return undefined;
    }
    let cancelled = false;
    setLoad((prev) => ({ ...prev, status: 'loading' }));
    fetch(`/api/clawd/ebay?action=item_aspects&category_id=${encodeURIComponent(categoryId)}`, { credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = parseItemAspects(await res.json());
        if (!cancelled) setLoad({ status: 'ready', ...parsed });
      })
      .catch(() => { if (!cancelled) setLoad({ status: 'error', required: [], recommended: [] }); });
    return () => { cancelled = true; };
  }, [categoryId, reloadKey]);

  // Score input: required / recommended coverage (`aspects_required`, `aspects_recommended` checks).
  React.useEffect(() => {
    if (load.status !== 'ready') return;
    reportFacts({ attributes: { required: load.required.length, filled: specificsFact(aspects, load.required, load.recommended).filled } } satisfies Partial<ListingFacts>);
  }, [load, aspects, reportFacts]);

  const write = (next: Record<string, string[]>) => ed.setField('aspects', encodeAspects(next));

  const dirtyNames = mode === 'edit' ? changedAspectNames(aspects, remoteAspects) : [];
  const issue = ed.issues.find((i) => i.field === 'aspects' && i.severity !== 'warn');
  const issueText = issue ? (root.has(issue.key) ? root(issue.key, (issue.params ?? {}) as Record<string, string | number>) : issue.message ?? null) : null;
  const missing = load.status === 'ready' ? missingRequiredAspects(aspects, load.required) : [];
  const errors: Record<string, string> = {};
  if (issue) for (const name of missing) errors[name] = t('specifics.requiredMissing');

  const rows = ai?.proposals ? proposalRows(ai.proposals, aspects).filter((r) => !skipped.has(r.name)) : [];
  const accept = (name: string, values: string[]) => {
    if (ai?.accept) ai.accept(name);
    else write(setAspectValues(aspects, name, values));
  };
  const skip = (name: string) => {
    if (ai?.skip) ai.skip(name);
    else setSkipped((prev) => new Set(prev).add(name));
  };
  const acceptAll = () => {
    const previous = aspects;
    if (ai?.acceptAll) ai.acceptAll();
    else {
      let next = { ...aspects };
      for (const r of rows) next = setAspectValues(next, r.name, r.values);
      write(next);
      ai?.dismiss();
      toast.success(t('specifics.filledToast', { count: rows.length }), { undo: () => write(previous) });
    }
  };

  const aiNames = [...load.required, ...load.recommended].map((a) => a.localizedAspectName);
  const action = ai && load.status === 'ready' && aiNames.length > 0
    ? {
      id: 'ai-specifics',
      label: t('specifics.fill'),
      icon: icons.ai,
      onClick: () => { setSkipped(new Set()); ai.run(aiNames); },
      loading: ai.loading,
      loadingLabel: t('specifics.filling'),
      disabled: readOnly || ai.disabled,
      disabledReason: ai.disabledReason,
    }
    : undefined;

  return (
    <Section id={sectionAnchorId(id)} title={t('section.specifics')} variant="plain" action={action} data-testid="le-section-specifics">
      <Box id={fieldAnchorId('aspects')} sx={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: 720 }}>
        {issueText && (
          <Typography variant="caption" role="alert" sx={{ color: 'error.main' }}>{issueText}</Typography>
        )}
        {ai && (rows.length > 0 || ai.error) && (
          <Box
            data-testid="specifics-proposals"
            sx={{ border: `1px solid ${accent[200]}`, borderRadius: `${radius.md}px`, p: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Box component="span" sx={{ display: 'inline-flex', color: accent[600] }}><icons.ai size={16} aria-hidden /></Box>
              <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>{t('specifics.proposalTitle')}</Typography>
              {rows.length > 1 && (
                <Button variant="secondary" size="sm" onClick={acceptAll} disabled={readOnly}>{t('specifics.useAll')}</Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => { setSkipped(new Set()); ai.dismiss(); }}>{t('specifics.dismiss')}</Button>
            </Box>
            {ai.error ? (
              <ErrorState
                variant="inline"
                title={typeof ai.error === 'string' ? ai.error : t('specifics.garbled')}
                onRetry={() => ai.run(aiNames)}
              />
            ) : null}
            {rows.map((r) => (
              <Box
                key={r.name}
                data-testid={`specifics-proposal-${r.name}`}
                sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', borderTop: `1px solid ${neutral[100]}`, pt: '8px' }}
              >
                <Box sx={{ flex: 1, minWidth: 160 }}>
                  <Typography variant="caption" component="p" sx={{ m: 0 }}>{r.name}</Typography>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{r.values.join(', ')}</Typography>
                </Box>
                <Button variant="ghost" size="sm" onClick={() => skip(r.name)}>{t('specifics.skip')}</Button>
                <Button variant="secondary" size="sm" onClick={() => accept(r.name, r.values)} disabled={readOnly}>{t('specifics.use')}</Button>
              </Box>
            ))}
            {ai.basis ? <Typography variant="caption" component="p" sx={{ m: 0 }}>{ai.basis}</Typography> : null}
          </Box>
        )}
        {!categoryId ? (
          <Typography variant="body2" sx={{ color: neutral[600] }} data-testid="specifics-no-category">{t('specifics.noCategory')}</Typography>
        ) : load.status === 'loading' || load.status === 'idle' ? (
          <PanelSkeleton sections={1} data-testid="specifics-loading" />
        ) : load.status === 'error' ? (
          <ErrorState variant="inline" title={t('specifics.loadFailed')} onRetry={() => setReloadKey((k) => k + 1)} data-testid="specifics-error" />
        ) : (
          <ItemSpecificsEditor
            embedded
            aspects={aspects}
            requiredAspects={load.required}
            recommendedAspects={load.recommended}
            onChange={write}
            dirtyNames={dirtyNames}
            onRevertAspect={remoteAspects ? (name) => write(setAspectValues(aspects, name, remoteAspects[name] ?? [])) : undefined}
            errors={errors}
            disabled={readOnly}
          />
        )}
      </Box>
    </Section>
  );
}

export default SpecificsSection;
