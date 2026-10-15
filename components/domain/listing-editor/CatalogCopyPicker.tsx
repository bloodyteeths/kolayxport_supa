// components/domain/listing-editor/CatalogCopyPicker.tsx — the listing picker behind the creators' "Start faster"
// card (marketplace-editors §5.1, §5.4; M6b-C route wiring of M6b-D's CreateStartCard). Trendyol copies an Etsy or
// eBay listing (`new?crosslist=etsy:<id>` / `ebay:<sku>`); Wix and Shopify copy one of the store's own products
// (`new?copy=<id>`). Read-only: it lists through the grid API (`GET /api/listings?q=`) and only navigates; the copy
// itself is a create prefill the seller reviews, staged as a draft, and nothing reaches a marketplace before Send.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ds/overlay/Modal';
import { SearchField } from '@/components/ds/toolbar/SearchField';
import { SegmentedControl } from '@/components/ds/inputs/SegmentedControl';
import { Thumb } from '@/components/ds/data/Thumb';
import { accent, neutral, radius } from '@/lib/ds/tokens';
import type { CatalogMarketplace } from './adapters/catalog';

export type CopyPickSource = 'etsy' | 'ebay' | CatalogMarketplace;

export interface CopyPick {
  source: CopyPickSource;
  id: string;
}

export interface CopyPickerRow {
  id: string;
  title: string;
  thumbUrl: string | null;
  meta: string;
}

/** Sources the picker offers for a creator (Trendyol: cross-list; Wix / Shopify: the same store). Pure. */
export function copySourcesFor(marketplace: CatalogMarketplace): CopyPickSource[] {
  return marketplace === 'trendyol' ? ['etsy', 'ebay'] : [marketplace];
}

/** A pick → the creator's query (`copy` same marketplace, `crosslist` Etsy / eBay). Pure. */
export function copyPickQuery(marketplace: CatalogMarketplace, pick: CopyPick): { copy?: string; crosslist?: string } {
  if (pick.source === marketplace) return { copy: pick.id };
  return { crosslist: `${pick.source}:${pick.id}` };
}

const SOURCE_NAME: Record<CopyPickSource, string> = { etsy: 'Etsy', ebay: 'eBay', trendyol: 'Trendyol', wix: 'Wix', shopify: 'Shopify' };
const PAGE = 10;

/** `GET /api/listings` body → picker rows. Pure. */
export function copyPickerRows(body: unknown): CopyPickerRow[] {
  const rows = body && typeof body === 'object' && Array.isArray((body as { rows?: unknown }).rows) ? (body as { rows: unknown[] }).rows : [];
  const out: CopyPickerRow[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id) continue;
    out.push({
      id: o.id,
      title: typeof o.title === 'string' ? o.title : '',
      thumbUrl: typeof o.thumbUrl === 'string' && o.thumbUrl ? o.thumbUrl : null,
      meta: Array.isArray(o.metaLine) ? o.metaLine.filter((x): x is string => typeof x === 'string').join(' · ') : '',
    });
  }
  return out.slice(0, PAGE);
}

type LoadState = { status: 'loading' } | { status: 'ready'; rows: CopyPickerRow[] } | { status: 'not_connected' } | { status: 'error' };

export interface CatalogCopyPickerProps {
  open: boolean;
  marketplace: CatalogMarketplace;
  /** Store of the same-marketplace source (Wix site / Shopify shop id); cross-list sources use their first store. */
  storeId: string | null;
  onClose: () => void;
  onPick: (pick: CopyPick) => void;
}

