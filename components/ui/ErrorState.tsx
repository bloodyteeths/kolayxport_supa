import React from 'react';
import { Button, CircularProgress } from '@mui/material';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { useTranslations } from 'next-intl';
import { getErrorMessage } from '@/lib/notify';

export interface ErrorStateProps {
  /** Default: ui.errorState.title ("Couldn't load this data"). */
  title?: string;
  /** Explicit message. If omitted, derived from `error`, else ui.errorState.message. */
  message?: string;
  /** Raw error (axios/fetch/Error) — a safe short message is extracted. */
  error?: unknown;
  onRetry?: () => void | Promise<unknown>;
  /** Shows a spinner on the retry button. */
  retrying?: boolean;
  /** Inline one-row variant for cards/widgets. */
  compact?: boolean;
  className?: string;
}

/**
 * Use for failed fetches instead of rendering zeros / empty states that look
 * like real data.
 */
export default function ErrorState({
  title,
  message,
  error,
  onRetry,
  retrying = false,
  compact = false,
  className = '',
}: ErrorStateProps) {
  const t = useTranslations('ui');
  const te = useTranslations('errors');
  const heading = title || t('errorState.title');
  const body = message || (error !== undefined ? getErrorMessage(error, t('errorState.message')) : t('errorState.message'));

  const retryButton = onRetry ? (
    <Button
      onClick={(e) => {
        e.stopPropagation();
        void onRetry();
      }}
      disabled={retrying}
      size="small"
      variant={compact ? 'text' : 'outlined'}
      startIcon={retrying ? <CircularProgress size={14} color="inherit" /> : <RefreshRoundedIcon fontSize="small" />}
      sx={{ minHeight: 44, flexShrink: 0, textTransform: 'none' }}
    >
      {te('tryAgain')}
    </Button>
  ) : null;

  if (compact) {
    return (
      <div
        role="alert"
        className={`flex items-center gap-3 rounded-xl border border-red-100 bg-red-50/60 px-3 py-2 ${className}`}
      >
        <ErrorOutlineRoundedIcon sx={{ color: '#dc2626', fontSize: 20, flexShrink: 0 }} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-800 truncate">{heading}</p>
          <p className="text-xs text-slate-500 break-words">{body}</p>
        </div>
        {retryButton}
      </div>
    );
  }

  return (
    <div role="alert" className={`flex flex-col items-center justify-center py-12 px-6 text-center ${className}`}>
      <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center mb-4 bg-red-50">
        <ErrorOutlineRoundedIcon sx={{ color: '#dc2626', fontSize: 30 }} />
      </div>
      <h3 className="text-base sm:text-lg font-semibold text-slate-800 mb-1.5" style={{ letterSpacing: '-0.01em' }}>
        {heading}
      </h3>
      <p className="text-sm text-slate-500 max-w-sm mb-5 break-words">{body}</p>
      {retryButton}
    </div>
  );
}

export { ErrorState };
