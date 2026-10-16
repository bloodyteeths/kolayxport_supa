// components/domain/listings/tools/FindReplacePanel.tsx — listings-grid §10 "Find & replace" (M5 G6).
// SidePanel md. Field [Title · Tags · (Description)] · Find · Replace with · Match case · Scope [view · selected].
// Live preview (first 50, "and N more"). Etsy titles are checked with `checkTitle`; a result over the limit is
// flagged and excluded from the count. Primary "Stage N changes" stages drafts; nothing is sent from here.
//
// Data: the current view's rows come from `GET /api/listings/export` (the same filters, every row, not only
// the page), parsed with `readListingsCsv`, with every open draft overlaid (`fetchOpenDraftRows` +
// `applyListingRows`): titles are computed from the unsent title, and a listing whose unsent tags/description
// cannot be read is skipped with a reason instead of being silently overwritten. The description column is
// fetched only when the Description field is chosen. Preview thumbnails come from `/api/listings?ids=` for the
// rows shown.
import React, { useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { SidePanel } from '@/components/ds/overlay/SidePanel';
import { FormField } from '@/components/ds/inputs/FormField';
import { Select, type SelectOption } from '@/components/ds/inputs/Select';
import { TextField } from '@/components/ds/inputs/TextField';
import { Checkbox } from '@/components/ds/inputs/Checkbox';
import { Thumb } from '@/components/ds/data/Thumb';
import { RadioGroup, type RadioOption } from '@/components/ds/inputs/RadioGroup';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { PanelSkeleton } from '@/components/ds/state/Skeletons';
import { useToast } from '@/components/ds/feedback/toast';
import { icons } from '@/lib/ds/icons';
import { neutral as n, radius, space, px, tone } from '@/lib/ds/tokens';
import { checkTitle } from '@/lib/etsy/seoRules';
import type { ListingMarketplace } from '@/lib/listings/types';
import {
  applyListingRows,
  MARKETPLACE_LIMITS,
  readListingsCsv,
  stageableFields,
  unsentFieldsWithoutValue,
  type CurrentListing,
  type ImportPatch,
} from '@/lib/listings/csvImport';
import {
  fetchOpenDraftRows,
  fetchRowsByIds,
  fetchToolText,
  stageMany,
  textStyle,
  toolSearchParams,
  ToolFetchError,
  type ListingsToolPanelProps,
} from './ToolsMenuItems';

export type FindReplaceField = 'title' | 'tags' | 'description' | 'materials';
export type FindReplaceScope = 'view' | 'selected';

/**
 * Fields offered per marketplace. Description needs StagePatch.description (requested from G0/G5): opt-in.
 * Materials (Etsy) needs the adapter to stage Etsy draft fields (`stagesEtsyExtras`): opt-in.
 */
export function findReplaceFields(marketplace: ListingMarketplace, opts: { description?: boolean; materials?: boolean } = {}): FindReplaceField[] {
  const out: FindReplaceField[] = stageableFields(marketplace, opts).filter((f): f is 'title' | 'tags' | 'description' => f === 'title' || f === 'tags' || f === 'description');
  if (opts.materials && marketplace === 'etsy') out.push('materials');
  return out;
}

/** Etsy materials limits (the listing editor's: 13 materials, 45 characters each). */
export const ETSY_MATERIALS = { max: 13, maxLen: 45 } as const;

/**
 * Why a change is shown but not staged: over the limit, a tag over its length or holding a tag separator
 * (`,` `|` `;` would split differently on send and on re-import), an empty title, an unsent value of this field
 * the tool cannot read (staging would replace it), or a draft being sent right now.
 */
export type FindReplaceFlag = 'overLimit' | 'tagTooLong' | 'tagSeparator' | 'empty' | 'unsentChange' | 'sending';

const TAG_SEPARATORS = /[,|;]/;

export type FindReplaceChange = {
  id: string;
  /** Listing title (before), for the preview row. */
  title: string;
  before: string;
  after: string;
  /** `etsy.fields.materials` for the materials field (the Etsy draft's fieldPatch key). */
  patch: ImportPatch & { etsy?: { fields?: Record<string, unknown> } };
  /** Set when the result would be rejected; the row shows the reason and is not staged. */
  flag?: FindReplaceFlag;
  flagParams?: Record<string, number>;
};

export type FindReplaceResult = { changes: FindReplaceChange[]; stageable: FindReplaceChange[]; flagged: number };

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Literal (not regex) find, every occurrence. Case-insensitive unless `matchCase`. */
export function findRegExp(find: string, matchCase: boolean): RegExp | null {
  if (!find) return null;
  return new RegExp(escapeRegExp(find), matchCase ? 'gu' : 'giu');
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

function cleanTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = collapse(raw);
    const key = tag.toLocaleLowerCase('tr');
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** Pure: what Find & replace would stage for these listings. */
export function computeFindReplace(
  listings: CurrentListing[],
  input: { field: FindReplaceField; find: string; replace: string; matchCase: boolean },
  marketplace: ListingMarketplace,
): FindReplaceResult {
  const re = findRegExp(input.find, input.matchCase);
  const changes: FindReplaceChange[] = [];
  if (!re) return { changes, stageable: [], flagged: 0 };
  const limits = MARKETPLACE_LIMITS[marketplace];
  const swap = (s: string) => s.replace(re, () => input.replace);

  /** Draft-level reasons that win over any value check. */
  const draftFlag = (l: CurrentListing): FindReplaceFlag | null => {
    if (l.draft?.status === 'syncing') return 'sending';
    if (unsentFieldsWithoutValue(l).includes(input.field)) return 'unsentChange';
    return null;
  };

  for (const l of listings) {
    const before = changes.length;
    if (input.field === 'title') {
      if (!l.title || l.title.search(re) === -1) continue;
      const after = collapse(swap(l.title));
      if (after === l.title) continue;
      const change: FindReplaceChange = { id: l.id, title: l.title, before: l.title, after, patch: { title: after } };
      if (!after) change.flag = 'empty';
      else if (marketplace === 'etsy' ? checkTitle(after).issues.includes('too_long') : after.length > limits.titleMax) {
        change.flag = 'overLimit';
        change.flagParams = { max: limits.titleMax };
      }
      changes.push(change);
    } else if (input.field === 'tags') {
      if (!l.tags?.length || !limits.tags) continue;
      if (!l.tags.some((tag) => tag.search(re) !== -1)) continue;
      const afterTags = cleanTags(l.tags.map(swap));
      const before = l.tags.join(', ');
      const after = afterTags.join(', ');
      if (after === before) continue;
      const change: FindReplaceChange = { id: l.id, title: l.title, before, after, patch: { tags: afterTags } };
      if (afterTags.some((tag) => TAG_SEPARATORS.test(tag))) change.flag = 'tagSeparator';
      else if (afterTags.some((tag) => tag.length > limits.tags!.maxLen)) {
        change.flag = 'tagTooLong';
        change.flagParams = { max: limits.tags.maxLen };
      }
      changes.push(change);
    } else if (input.field === 'materials') {
      if (marketplace !== 'etsy' || !l.materials?.length) continue;
      if (!l.materials.some((m) => m.search(re) !== -1)) continue;
      const afterList = cleanTags(l.materials.map(swap));
      const before = l.materials.join(', ');
      const after = afterList.join(', ');
      if (after === before) continue;
      const change: FindReplaceChange = { id: l.id, title: l.title, before, after, patch: { etsy: { fields: { materials: afterList } } } };
      if (afterList.some((m) => TAG_SEPARATORS.test(m))) change.flag = 'tagSeparator';
      else if (afterList.some((m) => m.length > ETSY_MATERIALS.maxLen)) {
        change.flag = 'tagTooLong';
        change.flagParams = { max: ETSY_MATERIALS.maxLen };
      } else if (afterList.length > ETSY_MATERIALS.max) {
        change.flag = 'overLimit';
        change.flagParams = { max: ETSY_MATERIALS.max };
      }
      changes.push(change);
    } else {
      const desc = l.description ?? '';
      if (!desc || desc.search(re) === -1) continue;
      const after = swap(desc);
      if (after === desc) continue;
      changes.push({ id: l.id, title: l.title, before: desc, after, patch: { description: after } });
    }
    if (changes.length > before) {
      const flag = draftFlag(l);
      if (flag) {
        changes[changes.length - 1].flag = flag;
        delete changes[changes.length - 1].flagParams;
      }
    }
  }
  const stageable = changes.filter((c) => !c.flag);
  return { changes, stageable, flagged: changes.length - stageable.length };
}

/** Splits `text` around matches so the preview can highlight them. */
export function highlightParts(text: string, re: RegExp | null): { text: string; match: boolean }[] {
  if (!re) return [{ text, match: false }];
  const parts: { text: string; match: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(new RegExp(re.source, re.flags))) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at), match: false });
    if (m[0]) parts.push({ text: m[0], match: true });
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts;
}

