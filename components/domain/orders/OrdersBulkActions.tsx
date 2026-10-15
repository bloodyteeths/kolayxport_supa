// components/domain/orders/OrdersBulkActions.tsx (orders G2) — the BulkActionBar content for a selection
// (orders §1.4, §2.3, §3.1): primary "Create M labels" (labelable rows only, tooltip names the skipped ones)
// or, when none is labelable, the "Print ▾" SplitButton; secondaries Print ▾ + Export ▾; ⋯ Copy addresses and
// Send ETGB documents (only with `etgbEnabled`). "Mark shipped" is dropped (no API, orders §0.3).
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import type { BulkActionBarProps } from '@/components/ds/toolbar';
import type { ActionSpec } from '@/components/ds/page';
import { Button } from '@/components/ds/inputs/Button';
import { SplitButton } from '@/components/ds/inputs/SplitButton';
import { Tooltip } from '@/components/ds/overlay/Tooltip';
import { useToast } from '@/components/ds/feedback/toast';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { icons } from '@/lib/ds/icons';
import { copyText } from '@/lib/hooks/useCopy';
import { openLabelUrl } from '@/lib/shipping/labelLinks';
import { openPrintPage, type PrintPageKind } from '@/lib/print/openPrintPage';
import type { OrderRow, OrdersQuery } from '@/lib/orders/types';
import { isLabelable, notLabelableReason, type NotLabelableReason, type OrdersT } from './orderColumns';
import { OrdersExportMenu } from './OrdersExportMenu';

/** Popup-safe cap for opening stored label URLs in one click (orders §2.3). */
export const PRINT_LABELS_MAX = 20;

// ── pure helpers (unit-tested) ──────────────────────────────────────────────────────────────────────────

const tsvCell = (v: unknown) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();

/** Same columns as the legacy `buildAddressesTsv`: order no, name, line 1, line 2, city, state, postal, country, phone, email. */
export function buildAddressesTsv(rows: readonly OrderRow[], header: readonly string[]): string {
  const lines = rows.map((r) => {
    const a = r.shipTo;
    return [r.orderNumber, a.name || r.buyerName, a.street1, a.street2, a.city, a.state, a.postal, a.country, a.phone, a.email].map(tsvCell).join('\t');
  });
  return [header.map(tsvCell).join('\t'), ...lines].join('\n');
}

export type SelectionSummary = {
  labelable: OrderRow[];
  skipped: { row: OrderRow; reason: NotLabelableReason }[];
  /** Rows with a stored label URL (Print › Labels). */
  printable: OrderRow[];
  /** Most common skip reason (tooltip "{n} orders can't get a label here: {reason}"). */
  mainReason: NotLabelableReason | null;
};

export function summarizeSelection(rows: readonly OrderRow[]): SelectionSummary {
  const labelable: OrderRow[] = [];
  const skipped: SelectionSummary['skipped'] = [];
  const printable: OrderRow[] = [];
  const tally = new Map<NotLabelableReason, number>();
  for (const r of rows) {
    if (r.label?.labelHref) printable.push(r);
    const reason = notLabelableReason(r);
    if (!reason && isLabelable(r)) labelable.push(r);
    else if (reason) {
      skipped.push({ row: r, reason });
      tally.set(reason, (tally.get(reason) ?? 0) + 1);
    }
  }
  let mainReason: NotLabelableReason | null = null;
  let best = 0;
  tally.forEach((n, k) => {
    if (n > best) {
      best = n;
      mainReason = k;
    }
  });
  return { labelable, skipped, printable, mainReason };
}

// ── hook ────────────────────────────────────────────────────────────────────────────────────────────────

export type OrdersBulkActionsInput = {
  /** Selected rows (kept across pages by the page). */
  selected: readonly OrderRow[];
  query: OrdersQuery;
  matchingTotal?: number | null;
  etgbEnabled: boolean;
  etgbRecipientEmail?: string | null;
  onCreateLabels(rows: OrderRow[]): void;
  onClear(): void;
  /** Settings › Sender profile, where the ETGB email lives (missing-email toast action). */
  settingsHref?: string;
};

const REASON_KEY: Record<NotLabelableReason, string> = {
  fba: 'row.fba',
  address: 'problem.addressIncompleteShort',
  hasLabel: 'views.labelCreated',
  closed: 'bulk.reasonClosed',
};

