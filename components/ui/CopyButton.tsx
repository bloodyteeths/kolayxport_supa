import React from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTranslations } from 'next-intl';
import { useCopy } from '@/lib/hooks/useCopy';
import { icons } from '@/lib/ds/icons';
import { IconButton as DsIconButton } from '@/components/ds/inputs/IconButton';
import { Button as DsButton } from '@/components/ds/inputs/Button';

/**
 * M1-f shim (DESIGN_SYSTEM §4.4: `ds/format/CopyText` absorbs `ui/CopyButton`; deleted in M10).
 *
 * `CopyText` renders the value itself, while every legacy call site already renders the value next to this
 * button, so routing through `CopyText` would print it twice. The shim keeps the legacy API and renders DS
 * controls:
 * - `icon` (default): DS `IconButton` ghost (`small` → sm 32, `medium` → md 40; 44 on touch), registry icon
 *   `copy` → `check` while copied; aria-label + tooltip "Copy {label}" / "Copied".
 * - `chip`: DS `Button` secondary sm with the `copy`/`check` icon and the label text.
 * Works inside clickable rows/cards: click, mousedown, touchstart and Enter/Space never reach the row.
 */

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
  /** Applied to the wrapper span. */
  sx?: SxProps<Theme>;
  className?: string;
  'data-testid'?: string;
  /** Called after the copy attempt with the real result. */
  onCopied?: (ok: boolean) => void;
}

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
  'data-testid': testId,
  onCopied,
}: CopyButtonProps) {
  const t = useTranslations('ui');
  const { copy, copied } = useCopy({
    successMessage: successMessage ?? (label ? t('copy.copiedLabel', { label }) : undefined),
    silent,
  });

  const resolve = () => (typeof value === 'function' ? value() : value) ?? '';
  const isEmpty = typeof value !== 'function' && !value;
  const isDisabled = !!disabled || isEmpty;

  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
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
  const Icon = copied ? icons.check : icons.copy;

  return (
    <Box
      component="span"
      className={className}
      data-copied={copied ? 'true' : undefined}
      sx={[{ display: 'inline-flex', maxWidth: '100%' }, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}
      onMouseDown={stop}
      onTouchStart={stop}
      onClick={stop}
      onKeyDown={stopKeys}
    >
      {variant === 'chip' ? (
        <DsButton
          variant="secondary"
          size="sm"
          icon={Icon}
          disabled={isDisabled}
          onClick={handleClick}
          aria-label={actionLabel}
          data-testid={testId}
        >
          {label || t('copy.copy')}
        </DsButton>
      ) : (
        <DsIconButton
          icon={Icon}
          label={copied ? t('copy.copiedShort') : actionLabel}
          size={size === 'small' ? 'sm' : 'md'}
          disabled={isDisabled}
          onClick={handleClick}
          data-testid={testId}
        />
      )}
    </Box>
  );
}

export { CopyButton };
