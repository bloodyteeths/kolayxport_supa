// components/domain/listing-editor/sections/marketplaceSectionShared.tsx — M6b-D: the shared surface of the
// Trendyol / Wix / Shopify sections (marketplace-editors §3, §4). The sections only read the engine through
// `useListingEditor()` and call `setField` / `setFields`; the M6b-C adapters stage the form into the
// `CatalogDraft` (nothing reaches a marketplace until Send).
//
// FORM CONTRACT (what the M6b-C adapters put in `view.fields`, and what the sections write back). Keys are the
// `CatalogFieldPatch` v2 keys (lib/catalogDrafts/schemas.ts) wherever the value is a scalar or a string list.
// Values the engine cannot diff as scalars (`FieldValue`) are carried as JSON strings (the eBay `aspects`
// precedent) and flattened where that is clearer:
//   Trendyol  title, description, images: string[], attributes: JSON TrendyolAttributeValue[] (encodeAttributes),
//             price (sale) / listPrice: number | '', vatRate: number | '', quantity: number | '', stockCode,
//             dimensionalWeight: number | ''. Create only (→ `queuedActions.create.payload`): barcode,
//             productMainId, brandId / categoryId / cargoCompanyId / shipmentAddressId / returningAddressId:
//             number | ''. Display labels kept with the pick, never sent: brandName, categoryName, categoryPath.
//   Wix       title, description, price: number | '', discountType: 'AMOUNT' | 'PERCENT' | 'NONE',
//             discountValue: number | '' (→ `discount`), sku, weight: number | '', ribbon, visible: boolean,
//             trackInventory: boolean, quantity: number | '', inStock: boolean, collectionIds: string[],
//             customTextFields: JSON WixCustomTextField[] (encodeTextFields).
//   Shopify   title, description, tags: string[], vendor, productType, status: 'active' | 'draft' | 'archived',
//             price / compareAtPrice: number | '' (single variant), sku, quantity: number | '', weight: number | '',
//             weightUnit, seoTitle / seoDescription (→ `seo`), variants: JSON ShopifyVariantEdit[] (edits only,
//             encodeVariantEdits; `expectedQuantity` = the quantity the table showed).
// Read-only facts come from `view.meta.raw` (the cache row / API product the adapter loaded); see each section.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Button, TextField, type TextFieldProps } from '@/components/ds/inputs';
import { BottomSheet, SheetFooter } from '@/components/ds/overlay';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { neutral } from '@/lib/ds/tokens';
import type { WixCustomTextField } from '@/lib/catalogDrafts/schemas';
import type { FieldMap, FieldValue } from '@/lib/listingEditor/types';
import { useListingEditor } from '../useListingDraft';
import { useFieldError } from './useEtsySection';

