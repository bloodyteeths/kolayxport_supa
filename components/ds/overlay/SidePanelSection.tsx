import React from 'react';
import Box from '@mui/material/Box';
import { layout, neutral as n } from '@/lib/ds/tokens';
import { ActionButton, type ActionSpec } from './actions';

export interface SidePanelSectionProps {
  /** Anchor id, used by the SidePanel `sectionNav` chips. */
  id: string;
  title: string;
  description?: string;
  /** Optional right-aligned action link ("Change", "Edit"). */
  action?: ActionSpec;
  children?: React.ReactNode;
  className?: string;
  'data-testid'?: string;
}

/** DS §3.5 panel body section: title 14/600, optional right action, 16px padding (density pass), 1px neutral-100 rule. */
export function SidePanelSection({ id, title, description, action, children, className, ...rest }: SidePanelSectionProps) {
  const headingId = `${id}-title`;
  return (
    <Box
      component="section"
      id={id}
      aria-labelledby={headingId}
      className={className}
      data-testid={rest['data-testid'] ?? `panel-section-${id}`}
      // Phones: 12px between sections (16px stacked up into the founder's "huge white spaces"); 16px from sm up.
      sx={{ px: `${layout.panelPad}px`, py: { xs: '12px', sm: `${layout.panelPad}px` }, scrollMarginTop: '56px', '& + &': { borderTop: `1px solid ${n[100]}` } }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: 24, mb: children ? '8px' : 0 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box id={headingId} component="h3" sx={{ m: 0, fontSize: 14, lineHeight: '20px', fontWeight: 600, color: n[900] }}>
            {title}
          </Box>
          {description && <Box sx={{ mt: '2px', fontSize: 12, lineHeight: '16px', color: n[500] }}>{description}</Box>}
        </Box>
        {/* Touch: the 44px button overlaps the row's padding instead of making every section header 44px tall. */}
        {action && <Box sx={{ '@media (pointer: coarse)': { my: '-10px' } }}><ActionButton action={action} variant="ghost" size="sm" /></Box>}
      </Box>
      {children}
    </Box>
  );
}

export default SidePanelSection;
