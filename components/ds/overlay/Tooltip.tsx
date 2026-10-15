import React from 'react';
import MuiTooltip, { type TooltipProps as MuiTooltipProps } from '@mui/material/Tooltip';
import Box from '@mui/material/Box';
import { neutral as n, radius, zIndex } from '@/lib/ds/tokens';

export interface TooltipProps {
  /** Already-translated text. */
  title: string;
  /** Shown after the title in a kbd chip, e.g. "J" or "⌘K". */
  shortcut?: string;
  placement?: MuiTooltipProps['placement'];
  /** Hover delay in ms (theme default 400). */
  enterDelay?: number;
  children: React.ReactElement;
  className?: string;
  'data-testid'?: string;
}

/** DS tooltip: neutral-900, 12px, z 1800, 400ms hover delay (theme default). */
export function Tooltip({ title, shortcut, placement = 'top', enterDelay, children, className, ...rest }: TooltipProps) {
  if (!title) return children;
  const content = shortcut ? (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }} className={className} data-testid={rest['data-testid']}>
      <span>{title}</span>
      <Box
        component="kbd"
        sx={{
          fontFamily: 'inherit', fontSize: 11, lineHeight: '14px', px: '4px', borderRadius: `${radius.xs}px`,
          border: `1px solid ${n[600]}`, color: n[200],
        }}
      >
        {shortcut}
      </Box>
    </Box>
  ) : (
    title
  );
  return (
    <MuiTooltip title={content} placement={placement} enterDelay={enterDelay} slotProps={{ popper: { sx: { zIndex: zIndex.tooltip } } }}>
      {children}
    </MuiTooltip>
  );
}

export default Tooltip;
