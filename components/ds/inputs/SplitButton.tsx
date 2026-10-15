// components/ds/inputs/SplitButton.tsx — DS §3.8: a primary with variants ("Print ▾": label / packing slip / both,
// "Publish on Etsy ▾"). Carrier choice is a RateList, never a split button.
import { useId, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import MuiButton from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { neutral, accent, tone, radius } from '@/lib/ds/tokens';
import { IconDisclose, ICON_STROKE } from './_icons';
import { muiVariantProps, buttonSizeSx, variantColorSx } from './Button';
import type { ActionSpec, ControlSize, DsBaseProps } from './types';

export interface SplitButtonProps extends DsBaseProps {
  primary: ActionSpec;
  options: ActionSpec[];
  variant?: 'primary' | 'secondary';
  size?: ControlSize;
  /** Accessible label of the ▾ half. Defaults to "More options for {primary.label}". */
  menuLabel?: string;
}

const MUI_SIZE = { sm: 'small', md: 'medium', lg: 'large', xl: 'large' } as const;

export function SplitButton({ primary, options, variant = 'primary', size = 'md', menuLabel, className, 'data-testid': testId }: SplitButtonProps) {
  const t = useTranslations('ds.inputs');
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement | null>(null);
  const menuId = `split-${useId().replace(/:/g, '')}`;
  const Icon = primary.icon;
  const base = { ...muiVariantProps(variant), size: MUI_SIZE[size] };
  const sizeSx = buttonSizeSx(size);
  const colorSx = variantColorSx(variant);
  const divider = variant === 'primary' ? `1px solid ${accent[700]}` : `1px solid ${neutral[300]}`;

  const main = (
    <MuiButton
      {...base}
      {...(primary.href && !primary.disabled ? { component: NextLink, href: primary.href } : {})}
      onClick={primary.onClick}
      disabled={primary.disabled || primary.loading}
      aria-busy={primary.loading || undefined}
      startIcon={primary.loading
        ? <CircularProgress size={14} thickness={5} sx={{ color: variant === 'primary' ? neutral[0] : neutral[500] }} aria-hidden />
        : Icon ? <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden /> : undefined}
      sx={{ ...sizeSx, ...colorSx, borderTopRightRadius: 0, borderBottomRightRadius: 0, whiteSpace: 'nowrap', ...(variant === 'secondary' ? { borderRight: 'none' } : null) }}
    >
      {primary.loading ? primary.loadingLabel ?? primary.label : primary.label}
    </MuiButton>
  );

  return (
    <Box ref={anchor} className={className} data-testid={testId} sx={{ display: 'inline-flex', borderRadius: `${radius.sm}px` }}>
      {primary.disabled && primary.disabledReason ? (
        <Tooltip title={primary.disabledReason}><span style={{ display: 'inline-flex' }}>{main}</span></Tooltip>
      ) : main}
      <MuiButton
        {...base}
        aria-label={menuLabel ?? t('splitButton.more', { label: primary.label })}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={options.length === 0}
        onClick={() => setOpen((v) => !v)}
        sx={{
          ...sizeSx, ...colorSx, minWidth: 0, px: '8px', borderTopLeftRadius: 0, borderBottomLeftRadius: 0,
          borderLeft: divider, '&:hover': { ...(colorSx as Record<string, unknown>)['&:hover'] as object, borderLeft: divider },
        }}
      >
        <IconDisclose size={16} strokeWidth={ICON_STROKE} aria-hidden />
      </MuiButton>
      <Menu
        id={menuId}
        open={open}
        anchorEl={anchor.current}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { mt: '4px', minWidth: 200 } } }}
      >
        {options.map((o) => {
          const OIcon = o.icon;
          return (
            <MenuItem
              key={o.id}
              disabled={o.disabled}
              {...(o.href && !o.disabled ? { component: NextLink, href: o.href } : {})}
              onClick={() => { setOpen(false); o.onClick?.(); }}
              sx={{ gap: '8px', fontSize: 13, color: o.tone === 'danger' ? tone.danger.fg : neutral[800], flexWrap: 'wrap' }}
            >
              {OIcon ? <OIcon size={16} strokeWidth={ICON_STROKE} aria-hidden /> : null}
              <span>{o.label}</span>
              {o.disabled && o.disabledReason ? (
                <Box component="span" sx={{ width: '100%', fontSize: 12, color: neutral[500] }}>{o.disabledReason}</Box>
              ) : null}
            </MenuItem>
          );
        })}
      </Menu>
    </Box>
  );
}

export default SplitButton;
