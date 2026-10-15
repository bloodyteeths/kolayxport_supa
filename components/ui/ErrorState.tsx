import React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { getErrorMessage } from '@/lib/notify';
import { ErrorState as DsErrorState } from '@/components/ds/state/ErrorState';

/**
 * M1-f shim → `components/ds/state/ErrorState` (DESIGN_SYSTEM §3.13/§4.5; deleted in M10).
 *
 * Adapter (legacy prop → DS prop):
 * - `compact` (or `variant="inline"`) → `variant="inline"`, otherwise `variant="page"`
 * - `title` (default `ui.errorState.title`) → `title`
 * - `message`, else a safe short message from `error` via `getErrorMessage`, else `ui.errorState.message` → `cause`
 * - `onRetry` (may return a Promise) → `onRetry`; label stays `errors.tryAgain` (`retryLabel`)
 * - `retrying` → DS `retrying` (the retry ActionSpec gets `loading`: in-button spinner, disabled, aria-busy);
 *   clicks are also ignored here while it is true.
 * - `className`, `data-testid` pass through
 * Clicks inside the error never bubble to a clickable parent card/row (legacy behavior).
 */

export interface ErrorStateProps {
  /** Default: ui.errorState.title ("Couldn't load this data"). */
  title?: string;
  /** Explicit message (DS: `cause`). If omitted, derived from `error`, else ui.errorState.message. */
  message?: string;
  /** Raw error (axios/fetch/Error) — a safe short message is extracted. */
  error?: unknown;
  onRetry?: () => void | Promise<unknown>;
  /** While true, the retry button shows its spinner, is announced busy/disabled and clicks are ignored. */
  retrying?: boolean;
  /** Inline one-row variant for cards/widgets (DS `variant="inline"`). */
  compact?: boolean;
  /** DS-style alias: `inline` = `compact`. */
  variant?: 'page' | 'inline';
  className?: string;
  'data-testid'?: string;
}

export default function ErrorState({
  title,
  message,
  error,
  onRetry,
  retrying = false,
  compact = false,
  variant,
  className,
  'data-testid': testId,
}: ErrorStateProps) {
  const t = useTranslations('ui');
  const te = useTranslations('errors');
  const heading = title || t('errorState.title');
  const cause = message || (error !== undefined ? getErrorMessage(error, t('errorState.message')) : t('errorState.message'));
  const dsVariant = (variant ?? (compact ? 'inline' : 'page')) === 'inline' ? 'inline' : 'page';

  return (
    <Box
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      data-retrying={retrying || undefined}
      aria-busy={retrying || undefined}
      sx={{ display: 'contents' }}
    >
      <DsErrorState
        variant={dsVariant}
        title={heading}
        cause={cause}
        onRetry={
          onRetry
            ? () => {
                if (!retrying) void onRetry();
              }
            : undefined
        }
        retrying={retrying}
        retryLabel={te('tryAgain')}
        className={className}
        data-testid={testId}
      />
    </Box>
  );
}

export { ErrorState };
