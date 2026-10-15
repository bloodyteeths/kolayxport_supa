// Thumb: product thumbnail (DESIGN_SYSTEM §3.11). 1px neutral-200 border, radius 6, cover, neutral-50 bg.
// A missing or broken image shows the neutral package glyph, never "-". Desktop hover opens a 240px preview
// after 400 ms (`preview`).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Popper } from '@mui/material';
import { neutral as n, px, radius, elevation, zIndex } from '@/lib/ds/tokens';
import { PlaceholderIcon } from './dataIcons';
import type { DsBaseProps } from './types';

export type ThumbSize = 16 | 32 | 40 | 48 | 64 | 96 | 120;

export type ThumbProps = DsBaseProps & {
  src?: string | null;
  alt: string;
  size: ThumbSize;
  preview?: boolean;
  /** Corner badge, e.g. "+2" for more items. */
  badge?: ReactNode;
};

const PREVIEW_DELAY = 400;
const PREVIEW_SIZE = 240;

export function Thumb({ src, alt, size, preview, badge, className, 'data-testid': testId }: ThumbProps) {
  const [failed, setFailed] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setFailed(false), [src]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const hasImage = !!src && !failed;
  const r = size <= 16 ? radius.xs : radius.sm;

  const onEnter = (e: React.MouseEvent<HTMLElement>) => {
    if (!preview || !hasImage) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) return;
    const el = e.currentTarget;
    timer.current = setTimeout(() => setAnchor(el), PREVIEW_DELAY);
  };
  const onLeave = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setAnchor(null);
  };

  return (
    <Box
      className={className}
      data-testid={testId}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      sx={{
        position: 'relative',
        width: px(size),
        height: px(size),
        flexShrink: 0,
        borderRadius: px(r),
        border: `1px solid ${n[200]}`,
        bgcolor: n[50],
        overflow: 'hidden',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {hasImage ? (
        <Box
          component="img"
          src={src ?? undefined}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        // Empty alt = decorative (e.g. a thumb column without `thumbAlt`): no img role with an empty name.
        <Box
          component="span"
          {...(alt ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true })}
          sx={{ display: 'inline-flex', color: n[400] }}
        >
          <PlaceholderIcon size={Math.max(12, Math.round(size * 0.4))} strokeWidth={1.75} aria-hidden />
        </Box>
      )}
      {badge !== undefined && badge !== null && (
        <Box
          sx={{
            position: 'absolute', right: px(2), bottom: px(2), px: px(4), borderRadius: px(radius.full),
            bgcolor: n[900], color: n[0], fontSize: px(11), lineHeight: px(14), fontWeight: 500,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {badge}
        </Box>
      )}
      {preview && hasImage && (
        <Popper open={!!anchor} anchorEl={anchor} placement="right-start" sx={{ zIndex: zIndex.popover, pointerEvents: 'none' }}>
          <Box
            sx={{
              width: px(PREVIEW_SIZE), height: px(PREVIEW_SIZE), ml: px(8), bgcolor: n[0],
              border: `1px solid ${n[200]}`, borderRadius: px(radius.md), boxShadow: elevation.e2, overflow: 'hidden',
            }}
          >
            <Box component="img" src={src ?? undefined} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </Box>
        </Popper>
      )}
    </Box>
  );
}

export default Thumb;
