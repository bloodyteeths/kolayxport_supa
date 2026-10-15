// components/domain/preview/PreviewPhoto.tsx: one preview image box with a fixed aspect ratio. No image (create
// mode, or a staged file not uploaded yet) renders the grey placeholder with the registry's thumb icon, never a
// broken image. `fit="cover"` crops the way the marketplace crops; `contain` shows the whole photo.
import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import { icons, ICON_STROKE } from '@/lib/ds/icons';
import { neutral as n, radius as r, px } from '@/lib/ds/tokens';
import type { PreviewImage } from './types';

export interface PreviewPhotoProps {
  image: PreviewImage | undefined;
  /** width / height of the box. */
  ratio: number;
  fit?: 'cover' | 'contain';
  /** Accessible fallback when the image has no alt text. */
  fallbackAlt: string;
  radius?: number;
  /** Natural width / height, reported once the image loads (Etsy "Show crop"). */
  onRatio?: (ratio: number) => void;
  /** Drawn over the image (crop outline). */
  overlay?: ReactNode;
  'data-testid'?: string;
}

export function PreviewPhoto({ image, ratio, fit = 'cover', fallbackAlt, radius = r.sm, onRatio, overlay, 'data-testid': testId }: PreviewPhotoProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = image?.url && image.url !== failedUrl ? image.url : null;
  const Placeholder = icons.thumbPlaceholder;
  return (
    <Box
      data-testid={testId}
      sx={{
        position: 'relative',
        width: '100%',
        aspectRatio: String(ratio),
        bgcolor: n[100],
        borderRadius: px(radius),
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {url ? (
        <img
          src={url}
          alt={(image?.alt ?? '').trim() || fallbackAlt}
          loading="lazy"
          onError={() => setFailedUrl(url)}
          onLoad={(e) => {
            const el = e.currentTarget;
            if (onRatio && el.naturalWidth > 0 && el.naturalHeight > 0) onRatio(el.naturalWidth / el.naturalHeight);
          }}
          style={{ width: '100%', height: '100%', objectFit: fit, display: 'block' }}
        />
      ) : (
        <Placeholder size={24} strokeWidth={ICON_STROKE} color={n[400]} aria-label={fallbackAlt} role="img" />
      )}
      {url && overlay}
    </Box>
  );
}

export default PreviewPhoto;
