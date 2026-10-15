// components/domain/research/shops/WatchShopModal.tsx (research R3-B) — "Watch a shop" (research.md §8): Modal sm with
// one TextField "Shop link or name"; the marketplace is detected from the link (etsy.com/shop/…, ebay.com/usr|str/…),
// a plain name uses the hub's marketplace. An eBay item link (ebay.com/itm/…) watches that item: its price and sold
// count are read on add and then daily (lib/research/ebayItemTracker.ts). Writes a KolayXport watch row only (POST /api/research/watches); the first
// daily reading is taken by the snapshot job, so sales per day appear the next day.
import * as React from 'react';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ds/overlay/Modal';
import { FormField } from '@/components/ds/inputs/FormField';
import { TextField } from '@/components/ds/inputs/TextField';
import { neutral as n } from '@/lib/ds/tokens';
import {
  DEFAULT_ALERT_RULES,
  createWatch,
  watchErrorKind,
  type WatchErrorKind,
  type WatchSummary,
} from '@/lib/research/hooks/useWatches';
import { MKT_NAME } from '../ResearchLayout';
import { findExisting, parseShopInput, type ShopMkt, type ShopT } from './shopModel';

export type WatchShopModalProps = {
  open: boolean;
  onClose: () => void;
  /** Hub marketplace: a plain name is looked up there. */
  mkt: ShopMkt;
  /** Prefill (`?add=` from the Research Home router). */
  initial?: string;
  /** Current watches (duplicate check before the request). */
  rows: WatchSummary[];
  /**
   * Quota reached / tracker not available yet. Applies to Etsy shops only (eBay sellers are legacy tracked sellers:
   * the server adds them without the quota or BR-1c) and never to "Open" on a shop already watched.
   */
  quotaReason?: string;
  /** After a successful add (revalidate, open the new row). `readingSkipped`: the first reading wasn't taken today. */
  onAdded: (watch: WatchSummary | null, label: string, readingSkipped?: boolean) => void;
  /** Already watched → open that row instead. */
  onOpenExisting?: (id: string) => void;
  /** A failed add (e.g. 409 quota / duplicate: the page's quota and rows are stale → revalidate). */
  onFailed?: (kind: WatchErrorKind) => void;
};

const ERROR_KEY: Record<WatchErrorKind, string> = {
  quota: 'research.shops.error.quota',
  duplicate: 'research.shops.error.duplicate',
  notFound: 'research.shops.error.notFound',
  invalid: 'research.shops.error.invalid',
  unsupported: 'research.shops.error.unsupported',
  readOnly: 'research.shops.error.failed',
  budget: 'research.error.budget',
  rateLimited: 'research.shops.error.rateLimited',
  unavailable: 'research.shops.error.unavailable',
  failed: 'research.shops.error.failed',
};

export function WatchShopModal({ open, onClose, mkt, initial, rows, quotaReason, onAdded, onOpenExisting, onFailed }: WatchShopModalProps) {
  const t = useTranslations() as unknown as ShopT;
  const [value, setValue] = React.useState(initial ?? '');
  const [touched, setTouched] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [serverError, setServerError] = React.useState<{ kind: WatchErrorKind; key?: string } | null>(null);

  React.useEffect(() => {
    if (open) {
      setValue(initial ?? '');
      setTouched(false);
      setServerError(null);
    }
  }, [open, initial]);

  const parsed = parseShopInput(value, mkt);
  const existing = parsed.ok ? findExisting(rows, parsed.request.marketplace, parsed.name) : null;
  // The block is for new Etsy watches only; before a parse, the hub marketplace decides.
  const etsyTarget = parsed.ok ? parsed.request.type === 'etsyShop' : mkt === 'etsy';
  const blocked = !existing && etsyTarget ? quotaReason : undefined;

  let fieldError: string | null = null;
  if (serverError) {
    // Quota keeps the page's wording (with the limit); other server keys are used when the catalog has them.
    fieldError = serverError.kind !== 'quota' && serverError.key && t.has(serverError.key) ? t(serverError.key) : t(ERROR_KEY[serverError.kind]);
  } else if (touched && !parsed.ok && parsed.reason !== 'empty') {
    fieldError = t(parsed.reason === 'unsupported' ? 'research.shops.error.unsupported' : 'research.shops.error.invalid');
  }

  const helper = parsed.ok
    ? existing
      ? t('research.shops.alreadyWatching', { shop: existing.label })
      : parsed.request.type === 'ebayItem'
        ? t('research.shops.watchEbayItem', { item: parsed.itemLabel ?? parsed.name })
        : t('research.shops.detected', { marketplace: MKT_NAME[parsed.request.marketplace], shop: parsed.name })
    : mkt === 'ebay'
      ? t('research.shops.ebayItemPrompt')
      : t('research.shops.linkHelper', { marketplace: MKT_NAME[mkt] });

  const submit = async () => {
    setTouched(true);
    if (!parsed.ok || busy) return;
    if (existing) {
      onOpenExisting?.(existing.id);
      onClose();
      return;
    }
    if (blocked) return;
    setBusy(true);
    setServerError(null);
    try {
      const out = await createWatch({ ...parsed.request, alertRules: DEFAULT_ALERT_RULES });
      onAdded(out.watch, parsed.name, out.readingSkipped);
      onClose();
    } catch (e) {
      const kind = watchErrorKind(e);
      const key = e && typeof e === 'object' && 'key' in e && typeof (e as { key?: unknown }).key === 'string' ? (e as { key: string }).key : undefined;
      setServerError({ kind, key });
      onFailed?.(kind);
    } finally {
      setBusy(false);
    }
  };

  const disabledReason = blocked ?? (!parsed.ok ? t('research.shops.linkRequired') : undefined);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={t('research.action.watchShop')}
      description={t('research.shops.modalBody')}
      primary={{
        id: 'shops-watch-submit',
        label: existing ? t('research.shops.openWatched') : t('research.action.watch'),
        onClick: () => void submit(),
        loading: busy,
        loadingLabel: t('research.shops.adding'),
        disabled: Boolean(blocked) || !parsed.ok,
        disabledReason,
      }}
      data-testid="shops-watch-modal"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FormField label={t('research.shops.linkLabel')} helper={helper} error={fieldError}>
          <TextField
            value={value}
            onChange={(v) => {
              setValue(v);
              setServerError(null);
            }}
            onBlur={() => setTouched(true)}
            placeholder={t('research.shops.linkPlaceholder')}
            maxLength={200}
            autoFocus
            autoComplete="off"
            data-testid="shops-watch-input"
          />
        </FormField>
      </form>
      {blocked ? (
        <Typography variant="caption" component="p" sx={{ m: 0, mt: '8px', color: n[600] }} data-testid="shops-watch-quota">
          {blocked}
        </Typography>
      ) : null}
    </Modal>
  );
}

export default WatchShopModal;
