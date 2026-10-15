// components/domain/listings/tools/ExportCsvModal.tsx — listings-grid §10 "Export CSV" (M5 G6).
// Modal sm: Scope [Current view (248) · Selected (24) · All listings (312)] · ☐ Include description.
// Downloads through `GET /api/listings/export` (every matching row, not only the page; UTF-8 BOM, server-named
// file `etsy-listings-{shop}-{yyyy-mm-dd}.csv`). Read-only: nothing is staged or sent.
import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ds/overlay/Modal';
import { RadioGroup, type RadioOption } from '@/components/ds/inputs/RadioGroup';
import { Checkbox } from '@/components/ds/inputs/Checkbox';
import { useToast } from '@/components/ds/feedback/toast';
import { icons } from '@/lib/ds/icons';
import { px, space } from '@/lib/ds/tokens';
import { storeSearchParams, toolSearchParams, withSort, type ListingsToolContext, type ListingsToolPanelProps } from './ToolsMenuItems';

export type ExportScope = 'view' | 'selected' | 'all';

/**
 * "Selected" sends the ids in the GET query string. Above this many encoded characters the request risks the
 * proxy / Node header limit (431), so the scope is offered disabled with a reason. A POST variant of the export
 * is requested from G1.
 */
export const MAX_SELECTED_IDS_CHARS = 6000;

export function selectedTooLong(ids: readonly string[]): boolean {
  return encodeURIComponent(ids.join(',')).length > MAX_SELECTED_IDS_CHARS;
}

/** The export URL for a scope (pure; exported for tests and for the BulkActionBar "Export selected"). Keeps the list's sort. */
export function exportUrl(ctx: Pick<ListingsToolContext, 'query' | 'store' | 'marketplace' | 'selectedIds'>, scope: ExportScope, includeDescription: boolean): string {
  const p = scope === 'view' ? toolSearchParams(ctx) : storeSearchParams(ctx);
  if (scope === 'selected') p.set('ids', ctx.selectedIds.join(','));
  if (includeDescription) p.set('includeDescription', '1');
  withSort(p, ctx);
  return `/api/listings/export?${p.toString()}`;
}

/** `attachment; filename="x.csv"` / `filename*=UTF-8''x.csv` → name, else null. */
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}

function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export interface ExportCsvModalProps extends ListingsToolPanelProps {
  /** Opened from the BulkActionBar "Export selected": preselect Selected. */
  initialScope?: ExportScope;
}

export function ExportCsvModal({ open, onClose, ctx, initialScope }: ExportCsvModalProps) {
  const t = useTranslations('listings');
  const tOverlay = useTranslations('ds.overlay');
  const toast = useToast();
  const hasSelection = ctx.selectedIds.length > 0;
  const tooLong = hasSelection && selectedTooLong(ctx.selectedIds);
  const canSelected = hasSelection && !tooLong;
  const defaultScope = (): ExportScope => initialScope ?? (hasSelection ? 'selected' : 'view');
  const [scope, setScope] = useState<ExportScope>(defaultScope);
  const [includeDescription, setIncludeDescription] = useState(false);
  const [busy, setBusy] = useState(false);
  // The page keeps this modal mounted and toggles `open`: start fresh on every open.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setScope(defaultScope());
      setIncludeDescription(false);
    }
  }
  const effective: ExportScope = scope === 'selected' && !canSelected ? 'view' : scope;

  const options: RadioOption<ExportScope>[] = [
    { value: 'view', label: t('fr.scopeView', { count: ctx.viewCount }) },
    {
      value: 'selected',
      label: t('fr.scopeSelected', { count: ctx.selectedIds.length }),
      disabled: !canSelected,
      disabledReason: !hasSelection ? t('fr.noneSelected') : tooLong ? t('export.selectedTooMany') : undefined,
    },
    { value: 'all', label: t('export.scopeAll', { count: ctx.allCount }) },
  ];

  const download = async () => {
    setBusy(true);
    try {
      const res = await fetch(exportUrl(ctx, effective, includeDescription), { credentials: 'same-origin' });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const today = new Date().toISOString().slice(0, 10);
      saveBlob(blob, filenameFromDisposition(res.headers.get('content-disposition')) ?? `${ctx.marketplace}-listings-${today}.csv`);
      onClose();
    } catch {
      toast.error(t('export.failed'), { persist: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={t('tools.export')}
      primary={{ id: 'export-download', label: t('export.download'), icon: icons.download, onClick: download, loading: busy, loadingLabel: t('export.preparing') }}
      secondary={{ id: 'export-cancel', label: tOverlay('cancel'), onClick: onClose }}
      data-testid="listings-tool-export"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: px(space[4]) }}>
        <RadioGroup<ExportScope> value={effective} onChange={setScope} options={options} aria-label={t('fr.scope')} />
        <Checkbox checked={includeDescription} onChange={setIncludeDescription} label={t('export.includeDescription')} />
      </div>
    </Modal>
  );
}

export default ExportCsvModal;
