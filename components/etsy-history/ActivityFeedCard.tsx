import React, { useState } from 'react';
import { Avatar, Box, Collapse, IconButton, Link as MuiLink, Paper, Typography } from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import ImageNotSupportedRoundedIcon from '@mui/icons-material/ImageNotSupportedRounded';
import { useFormatter, useTranslations } from 'next-intl';
import AttributionChip from './AttributionChip';
import VersionDiffView from './VersionDiffView';
import type { ActivityItem } from './types';

/** One listing change in the activity feed (expandable card; mobile-first). */
export default function ActivityFeedCard({ item, highlight = false }: { item: ActivityItem; highlight?: boolean }) {
  const t = useTranslations('listingHistory');
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const keys = item.isTombstone ? ['deleted'] : item.changedKeys;
  const title = item.listing.title || (item.isTombstone ? t('activity.deletedListing') : `#${item.listingId}`);

  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: '12px',
        overflow: 'hidden',
        transition: 'background-color 1.2s',
        bgcolor: highlight ? '#EFF6FF' : 'background.paper',
      }}
    >
      <Box
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setOpen((o) => !o);
        }}
        sx={{ display: 'flex', alignItems: 'center', gap: 1.25, p: 1.25, cursor: 'pointer', minHeight: 56 }}
      >
        <Avatar variant="rounded" src={item.listing.thumbnail || undefined} sx={{ width: 44, height: 44, bgcolor: '#F1F5F9' }}>
          <ImageNotSupportedRoundedIcon sx={{ color: '#94A3B8' }} fontSize="small" />
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
            {title}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mt: 0.25 }}>
            <AttributionChip attribution={item.attribution} />
            <Typography variant="caption" color="text.secondary" noWrap>
              {keys.map((k) => (t.has(`keys.${k}`) ? t(`keys.${k}`) : k)).join(', ')}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.25 }}>
          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            {format.relativeTime(new Date(item.capturedAt), new Date())}
          </Typography>
          <IconButton size="small" aria-label="expand" sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
            <ExpandMoreRoundedIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 1.25, pb: 1.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <VersionDiffView changedKeys={item.changedKeys} diff={item.diff} isTombstone={item.isTombstone} />
          {item.listing.url && (
            <MuiLink href={item.listing.url} target="_blank" rel="noopener noreferrer" variant="body2" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
              {t('activity.viewListing')}
              <OpenInNewRoundedIcon sx={{ fontSize: 14 }} />
            </MuiLink>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}
