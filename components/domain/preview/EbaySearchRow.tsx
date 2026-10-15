// components/domain/preview/EbaySearchRow.tsx: how the listing appears in eBay search (listing-editor §4.5).
// Square photo 1, title (eBay max 80), condition, price, and "Free shipping" only when the fulfillment policy
// is known to be free (unknown → omitted, never guessed). Desktop is a row; mobile stacks photo left, text right
// at phone width.
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { neutral as n, px, space, tone } from '@/lib/ds/tokens';
import { PreviewPhoto } from './PreviewPhoto';
import { PreviewPrice } from './PreviewPrice';
import { previewText, type PreviewDevice, type PreviewModel } from './types';

export interface EbaySearchRowProps {
  listing: PreviewModel;
  device: PreviewDevice;
}

export function EbaySearchRow({ listing, device }: EbaySearchRowProps) {
  const t = useTranslations('listingEditor.preview');
  const mobile = device === 'mobile';
  const title = previewText(listing.title);
  const condition = previewText(listing.condition);
  return (
    <Box
      data-testid="ebay-search-row"
      data-device={device}
      sx={{
        display: 'grid',
        gridTemplateColumns: mobile ? `${px(112)} minmax(0, 1fr)` : `${px(140)} minmax(0, 1fr)`,
        gap: px(space[3]),
        alignItems: 'start',
        width: '100%',
        maxWidth: mobile ? px(360) : '100%',
      }}
    >
      <PreviewPhoto image={listing.images[0]} ratio={1} fit="cover" fallbackAlt={t('photoAlt', { index: 1 })} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: px(space[1]), minWidth: 0 }}>
        <Typography
          component="p"
          variant="dense"
          data-testid="ebay-row-title"
          sx={{
            m: 0,
            color: title ? n[900] : n[400],
            overflowWrap: 'anywhere',
            display: '-webkit-box',
            WebkitLineClamp: mobile ? 3 : 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {title || t('titlePlaceholder')}
        </Typography>
        {condition && (
          <Typography component="p" variant="caption" sx={{ m: 0, color: n[500] }}>{condition}</Typography>
        )}
        <Typography component="p" variant="titleSm" sx={{ m: 0, color: n[900] }}>
          <PreviewPrice listing={listing} />
        </Typography>
        {listing.freeShipping === true && (
          <Typography component="p" variant="caption" sx={{ m: 0, color: tone.success.fg }}>{t('freeShipping')}</Typography>
        )}
      </Box>
    </Box>
  );
}

export default EbaySearchRow;
