// DS §4.2 Section: a titled content block. `card` = flat white surface with a 1px neutral-200 border
// (P2: no shadow on non-floating surfaces); `plain` = heading + content only.
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { neutral, radius, sectionGapSx } from '@/lib/ds/tokens';
import { ActionButton } from './ActionButton';
import type { ActionSpec, DsBaseProps } from './types';

export type SectionProps = DsBaseProps & {
  id?: string;
  title?: string;
  description?: React.ReactNode;
  /** One ghost action at the right of the heading (e.g. "View all"). */
  action?: ActionSpec;
  /** Free slot right of the heading when an ActionSpec is not enough (e.g. a FilterButton). */
  headerSlot?: React.ReactNode;
  variant?: 'plain' | 'card';
  /** Heading element; default h2. */
  headingLevel?: 2 | 3;
  /** Card body without inner padding (e.g. a DataTable that brings its own border). */
  flush?: boolean;
  sx?: SxProps<Theme>;
  children: React.ReactNode;
};

export function Section({
  id,
  title,
  description,
  action,
  headerSlot,
  variant = 'plain',
  headingLevel = 2,
  flush = false,
  sx,
  className,
  children,
  ...rest
}: SectionProps) {
  const card = variant === 'card';
  const headingId = id && title ? `${id}-title` : undefined;
  const hasHeader = Boolean(title || description || action || headerSlot);
  const pad = card && !flush ? '16px' : 0;

  return (
    <Box
      component="section"
      id={id}
      aria-labelledby={headingId}
      className={className}
      data-testid={rest['data-testid'] ?? 'ds-section'}
      data-variant={variant}
      sx={[
        {
          // density: 16 below md, 24 from md (USABILITY_FINDINGS).
          mb: sectionGapSx,
          minWidth: 0,
          ...(card ? { bgcolor: neutral[0], border: `1px solid ${neutral[200]}`, borderRadius: `${radius.md}px`, overflow: 'hidden' } : {}),
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {hasHeader ? (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            px: card ? '16px' : 0,
            pt: card ? '12px' : 0,
            pb: card ? (flush ? '12px' : 0) : '8px',
            ...(card && flush ? { borderBottom: `1px solid ${neutral[200]}` } : {}),
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {title ? (
              <Typography id={headingId} variant="titleSm" component={headingLevel === 3 ? 'h3' : 'h2'} sx={{ m: 0 }}>
                {title}
              </Typography>
            ) : null}
            {description ? (
              <Typography variant="caption" component="div" sx={{ mt: '2px' }}>
                {description}
              </Typography>
            ) : null}
          </Box>
          {headerSlot}
          {action ? <ActionButton action={action} variant="ghost" size="sm" /> : null}
        </Box>
      ) : null}
      <Box sx={{ p: pad, pt: card && hasHeader && !flush ? '12px' : pad }}>{children}</Box>
    </Box>
  );
}
