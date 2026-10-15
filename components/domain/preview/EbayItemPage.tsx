// components/domain/preview/EbayItemPage.tsx: the top of the eBay item page (listing-editor §4.5).
// Gallery, title, subtitle, condition, price, the first 8 item specifics, and the seller description rendered
// as sanitized HTML inside an `iframe sandbox=""` (no scripts, no same-origin, no forms).
import { useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { accent, font, neutral as n, px, radius, space } from '@/lib/ds/tokens';
import { KeyValueList } from '@/components/ds/data/KeyValueList';
import { PreviewPhoto } from './PreviewPhoto';
import { PreviewPrice } from './PreviewPrice';
import { EBAY_SPECIFICS_SHOWN, descriptionSrcDoc, previewText, type PreviewDevice, type PreviewModel } from './types';

export interface EbayItemPageProps {
  listing: PreviewModel;
  device: PreviewDevice;
}

const THUMBS = 8;

export function EbayItemPage({ listing, device }: EbayItemPageProps) {
  const t = useTranslations('listingEditor.preview');
  const [active, setActive] = useState(0);
  const mobile = device === 'mobile';
  const images = listing.images;
  const index = Math.min(active, Math.max(0, images.length - 1));
  const title = previewText(listing.title);
  const subtitle = previewText(listing.subtitle);
  const condition = previewText(listing.condition);
  const specifics = (listing.specifics ?? [])
    .map((s) => ({ name: previewText(s.name), value: previewText(s.value) }))
    .filter((s) => s.name && s.value)
    .slice(0, EBAY_SPECIFICS_SHOWN);
  const description = (listing.description ?? '').trim();

  return (
    <Box
      data-testid="ebay-item-page"
      data-device={device}
      sx={{ width: '100%', maxWidth: mobile ? px(360) : '100%', containerType: 'inline-size', display: 'flex', flexDirection: 'column', gap: px(space[4]) }}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '1fr',
          gap: px(space[4]),
          ...(mobile ? {} : { '@container (min-width: 520px)': { gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' } }),
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: px(space[2]), minWidth: 0 }}>
          <PreviewPhoto image={images[index]} ratio={1} fit="contain" fallbackAlt={t('photoAlt', { index: index + 1 })} />
          {images.length > 1 && (
            <Box sx={{ display: 'flex', gap: px(space[1]), overflowX: 'auto', pb: px(space[0.5]) }}>
              {images.slice(0, THUMBS).map((img, i) => (
                <ButtonBase
                  key={`${img.url ?? 'none'}-${i}`}
                  onClick={() => setActive(i)}
                  aria-label={t('showPhoto', { index: i + 1 })}
                  aria-pressed={i === index}
                  sx={{ flex: '0 0 auto', width: px(44), borderRadius: px(radius.xs), outline: i === index ? `2px solid ${accent[600]}` : 'none', outlineOffset: '1px' }}
                >
                  <PreviewPhoto image={img} ratio={1} fallbackAlt={t('photoAlt', { index: i + 1 })} radius={radius.xs} />
                </ButtonBase>
              ))}
            </Box>
          )}
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: px(space[2]), minWidth: 0 }}>
          <Typography component="p" variant="titleMd" sx={{ m: 0, color: title ? n[900] : n[400], overflowWrap: 'anywhere' }}>
            {title || t('titlePlaceholder')}
          </Typography>
          {subtitle && <Typography component="p" variant="dense" sx={{ m: 0, color: n[600] }}>{subtitle}</Typography>}
          {condition && (
            <Typography component="p" variant="dense" sx={{ m: 0, color: n[800] }}>{t('condition', { condition })}</Typography>
          )}
          <Typography component="p" variant="titleLg" sx={{ m: 0, color: n[900] }}>
            <PreviewPrice listing={listing} />
          </Typography>
        </Box>
      </Box>

      {specifics.length > 0 && (
        <Box data-testid="ebay-specifics">
          <Typography component="p" variant="titleSm" sx={{ m: 0, mb: px(space[1]), color: n[800] }}>{t('specifics')}</Typography>
          <KeyValueList columns={mobile ? 1 : 2} items={specifics.map((s) => ({ label: s.name, value: s.value }))} />
        </Box>
      )}

      {description && (
        <Box>
          <Typography component="p" variant="titleSm" sx={{ m: 0, mb: px(space[1]), color: n[800] }}>{t('sellerDescription')}</Typography>
          <Box
            component="iframe"
            title={t('sellerDescription')}
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={descriptionSrcDoc(description, { font: font.sans, color: n[800], size: 13 })}
            data-testid="ebay-description-frame"
            sx={{ width: '100%', height: px(240), border: `1px solid ${n[200]}`, borderRadius: px(radius.sm), bgcolor: n[0] }}
          />
        </Box>
      )}
    </Box>
  );
}

export default EbayItemPage;
