// components/domain/MarketplacePreview.tsx: live marketplace preview of the draft view (DESIGN_SYSTEM §4.7,
// listing-editor §4.5). [Search | Listing] × [Desktop | Mobile], Etsy "Show crop", one actionable hint line
// (Etsy mobile title cut) and the honesty caption. Text updates debounced 150 ms; photo changes are immediate.
// Read-only: it never stages or sends anything.
import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { neutral as n, px, space } from '@/lib/ds/tokens';
import { SegmentedControl } from '@/components/ds/inputs/SegmentedControl';
import { Checkbox } from '@/components/ds/inputs/Checkbox';
import { EtsySearchCard } from './preview/EtsySearchCard';
import { EtsyListingPage } from './preview/EtsyListingPage';
import { EbaySearchRow } from './preview/EbaySearchRow';
import { EbayItemPage } from './preview/EbayItemPage';
import {
  ETSY_MOBILE_TITLE_CHARS,
  PREVIEW_DEBOUNCE_MS,
  mobileTitleCut,
  type PreviewDevice,
  type PreviewMarketplace,
  type PreviewModel,
  type PreviewSurface,
} from './preview/types';

export type { PreviewModel, PreviewImage, PreviewDevice, PreviewSurface, PreviewMarketplace } from './preview/types';

export interface MarketplacePreviewProps {
  marketplace: PreviewMarketplace;
  listing: PreviewModel;
  /** Controlled surface; omit to let the preview keep its own (default `search`). */
  surface?: PreviewSurface;
  onSurfaceChange?: (surface: PreviewSurface) => void;
  /** Controlled device; omit to let the preview keep its own (default `desktop`). */
  device?: PreviewDevice;
  onDeviceChange?: (device: PreviewDevice) => void;
  /** Mobile BottomSheet: forces the mobile device and hides the device switch. */
  forceDevice?: PreviewDevice;
  /** Render the "Preview" heading row with the switches (default true). The rail and SidePanel keep it. */
  showHeader?: boolean;
  /** Heading level of the "Preview" title when shown. */
  headingLevel?: 2 | 3;
  'data-testid'?: string;
}

const MP_NAME: Record<PreviewMarketplace, string> = { etsy: 'Etsy', ebay: 'eBay' };

/** `value` after it stopped changing for `ms` (the first value renders at once). */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    if (ms <= 0) {
      setV(value);
      return undefined;
    }
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return ms <= 0 ? value : v;
}

export function MarketplacePreview({
  marketplace,
  listing,
  surface: surfaceProp,
  onSurfaceChange,
  device: deviceProp,
  onDeviceChange,
  forceDevice,
  showHeader = true,
  headingLevel = 3,
  'data-testid': testId,
}: MarketplacePreviewProps) {
  const t = useTranslations('listingEditor.preview');
  const [surfaceState, setSurfaceState] = useState<PreviewSurface>('search');
  const [deviceState, setDeviceState] = useState<PreviewDevice>('desktop');
  const [showCrop, setShowCrop] = useState(false);
  const surface = surfaceProp ?? surfaceState;
  const device = forceDevice ?? deviceProp ?? deviceState;
  const mp = MP_NAME[marketplace];

  const debounced = useDebouncedValue(listing, PREVIEW_DEBOUNCE_MS);
  // Photos come from the live value: reorder / delete / upload show without the text debounce.
  const view = useMemo<PreviewModel>(() => ({ ...debounced, images: listing.images }), [debounced, listing.images]);

  const setSurface = (s: PreviewSurface) => {
    if (surfaceProp === undefined) setSurfaceState(s);
    onSurfaceChange?.(s);
  };
  const setDevice = (d: PreviewDevice) => {
    if (deviceProp === undefined) setDeviceState(d);
    onDeviceChange?.(d);
  };

  const cut = marketplace === 'etsy' && surface === 'search' ? mobileTitleCut(view.title) : null;

  let body;
  if (marketplace === 'etsy') {
    body = surface === 'search'
      ? <EtsySearchCard listing={view} device={device} showCrop={showCrop} />
      : <EtsyListingPage listing={view} device={device} />;
  } else {
    body = surface === 'search'
      ? <EbaySearchRow listing={view} device={device} />
      : <EbayItemPage listing={view} device={device} />;
  }

  return (
    <Box
      data-testid={testId ?? 'marketplace-preview'}
      data-marketplace={marketplace}
      data-surface={surface}
      data-device={device}
      sx={{ display: 'flex', flexDirection: 'column', gap: px(space[3]), minWidth: 0 }}
    >
      {showHeader && (
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: px(space[2]) }}>
          <Typography component={headingLevel === 2 ? 'h2' : 'h3'} variant="titleSm" sx={{ m: 0, color: n[800], mr: 'auto' }}>
            {t('title')}
          </Typography>
          <SegmentedControl<PreviewSurface>
            aria-label={t('surfaceLabel')}
            value={surface}
            onChange={setSurface}
            options={[
              { value: 'search', label: t('search') },
              { value: 'listing', label: t('listing') },
            ]}
          />
          {!forceDevice && (
            <SegmentedControl<PreviewDevice>
              aria-label={t('deviceLabel')}
              value={device}
              onChange={setDevice}
              options={[
                { value: 'desktop', label: t('desktop') },
                { value: 'mobile', label: t('mobile') },
              ]}
            />
          )}
        </Box>
      )}

      {marketplace === 'etsy' && surface === 'search' && (
        <Checkbox checked={showCrop} onChange={(v) => setShowCrop(v)} label={t('showCrop')} data-testid="preview-show-crop" />
      )}

      <Box sx={{ display: 'flex', justifyContent: device === 'mobile' ? 'center' : 'stretch', minWidth: 0 }}>{body}</Box>

      {cut?.cut && (
        <Typography component="p" variant="caption" data-testid="preview-hint" sx={{ m: 0, color: n[600] }}>
          {t('mobileCut', { marketplace: mp, chars: ETSY_MOBILE_TITLE_CHARS })}
          {' · '}
          {t('mobileCutShows', { text: cut.visible })}
        </Typography>
      )}
      <Typography component="p" variant="caption" sx={{ m: 0, color: n[500] }}>
        {t('disclaimer', { marketplace: mp })}
      </Typography>
    </Box>
  );
}

export default MarketplacePreview;
