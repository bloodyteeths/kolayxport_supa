import { Button, IconButton, Tooltip, type ButtonProps } from '@mui/material';
import PrintRoundedIcon from '@mui/icons-material/PrintRounded';
import type { MouseEvent } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'react-hot-toast';
import { openLabelUrl } from './labelLinks';

interface PrintLabelButtonProps {
  url: string | null | undefined;
  /** Button text. Default labels.printLabel. */
  label?: string;
  /** Download file name (without extension) used when a data: label cannot open in a tab. */
  filename?: string;
  variant?: ButtonProps['variant'];
  color?: ButtonProps['color'];
  size?: ButtonProps['size'];
  fullWidth?: boolean;
  sx?: ButtonProps['sx'];
  /** Compact icon-only variant (44x44 on xs), e.g. for collapsed card headers. */
  iconOnly?: boolean;
}

/**
 * Opens/prints an existing label from a direct click, so popup blockers allow it.
 * Safe inside clickable cards (stops propagation).
 */
export default function PrintLabelButton({
  url,
  label,
  filename = 'label',
  variant = 'outlined',
  color = 'primary',
  size = 'small',
  fullWidth,
  sx,
  iconOnly,
}: PrintLabelButtonProps) {
  const t = useTranslations('labels');
  const text = label || t('printLabel');
  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (!openLabelUrl(url, filename)) toast.error(t('labelOpenFailed'));
  };
  if (iconOnly) {
    return (
      <Tooltip title={text}>
        <span>
          <IconButton
            type="button"
            size="small"
            color={color}
            aria-label={text}
            disabled={!url}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleClick}
            sx={[
              { p: 0.25, minWidth: { xs: 44, md: 28 }, minHeight: { xs: 44, md: 28 } },
              ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
            ]}
          >
            <PrintRoundedIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </span>
      </Tooltip>
    );
  }
  return (
    <Button
      type="button"
      variant={variant}
      color={color}
      size={size}
      fullWidth={fullWidth}
      disabled={!url}
      startIcon={<PrintRoundedIcon sx={{ fontSize: 16 }} />}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={handleClick}
      sx={[
        { textTransform: 'none', minHeight: { xs: 44, md: 32 } },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {text}
    </Button>
  );
}