export function CatalogCopyPicker({ open, marketplace, storeId, onClose, onPick }: CatalogCopyPickerProps) {
  const t = useTranslations('listingEditor');
  const sources = copySourcesFor(marketplace);
  const [source, setSource] = React.useState<CopyPickSource>(sources[0]);
  const [q, setQ] = React.useState('');
  const [state, setState] = React.useState<LoadState>({ status: 'loading' });
  const [selected, setSelected] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setState({ status: 'loading' });
    setSelected(null);
    const qs = new URLSearchParams({ marketplace: source, size: '50' });
    if (q.trim()) qs.set('q', q.trim());
    if (source === marketplace && storeId) qs.set('store', storeId);
    fetch(`/api/listings?${qs.toString()}`, { credentials: 'same-origin' })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (cancelled) return;
        if (res.status === 404 && body?.error === 'not_connected') return setState({ status: 'not_connected' });
        if (!res.ok) return setState({ status: 'error' });
        setState({ status: 'ready', rows: copyPickerRows(body) });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [open, source, q, marketplace, storeId, nonce]);

  const title = marketplace === 'trendyol' ? t('catalog.copyPickerCrosslistTitle') : t('catalog.copyPickerProductTitle');
  const pick = () => {
    if (selected) onPick({ source, id: selected });
  };

  let list: React.ReactNode;
  if (state.status === 'loading') {
    list = <Box sx={{ color: neutral[500], fontSize: 13, py: '12px' }}>{t('catalog.copyPickerLoading')}</Box>;
  } else if (state.status === 'not_connected') {
    list = <Box sx={{ color: neutral[600], fontSize: 13, py: '12px' }}>{t('catalog.copyPickerNotConnected', { marketplace: SOURCE_NAME[source] })}</Box>;
  } else if (state.status === 'error') {
    list = (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', color: neutral[600], fontSize: 13, py: '12px' }}>
        <span>{t('catalog.copyPickerFailed')}</span>
        <Box
          component="button"
          type="button"
          onClick={() => setNonce((n) => n + 1)}
          sx={{ border: 0, background: 'none', p: 0, color: accent[600], cursor: 'pointer', font: 'inherit' }}
        >
          {t('catalog.copyPickerRetry')}
        </Box>
      </Box>
    );
  } else if (!state.rows.length) {
    list = <Box sx={{ color: neutral[500], fontSize: 13, py: '12px' }}>{t('catalog.copyPickerEmpty')}</Box>;
  } else {
    list = (
      <Box role="radiogroup" aria-label={title} sx={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: 320, overflowY: 'auto' }}>
        {state.rows.map((r) => {
          const on = r.id === selected;
          return (
            <Box
              key={r.id}
              component="button"
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setSelected(r.id)}
              onDoubleClick={() => onPick({ source, id: r.id })}
              data-testid={`le-copy-pick-${r.id}`}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                p: '8px',
                minHeight: 44,
                textAlign: 'left',
                border: `1px solid ${on ? accent[600] : neutral[200]}`,
                borderRadius: `${radius.md}px`,
                background: on ? accent[50] : neutral[0],
                cursor: 'pointer',
                font: 'inherit',
                minWidth: 0,
              }}
            >
              <Thumb src={r.thumbUrl} alt="" size={40} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Box sx={{ fontSize: 14, color: neutral[900], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title || r.id}</Box>
                {r.meta ? (
                  <Box sx={{ fontSize: 12, color: neutral[500], fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.meta}
                  </Box>
                ) : null}
              </Box>
            </Box>
          );
        })}
      </Box>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="md"
      primary={{ id: 'copy', label: t('catalog.copyPickerCopy'), onClick: pick, disabled: !selected, disabledReason: t('catalog.copyPickerChoose') }}
      data-testid="le-copy-picker"
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
        {sources.length > 1 ? (
          <SegmentedControl<CopyPickSource>
            value={source}
            onChange={(v) => setSource(v)}
            options={sources.map((s) => ({ value: s, label: SOURCE_NAME[s] }))}
            aria-label={title}
          />
        ) : null}
        <SearchField value={q} onChange={setQ} placeholder={t('catalog.copyPickerSearch')} fullWidth autoFocus shortcut={null} />
        {list}
      </Box>
    </Modal>
  );
}

export default CatalogCopyPicker;
