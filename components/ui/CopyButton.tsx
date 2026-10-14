import React from 'react';
import { Chip, IconButton, Tooltip, type SxProps, type Theme } from '@mui/material';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { useTranslations } from 'next-intl';
import { useCopy } from '@/lib/hooks/useCopy';

export interface CopyButtonProps {
  /** Text to copy, or a function computed at click time (e.g. formatAddressForCopy). */
  value: string | null | undefined | (() => string | null | undefined);
  /** What is being copied, e.g. "Tracking number". Used in aria-label/tooltip and as chip text. */
  label?: string;
  size?: 'small' | 'medium';
  variant?: 'icon' | 'chip';
  /** Override the success toast text. */
  successMessage?: string;
  /** Suppress toasts (only the check-icon feedback). */
  silent?: boolean;
  disabled?: boolean;
  sx?: SxProps<Theme>;
  className?: string;
  /** Called after the copy attempt with the real result. */
  onCopied?: (ok: boolean) => void;
}

/**
 * Copy-to-clipboard button. Works inside clickable rows/cards (stops click,
 * mousedown and key propagation). >= 44px tap target on phones.
 */
export default function CopyButton({
  value,
  label,
  size = 'small',
  variant = 'icon',
  successMessage,
  silent,
  disabled,
  sx,
  className,
  onCopied,
}: CopyButtonProps) {
  const t = useTranslations('ui');
  const { copy, copied } = useCopy({
    successMessage: successMessage ?? (label ? t('copy.copiedLabel', { label }) : undefined),
    silent,
  });

  const resolve = () => (typeof value === 'function' ? value() : value) ?? '';
  const isEmpty = typeof value !== 'function' && !value;
  const isDisabled = disabled || isEmpty;

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (isDisabled) return;
    const ok = await copy(resolve());
    onCopied?.(ok);
  };

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const stopKeys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
  };

  const actionLabel = label ? t('copy.copyLabel', { label }) : t('copy.copy');
  const tooltip = copied ? t('copy.copiedShort') : actionLabel;
  const iconSize = size === 'small' ? 16 : 20;
  const Icon = copied ? CheckRoundedIcon : ContentCopyRoundedIcon;

  if (variant === 'chip') {
    return (
      <Tooltip title={tooltip} arrow>
        <span className={className} style={{ display: 'inline-flex' }} onMouseDown={stop} onTouchStart={stop}>
          <Chip
            component="button"
            type="button"
            clickable
            disabled={isDisabled}
            onClick={handleClick}
            onKeyDown={stopKeys}
            aria-label={actionLabel}
            size={size}
            variant="outlined"
            color={copied ? 'success' : 'default'}
            icon={<Icon sx={{ fontSize: iconSize }} />}
            label={label || t('copy.copy')}
            sx={[
              {
                position: 'relative',
                maxWidth: '100%',
                // Visually compact chip, but a 44px-tall hit area on phones.
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: { xs: size === 'small' ? -10 : -6, md: 0 },
                  bottom: { xs: size === 'small' ? -10 : -6, md: 0 },
                },
              },
              ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
            ]}
          />
        </span>
      </Tooltip>
    );
  }

  return (
    <Tooltip title={tooltip} arrow>
      {/* span keeps the Tooltip working while the button is disabled */}
      <span className={className} style={{ display: 'inline-flex' }} onMouseDown={stop} onTouchStart={stop}>
        <IconButton
          type="button"
          size={size}
          disabled={isDisabled}
          onClick={handleClick}
          onKeyDown={stopKeys}
          aria-label={actionLabel}
          color={copied ? 'success' : 'default'}
          sx={[
            {
              minWidth: { xs: 44, md: size === 'small' ? 30 : 36 },
              minHeight: { xs: 44, md: size === 'small' ? 30 : 36 },
              color: copied ? 'success.main' : 'text.secondary',
            },
            ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
          ]}
        >
          <Icon sx={{ fontSize: iconSize }} />
        </IconButton>
      </span>
    </Tooltip>
  );
}

export { CopyButton };
