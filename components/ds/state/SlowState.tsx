import React from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { useTranslations } from 'next-intl';
import { neutral as n } from '@/lib/ds/tokens';
import { ActionButton } from '../overlay/actions';

export interface SlowStateProps {
  onRetry?: () => void;
  /** page: centered in the region · inline: one line. */
  variant?: 'page' | 'inline';
  className?: string;
  'data-testid'?: string;
}

/** The 15s "Still loading… [Retry]" state of `useAsyncState` (DS P6). */
export function SlowState({ onRetry, variant = 'page', className, ...rest }: SlowStateProps) {
  const t = useTranslations('ds.state');
  return (
    <Box
      role="status"
      className={className}
      data-testid={rest['data-testid'] ?? 'slow-state'}
      sx={{
        display: 'flex', alignItems: 'center', justifyContent: variant === 'page' ? 'center' : 'flex-start', gap: '8px',
        py: variant === 'page' ? '48px' : '8px', fontSize: 13, lineHeight: '18px', color: n[600],
      }}
    >
      <CircularProgress size={14} sx={{ color: n[400] }} />
      <span>{t('slow')}</span>
      {onRetry && <ActionButton variant="ghost" size="sm" action={{ id: 'retry', label: t('error.retryShort'), onClick: onRetry }} />}
    </Box>
  );
}

export default SlowState;
