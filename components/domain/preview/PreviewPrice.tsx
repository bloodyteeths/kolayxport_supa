// components/domain/preview/PreviewPrice.tsx: price or variation price range through the DS Money formatter.
// Nothing renders when the price is unknown (create mode before a price is typed). An unknown currency shows the
// bare number, never a guessed symbol.
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Money } from '@/components/ds/format/Money';
import type { PreviewModel } from './types';

export function hasPreviewPrice(listing: Pick<PreviewModel, 'price' | 'priceRange'>): boolean {
  const range = listing.priceRange;
  if (range && Number.isFinite(range.min) && Number.isFinite(range.max)) return true;
  return typeof listing.price === 'number' && Number.isFinite(listing.price);
}

export function PreviewPrice({ listing }: { listing: Pick<PreviewModel, 'price' | 'priceRange' | 'currency'> }) {
  const t = useTranslations('listingEditor.preview');
  if (!hasPreviewPrice(listing)) return null;
  // Never invent a currency: unknown (shop not loaded yet) → the DS Money formatter shows the plain number.
  const currency = listing.currency || null;
  const range = listing.priceRange;
  if (range && Number.isFinite(range.min) && Number.isFinite(range.max) && range.min !== range.max) {
    return (
      <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
        {t.rich('priceRange', {
          min: () => <Money amount={Math.min(range.min, range.max)} currency={currency} />,
          max: () => <Money amount={Math.max(range.min, range.max)} currency={currency} />,
        })}
      </Box>
    );
  }
  const amount = range && Number.isFinite(range.min) ? range.min : (listing.price as number);
  return <Money amount={amount} currency={currency} />;
}

export default PreviewPrice;
