import React, { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import { useFormatter, useTranslations } from 'next-intl';
import { neutral as n, radius, tone } from '@/lib/ds/tokens';
import { ActionButton, type ActionSpec } from '../overlay/actions';
import { CheckIcon, CopyIcon, DangerIcon, WarningIcon } from '../overlay/icons.internal';

export type ErrorStateVariant = 'page' | 'inline' | 'stale';

export interface ErrorStateProps {
  /** page: replaces the region body · inline: inside a card or panel · stale: one line above data that stays visible. */
  variant?: ErrorStateVariant;
  /**
   * Plain cause headline: "Couldn't load orders", "Couldn't check Etsy". Required for page/inline.
   * For `stale` it defaults to "Showing data from {time}" built from `staleSince`.
   */
  title?: string;
  /** Second line: "Etsy didn't respond". Never raw JSON / API text. */
  cause?: string;
  /** Shown as "Copy error ID" (copies the id to the clipboard). */
  errorId?: string;
  /** stale: when the visible data was last good. */
  staleSince?: Date;
  onRetry?: () => void;
  /** While a retry is in flight: the retry button shows its spinner, is announced busy and ignores clicks. */
  retrying?: boolean;
  /** Override "Try again" / "Retry". */
  retryLabel?: string;
  /**
   * Cause-specific recovery rendered as the primary ([Reconnect Etsy], [Back to listings]);
   * [Try again] then drops to secondary. page/inline only.
   */
  action?: ActionSpec;
  /** A second recovery, rendered as secondary next to the action ([Open the draft]). page/inline only. */
  secondaryAction?: ActionSpec;
  className?: string;
  'data-testid'?: string;
}

async function copy(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* clipboard blocked */
  }
  return false;
}

function CopyErrorId({ errorId }: { errorId: string }) {
  const t = useTranslations('ds.state.error');
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <ActionButton
      variant="ghost"
      size="sm"
      data-testid="error-copy-id"
      action={{
        id: 'copy-error-id',
        label: copied ? t('copied') : t('copyId'),
        icon: copied ? CheckIcon : CopyIcon,
        onClick: () => {
          void copy(errorId).then((ok) => {
            if (!ok) return;
            setCopied(true);
            timer.current = setTimeout(() => setCopied(false), 2000);
          });
        },
      }}
    />
  );
}

/**
 * DS §3.13 ErrorState. Says what really happened ("Couldn't check Etsy", never "Not connected" unless
 * known), offers [Try again] and "Copy error ID". Raw JSON never reaches the UI.
 */
export function ErrorState({
  variant = 'page', title, cause, errorId, staleSince, onRetry, retrying = false, retryLabel, action, secondaryAction, className, ...rest
}: ErrorStateProps) {
  const t = useTranslations('ds.state.error');
  const format = useFormatter();
  const testId = rest['data-testid'] ?? `error-${variant}`;

  if (variant === 'stale') {
    const when = staleSince ? format.dateTime(staleSince, { hour: '2-digit', minute: '2-digit' }) : null;
    const text = title ?? (when ? t('staleSince', { time: when }) : t('staleUnknown'));
    return (
      <Box
        role="status"
        className={className}
        data-testid={testId}
        sx={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: 32, fontSize: 12, lineHeight: '16px', color: tone.warning.fg }}
      >
        <WarningIcon size={14} strokeWidth={1.75} aria-hidden />
        <span>{text}</span>
        {onRetry && (
          <>
            <Box component="span" aria-hidden sx={{ color: n[400] }}>·</Box>
            <ActionButton variant="ghost" size="sm" action={{ id: 'retry', label: retryLabel ?? t('retryShort'), onClick: onRetry, loading: retrying }} />
          </>
        )}
      </Box>
    );
  }

  const retryButton = onRetry ? <ActionButton variant="secondary" size="md" action={{ id: 'retry', label: retryLabel ?? t('retry'), onClick: onRetry, loading: retrying }} /> : null;
  const buttons = action || secondaryAction || retryButton ? (
    <Box sx={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: variant === 'page' ? 'center' : 'flex-start' }}>
      {action && <ActionButton variant="primary" size="md" action={action} />}
      {secondaryAction && <ActionButton variant="secondary" size="md" action={secondaryAction} />}
      {retryButton}
    </Box>
  ) : null;

  if (variant === 'inline') {
    return (
      <Box
        role="alert"
        className={className}
        data-testid={testId}
        sx={{
          display: 'flex', alignItems: 'flex-start', gap: '12px', p: '12px', borderRadius: `${radius.md}px`,
          border: `1px solid ${tone.danger.border}`, bgcolor: tone.danger.bg,
        }}
      >
        <Box sx={{ color: tone.danger.fg, display: 'inline-flex', mt: '2px' }}>
          <DangerIcon size={16} strokeWidth={1.75} aria-hidden />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ fontSize: 13, lineHeight: '18px', fontWeight: 500, color: tone.danger.fg }}>{title}</Box>
          {cause && <Box sx={{ fontSize: 13, lineHeight: '18px', color: n[700], mt: '2px' }}>{cause}</Box>}
          {(buttons || errorId) && (
            <Box sx={{ display: 'flex', gap: '8px', alignItems: 'center', mt: '8px', flexWrap: 'wrap' }}>
              {buttons}
              {errorId && <CopyErrorId errorId={errorId} />}
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <Box
      role="alert"
      className={className}
      data-testid={testId}
      sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', py: '48px', px: '16px', maxWidth: 480, mx: 'auto' }}
    >
      <Box
        aria-hidden
        sx={{ width: 40, height: 40, borderRadius: `${radius.md}px`, bgcolor: n[100], color: tone.danger.fg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <DangerIcon size={20} strokeWidth={1.75} />
      </Box>
      <Box component="h3" sx={{ m: 0, mt: '12px', fontSize: 14, lineHeight: '20px', fontWeight: 600, color: n[900] }}>{title}</Box>
      {cause && <Box sx={{ mt: '4px', fontSize: 13, lineHeight: '18px', color: n[500] }}>{cause}</Box>}
      {(buttons || errorId) && (
        <Box sx={{ mt: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
          {buttons}
          {errorId && <CopyErrorId errorId={errorId} />}
        </Box>
      )}
    </Box>
  );
}

export default ErrorState;
