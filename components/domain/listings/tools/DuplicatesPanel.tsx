// components/domain/listings/tools/DuplicatesPanel.tsx — listings-grid §10 "Find duplicates" (M5 G6).
// SidePanel lg. Groups from `GET /api/listings/duplicates?marketplace&store` (computed server-side, ≤ 200),
// each a Section with its reason ("Same SKU BB-PINK", "Titles 92% similar") and a DataTable of its rows.
// Row ⋯: Open · the marketplace's own "take it down" actions from `config.rowActions` (Etsy/eBay Deactivate,
// Wix Hide from store; stage at once) · Trendyol Archive… / Delete… (stage after a confirm). No panel primary
// (P1 allows zero). A staged delete/archive is never sent from here or by "Send N": it waits for the explicit
// send with type-to-confirm.
import React, { useMemo, useState } from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { SidePanel } from '@/components/ds/overlay/SidePanel';
import { ConfirmDialog } from '@/components/ds/overlay/ConfirmDialog';
import { Section } from '@/components/ds/page/Section';
import { DataTable, type Column } from '@/components/ds/data/DataTable';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { PanelSkeleton } from '@/components/ds/state/Skeletons';
import { useToast } from '@/components/ds/feedback/toast';
import { icons } from '@/lib/ds/icons';
import type { ActionSpec } from '@/components/ds/types/actions';
import { neutral as n, px, space, font, tone } from '@/lib/ds/tokens';
import type { DuplicateReason, DuplicatesResponse, ListingMarketplace, ListingRow, StagedAction } from '@/lib/listings/types';
import { listingsConfig } from '@/components/domain/listings/config';
import { fetchToolJson, storeSearchParams, textStyle, ToolFetchError, type ListingsToolPanelProps } from './ToolsMenuItems';

type T = ReturnType<typeof useTranslations>;

/** "Same SKU BB-PINK" · "Titles 100% similar" · "Titles 92% similar". */
export function duplicateReasonLabel(t: T, reason: DuplicateReason): string {
  switch (reason.kind) {
    case 'same_sku':
      return t('dup.sameSku', { sku: reason.sku });
    case 'same_title':
      return t('dup.similarTitle', { pct: '100%' });
    case 'similar_title':
      return t('dup.similarTitle', { pct: `${Math.round(reason.similarity)}%` });
    default:
      return '';
  }
}

/** Statuses a seller can deactivate from (anything already off is left alone). */
const DEACTIVATABLE = new Set<ListingRow['status']>(['active', 'sold_out']);

/** The duplicate-cleanup actions this panel knows, by `config.rowActions` key. */
export type DuplicateActionKey = 'deactivate' | 'hideInStore' | 'archive' | 'delete';

/** Row actions the draft rejects never show: only keys the marketplace's config lists (Etsy/eBay deactivate + delete, Wix hide + delete, Shopify delete, Trendyol archive). */
export function duplicateActionKeys(marketplace: ListingMarketplace, rowActions?: readonly string[]): DuplicateActionKey[] {
  const allowed = rowActions ?? listingsConfig(marketplace).rowActions;
  return (['deactivate', 'hideInStore', 'archive', 'delete'] as const).filter((k) => allowed.includes(k));
}

/** Which of `keys` apply to this row (same row rules as the grid's ⋯ menu). */
export function duplicateActionsFor(r: ListingRow, keys: readonly DuplicateActionKey[]): DuplicateActionKey[] {
  if (r.sync?.queuedDelete) return [];
  return keys.filter((k) => {
    if (k === 'deactivate') return DEACTIVATABLE.has(r.status);
    if (k === 'hideInStore') return r.extra.visible !== false && r.status !== 'inactive';
    if (k === 'archive') return r.status !== 'inactive';
    return true;
  });
}

const STAGED_ACTION: Record<DuplicateActionKey, Exclude<StagedAction['type'], 'copy'>> = { deactivate: 'deactivate', hideInStore: 'hide', archive: 'archive', delete: 'delete' };

type Pending = { row: ListingRow; action: 'delete' | 'archive' } | null;

