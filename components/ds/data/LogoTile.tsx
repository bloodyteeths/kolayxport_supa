// LogoTile: the ONLY place brand marks and brand colors appear (DESIGN_SYSTEM §3.11, BUILD_PLAN §2.1).
// Reads lib/ds/logos.ts. The real mark renders on a white tile with a 1px border; the monogram
// (white initials on the brand color) is only the onError fallback, or the tile for a provider
// that has no asset in the registry.
import { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { getLogo, logoDisplayName, type LogoAsset } from '@/lib/ds/logos';
import { brand as brandColors, neutral as n, px, space } from '@/lib/ds/tokens';
import type { BrandKey, DsBaseProps } from './types';

export type LogoTileSize = 16 | 20 | 24 | 32 | 40;

export type LogoTileProps = DsBaseProps & {
  /** A BrandKey or a raw marketplace/carrier string ("Etsy", "MNG Kargo"); normalized by `getLogo`. */
  brand: BrandKey | string;
  size?: LogoTileSize;
  withName?: boolean;
  /** `mono` tints the single-color mark with currentColor (collapsed rail). */
  tone?: 'color' | 'mono';
  /** Overrides the accessible name (default: the registry's proper-noun name). */
  label?: string;
};

export function tileRadius(size: LogoTileSize): number {
  if (size <= 20) return 4;
  if (size <= 32) return 6;
  return 8;
}

/** Proper-noun fallback name for brands that are not in the registry (n11, chrome, unknown strings). */
function fallbackName(raw: string): string {
  const s = raw.trim();
  return s ? s.charAt(0).toLocaleUpperCase('en') + s.slice(1) : s;
}

export function resolveBrand(raw: BrandKey | string): { asset: LogoAsset | null; name: string; color: string; initials: string } {
  const asset = getLogo(raw);
  if (asset) return { asset, name: logoDisplayName(raw) ?? asset.name, color: asset.color, initials: asset.initials };
  const key = String(raw || '').trim().toLowerCase();
  const color = (brandColors as Record<string, string>)[key] ?? n[600];
  const name = fallbackName(String(raw || ''));
  return { asset: null, name, color, initials: name.charAt(0) || '?' };
}

export function LogoTile({
  brand, size = 20, withName, tone = 'color', label, className, 'data-testid': testId,
}: LogoTileProps) {
  const { asset, name, color, initials } = resolveBrand(brand);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [brand, tone]);

  const r = tileRadius(size);
  const ariaLabel = label ?? name;
  const src = asset ? (tone === 'mono' ? asset.monoSrc : asset.src) : null;
  const showMonogram = !src || failed;
  const pad = size >= 32 ? Math.round(size * 0.15) : Math.max(1, Math.round(size * 0.1));

  const tile = (
    <Box
      component="span"
      role="img"
      aria-label={ariaLabel}
      data-brand={asset?.provider ?? String(brand)}
      data-monogram={showMonogram ? 'true' : undefined}
      className={withName ? undefined : className}
      data-testid={withName ? undefined : testId}
      sx={{
        width: px(size),
        height: px(size),
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: px(r),
        overflow: 'hidden',
        boxSizing: 'border-box',
        ...(showMonogram
          ? { bgcolor: tone === 'mono' ? 'currentColor' : color }
          : { bgcolor: n[0], border: `1px solid ${n[200]}`, p: px(pad) }),
      }}
    >
      {showMonogram ? (
        <Box
          component="span"
          aria-hidden
          sx={{
            color: n[0],
            fontSize: px(Math.max(9, Math.round(size * 0.5))),
            lineHeight: 1,
            fontWeight: 600,
          }}
        >
          {initials}
        </Box>
      ) : tone === 'mono' ? (
        <Box
          component="span"
          aria-hidden
          sx={{
            width: '100%',
            height: '100%',
            bgcolor: 'currentColor',
            maskImage: `url(${src})`,
            WebkitMaskImage: `url(${src})`,
            maskSize: 'contain',
            WebkitMaskSize: 'contain',
            maskRepeat: 'no-repeat',
            WebkitMaskRepeat: 'no-repeat',
            maskPosition: 'center',
            WebkitMaskPosition: 'center',
          }}
        >
          {/* hidden probe so a missing mono asset still falls back to the monogram */}
          <Box component="img" src={src ?? undefined} alt="" onError={() => setFailed(true)} sx={{ display: 'none' }} />
        </Box>
      ) : (
        <Box
          component="img"
          src={src ?? undefined}
          alt=""
          aria-hidden
          onError={() => setFailed(true)}
          sx={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      )}
    </Box>
  );

  if (!withName) return tile;
  return (
    <Box
      component="span"
      className={className}
      data-testid={testId}
      sx={{ display: 'inline-flex', alignItems: 'center', gap: px(space[1.5]), minWidth: 0 }}
    >
      {tile}
      <Typography component="span" variant="dense" sx={{ color: n[700], whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {name}
      </Typography>
    </Box>
  );
}

export default LogoTile;
