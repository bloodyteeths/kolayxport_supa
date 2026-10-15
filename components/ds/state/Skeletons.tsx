import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import MuiSkeleton from '@mui/material/Skeleton';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTranslations } from 'next-intl';
import { layout, neutral as n, radius } from '@/lib/ds/tokens';

/** Skeletons appear after this delay so fast loads never flash (DS §3.13). */
export const SKELETON_DELAY_MS = 200;

export function useDelayedVisible(delayMs: number): boolean {
  const [visible, setVisible] = useState(delayMs <= 0);
  useEffect(() => {
    if (delayMs <= 0) return undefined;
    const id = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(id);
  }, [delayMs]);
  return visible;
}

interface BaseProps {
  /** Default 200ms. Pass 0 to render at once. */
  delayMs?: number;
  className?: string;
  'data-testid'?: string;
}

/** One neutral-100 block; the 1.4s shimmer is off under prefers-reduced-motion. */
export function Bone({ w, h, r = radius.xs, circle }: { w: number | string; h: number; r?: number; circle?: boolean }) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  return (
    <MuiSkeleton
      variant={circle ? 'circular' : 'rectangular'}
      animation={reduced ? false : 'wave'}
      width={w}
      height={h}
      sx={{ bgcolor: n[100], borderRadius: circle ? '50%' : `${r}px`, flexShrink: 0, '&::after': { animationDuration: '1.4s', animationTimingFunction: 'linear' } }}
    />
  );
}

function Region({ children, delayMs = SKELETON_DELAY_MS, className, testId }: { children: React.ReactNode; delayMs?: number; className?: string; testId: string }) {
  const t = useTranslations('ds.state');
  const visible = useDelayedVisible(delayMs);
  return (
    <Box role="status" aria-busy="true" aria-label={t('loading')} className={className} data-testid={testId} data-visible={visible ? 'true' : 'false'}>
      {visible ? children : null}
    </Box>
  );
}

const W = ['72%', '48%', '60%', '40%', '66%', '54%'];

export interface TableSkeletonProps extends BaseProps {
  rows?: number;
  /** Adds the 48px thumbnail block of listing / order tables. */
  thumb?: boolean;
  /** Data columns after the identity cell. Default 3. */
  columns?: number;
  density?: 'standard' | 'compact';
}

/** Matches DataTable: 36px header, 44px (36 compact) rows, optional thumb, identity cell + columns. */
export function TableSkeleton({ rows = 8, thumb, columns = 3, density = 'standard', ...rest }: TableSkeletonProps) {
  const rowH = density === 'compact' ? layout.rowHCompact : layout.rowH;
  return (
    <Region delayMs={rest.delayMs} className={rest.className} testId={rest['data-testid'] ?? 'skeleton-table'}>
      <Box sx={{ border: `1px solid ${n[200]}`, borderRadius: `${radius.md}px`, overflow: 'hidden', bgcolor: n[0] }}>
        <Box sx={{ height: 36, bgcolor: n[25], borderBottom: `1px solid ${n[200]}`, display: 'flex', alignItems: 'center', gap: '24px', px: '12px' }}>
          <Bone w={120} h={10} />
          {Array.from({ length: columns }, (_, i) => <Bone key={i} w={64} h={10} />)}
        </Box>
        {Array.from({ length: rows }, (_, r) => (
          <Box key={r} data-testid="skeleton-row" sx={{ minHeight: thumb ? 64 : rowH, display: 'flex', alignItems: 'center', gap: '12px', px: '12px', '& + &': { borderTop: `1px solid ${n[100]}` } }}>
            {thumb && <Bone w={48} h={48} r={radius.sm} />}
            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <Bone w={W[r % W.length]} h={12} />
              {thumb && <Bone w="28%" h={10} />}
            </Box>
            {Array.from({ length: columns }, (_, c) => <Bone key={c} w={64} h={12} />)}
          </Box>
        ))}
      </Box>
    </Region>
  );
}