export function DuplicatesPanel({ open, onClose, ctx }: ListingsToolPanelProps) {
  const t = useTranslations('listings');
  const toast = useToast();
  const [confirm, setConfirm] = useState<Pending>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const url = open && ctx.store ? `/api/listings/duplicates?${storeSearchParams(ctx).toString()}` : null;
  const { data, error, isLoading, mutate } = useSWR(url, (u: string) => fetchToolJson<DuplicatesResponse>(u), { revalidateOnFocus: false });

  const stage = async (row: ListingRow, action: Exclude<StagedAction['type'], 'copy'>) => {
    setBusyId(row.id);
    try {
      await ctx.adapter.stage(row.id, {}, { queuedActions: [{ type: action }] });
      toast.success(t(action === 'delete' ? 'dup.deleteStaged' : action === 'archive' ? 'dup.archiveStaged' : action === 'hide' ? 'dup.hideStaged' : 'dup.deactivateStaged'));
      ctx.onChanged?.();
      void mutate();
    } catch {
      toast.error(t('cell.stageFailed'), { persist: false });
    } finally {
      setBusyId(null);
    }
  };

  const columns = useMemo<Column<ListingRow>[]>(
    () => [
      { key: 'thumb', header: '', type: 'thumb', width: 64, value: (r) => r.thumbUrl, thumbAlt: (r) => r.title, mobile: 'media' },
      {
        key: 'listing',
        header: t('col.listing'),
        minWidth: 240,
        mobile: 'title',
        render: (r) => (
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ ...textStyle('body'), display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.title}</span>
            {r.metaLine.length > 0 && <span style={{ ...textStyle('caption', n[500]), fontFamily: font.mono }}>{r.metaLine.join(' · ')}</span>}
            {r.sync?.queuedDelete && <span style={textStyle('caption', tone.danger.fg)}>{t('cell.willDelete')}</span>}
          </span>
        ),
        mobileRender: (r) => r.title,
      },
      { key: 'price', header: t('col.price'), type: 'money', width: 112, align: 'right', value: (r) => r.price?.amount ?? null, currency: (r) => r.price?.currency, mobile: 'trailing' },
      { key: 'qty', header: t('col.qty'), type: 'number', width: 72, align: 'right', value: (r) => r.qty, mobile: 'meta' },
      { key: 'status', header: t('col.status'), type: 'status', width: 112, value: (r) => ({ domain: 'listing', status: r.status, raw: r.statusNote ?? r.statusRaw }), mobile: 'status' },
      { key: 'health', header: t('col.health'), type: 'score', width: 96, align: 'right', value: (r) => r.health.score, mobile: 'hidden' },
    ],
    [t],
  );

  const actionKeys = useMemo(() => duplicateActionKeys(ctx.marketplace, ctx.rowActions), [ctx.marketplace, ctx.rowActions]);

  const rowActions = (r: ListingRow): ActionSpec[] => {
    const busy = busyId === r.id;
    const items: ActionSpec[] = [{ id: 'open', label: t('action.openEditor'), icon: icons.edit, href: ctx.editorHref(r.id) }];
    for (const key of duplicateActionsFor(r, actionKeys)) {
      if (key === 'deactivate' || key === 'hideInStore') {
        items.push({ id: key, label: t(`action.${key}`), onClick: () => void stage(r, STAGED_ACTION[key]), disabled: busy, loading: busy });
      } else if (key === 'archive') {
        items.push({ id: key, label: t('action.archiveConfirm'), tone: 'danger', onClick: () => setConfirm({ row: r, action: 'archive' }), disabled: busy });
      } else {
        items.push({ id: key, label: t('action.delete'), icon: icons.delete, tone: 'danger', onClick: () => setConfirm({ row: r, action: 'delete' }), disabled: busy });
      }
    }
    return items;
  };

  const loadError = error ? (error instanceof ToolFetchError ? error : new ToolFetchError(0)) : null;
  const groups = data?.groups ?? [];

  return (
    <SidePanel padded open={open} onClose={onClose} size="lg" title={t('tools.duplicates')} data-testid="listings-tool-duplicates">
      {loadError && !data ? (
        <ErrorState
          variant="inline"
          title={t('tools.loadFailed')}
          cause={loadError.status >= 500 || loadError.status === 0 ? t('error.serverNoResponse') : undefined}
          errorId={loadError.errorId}
          onRetry={() => void mutate()}
        />
      ) : isLoading || !data ? (
        <PanelSkeleton sections={3} />
      ) : groups.length === 0 ? (
        <EmptyState kind="done" title={t('dup.none')} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: px(space[5]) }}>
          <p style={textStyle('label', n[700])}>{t('dup.summary', { groups: groups.length })}</p>
          {groups.map((g, i) => (
            <Section key={`${g.reason.kind}-${g.ids.join('-')}`} id={`dup-group-${i}`} title={duplicateReasonLabel(t, g.reason)} headingLevel={3} variant="plain">
              <DataTable<ListingRow>
                rows={g.rows}
                columns={columns}
                getRowId={(r) => r.id}
                state="ready"
                rowActions={rowActions}
                density="compact"
                columnStateKey={`listings-dup-${ctx.marketplace}`}
                ariaLabel={duplicateReasonLabel(t, g.reason)}
                stickyHeader={false}
              />
            </Section>
          ))}
          {data.truncated && <p style={textStyle('caption', n[500])}>{t('dup.truncated', { max: groups.length })}</p>}
        </div>
      )}
      <ConfirmDialog
        open={!!confirm}
        tone="danger"
        title={confirm ? t(confirm.action === 'archive' ? 'dup.archiveTitle' : 'dup.deleteTitle', { title: confirm.row.title }) : ''}
        body={t(confirm?.action === 'archive' ? 'dup.archiveBody' : 'dup.deleteBody', { on: t('mp.on', { marketplace: ctx.marketplace }) })}
        confirmLabel={t(confirm?.action === 'archive' ? 'dup.archiveConfirm' : 'dup.deleteConfirm')}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (c) void stage(c.row, c.action);
        }}
      />
    </SidePanel>
  );
}

export default DuplicatesPanel;