export type CatalogEditorMarketplace = 'trendyol' | 'wix' | 'shopify';

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Value readers (pure; tolerant of the adapter's exact scalar choice: number or numeric string)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Number or null (`''`, null, NaN → null). Accepts "12,50". */
export function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function toStr(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}

export function toBool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function toStrList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** number | '' form value (blank number inputs stage as ''). */
export function numOrBlank(n: number | null | undefined): number | '' {
  return typeof n === 'number' && Number.isFinite(n) ? n : '';
}

/** Price rounding the server applies (2 decimals). */
export function money2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseJsonArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string' || !v.trim()) return [];
  try {
    const parsed = JSON.parse(v) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// The form codecs are the M6b-C adapters' own (one implementation, so section writes and adapter diffs agree
// byte for byte). Re-exported under the section-side names.
export {
  decodeTrendyolAttributes as decodeAttributes,
  encodeTrendyolAttributes as encodeAttributes,
} from '../adapters/trendyol';
export { encodeWixTextFields as encodeTextFields } from '../adapters/wix';
export {
  decodeShopifyVariantEdits as decodeVariantEdits,
  encodeShopifyVariantEdits as encodeVariantEdits,
} from '../adapters/shopify';

/** Wix `customTextFields` form value → list (drops malformed rows; tolerant reader for the section UI). */
export function decodeTextFields(v: unknown): WixCustomTextField[] {
  const out: WixCustomTextField[] = [];
  for (const r of parseJsonArray(v)) {
    if (!isObj(r)) continue;
    const maxLength = toNum(r.maxLength);
    out.push({
      title: toStr(r.title),
      maxLength: maxLength !== null && maxLength > 0 ? Math.round(maxLength) : 0,
      mandatory: toBool(r.mandatory),
    });
  }
  return out;
}

/** The raw marketplace product the adapter loaded (`view.meta.raw`), as a plain record. */
export function rawRecord(raw: unknown): Record<string, unknown> {
  return isObj(raw) ? raw : {};
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Engine binding
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function useCatalogSection() {
  const ed = useListingEditor<FieldMap>();
  const errorFor = useFieldError({ issues: ed.issues });
  const f = ed.view.fields as Record<string, unknown>;
  const { mode, isFieldDirty, setField, revert: edRevert } = ed;
  const dirty = React.useCallback((key: string) => mode === 'edit' && isFieldDirty(key), [mode, isFieldDirty]);
  const set = React.useCallback((key: string, value: FieldValue) => setField(key, value), [setField]);
  const revert = React.useCallback((...keys: string[]) => edRevert(keys), [edRevert]);
  return {
    ed,
    f,
    raw: rawRecord(ed.view.meta.raw),
    ro: ed.readOnly,
    mode,
    currency: ed.view.meta.currency || '',
    errorFor,
    dirty,
    set,
    revert,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Remote lists (metadata, collections, locations)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export interface RemoteList<T> {
  status: 'idle' | 'loading' | 'ready' | 'error';
  items: T[];
  retry: () => void;
}

/** GET `url` (null = idle) once per url / retry and parse it. Never throws; `error` offers Retry. */
export function useRemoteList<T>(url: string | null, parse: (data: unknown) => T[]): RemoteList<T> {
  const [state, setState] = React.useState<{ status: RemoteList<T>['status']; items: T[] }>({ status: url ? 'loading' : 'idle', items: [] });
  const [nonce, setNonce] = React.useState(0);
  const parseRef = React.useRef(parse);
  parseRef.current = parse;
  React.useEffect(() => {
    if (!url) {
      setState({ status: 'idle', items: [] });
      return undefined;
    }
    let cancelled = false;
    setState((s) => ({ status: 'loading', items: s.items }));
    fetchJson(url)
      .then((d) => {
        if (!cancelled) setState({ status: 'ready', items: parseRef.current(d) });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [url, nonce]);
  const retry = React.useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, retry };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Mobile: heavy parts open as a full-height BottomSheet (marketplace-editors §4.4)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface MobileEditSheetProps {
  /** Sheet title (already translated). */
  title: string;
  /** One-line summary shown in the page on mobile. */
  summary: React.ReactNode;
  /** Field keys the sheet edits: Cancel restores them to the values at open. */
  keys: string[];
  disabled?: boolean;
  'data-testid'?: string;
  children: React.ReactNode;
}

/**
 * Desktop: renders `children` inline. Mobile (< 900px): a summary row + Edit; the editor opens in a full-height
 * BottomSheet with [Cancel] [Done]. Edits stage live into the same draft (autosave); Cancel puts back the values
 * the sheet opened with, Done keeps them.
 */
export function MobileEditSheet({ title, summary, keys, disabled, children, 'data-testid': testId }: MobileEditSheetProps) {
  const t = useTranslations('listingEditor');
  const mobile = useIsMobile();
  const ed = useListingEditor<FieldMap>();
  const [open, setOpen] = React.useState(false);
  const snapshot = React.useRef<Partial<FieldMap>>({});
  if (!mobile) return <>{children}</>;
  const onOpen = () => {
    const f = ed.view.fields as FieldMap;
    snapshot.current = Object.fromEntries(keys.map((k) => [k, f[k]]));
    setOpen(true);
  };
  const onCancel = () => {
    ed.setFields(snapshot.current);
    setOpen(false);
  };
  return (
    <Box data-testid={testId}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'space-between' }}>
        <Box sx={{ color: neutral[700], fontSize: 14, minWidth: 0 }}>{summary}</Box>
        <Button variant="secondary" size="sm" onClick={onOpen} disabled={disabled}>
          {t('common.edit')}
        </Button>
      </Box>
      <BottomSheet
        open={open}
        onClose={onCancel}
        title={title}
        fullHeight
        footer={
          <SheetFooter
            secondary={{ id: 'cancel', label: t('common.cancel'), onClick: onCancel }}
            primary={{ id: 'done', label: t('common.done'), onClick: () => setOpen(false) }}
          />
        }
      >
        {children}
      </BottomSheet>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Text input that stages a normalized value (trimmed by default) but keeps the raw text while typing
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface NormalizedTextFieldProps extends Omit<TextFieldProps, 'onChange'> {
  /** Called with the normalized text (only when it differs from `value`). */
  onChange: (value: string) => void;
  /** Normalizer applied before staging (default: trim). */
  normalize?: (raw: string) => string;
}

/**
 * Staging a trimmed value on every keystroke eats a trailing space before the next letter arrives ("Ahşap K" →
 * "AhşapK"). This keeps the typed text locally, stages `normalize(text)`, and takes an outside change of `value`
 * (revert, AI, sheet Cancel) as the new text. On blur the field shows the staged value.
 */
export function NormalizedTextField({ value, onChange, normalize = defaultNormalize, onBlur, ...rest }: NormalizedTextFieldProps) {
  const [text, setText] = React.useState(value);
  const [prev, setPrev] = React.useState(value);
  if (value !== prev) {
    setPrev(value);
    if (normalize(text) !== value) setText(value);
  }
  return (
    <TextField
      {...rest}
      value={text}
      onChange={(v) => {
        setText(v);
        const n = normalize(v);
        if (n !== value) onChange(n);
      }}
      onBlur={(e) => {
        setText(value);
        onBlur?.(e);
      }}
    />
  );
}

function defaultNormalize(raw: string): string {
  return raw.trim();
}
