// components/domain/listings/tools/EbayCsvCreateSection.tsx — the "Create new listings" mode of the eBay CSV import
// (CsvImportPanel, listings-grid §10). Pure planning lives in `ebayCsvCreate.ts`; this hook owns the mapping, the
// existing-SKU lookup (the store export), staging (one create draft per row, never a live write) and the preview.
// The SidePanel stays CsvImportPanel's: this returns its primary and the mapping/preview body.
import * as React from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page/Section';
import { Select, type SelectOption } from '@/components/ds/inputs/Select';
import { Button } from '@/components/ds/inputs/Button';
import { DataTable, type Column } from '@/components/ds/data/DataTable';
import { Banner } from '@/components/ds/feedback/Banner';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { PanelSkeleton } from '@/components/ds/state/Skeletons';
import { useToast } from '@/components/ds/feedback/toast';
import type { ActionSpec } from '@/components/ds/page';
import { icons } from '@/lib/ds/icons';
import { neutral as n, space, px, tone, font } from '@/lib/ds/tokens';
import { readListingsCsv, type ParsedCsv } from '@/lib/listings/csvImport';
import { newListingHref } from '@/lib/listingEditor/editorNav';
import { ebayAdapter } from '@/components/domain/listing-editor/adapters/ebay';
import {
  buildEbayCreatePlan,
  detectEbayCreateMapping,
  EBAY_CREATE_FIELDS,
  localSkusFor,
  setEbayCreateMapping,
  stageEbayCreateRow,
  type EbayCreateField,
  type EbayCreateIssue,
  type EbayCreateMapping,
  type EbayCreatePlanRow,
} from './ebayCsvCreate';
import { fetchToolText, storeSearchParams, textStyle, ToolFetchError, type ListingsToolContext } from './ToolsMenuItems';

const PREVIEW_MAX = 200;
type MapValue = EbayCreateField | 'ignore';

/** Template for the create mode (header only). */
export const EBAY_CREATE_TEMPLATE = `${EBAY_CREATE_FIELDS.join(',')}\n`;

export interface UseEbayCsvCreate {
  primary: ActionSpec | undefined;
  body: React.ReactNode;
}

