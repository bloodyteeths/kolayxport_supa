import React, { useCallback, useEffect, useState } from 'react';
import { Chip, Tooltip } from '@mui/material';
import FiberManualRecordRoundedIcon from '@mui/icons-material/FiberManualRecordRounded';
import { useFormatter, useTranslations } from 'next-intl';
import { useLiveRevalidate } from '@/components/live/useLiveEvent';
import { fetchJson, type CacheStatus } from './types';

/**
 * Seller-facing freshness of the Etsy listing cache:
 *   live    "Etsy live · last change 2 min ago"
 *   polling "Delayed · checked once a day · last check …"
 * Never says "webhook". Refreshes on live listing events and every minute.
 */
/**
 * `pendingCount`: staged changes not sent yet. When > 0 the chip says so (amber) instead of "no changes": the
 * seller must never read "no changes" while their own edits are waiting (usability review 24 Oct).
 */
export default function CacheFreshnessChip({ shopId, size = 'small', pendingCount = 0 }: { shopId: string; size?: 'small' | 'medium'; pendingCount?: number }) {
  const t = useTranslations('listingHistory');
  const format = useFormatter();
  const [status, setStatus] = useState<CacheStatus | null>(null);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    if (!shopId) return;
    try {
      setStatus(await fetchJson<CacheStatus>(`/api/etsy/cache-status?shop_id=${encodeURIComponent(shopId)}`));
    } catch {
      setStatus(null);
    }
  }, [shopId]);

  useEffect(() => {
    void load();
    const id = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        setTick((n) => n + 1); // re-render relative time
      }
    }, 60_000);
    const refetch = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void load();
    }, 5 * 60_000);
    return () => {
      clearInterval(id);
      clearInterval(refetch);
    };
  }, [load]);

  useLiveRevalidate(['listing.changed', 'listing.removed', 'sync.finished'], load, { throttleMs: 5000 });

  if (!status) return null;
  const now = new Date();
  let label: string;
  let color: string;
  if (status.needsReauth) {
    label = t('freshness.needsReauth');
    color = '#DC2626';
  } else if (pendingCount > 0) {
    label = t('freshness.pending', { count: pendingCount });
    color = '#D97706';
  } else if (status.live) {
    label = status.lastChangeAt
      ? t('freshness.live', { time: format.relativeTime(new Date(status.lastChangeAt), now) })
      : t('freshness.liveNoChange');
    color = '#16A34A';
  } else {
    label = status.lastCheckAt
      ? t('freshness.delayed', { time: format.relativeTime(new Date(status.lastCheckAt), now) })
      : t('freshness.delayedNever');
    color = '#D97706';
  }
  return (
    <Tooltip title={status.live ? t('freshness.tooltipLive') : t('freshness.tooltipDelayed')} enterTouchDelay={0}>
      <Chip
        size={size}
        variant="outlined"
        icon={<FiberManualRecordRoundedIcon sx={{ fontSize: 10, color: `${color} !important` }} />}
        label={label}
        sx={{ maxWidth: '100%', borderColor: `${color}55`, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
      />
    </Tooltip>
  );
}
