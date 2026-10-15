import React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { neutral as n, radius } from '@/lib/ds/tokens';

export interface FeaturePreviewProps {
  /** Static screenshot rendered from fixtures (`public/previews/*`), EN or `-tr` variant. */
  image: { src: string; srcSet?: string; alt: string };
  /** Mandatory sample-data label (P6). Default: `pro.preview.caption` "Example with sample data". */
  caption?: string;
  /** ≤ 3 benefit points; extra items are dropped. */
  points: string[];
  className?: string;
  'data-testid'?: string;
}

/**
 * pro-gating §3.1 FeaturePreview: a static, non-interactive screenshot at 100% opacity (no blur,
 * no glass, no fake interactivity), 1px border, radius 8, max 880, with the sample-data caption and
 * up to 3 points.
 */
export function FeaturePreview({ image, caption, points, className, ...rest }: FeaturePreviewProps) {
  const t = useTranslations('pro.preview');
  const shown = points.slice(0, 3);
  return (
    <Box component="figure" className={className} data-testid={rest['data-testid'] ?? 'feature-preview'} sx={{ m: 0, mx: 'auto', width: '100%', maxWidth: 880, textAlign: 'left' }}>
      <Box sx={{ border: `1px solid ${n[200]}`, borderRadius: `${radius.md}px`, overflow: 'hidden', bgcolor: n[0], lineHeight: 0 }}>
        <img
          src={image.src}
          srcSet={image.srcSet}
          alt={image.alt}
          draggable={false}
          loading="lazy"
          style={{ display: 'block', width: '100%', height: 'auto', pointerEvents: 'none', userSelect: 'none' }}
        />
      </Box>
      <Box component="figcaption" sx={{ mt: '8px', fontSize: 12, lineHeight: '16px', color: n[500] }}>
        {caption ?? t('caption')}
      </Box>
      {shown.length > 0 && (
        <Box component="ul" sx={{ m: 0, mt: '12px', p: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', columnGap: '24px', rowGap: '8px' }}>
          {shown.map((p) => (
            <Box component="li" key={p} sx={{ fontSize: 14, lineHeight: '20px', color: n[700], display: 'flex', gap: '6px' }}>
              <Box component="span" aria-hidden sx={{ color: n[400] }}>·</Box>
              <span>{p}</span>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

export default FeaturePreview;