export function useEbayCsvCreate({ active, csv, ctx }: { active: boolean; csv: ParsedCsv | null; ctx: ListingsToolContext }): UseEbayCsvCreate {
  const t = useTranslations('listings');
  const tRoot = useTranslations();
  const toast = useToast();
  const [mapping, setMap] = React.useState<EbayCreateMapping>([]);
  /** line → staged draft id. */
  const [staged, setStaged] = React.useState<Map<number, string>>(() => new Map());
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const abort = React.useRef(false);

  // A new file (or switching into this mode) starts fresh.
  const [csvSeen, setCsvSeen] = React.useState<ParsedCsv | null>(null);
  if (csv !== csvSeen) {
    setCsvSeen(csv);
    setMap(csv ? detectEbayCreateMapping(csv.headers) : []);
    setStaged(new Map());
    setProgress(null);
  }
  React.useEffect(() => () => void (abort.current = true), []);

  const skuMapped = mapping.includes('sku');
  const titleMapped = mapping.includes('title');
  const existingUrl = active && csv && skuMapped && ctx.store ? `/api/listings/export?${storeSearchParams(ctx).toString()}` : null;
  const existing = useSWR(existingUrl, async (u: string) => new Set(readListingsCsv(await fetchToolText(u)).keys()), {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  const defaults = React.useMemo(() => (active ? ebayAdapter.readCreateDefaults(ctx.store?.id ?? 'ebay') : {}), [active, ctx.store?.id]);
  const plan = React.useMemo(() => {
    if (!active || !csv || !skuMapped || !titleMapped || !existing.data) return null;
    return buildEbayCreatePlan({ csv, mapping, existingSkus: existing.data, defaults });
  }, [active, csv, skuMapped, titleMapped, existing.data, mapping, defaults]);
  const queue = React.useMemo(() => (plan ? plan.rows.filter((r) => r.kind !== 'invalid' && !staged.has(r.line)) : []), [plan, staged]);

  const issueText = React.useCallback((i: EbayCreateIssue) => (i.root ? tRoot(i.key, i.params) : t(i.key, i.params)), [t, tRoot]);

  const stage = React.useCallback(async () => {
    if (!queue.length || progress) return;
    abort.current = false;
    const skus = localSkusFor(queue.length);
    const done = new Map<number, string>();
    let failed = 0;
    setProgress({ done: 0, total: queue.length });
    for (let i = 0; i < queue.length; i++) {
      if (abort.current) break;
      try {
        const draft = await stageEbayCreateRow(queue[i], skus[i]);
        if (draft) done.set(queue[i].line, draft.id);
        else failed += 1;
      } catch {
        failed += 1;
      }
      setProgress({ done: i + 1, total: queue.length });
    }
    setProgress(null);
    if (done.size) {
      setStaged((prev) => new Map([...prev, ...done]));
      ctx.onChanged?.();
    }
    if (failed) toast.error(t('csv.stagePartial', { done: done.size, failed }), { persist: false });
    else if (done.size) toast.success(t('csv.create.staged', { count: done.size }));
  }, [queue, progress, ctx, toast, t]);

  const primary: ActionSpec | undefined =
    active && plan
      ? {
          id: 'csv-create-stage',
          label: t('csv.create.stage', { count: queue.length }),
          icon: icons.unsent,
          onClick: () => void stage(),
          loading: progress !== null,
          loadingLabel: progress ? t('csv.staging', { done: progress.done, total: progress.total }) : undefined,
          disabled: queue.length === 0 || progress !== null,
          disabledReason: queue.length === 0 ? t('csv.nothingToStage') : undefined,
        }
      : undefined;

  if (!active || !csv) return { primary, body: null };

  const fieldLabel = (f: EbayCreateField) => (f === 'sku' ? 'SKU' : t(`csv.create.fields.${f}`));
  const mapOptions: SelectOption<MapValue>[] = [{ value: 'ignore', label: t('csv.ignore') }, ...EBAY_CREATE_FIELDS.map((f) => ({ value: f as MapValue, label: fieldLabel(f) }))];

  const columns: Column<EbayCreatePlanRow>[] = [
    { key: 'line', header: t('csv.line'), type: 'number', width: 64, align: 'right', value: (r) => r.line, mobile: 'meta' },
    {
      key: 'listing',
      header: t('col.listing'),
      minWidth: 220,
      mobile: 'title',
      render: (r) => (
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ ...textStyle('body'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title || '—'}</span>
          <span style={{ ...textStyle('caption', n[500]), fontFamily: font.mono }}>{r.sku || '—'}</span>
        </span>
      ),
      mobileRender: (r) => r.title || r.sku || '—',
    },
    {
      key: 'result',
      header: t('csv.result'),
      minWidth: 220,
      mobile: 'subtitle',
      render: (r) => {
        const draftId = staged.get(r.line);
        if (draftId) {
          return (
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: px(space[1]) }}>
              <span style={textStyle('caption', tone.success.fg)}>{t('csv.rowStaged')}</span>
              <Button variant="ghost" size="sm" icon={icons.edit} href={newListingHref('ebay', null, { draft: draftId })}>
                {t('csv.create.openEditor')}
              </Button>
            </span>
          );
        }
        if (r.kind === 'invalid') {
          return (
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              {r.issues.map((i) => (
                <span key={i.key} style={textStyle('dense', tone.danger.fg)}>
                  {issueText(i)}
                </span>
              ))}
            </span>
          );
        }
        if (r.kind === 'incomplete') {
          return (
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={textStyle('dense', tone.warning.fg)}>{t('csv.create.incomplete')}</span>
              <span style={textStyle('caption', n[600])}>{r.missing.map(issueText).join(' · ')}</span>
            </span>
          );
        }
        return <span style={textStyle('dense', n[900])}>{t('csv.create.ready')}</span>;
      },
    },
  ];

  const loadError = existing.error ? (existing.error instanceof ToolFetchError ? existing.error : new ToolFetchError(0)) : null;
  const body = (
    <>
      <Section id="csv-create-mapping" title={t('csv.mapping')} headingLevel={3} variant="plain">
        <div style={{ display: 'flex', flexDirection: 'column', gap: px(space[2]) }}>
          {csv.headers.map((h, i) => (
            <div key={`${h}-${i}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: px(space[3]), alignItems: 'center' }}>
              <span style={{ ...textStyle('dense', n[800]), fontFamily: font.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h || '—'}</span>
              <Select<MapValue>
                value={mapping[i] ?? 'ignore'}
                onChange={(v) => setMap((m) => setEbayCreateMapping(m, i, v === 'ignore' ? null : v))}
                options={mapOptions}
                size="sm"
                fullWidth
                aria-label={t('csv.mapColumn', { column: h })}
                data-testid={`csv-create-map-${i}`}
              />
            </div>
          ))}
          {!skuMapped || !titleMapped ? <span style={textStyle('dense', tone.danger.fg)}>{t('csv.create.required')}</span> : null}
        </div>
      </Section>
      {skuMapped && titleMapped ? (
        <Section id="csv-create-preview" title={t('csv.preview')} headingLevel={3} variant="plain">
          {loadError && !plan ? (
            <ErrorState
              variant="inline"
              title={t('tools.loadFailed')}
              cause={loadError.status >= 500 || loadError.status === 0 ? t('error.serverNoResponse') : undefined}
              errorId={loadError.errorId}
              onRetry={() => void existing.mutate()}
            />
          ) : !plan ? (
            <PanelSkeleton sections={1} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: px(space[3]) }}>
              <Banner tone="info" title={t('csv.create.note')} />
              <p style={textStyle('label', n[700])} data-testid="csv-create-summary">
                {t('csv.create.summary', { rows: plan.summary.rows, ready: plan.summary.ready, incomplete: plan.summary.incomplete, invalid: plan.summary.invalid })}
              </p>
              <DataTable<EbayCreatePlanRow>
                rows={plan.rows.slice(0, PREVIEW_MAX)}
                columns={columns}
                getRowId={(r) => `${r.line}`}
                state="ready"
                density="compact"
                columnStateKey="listings-import-ebay-create"
                ariaLabel={t('csv.preview')}
                stickyHeader={false}
                caption={plan.rows.length > PREVIEW_MAX ? t('fr.andMore', { count: plan.rows.length - PREVIEW_MAX }) : undefined}
              />
            </div>
          )}
        </Section>
      ) : null}
    </>
  );
  return { primary, body };
}