/**
 * `before` with every match swapped for `replace`, as parts (the replacement marked), for the after line.
 * Null when whitespace clean-up makes the parts differ from the staged text (then the line is shown plain).
 */
export function replacedParts(before: string, re: RegExp | null, replace: string, after: string): { text: string; match: boolean }[] | null {
  if (!re) return null;
  const parts = highlightParts(before, re).map((p) => (p.match ? { text: replace, match: true } : p));
  return parts.map((p) => p.text).join('') === after ? parts.filter((p) => p.text) : null;
}

const PREVIEW_MAX = 50;
/** Description previews show the text around the first match only. */
const SNIPPET = 60;

function snippet(text: string, re: RegExp | null): string {
  if (!re || text.length <= SNIPPET * 2) return text;
  const at = text.search(new RegExp(re.source, re.flags.replace('g', '')));
  if (at < 0) return `${text.slice(0, SNIPPET * 2)}…`;
  const start = Math.max(0, at - SNIPPET);
  return `${start > 0 ? '…' : ''}${text.slice(start, at + SNIPPET)}${at + SNIPPET < text.length ? '…' : ''}`;
}

export interface FindReplacePanelProps extends ListingsToolPanelProps {
  /** Override the offered fields (default `findReplaceFields(marketplace)`, plus description when the adapter stages it). */
  fields?: FindReplaceField[];
}

