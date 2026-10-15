// components/domain/preview/EtsySearchCard.tsx: how the listing appears in Etsy search (listing-editor §4.5).
// Photo 1 cropped to 4:3 as Etsy crops it ("Show crop" draws the crop outline over the whole photo instead),
// title clamped to 2 lines on desktop / the ~55 characters Etsy shows on mobile, price, shop name.
// Honest preview: no stars, review counts, "Bestseller" or free-shipping badges (we do not know them).
import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { neutral as n, px, space } from '@/lib/ds/tokens';
import { PreviewPhoto } from './PreviewPhoto';
import { PreviewPrice } from './PreviewPrice';
import { ETSY_CARD_RATIO, cropBox, mobileTitleCut, previewText, type PreviewDevice, type PreviewModel } from './types';

export interface EtsySearchCardProps {
  listing: PreviewModel;
  device: PreviewDevice;
  showCrop?: boolean;
}

/** Card width on the mobile surface: one column of Etsy's two-column phone grid. */
export const ETSY_MOBILE_CARD_WIDTH = 172;

export function EtsySearchCard({ listing, device, showCrop = false }: EtsySearchCardProps) {
  const t = useTranslations('listingEditor.preview');
  const [ratio, setRatio] = useState<number | null>(null);
  const mobile = device === 'mobile';
  const title = previewText(listing.title);
  const cut = mobileTitleCut(title);
  const image = listing.images[0];
  const box = ratio ? cropBox(ratio) : null;

  const photo = showCrop ? (
    <PreviewPhoto
      image={image}
      ratio={ratio ?? 1}
      fit="contain"
      fallbackAlt={t('photoAlt', { index: 1 })}
      onRatio={setRatio}
      data-testid="etsy-card-photo"
      overlay={box && (
        <Box
          aria-hidden
          data-testid="etsy-crop-outline"
          sx={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: `${box.widthPct}%`,
            height: `${box.heightPct}%`,
            border: `2px dashed ${n[0]}`,
            outline: `1px solid ${n[900]}`,
            outlineOffset: '-3px',
            pointerEvents: 'none',
          }}
        />
      )}
    />
  ) : (
    <PreviewPhoto image={image} ratio={ETSY_CARD_RATIO} fit="cover" fallbackAlt={t('photoAlt', { index: 1 })} onRatio={setRatio} data-testid="etsy-card-photo" />
  );

  return (
    <Box
      data-testid="etsy-search-card"
      data-device={device}
      sx={{ width: mobile ? px(ETSY_MOBILE_CARD_WIDTH) : '100%', maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: px(space[1.5]) }}
    >
      {photo}
      <Typography
        component="p"
        variant={mobile ? 'caption' : 'dense'}
        data-testid="etsy-card-title"
        sx={{
          m: 0,
          color: title ? n[800] : n[400],
          overflowWrap: 'anywhere',
          ...(mobile ? {} : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
        }}
      >
        {!title ? t('titlePlaceholder') : mobile && cut.cut ? t('truncated', { text: cut.visible }) : title}
      </Typography>
      <Typography component="p" variant="label" sx={{ m: 0, color: n[900], fontWeight: 600 }}>
        <PreviewPrice listing={listing} />
      </Typography>
      {listing.shopName && (
        <Typography component="p" variant="caption" sx={{ m: 0, color: n[500] }}>
          {previewText(listing.shopName)}
        </Typography>
      )}
    </Box>
  );
}

export default EtsySearchCard;
