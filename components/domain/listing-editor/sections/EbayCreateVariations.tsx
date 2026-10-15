// components/domain/listing-editor/sections/EbayCreateVariations.tsx — variations for a NEW eBay listing
// (listing-editor §2.1 #5, M6 Group F). Replaces the legacy creator's "VARIATION LISTING FLOW": the seller names
// up to 3 options (Color, Size …) with their values, and every combination gets its own SKU, price and quantity.
// Everything is the `createVariations` editor field: the adapter stages it as the draft's variationPatch
// (`EbayCreateVariations`) and the server's F1 plan creates item-per-variant → group → offers → publish by group
// on Send. Nothing here talks to eBay.
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Button, FormField, IconButton, MoneyField, NumberField, TagInput, TextField } from '@/components/ds/inputs';
import { icons } from '@/lib/ds/icons';
import { neutral, radius, tone } from '@/lib/ds/tokens';
import { fieldAnchorId } from '@/lib/listingEditor/sections';
import { SELLER_SKU_MAX } from '@/lib/ebay/draftPlan';
import { useListingEditor } from '../useListingDraft';
import { useFieldError } from './useEtsySection';
import {
  decodeCreateVariations,
  encodeCreateVariations,
  rebuildCreateVariants,
  toPriceString,
  type EbayEditorFields,
} from '../adapters/ebay';

/** eBay allows up to 5 varying aspects; 3 keeps the combination grid usable (e.g. 4 × 5 × 3 = 60 rows). */
export const EBAY_CREATE_MAX_OPTIONS = 3;
/** eBay's limit of variations per listing. */
export const EBAY_MAX_VARIANTS = 250;
/** eBay aspect values are capped at 65 characters (lib/ebay/payloadRules ASPECT_VALUE_MAX). */
const OPTION_VALUE_MAX = 65;
const OPTION_NAME_MAX = 65;

type Spec = { name: string; values: string[] };