export function FindReplacePanel({ open, onClose, ctx, fields: fieldsProp }: FindReplacePanelProps) {
  const t = useTranslations('listings');
  const toast = useToast();
  // Description is offered when the staging adapter carries it into the draft (Etsy, ExtendedStagePatch.description);
  // materials when it carries Etsy draft fields (ExtendedStagePatch.etsy.fields).
  const adapterCaps = ctx.adapter as { stagesDescription?: boolean; stagesEtsyExtras?: boolean };
  const fields = fieldsProp ?? findReplaceFields(ctx.marketplace, { description: Boolean(adapterCaps.stagesDescription), materials: Boolean(adapterCaps.stagesEtsyExtras) });
  const unavailable = fields.length === 0;
  const [field, setField] = useState<FindReplaceField>(fields[0] ?? 'title');
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const hasSelection = ctx.selectedIds.length > 0;
  const [scope, setScope] = useState<FindReplaceScope>(hasSelection ? 'selected' : 'view');
  // The page keeps this panel mounted and toggles `open`: start fresh on every open.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setField(fields[0] ?? 'title');
      setFind('');
      setReplace('');
      setMatchCase(false);
      setScope(hasSelection ? 'selected' : 'view');
    }
  }
  const effectiveScope: FindReplaceScope = scope === 'selected' && !hasSelection ? 'view' : scope;
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const abort = useRef({ aborted: false });

  const url = useMemo(() => {
    if (!open || !ctx.store || unavailable) return null;
    const p = toolSearchParams(ctx);
    if (field === 'description') p.set('includeDescription', '1');
    return `/api/listings/export?${p.toString()}`;
  }, [open, ctx, field, unavailable]);

  const { data, error, isLoading, mutate } = useSWR(
    url,
    async (u: string) => {
      const [text, drafts] = await Promise.all([fetchToolText(u), fetchOpenDraftRows(ctx)]);
      return Array.from(applyListingRows(readListingsCsv(text), drafts).values());
    },
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  const scoped = useMemo(() => {
    if (!data) return [];
    if (effectiveScope === 'view') return data;
    const ids = new Set(ctx.selectedIds);
    return data.filter((l) => ids.has(l.id));
  }, [data, effectiveScope, ctx.selectedIds]);

  const result = useMemo(() => computeFindReplace(scoped, { field, find, replace, matchCase }, ctx.marketplace), [scoped, field, find, replace, matchCase, ctx.marketplace]);
  const re = useMemo(() => findRegExp(find, matchCase), [find, matchCase]);
  const count = result.stageable.length;

  // Thumbnails for the preview rows (the export has no image column).
  const previewIds = useMemo(() => result.changes.slice(0, PREVIEW_MAX).map((c) => c.id), [result.changes]);
  const thumbKey = open && ctx.store && previewIds.length ? `fr-thumbs:${ctx.marketplace}:${ctx.store.id}:${previewIds.join(',')}` : null;
  const thumbs = useSWR(thumbKey, () => fetchRowsByIds(ctx, previewIds), { revalidateOnFocus: false, keepPreviousData: true, shouldRetryOnError: false });

  const close = () => {
    abort.current.aborted = true;
    onClose();
  };

  const stage = async () => {
    abort.current = { aborted: false };
    setProgress({ done: 0, total: count });
    const run = await stageMany(
      ctx.adapter,
      result.stageable.map((c) => ({ id: c.id, patch: c.patch })),
      (done, total) => setProgress({ done, total }),
      { signal: abort.current },
    );
    setProgress(null);
    if (run.done.length) ctx.onChanged?.();
    if (run.failed.length) {
      toast.error(t('tools.stageFailed', { count: run.failed.length }), { persist: false });
      return;
    }
    toast.success(t('tools.staged', { count: run.done.length }));
    close();
  };

  const fieldOptions: SelectOption<FindReplaceField>[] = fields.map((f) => ({ value: f, label: t(`fr.fields.${f}`) }));
  const scopeOptions: RadioOption<FindReplaceScope>[] = [
    { value: 'view', label: t('fr.scopeView', { count: ctx.viewCount }) },
    {
      value: 'selected',
      label: t('fr.scopeSelected', { count: ctx.selectedIds.length }),
      disabled: !hasSelection,
      disabledReason: hasSelection ? undefined : t('fr.noneSelected'),
    },
  ];

  const busy = progress !== null;
  const loadError = error instanceof ToolFetchError ? error : error ? new ToolFetchError(0) : null;

  return (
    <SidePanel
      padded
      open={open}
      onClose={close}
      size="md"
      title={t('tools.findReplace')}
      primary={{
        id: 'fr-stage',
        label: t('fr.stage', { count }),
        icon: icons.unsent,
        onClick: stage,
        loading: busy,
        loadingLabel: progress ? t('csv.staging', { done: progress.done, total: progress.total }) : undefined,
        disabled: count === 0 || busy,
        disabledReason: unavailable ? t('tools.findReplaceUnavailable') : count === 0 ? t('fr.nothingToStage') : undefined,
      }}
      data-testid="listings-tool-findReplace"
    >
      {unavailable ? (
        <EmptyState kind="locked" title={t('tools.findReplaceUnavailable')} />
      ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: px(space[4]) }}>
        {fields.length > 1 && (
          <FormField label={t('fr.field')}>
            <Select<FindReplaceField> value={field} onChange={setField} options={fieldOptions} fullWidth />
          </FormField>
        )}
        <FormField label={t('fr.find')}>
          <TextField value={find} onChange={(v) => setFind(v)} autoFocus data-testid="fr-find" />
        </FormField>
        <FormField label={t('fr.replace')}>
          <TextField value={replace} onChange={(v) => setReplace(v)} data-testid="fr-replace" />
        </FormField>
        <Checkbox checked={matchCase} onChange={setMatchCase} label={t('fr.matchCase')} />
        <RadioGroup<FindReplaceScope> value={effectiveScope} onChange={setScope} options={scopeOptions} aria-label={t('fr.scope')} />

        <section aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: px(space[2]) }}>
          {loadError && !data ? (
            <ErrorState
              variant="inline"
              title={t('tools.loadFailed')}
              cause={loadError.status >= 500 || loadError.status === 0 ? t('error.serverNoResponse') : undefined}
              errorId={loadError.errorId}
              onRetry={() => void mutate()}
            />
          ) : isLoading && !data ? (
            <PanelSkeleton sections={1} />
          ) : !find ? null : result.changes.length === 0 ? (
            <EmptyState kind="no-results" compact title={t('fr.noMatches')} />
          ) : (
            <>
              <p style={textStyle('label', n[700])} data-testid="fr-summary">
                {t('fr.summary', { count, flagged: result.flagged })}
              </p>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: px(space[2]) }}>
                {result.changes.slice(0, PREVIEW_MAX).map((c) => (
                  <PreviewRow
                    key={c.id}
                    change={c}
                    re={re}
                    replace={replace}
                    field={field}
                    thumbUrl={thumbs.data?.get(c.id)?.thumbUrl ?? null}
                    flagLabel={c.flag ? flagText(t, c) : null}
                  />
                ))}
              </ul>
              {result.changes.length > PREVIEW_MAX && (
                <p style={textStyle('caption', n[500])}>{t('fr.andMore', { count: result.changes.length - PREVIEW_MAX })}</p>
              )}
            </>
          )}
        </section>
      </div>
      )}
    </SidePanel>
  );
}

