// Avatar: person avatar (DESIGN_SYSTEM §4.4, messages D5, shell-nav account menu). Image, else initials on a
// neutral tint (never a brand color). Optional brand badge (LogoTile 16) overlapping the bottom-right corner.
// With a badge the initials shrink a step and shift up-left so the badge (+ its 2px white ring) never covers a
// letter (production bug: "KD" clipped under the Wix badge in the inbox list).
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

/** Badge geometry (pure, tested): offset outside the avatar box and the initials' font size / nudge. */
export function avatarBadgeLayout(size: number, hasBadge: boolean) {
  if (!hasBadge) return { offset: 0, fontSize: Math.round(size * 0.4), nudge: 0 };
  return { offset: -6, fontSize: Math.round(size * 0.375), nudge: Math.max(1, Math.round(size / 16)) };
}

export function Avatar({ name, src, size = 32, brand, className, 'data-testid': testId }: AvatarProps) {
  const locale = useLocale();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const showImg = !!src && !failed;
  const badged = Boolean(brand) && size >= 28;
  const lay = avatarBadgeLayout(size, badged);
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
          fontSize: px(lay.fontSize), fontWeight: 500, lineHeight: 1,
        }}
      >
        {showImg ? (
          <Box component="img" src={src ?? undefined} alt="" onError={() => setFailed(true)} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <Box
            component="span"
            aria-hidden
            data-testid="avatar-initials"
            sx={lay.nudge ? { transform: `translate(${px(-lay.nudge)}, ${px(-lay.nudge)})` } : undefined}
          >
            {initialsOf(name, locale === 'en' ? 'en' : 'tr')}
          </Box>
        )}
      </Box>
      {badged && brand && (
        <Box
          component="span"
          data-testid="avatar-badge"
          sx={{ position: 'absolute', right: px(lay.offset), bottom: px(lay.offset), display: 'inline-flex', lineHeight: 0, borderRadius: px(4), boxShadow: `0 0 0 2px ${n[0]}`, zIndex: 1 }}
        >
          <LogoTile brand={brand} size={16} />
        </Box>
      )}
    </Box>
  );
}

export default Avatar;