export function EbayCreateVariations() {
  const t = useTranslations('listingEditor');
  const ed = useListingEditor<EbayEditorFields>();
  const f = ed.view.fields;
  const ro = ed.readOnly;
  const errorFor = useFieldError({ issues: ed.issues });
  const stored = React.useMemo(() => decodeCreateVariations(f.createVariations), [f.createVariations]);
  const baseSku = (f.sku || '').trim() || ed.ctx.listingId || 'SKU';

  // Option rows being typed (a name without values is not stored yet). Re-seeded when the field changes from
  // outside (draft overlay, Revert, Discard).
  const [specs, setSpecs] = React.useState<Spec[]>(() => stored?.specifications ?? []);
  const lastWritten = React.useRef(f.createVariations);
  React.useEffect(() => {
    if (f.createVariations === lastWritten.current) return;
    lastWritten.current = f.createVariations;
    setSpecs(stored?.specifications ?? []);
  }, [f.createVariations, stored]);

  const variants = React.useMemo(() => stored?.variants ?? [], [stored]);

  const write = (nextSpecs: Spec[], nextVariants = variants) => {
    const clean = nextSpecs.filter((s) => s.name.trim() && s.values.length);
    const rows = rebuildCreateVariants(clean, nextVariants, baseSku, {
      price: f.price ? String(f.price) : null,
      quantity: Math.max(0, Number(f.quantity) || 1),
    }).slice(0, EBAY_MAX_VARIANTS);
    const encoded = encodeCreateVariations(clean.length ? { specifications: clean, variants: rows } : null);
    lastWritten.current = encoded;
    ed.setField('createVariations', encoded);
  };

  const updateSpec = (i: number, patch: Partial<Spec>) => {
    const next = specs.map((s, j) => (j === i ? { ...s, ...patch } : s));
    setSpecs(next);
    write(next);
  };

  const updateVariant = (i: number, patch: Partial<(typeof variants)[number]>) => {
    if (!stored) return;
    const rows = variants.map((v, j) => (j === i ? { ...v, ...patch } : v));
    const encoded = encodeCreateVariations({ ...stored, variants: rows });
    lastWritten.current = encoded;
    ed.setField('createVariations', encoded);
  };

  const error = errorFor('createVariations');
  const combos = variants.length;

  if (!specs.length) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: 720 }} data-testid="le-ebay-create-variations">
        <Typography variant="body2" sx={{ color: neutral[600] }}>{t('variations.ebayCreateIntro')}</Typography>
        <Box>
          <Button variant="secondary" icon={icons.add} onClick={() => setSpecs([{ name: '', values: [] }])} disabled={ro}>
            {t('variations.ebayAddOption')}
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: 960 }} data-testid="le-ebay-create-variations" id={fieldAnchorId('createVariations')}>
      {specs.map((spec, i) => (
        <Box
          key={i}
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '200px 1fr 40px' },
            gap: '12px',
            alignItems: 'start',
            p: '12px',
            border: `1px solid ${neutral[200]}`,
            borderRadius: `${radius.md}px`,
          }}
        >
          <FormField label={t('variations.ebayOptionName')} htmlFor={`le-ebay-opt-name-${i}`}>
            <TextField
              id={`le-ebay-opt-name-${i}`}
              value={spec.name}
              placeholder={t('variations.ebayOptionNamePlaceholder')}
              maxLength={OPTION_NAME_MAX}
              onChange={(v) => updateSpec(i, { name: v })}
              readOnly={ro}
            />
          </FormField>
          <FormField label={t('variations.ebayOptionValues')} helper={t('variations.ebayOptionValuesHelper')}>
            <TagInput
              value={spec.values}
              maxLength={OPTION_VALUE_MAX}
              onChange={(values) => updateSpec(i, { values })}
              disabled={ro}
            />
          </FormField>
          <Box sx={{ pt: { xs: 0, sm: '28px' } }}>
            <IconButton
              icon={icons.close}
              label={t('variations.ebayRemoveOption', { name: spec.name || String(i + 1) })}
              onClick={() => {
                const next = specs.filter((_, j) => j !== i);
                setSpecs(next);
                write(next);
              }}
              disabled={ro}
            />
          </Box>
        </Box>
      ))}
      {specs.length < EBAY_CREATE_MAX_OPTIONS ? (
        <Box>
          <Button variant="ghost" size="sm" icon={icons.add} onClick={() => setSpecs([...specs, { name: '', values: [] }])} disabled={ro}>
            {t('variations.ebayAddOption')}
          </Button>
        </Box>
      ) : null}

      {error ? (
        <Typography variant="body2" role="alert" sx={{ color: tone.danger.fg }}>{error}</Typography>
      ) : null}

      {combos ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Typography variant="body2" sx={{ color: neutral[700], fontWeight: 600 }}>
            {t('variations.ebayCombinations', { count: combos })}
          </Typography>
          <Box
            aria-hidden
            sx={{
              display: { xs: 'none', sm: 'grid' },
              gridTemplateColumns: 'minmax(140px, 1fr) 220px 150px 110px',
              gap: '12px',
              fontSize: 12,
              color: neutral[600],
            }}
          >
            <span />
            <span>{t('field.sku')}</span>
            <span>{t('field.price')}</span>
            <span>{t('field.quantity')}</span>
          </Box>
          {variants.map((v, i) => {
            const label = specs.filter((s) => s.name.trim()).map((s) => v.combination[s.name.trim()]).filter(Boolean).join(' · ');
            const price = v.price != null ? parseFloat(String(v.price)) : NaN;
            return (
              <Box
                key={`${label}-${i}`}
                data-testid="le-ebay-variant-row"
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr 1fr', sm: 'minmax(140px, 1fr) 220px 150px 110px' },
                  gap: '8px 12px',
                  alignItems: 'center',
                  py: '8px',
                  borderTop: `1px solid ${neutral[100]}`,
                }}
              >
                <Typography variant="body2" sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' }, fontWeight: 500, minWidth: 0, overflowWrap: 'anywhere' }}>
                  {label}
                </Typography>
                <Box sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}>
                  <TextField
                    value={v.sku}
                    onChange={(s) => updateVariant(i, { sku: s.replace(/\s+/g, '') })}
                    maxLength={SELLER_SKU_MAX}
                    mono
                    readOnly={ro}
                    aria-label={t('variations.ebayVariantSku', { variant: label })}
                  />
                </Box>
                <MoneyField
                  currency={f.currency || 'USD'}
                  value={Number.isFinite(price) ? price : null}
                  placeholder={f.price ? String(f.price) : undefined}
                  onChange={(n) => updateVariant(i, { price: typeof n === 'number' && Number.isFinite(n) && n > 0 ? toPriceString(n) : null })}
                  readOnly={ro}
                  aria-label={t('variations.ebayVariantPrice', { variant: label })}
                />
                <NumberField
                  value={Number.isFinite(Number(v.quantity)) ? Number(v.quantity) : 0}
                  onChange={(n) => updateVariant(i, { quantity: typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0 })}
                  min={0}
                  decimals={0}
                  readOnly={ro}
                  aria-label={t('variations.ebayVariantQuantity', { variant: label })}
                />
              </Box>
            );
          })}
        </Box>
      ) : null}
    </Box>
  );
}
