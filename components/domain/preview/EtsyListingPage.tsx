// components/domain/preview/EtsyListingPage.tsx: the top of the Etsy listing page (listing-editor §4.5).
// Photo carousel with thumbs, full title, price, variation selects (labels only), the personalization box with
// instructions and character limit, the processing / made-to-order line, and the first 3 description lines
// followed by "Learn more about this item". Description is plain text, as Etsy shows it (no HTML).
// Two columns when the preview is wide (SidePanel md), stacked in the 360 rail and on the mobile surface.
import { useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { accent, neutral as n, px, radius, space } from '@/lib/ds/tokens';
import { PreviewPhoto } from './PreviewPhoto';
import { PreviewPrice } from './PreviewPrice';
import { descriptionLead, previewText, type PreviewDevice, type PreviewModel } from './types';

export interface EtsyListingPageProps {
  listing: PreviewModel;
  device: PreviewDevice;
}

/** Thumbs shown under the main photo (Etsy shows a scrolling column; the preview keeps one row). */
const THUMBS = 8;
export const MOBILE_PAGE_WIDTH = 360;

function SelectLook({ label, placeholder }: { label: string; placeholder: string }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: px(space[1]) }}>
      <Typography component="span" variant="label" sx={{ color: n[800] }}>{label}</Typography>
      <Box
        aria-hidden
        sx={{
          border: `1px solid ${n[300]}`,
          borderRadius: px(radius.sm),
          px: px(space[3]),
          py: px(space[2]),
          color: n[500],
          bgcolor: n[0],
        }}
      >
        <Typography component="span" variant="dense">{placeholder}</Typography>
      </Box>
    </Box>
  );
}

export function EtsyListingPage({ listing, device }: EtsyListingPageProps) {
  const t = useTranslations('listingEditor.preview');
  const [active, setActive] = useState(0);
  const mobile = device === 'mobile';
  const images = listing.images;
  const index = Math.min(active, Math.max(0, images.length - 1));
  const title = previewText(listing.title);
  const lead = descriptionLead(listing.description);
  const p = listing.personalization;
  const processing = listing.processingDays;

  return (
    <Box
      data-testid="etsy-listing-page"
      data-device={device}
      sx={{ width: '100%', maxWidth: mobile ? px(MOBILE_PAGE_WIDTH) : '100%', containerType: 'inline-size' }}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '1fr',
          gap: px(space[4]),
          ...(mobile ? {} : { '@container (min-width: 520px)': { gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)' } }),
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: px(space[2]), minWidth: 0 }}>
          <PreviewPhoto image={images[index]} ratio={1} fit="contain" fallbackAlt={t('photoAlt', { index: index + 1 })} data-testid="etsy-page-photo" />
          {images.length > 1 && (
            <Box sx={{ display: 'flex', gap: px(space[1]), overflowX: 'auto', pb: px(space[0.5]) }}>
              {images.slice(0, THUMBS).map((img, i) => (
                <ButtonBase
                  key={`${img.url ?? 'none'}-${i}`}
                  onClick={() => setActive(i)}
                  aria-label={t('showPhoto', { index: i + 1 })}
                  aria-pressed={i === index}
                  sx={{
                    flex: '0 0 auto',
                    width: px(44),
                    borderRadius: px(radius.xs),
                    outline: i === index ? `2px solid ${accent[600]}` : 'none',
                    outlineOffset: '1px',
                  }}
                >
                  <PreviewPhoto image={img} ratio={1} fallbackAlt={t('photoAlt', { index: i + 1 })} radius={radius.xs} />
                </ButtonBase>
              ))}
            </Box>
          )}
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: px(space[3]), minWidth: 0 }}>
          <Typography component="p" variant="titleMd" sx={{ m: 0, fontWeight: 600, color: n[900] }}>
            <PreviewPrice listing={listing} />
          </Typography>
          <Typography component="p" variant={mobile ? 'dense' : 'body1'} sx={{ m: 0, color: title ? n[800] : n[400], overflowWrap: 'anywhere' }}>
            {title || t('titlePlaceholder')}
          </Typography>
          {listing.shopName && (
            <Typography component="p" variant="caption" sx={{ m: 0, color: n[500] }}>{previewText(listing.shopName)}</Typography>
          )}

          {(listing.variations ?? []).filter((v) => previewText(v.name)).map((v, i) => (
            <SelectLook key={`${v.name}-${i}`} label={previewText(v.name)} placeholder={t('selectOption')} />
          ))}

          {p && (
            <Box data-testid="etsy-personalization" sx={{ display: 'flex', flexDirection: 'column', gap: px(space[1]) }}>
              <Typography component="span" variant="label" sx={{ color: n[800] }}>
                {p.required ? t('personalization') : t('personalizationOptional')}
              </Typography>
              {previewText(p.instructions) && (
                <Typography component="p" variant="caption" sx={{ m: 0, color: n[600], whiteSpace: 'pre-line' }}>
                  {previewText(p.instructions)}
                </Typography>
              )}
              <Box aria-hidden sx={{ border: `1px solid ${n[300]}`, borderRadius: px(radius.sm), minHeight: px(56), bgcolor: n[0] }} />
              {typeof p.charLimit === 'number' && p.charLimit > 0 && (
                <Typography component="span" variant="micro" sx={{ color: n[500], alignSelf: 'flex-end' }}>
                  {t('charLimit', { count: p.charLimit })}
                </Typography>
              )}
            </Box>
          )}

          {(listing.madeToOrder || processing) && (
            <Typography component="p" variant="dense" sx={{ m: 0, color: n[700] }}>
              {[
                listing.madeToOrder ? t('madeToOrder') : null,
                processing
                  ? processing.min === processing.max
                    ? t('processingOne', { count: processing.max })
                    : t('processingRange', { min: processing.min, max: processing.max })
                  : null,
              ].filter(Boolean).join(' · ')}
            </Typography>
          )}

          {lead.lines.length > 0 && (
            <Box data-testid="etsy-description" sx={{ display: 'flex', flexDirection: 'column', gap: px(space[1]) }}>
              {lead.lines.map((line, i) => (
                <Typography key={i} component="p" variant="dense" sx={{ m: 0, color: n[700], overflowWrap: 'anywhere' }}>
                  {line}
                </Typography>
              ))}
              <Typography component="span" variant="label" sx={{ color: n[900], textDecoration: 'underline' }}>
                {t('learnMore')}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

export default EtsyListingPage;