type T = ReturnType<typeof useTranslations>;

function flagText(t: T, c: FindReplaceChange): string {
  if (c.flag === 'overLimit') return t('fr.overLimit', { max: c.flagParams?.max ?? 0 });
  if (c.flag === 'tagTooLong') return t('fr.tagTooLong', { max: c.flagParams?.max ?? 0 });
  if (c.flag === 'tagSeparator') return t('fr.tagSeparator');
  if (c.flag === 'unsentChange') return t('fr.unsentChange');
  if (c.flag === 'sending') return t('fr.sending');
  return t('fr.emptyResult');
}

function Highlighted({ text, re, tint, parts: given }: { text: string; re: RegExp | null; tint: 'before' | 'after'; parts?: { text: string; match: boolean }[] | null }) {
  const parts = given ?? highlightParts(text, re);
  return (
    <>
      {parts.map((p, i) =>
        p.match ? (
          <mark
            key={i}
            style={{
              background: tint === 'before' ? tone.danger.bg : tone.success.bg,
              color: tint === 'before' ? tone.danger.fg : tone.success.fg,
              borderRadius: px(radius.xs),
              padding: '0 1px',
            }}
          >
            {p.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{p.text}</React.Fragment>
        ),
      )}
    </>
  );
}

function PreviewRow({
  change,
  re,
  replace,
  field,
  thumbUrl,
  flagLabel,
}: {
  change: FindReplaceChange;
  re: RegExp | null;
  replace: string;
  field: FindReplaceField;
  thumbUrl: string | null;
  flagLabel: string | null;
}) {
  const before = field === 'description' ? snippet(change.before, re) : change.before;
  const after = field === 'description' ? snippet(change.after, null) : change.after;
  // Title/tags: the replaced text marked in the after line. Description snippets mark occurrences of the replacement.
  const afterParts =
    field === 'description'
      ? replace
        ? highlightParts(after, findRegExp(replace, true))
        : null
      : replacedParts(change.before, re, replace, change.after);
  return (
    <li
      data-testid={`fr-row-${change.id}`}
      style={{
        border: `1px solid ${flagLabel ? tone.danger.border : n[200]}`,
        borderRadius: px(radius.md),
        padding: `${px(space[2])} ${px(space[3])}`,
        display: 'flex',
        gap: px(space[3]),
        alignItems: 'flex-start',
      }}
    >
      <Thumb src={thumbUrl} alt={change.title} size={32} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: px(space[1]), minWidth: 0, flex: 1 }}>
        {field !== 'title' && <span style={{ ...textStyle('caption', n[500]), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{change.title}</span>}
        <span style={{ ...textStyle('dense', n[600]), textDecoration: 'line-through', textDecorationColor: n[300] }}>
          <Highlighted text={before} re={re} tint="before" />
        </span>
        <span style={textStyle('dense', n[900])} data-testid={`fr-after-${change.id}`}>
          {afterParts ? <Highlighted text={after} re={null} tint="after" parts={afterParts} /> : after}
        </span>
        {flagLabel && <span style={textStyle('caption', tone.danger.fg)}>{flagLabel}</span>}
      </span>
    </li>
  );
}

export default FindReplacePanel;
