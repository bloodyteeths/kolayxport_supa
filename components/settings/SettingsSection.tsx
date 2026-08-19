import React from 'react';
import { Paper, Box, Typography, Accordion, AccordionSummary, AccordionDetails } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

interface SettingsSectionProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}

/**
 * Consistent settings card: theme border (no elevation), uniform padding/spacing.
 * Replaces the old `Paper elevation={3}` + `#ddd` header blocks.
 */
export default function SettingsSection({
  title, description, action, collapsible, defaultExpanded = true, children,
}: SettingsSectionProps) {
  if (collapsible) {
    return (
      <Accordion
        defaultExpanded={defaultExpanded}
        disableGutters
        elevation={0}
        sx={{ mb: 3, border: '1px solid', borderColor: 'divider', borderRadius: 2, '&:before': { display: 'none' }, overflow: 'hidden' }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: { xs: 2, sm: 3 } }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>{title}</Typography>
            {description && <Typography variant="body2" color="text.secondary">{description}</Typography>}
          </Box>
        </AccordionSummary>
        <AccordionDetails sx={{ px: { xs: 2, sm: 3 }, pb: { xs: 2, sm: 3 } }}>{children}</AccordionDetails>
      </Accordion>
    );
  }

  return (
    <Paper
      elevation={0}
      sx={{ p: { xs: 2, sm: 3 }, mb: 3, border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden', maxWidth: '100%' }}
    >
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, gap: 1, mb: description ? 0.5 : 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</Typography>
        {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
      </Box>
      {description && <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{description}</Typography>}
      {children}
    </Paper>
  );
}