export interface CardListSkeletonProps extends BaseProps {
  count?: number;
  thumb?: boolean;
}

/** Matches the DataTable mobile cards (64 media, 3 lines). */
export function CardListSkeleton({ count = 4, thumb = true, ...rest }: CardListSkeletonProps) {
  return (
    <Region delayMs={rest.delayMs} className={rest.className} testId={rest['data-testid'] ?? 'skeleton-cards'}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {Array.from({ length: count }, (_, i) => (
          <Box key={i} data-testid="skeleton-card" sx={{ display: 'flex', gap: '12px', p: '12px', border: `1px solid ${n[200]}`, borderRadius: `${radius.md}px`, bgcolor: n[0] }}>
            {thumb && <Bone w={64} h={64} r={radius.sm} />}
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <Bone w={W[i % W.length]} h={12} />
              <Bone w="40%" h={10} />
              <Bone w="30%" h={10} />
            </Box>
          </Box>
        ))}
      </Box>
    </Region>
  );
}

export interface PanelSkeletonProps extends BaseProps {
  sections?: number;
}

/** Matches SidePanel body sections (16px padding, title + 3 lines). */
export function PanelSkeleton({ sections = 3, ...rest }: PanelSkeletonProps) {
  return (
    <Region delayMs={rest.delayMs} className={rest.className} testId={rest['data-testid'] ?? 'skeleton-panel'}>
      {Array.from({ length: sections }, (_, i) => (
        <Box key={i} data-testid="skeleton-section" sx={{ p: '16px', display: 'flex', flexDirection: 'column', gap: '10px', '& + &': { borderTop: `1px solid ${n[100]}` } }}>
          <Bone w={120} h={14} />
          <Bone w="90%" h={12} />
          <Bone w="70%" h={12} />
          <Bone w="50%" h={12} />
        </Box>
      ))}
    </Region>
  );
}

export interface KpiSkeletonProps extends BaseProps {
  count: number;
}

/** Matches KpiTile rows (≤ 4 per row; 2×2 below 600). */
export function KpiSkeleton({ count, ...rest }: KpiSkeletonProps) {
  return (
    <Region delayMs={rest.delayMs} className={rest.className} testId={rest['data-testid'] ?? 'skeleton-kpi'}>
      <Box sx={{ display: 'grid', gap: '12px', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: `repeat(${Math.min(count, 4)}, minmax(0, 1fr))` } }}>
        {Array.from({ length: count }, (_, i) => (
          <Box key={i} data-testid="skeleton-kpi-tile" sx={{ p: '16px', border: `1px solid ${n[200]}`, borderRadius: `${radius.md}px`, bgcolor: n[0], display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <Bone w="50%" h={10} />
            <Bone w="70%" h={28} />
            <Bone w="40%" h={10} />
          </Box>
        ))}
      </Box>
    </Region>
  );
}

export interface ListSkeletonProps extends BaseProps {
  rows?: number;
  /** Leading block: avatar circle (messages), thumb square, or none. */
  leading?: 'avatar' | 'thumb' | 'none';
}

/** Conversation / notification lists: leading block + 2 lines. */
export function ListSkeleton({ rows = 5, leading = 'avatar', ...rest }: ListSkeletonProps) {
  return (
    <Region delayMs={rest.delayMs} className={rest.className} testId={rest['data-testid'] ?? 'skeleton-list'}>
      {Array.from({ length: rows }, (_, i) => (
        <Box key={i} data-testid="skeleton-list-row" sx={{ display: 'flex', gap: '12px', alignItems: 'center', px: '12px', py: '10px' }}>
          {leading === 'avatar' && <Bone w={32} h={32} circle />}
          {leading === 'thumb' && <Bone w={40} h={40} r={radius.sm} />}
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <Bone w={W[i % W.length]} h={12} />
            <Bone w="85%" h={10} />
          </Box>
        </Box>
      ))}
    </Region>
  );
}
