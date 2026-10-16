// components/domain/listings/tools/CsvImportPanel.tsx — listings-grid §10 "Import CSV" (M5 G6).
// SidePanel lg, three steps in one scroll:
//   1 Drop or choose a file (≤ 5 MB, .csv) · Download template (the id column + editable columns).
//   2 Match your columns: detected header → field (`id` required: Etsy listing_id, eBay sku, Trendyol barcode,
//     Wix/Shopify id).
//   3 Preview: matched rows that change, "not found" rows and invalid cells (reason shown); unchanged rows hidden.
//     Summary "120 rows · 96 listings will change · 3 not found · 2 invalid".
// Primary "Stage 96 changes" (progress "Staging 40 / 96…"). Resumable: a failed item stays in the queue and the
// primary re-offers only what is left. Every change is a staged draft; nothing is sent from here.
// eBay also offers "Create new listings" (EbayCsvCreateSection.tsx): each row becomes a staged create draft.
//
// Current values = the export (live) with every open draft overlaid (`fetchOpenDraftRows` + `applyListingRows`),
// so a row is diffed against the seller's unsent value. Price/qty are staged only for listings whose
// `ListingRow.editable` (read from `/api/listings?ids=` for those rows) proves them editable: the export has no
// editability column (variations, stock sync, not tracked). A change that replaces an unsent value is warned.
import React, { useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { SidePanel } from '@/components/ds/overlay/SidePanel';
import { SegmentedControl } from '@/components/ds/inputs/SegmentedControl';
import { Section } from '@/components/ds/page/Section';
import { Button } from '@/components/ds/inputs/Button';
import { Select, type SelectOption } from '@/components/ds/inputs/Select';
import { DataTable, type Column } from '@/components/ds/data/DataTable';
import { Banner } from '@/components/ds/feedback/Banner';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { PanelSkeleton } from '@/components/ds/state/Skeletons';
import { useToast } from '@/components/ds/feedback/toast';
import { useFormatters } from '@/lib/format';
import { icons } from '@/lib/ds/icons';
import { logoDisplayName } from '@/lib/ds/logos';
import { neutral as n, radius, space, px, tone, font, accent } from '@/lib/ds/tokens';
import {
  applyListingRows,
  buildImportPlan,
  detectMapping,
  ID_COLUMN,
  IMPORT_MAX_BYTES,
  importTemplateCsv,
  parseCsv,
  readListingsCsv,
  setMapping,
  stageableFields,
  type ColumnMapping,
  type EditableImportField,
  type ImportField,
  type ImportIssue,
  type ImportPlanRow,
  type ParsedCsv,
} from '@/lib/listings/csvImport';
import {
  fetchOpenDraftRows,
  fetchRowsByIds,
  fetchToolText,
  stageMany,
  storeSearchParams,
  textStyle,
  ToolFetchError,
  type ListingsToolPanelProps,
} from './ToolsMenuItems';
import { EBAY_CREATE_TEMPLATE, useEbayCsvCreate } from './EbayCsvCreateSection';

type FileState = { name: string; csv: ParsedCsv } | null;
type FileError = 'tooLarge' | 'notCsv' | 'empty' | 'unreadable' | null;
type MapValue = ImportField | 'ignore';
type ImportMode = 'update' | 'create';

const PREVIEW_MAX = 200;

function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/** Validates and reads a picked file. Pure apart from `file.text()`; exported for tests. */
export async function readImportFile(file: File): Promise<{ ok: true; csv: ParsedCsv } | { ok: false; error: Exclude<FileError, null> }> {
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (ext ? ext !== 'csv' : file.type !== 'text/csv') return { ok: false, error: 'notCsv' };
  if (file.size > IMPORT_MAX_BYTES) return { ok: false, error: 'tooLarge' };
  let text: string;
  try {
    text = await readFileText(file);
  } catch {
    return { ok: false, error: 'unreadable' };
  }
  const csv = parseCsv(text);
  if (!csv.headers.length || !csv.rows.length) return { ok: false, error: 'empty' };
  return { ok: true, csv };
}

export interface CsvImportPanelProps extends ListingsToolPanelProps {
  /** Offer a Description column (needs StagePatch.description; requested from G0/G5). Default false. */
  allowDescription?: boolean;
}

export function CsvImportPanel({ open, onClose, ctx, allowDescription = false }: CsvImportPanelProps) {
  const t = useTranslations('listings');
  const toast = useToast();
  const fmt = useFormatters();
  const inputRef = useRef<HTMLInputElement>(null);
  const abort = useRef({ aborted: false });
  const [file, setFile] = useState<FileState>(null);
  const [fileError, setFileError] = useState<FileError>(null);
  const [mapping, setMap] = useState<ColumnMapping>([]);
  const [dragOver, setDragOver] = useState(false);
  const [staged, setStaged] = useState<Set<string>>(() => new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [mode, setMode] = useState<ImportMode>('update');
  const canCreate = ctx.marketplace === 'ebay';
  const creating = canCreate && mode === 'create';
  // The page keeps this panel mounted and toggles `open`: start fresh on every open (no stale file or plan).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setFile(null);
      setFileError(null);
      setMap([]);
      setDragOver(false);
      setStaged(new Set());
      setProgress(null);
      setMode('update');
    }
  }

  const fields = useMemo(() => stageableFields(ctx.marketplace, { description: allowDescription }), [ctx.marketplace, allowDescription]);
  const idMapped = !creating && mapping.includes('id');
  const descriptionMapped = mapping.includes('description');

  // Current values of every listing in the store (for not-found, unchanged and the before → after preview).
  const currentUrl = useMemo(() => {
    if (!open || !ctx.store || !file || !idMapped) return null;
    const p = storeSearchParams(ctx);
    if (descriptionMapped) p.set('includeDescription', '1');
    return `/api/listings/export?${p.toString()}`;
  }, [open, ctx, file, idMapped, descriptionMapped]);
  const current = useSWR(
    currentUrl,
    async (u: string) => {
      const [text, drafts] = await Promise.all([fetchToolText(u), fetchOpenDraftRows(ctx)]);
      return applyListingRows(readListingsCsv(text), drafts);
    },
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  // Rows whose price/qty would change but whose editability is not known yet (drafted rows already carry it).
  const editableIds = useMemo(() => {
    if (!file || !idMapped || !current.data) return null;
    const prelim = buildImportPlan({ csv: file.csv, mapping, current: current.data, marketplace: ctx.marketplace, fields });
    const ids = prelim.rows.filter((r) => r.current && !r.current.editable && (r.patch.price !== undefined || r.patch.qty !== undefined)).map((r) => r.id);
    return Array.from(new Set(ids)).sort();
  }, [file, idMapped, mapping, current.data, ctx.marketplace, fields]);
  const editable = useSWR(
    currentUrl && editableIds?.length ? ['csv-import-editable', currentUrl, editableIds.join(',')] : null,
    () => fetchRowsByIds(ctx, editableIds ?? []),
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  const plan = useMemo(() => {
    if (!file || !idMapped || !current.data || !editableIds) return null;
    if (editableIds.length && !editable.data) return null;
    const merged = editable.data ? applyListingRows(current.data, Array.from(editable.data.values())) : current.data;
    return buildImportPlan({ csv: file.csv, mapping, current: merged, marketplace: ctx.marketplace, fields, requireEditable: true });
  }, [file, idMapped, mapping, current.data, editableIds, editable.data, ctx.marketplace, fields]);

  const queue = useMemo(() => (plan ? plan.rows.filter((r) => r.kind === 'change' && !staged.has(r.id)) : []), [plan, staged]);
  const visibleRows = useMemo(() => (plan ? plan.rows.filter((r) => r.kind !== 'unchanged') : []), [plan]);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    const res = await readImportFile(f);
    if (!res.ok) {
      setFileError(res.error);
      return;
    }
    setFileError(null);
    setStaged(new Set());
    setFile({ name: f.name, csv: res.csv });
    setMap(detectMapping(res.csv.headers, ctx.marketplace, fields));
  };

  const createMode = useEbayCsvCreate({ active: creating && open, csv: file?.csv ?? null, ctx });

  const downloadTemplate = () => {
    const blob = new Blob([creating ? EBAY_CREATE_TEMPLATE : importTemplateCsv(ctx.marketplace)], { type: 'text/csv;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = creating ? 'ebay-new-listings-template.csv' : `${ctx.marketplace}-listings-template.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  const stage = async () => {
    abort.current = { aborted: false };
    const items = queue.map((r) => ({ id: r.id, patch: r.patch }));
    setProgress({ done: 0, total: items.length });
    const run = await stageMany(ctx.adapter, items, (done, total) => setProgress({ done, total }), { signal: abort.current });
    setProgress(null);
    if (run.done.length) {
      setStaged((prev) => new Set([...prev, ...run.done]));
      ctx.onChanged?.();
    }
    if (run.failed.length) {
      toast.error(t('csv.stagePartial', { done: run.done.length, failed: run.failed.length }), { persist: false });
      return;
    }
    toast.success(t('tools.staged', { count: run.done.length }));
    onClose();
  };

  const close = () => {
    abort.current.aborted = true;
    onClose();
  };

  const fieldLabel = (f: ImportField) => (f === 'id' ? ID_COLUMN[ctx.marketplace] : t(`csv.fields.${f}`));
  const mapOptions: SelectOption<MapValue>[] = [
    { value: 'ignore', label: t('csv.ignore') },
    { value: 'id', label: fieldLabel('id') },
    ...fields.map((f) => ({ value: f as MapValue, label: fieldLabel(f) })),
  ];

  const money = (v: number | null | undefined) => fmt.money(v ?? null, ctx.store?.currency ?? 'USD');
  const describeChange = (r: ImportPlanRow, f: EditableImportField): string => {
    if (f === 'price') return `${t('col.price')}: ${money(r.current?.price)} → ${money(r.patch.price)}`;
    if (f === 'quantity') return `${t('col.qty')}: ${fmt.num(r.current?.quantity ?? null)} → ${fmt.num(r.patch.qty ?? null)}`;
    return t(`csv.fields.${f}`);
  };

  const issueText = (i: ImportIssue): string => {
    const params: Record<string, string | number> = { ...i.params };
    if (typeof params.marketplace === 'string') params.marketplace = logoDisplayName(params.marketplace) ?? params.marketplace;
    if (i.key === 'validate.priceMin' && typeof params.min === 'number') params.min = money(params.min);
    return t(i.key, params);
  };

  const columns: Column<ImportPlanRow>[] = [
    { key: 'line', header: t('csv.line'), type: 'number', width: 64, align: 'right', value: (r) => r.line, mobile: 'meta' },
    {
      key: 'listing',
      header: t('col.listing'),
      minWidth: 220,
      mobile: 'title',
      render: (r) => (
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ ...textStyle('body'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.current?.title || r.id}</span>
          <span style={{ ...textStyle('caption', n[500]), fontFamily: font.mono }}>{r.id}</span>
        </span>
      ),
      mobileRender: (r) => r.current?.title || r.id,
    },
    {
      key: 'result',
      header: t('csv.result'),
      minWidth: 200,
      mobile: 'subtitle',
      render: (r) => {
        if (r.kind === 'not_found') return <span style={textStyle('dense', n[600])}>{t('csv.notFound')}</span>;
        if (r.kind === 'invalid') {
          return (
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              {r.issues.map((i) => (
                <span key={`${i.field}-${i.key}`} style={textStyle('dense', tone.danger.fg)}>
                  {issueText(i)}
                </span>
              ))}
            </span>
          );
        }
        const done = staged.has(r.id);
        return (
          <span style={{ display: 'flex', flexDirection: 'column' }}>
            {r.changed.map((f) => (
              <span key={f} style={textStyle('dense', done ? n[500] : n[900])}>
                {describeChange(r, f)}
              </span>
            ))}
            {!done &&
              r.warnings.map((w) => (
                <span key={`w-${w.field}`} style={textStyle('caption', tone.warning.fg)}>
                  {t(w.key, { field: t(`csv.fields.${w.field}`) })}
                </span>
              ))}
            {done && <span style={textStyle('caption', tone.success.fg)}>{t('csv.rowStaged')}</span>}
          </span>
        );
      },
    },
  ];

  const busy = progress !== null;
  const stageCount = queue.length;
  const anyError = current.error ?? editable.error;
  const loadError = anyError ? (anyError instanceof ToolFetchError ? anyError : new ToolFetchError(0)) : null;

  return (
    <SidePanel
      padded
      open={open}
      onClose={close}
      size="lg"
      title={t('tools.import')}
      primary={
        creating
          ? createMode.primary
          : plan
          ? {
              id: 'csv-stage',
              label: t('csv.stage', { count: stageCount }),
              icon: icons.unsent,
              onClick: stage,
              loading: busy,
              loadingLabel: progress ? t('csv.staging', { done: progress.done, total: progress.total }) : undefined,
              disabled: stageCount === 0 || busy,
              disabledReason: stageCount === 0 ? t('csv.nothingToStage') : undefined,
            }
          : undefined
      }
      data-testid="listings-tool-import"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: px(space[6]) }}>
        {canCreate && (
          <SegmentedControl<ImportMode>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'update', label: t('csv.modeUpdate') },
              { value: 'create', label: t('csv.modeCreate') },
            ]}
            fullWidth
            aria-label={t('csv.modeLabel')}
            data-testid="csv-mode"
          />
        )}
        <Section id="csv-file" title={t('csv.stepFile')} headingLevel={3} variant="plain" action={{ id: 'csv-template', label: t('csv.template'), icon: icons.download, onClick: downloadTemplate }}>
          <div
            data-testid="csv-drop"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void pick(e.dataTransfer.files?.[0]);
            }}
            style={{
              border: `1px dashed ${dragOver ? accent[600] : n[300]}`,
              background: dragOver ? accent[50] : n[25],
              borderRadius: px(radius.md),
              padding: px(space[5]),
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: px(space[2]),
              textAlign: 'center',
            }}
          >
            <span style={textStyle('body', n[700])}>{file ? file.name : t('csv.drop')}</span>
            <span style={textStyle('caption', n[500])}>{t('csv.limit')}</span>
            <Button variant="secondary" size="sm" icon={icons.upload} onClick={() => inputRef.current?.click()}>
              {file ? t('csv.chooseAnother') : t('csv.choose')}
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              data-testid="csv-input"
              aria-label={t('csv.choose')}
              onChange={(e) => {
                void pick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          {fileError && (
            <div style={{ marginTop: px(space[3]) }}>
              <Banner tone="danger" title={t(`csv.${fileError}`)} />
            </div>
          )}
        </Section>

        {creating && createMode.body}

        {file && !creating && (
          <Section id="csv-mapping" title={t('csv.mapping')} headingLevel={3} variant="plain">
            <div style={{ display: 'flex', flexDirection: 'column', gap: px(space[2]) }}>
              {file.csv.headers.map((h, i) => (
                <div key={`${h}-${i}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: px(space[3]), alignItems: 'center' }}>
                  <span style={{ ...textStyle('dense', n[800]), fontFamily: font.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h || '—'}</span>
                  <Select<MapValue>
                    value={mapping[i] ?? 'ignore'}
                    onChange={(v) => setMap((m) => setMapping(m, i, v === 'ignore' ? null : v))}
                    options={mapOptions}
                    size="sm"
                    fullWidth
                    aria-label={t('csv.mapColumn', { column: h })}
                    data-testid={`csv-map-${i}`}
                  />
                </div>
              ))}
              {!idMapped && <span style={textStyle('dense', tone.danger.fg)}>{t('csv.idRequired', { column: ID_COLUMN[ctx.marketplace] })}</span>}
            </div>
          </Section>
        )}

        {file && idMapped && (
          <Section id="csv-preview" title={t('csv.preview')} headingLevel={3} variant="plain">
            {loadError && !plan ? (
              <ErrorState
                variant="inline"
                title={t('tools.loadFailed')}
                cause={loadError.status >= 500 || loadError.status === 0 ? t('error.serverNoResponse') : undefined}
                errorId={loadError.errorId}
                onRetry={() => void (current.error ? current.mutate() : editable.mutate())}
              />
            ) : !plan ? (
              <PanelSkeleton sections={1} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: px(space[3]) }}>
                <p style={textStyle('label', n[700])} data-testid="csv-summary">
                  {t('csv.summary', { rows: plan.summary.rows, change: plan.summary.change, missing: plan.summary.missing, invalid: plan.summary.invalid })}
                </p>
                {visibleRows.length === 0 ? (
                  <EmptyState kind="done" compact title={t('csv.noChanges')} />
                ) : (
                  <DataTable<ImportPlanRow>
                    rows={visibleRows.slice(0, PREVIEW_MAX)}
                    columns={columns}
                    getRowId={(r) => `${r.line}`}
                    state="ready"
                    density="compact"
                    columnStateKey={`listings-import-${ctx.marketplace}`}
                    ariaLabel={t('csv.preview')}
                    stickyHeader={false}
                    caption={visibleRows.length > PREVIEW_MAX ? t('fr.andMore', { count: visibleRows.length - PREVIEW_MAX }) : undefined}
                  />
                )}
              </div>
            )}
          </Section>
        )}
      </div>
    </SidePanel>
  );
}

export default CsvImportPanel;