/** BulkActionBar props for the Toolbar `selection` slot (desktop bar and mobile sticky bar). */
export function useOrdersBulkActions(input: OrdersBulkActionsInput): BulkActionBarProps {
  const t = useTranslations('orders') as unknown as OrdersT;
  const tPrint = useTranslations('printSlips');
  const toast = useToast();
  const mobile = useIsMobile();
  const [etgbBusy, setEtgbBusy] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const { selected, query, matchingTotal, etgbEnabled, etgbRecipientEmail, onCreateLabels, onClear } = input;

  const summary = React.useMemo(() => summarizeSelection(selected), [selected]);
  const ids = React.useMemo(() => selected.map((r) => r.id), [selected]);

  const printPage = (kind: PrintPageKind) => {
    const res = openPrintPage(kind, ids);
    if (!res.ok && res.reason === 'blocked') toast.info(tPrint('popupBlocked'));
    else if (res.ok && res.truncated) toast.info(tPrint('truncated', { max: res.max }));
  };

  const printLabels = () => {
    // Synchronous inside the click: popup blockers allow the batch.
    const list = summary.printable.slice(0, PRINT_LABELS_MAX);
    list.forEach((r) => openLabelUrl(r.label?.labelHref, `label-${r.orderNumber}`));
    if (summary.printable.length > PRINT_LABELS_MAX) toast.info(t('actions.printLabelsLimit', { max: PRINT_LABELS_MAX }));
  };

  const printOptions: ActionSpec[] = [
    {
      id: 'printLabels',
      label: t('actions.printLabels'),
      icon: icons.label,
      onClick: printLabels,
      disabled: summary.printable.length === 0,
      disabledReason: summary.printable.length === 0 ? t('bulk.noLabels') : undefined,
    },
    { id: 'printPackingSlips', label: tPrint('packingSlips'), onClick: () => printPage('packing-slips') },
    { id: 'printPickList', label: tPrint('pickList'), onClick: () => printPage('pick-list') },
  ];
  const printPrimary: ActionSpec = summary.printable.length > 0 ? printOptions[0] : printOptions[1];
  const printMenu = (variant: 'primary' | 'secondary') => (
    <SplitButton
      variant={variant}
      size={mobile ? 'xl' : 'sm'}
      primary={{ ...printPrimary, label: variant === 'primary' && !mobile ? `${t('actions.print')} · ${printPrimary.label}` : printPrimary.label }}
      options={printOptions.filter((o) => o.id !== printPrimary.id)}
      menuLabel={t('actions.print')}
      data-testid={`orders-bulk-print-${variant}`}
    />
  );

  const copyAddresses = async () => {
    const header = [
      t('bulk.tsv.orderNumber'),
      t('bulk.tsv.name'),
      t('bulk.tsv.street1'),
      t('bulk.tsv.street2'),
      t('bulk.tsv.city'),
      t('bulk.tsv.state'),
      t('bulk.tsv.postal'),
      t('bulk.tsv.country'),
      t('bulk.tsv.phone'),
      t('bulk.tsv.email'),
    ];
    const ok = await copyText(buildAddressesTsv(selected, header));
    if (ok) toast.success(t('actions.addressesCopied', { count: selected.length }));
    else toast.error(t('bulk.copyFailed'), { persist: false });
  };

  const sendEtgb = async () => {
    if (etgbBusy || ids.length === 0) return;
    const email = (etgbRecipientEmail ?? '').trim();
    if (!email) {
      toast.error(t('etgb.noEmail'), {
        action: { label: t('etgb.openSettings'), onClick: () => window.location.assign(input.settingsHref ?? '/ayarlar?tab=senderProfile') },
      });
      return;
    }
    setEtgbBusy(true);
    toast.info(t('etgb.sending', { count: ids.length }));
    try {
      const res = await fetch('/api/etgb/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds: ids, recipientEmail: email }),
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean };
      if (res.ok && body.success) {
        toast.success(t('etgb.sent', { email }));
        onClear();
      } else toast.error(t('etgb.failed'), { persist: false });
    } catch {
      toast.error(t('etgb.failed'), { persist: false });
    } finally {
      setEtgbBusy(false);
    }
  };

  const overflow: ActionSpec[] = [{ id: 'copyAddresses', label: t('actions.copyAddresses'), icon: icons.copy, onClick: () => void copyAddresses() }];
  if (etgbEnabled) {
    overflow.push({
      id: 'sendEtgb',
      label: t('actions.sendEtgb'),
      onClick: () => void sendEtgb(),
      loading: etgbBusy,
      loadingLabel: t('etgb.sending', { count: ids.length }),
    });
  }

  const n = summary.labelable.length;
  const skippedText =
    summary.skipped.length && summary.mainReason
      ? t('actions.createLabelsPartial', { skipped: summary.skipped.length, reason: t(REASON_KEY[summary.mainReason]) })
      : null;

  // Mobile (orders §3.1): Export lives in the sticky bar's ⋯ and opens the export sheet (no trigger button).
  const exportMenu = (
    <OrdersExportMenu
      selectedIds={ids}
      query={query}
      matchingTotal={matchingTotal}
      size="sm"
      open={mobile ? exportOpen : undefined}
      onOpenChange={mobile ? setExportOpen : undefined}
      hideTrigger={mobile}
      data-testid="orders-bulk-export"
    />
  );
  const mobileExportAction: ActionSpec = { id: 'export', label: t('actions.export'), icon: icons.download, onClick: () => setExportOpen(true) };

  let primarySlot: React.ReactNode;
  let secondarySlot: React.ReactNode;
  if (n > 0) {
    const createButton = (
      <Button variant="primary" size={mobile ? 'xl' : 'sm'} icon={icons.label} onClick={() => onCreateLabels(summary.labelable)} data-testid="orders-bulk-create-labels" fullWidth={mobile}>
        {t('actions.createLabels', { count: n })}
      </Button>
    );
    primarySlot = skippedText ? (
      <Tooltip title={skippedText}>
        <Box component="span" sx={{ display: 'inline-flex', flex: mobile ? 1 : undefined }}>
          {createButton}
        </Box>
      </Tooltip>
    ) : (
      createButton
    );
    secondarySlot = mobile ? (
      <>
        {printMenu('secondary')}
        {exportMenu}
      </>
    ) : (
      <Box sx={{ display: 'inline-flex', gap: '8px' }}>
        {printMenu('secondary')}
        {exportMenu}
      </Box>
    );
  } else {
    primarySlot = printMenu('primary');
    secondarySlot = exportMenu;
  }
  return {
    count: selected.length,
    primarySlot,
    secondarySlot,
    overflow: mobile ? [mobileExportAction, ...overflow] : overflow,
    onClear,
    'data-testid': 'orders-bulk-bar',
  };
}
