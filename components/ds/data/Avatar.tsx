// Avatar: person avatar (DESIGN_SYSTEM §4.4, messages D5, shell-nav account menu). Image, else initials on a
// neutral tint (never a brand color). Optional brand badge (LogoTile 16) in the bottom-right corner.
import { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { useLocale } from 'next-intl';
import { neutral as n, px, radius } from '@/lib/ds/tokens';
import { LogoTile } from './LogoTile';
import type { BrandKey, DsBaseProps } from './types';

export type AvatarProps = DsBaseProps & {
  name: string;
  src?: string | null;
  size?: 24 | 28 | 32 | 40;
  brand?: BrandKey;
};

/** "Ayşe Kaya" → "AK", "sarah@x.com" → "S". Locale-aware upper-casing (İ for i in Turkish names). */
export function initialsOf(name: string, locale = 'tr'): string {
  const clean = String(name || '').trim().replace(/@.*$/, '');
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? [parts[0], parts[parts.length - 1]] : parts.slice(0, 1);
  return letters.map((p) => Array.from(p)[0] ?? '').join('').toLocaleUpperCase(locale) || '?';
}

export function Avatar({ name, src, size = 32, brand, className, 'data-testid': testId }: AvatarProps) {
  const locale = useLocale();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const showImg = !!src && !failed;
  return (
    <Box
      component="span"
      className={className}
      data-testid={testId}
      role="img"
      aria-label={name}
      sx={{ position: 'relative', display: 'inline-flex', width: px(size), height: px(size), flexShrink: 0 }}
    >
      <Box
        component="span"
        sx={{
          width: '100%', height: '100%', borderRadius: px(radius.full), overflow: 'hidden', bgcolor: n[100], color: n[600],
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: px(Math.round(size * 0.4)), fontWeight: 500, lineHeight: 1,
        }}
      >
        {showImg ? (
          <Box component="img" src={src ?? undefined} alt="" onError={() => setFailed(true)} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span aria-hidden>{initialsOf(name, locale === 'en' ? 'en' : 'tr')}</span>
        )}
      </Box>
      {brand && size >= 28 && (
        <Box component="span" sx={{ position: 'absolute', right: px(-4), bottom: px(-4), borderRadius: px(4), boxShadow: `0 0 0 2px ${n[0]}` }}>
          <LogoTile brand={brand} size={16} />
        </Box>
      )}
    </Box>
  );
}

export default Avatar;
