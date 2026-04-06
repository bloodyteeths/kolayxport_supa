import React, { useState, useCallback } from 'react';
import { Button, Menu, MenuItem, ListItemIcon, ListItemText } from '@mui/material';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import TableChartIcon from '@mui/icons-material/TableChart';
import PrintIcon from '@mui/icons-material/Print';
import { useTranslations } from 'next-intl';
import { exportToCSV, exportToPDF } from './exportUtils';
import { GRADIENTS, glassCard } from './ui';

interface ExportButtonProps {
  /** Data array for CSV export */
  data: Record<string, any>[];
  /** Column definitions for CSV headers; if omitted, keys are derived from data */
  columns?: { key: string; label: string }[];
  /** Filename without extension */
  filename: string;
  /** DOM element id to capture for PDF print */
  elementId?: string;
  /** Override button label (default: translated "Export") */
  label?: string;
  /** Compact size variant */
  size?: 'small' | 'medium';
}

export default function ExportButton({
  data,
  columns,
  filename,
  elementId,
  label,
  size = 'small',
}: ExportButtonProps) {
  const t = useTranslations('etsyResearch');
  const resolvedLabel = label ?? t('exportButton');
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleOpen = useCallback((e: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(e.currentTarget);
  }, []);

  const handleClose = useCallback(() => {
    setAnchorEl(null);
  }, []);

  const handleCSV = useCallback(() => {
    exportToCSV(data, filename, columns);
    handleClose();
  }, [data, filename, columns, handleClose]);

  const handlePDF = useCallback(() => {
    if (elementId) {
      exportToPDF(elementId, filename);
    }
    handleClose();
  }, [elementId, filename, handleClose]);

  const disabled = !data.length;

  return (
    <>
      <Button
        size={size}
        variant="outlined"
        startIcon={<FileDownloadIcon sx={{ fontSize: size === 'small' ? 16 : 18 }} />}
        onClick={handleOpen}
        disabled={disabled}
        sx={{
          textTransform: 'none',
          fontWeight: 600,
          fontSize: size === 'small' ? '0.75rem' : '0.85rem',
          borderRadius: '20px',
          px: size === 'small' ? 1.5 : 2,
          py: size === 'small' ? 0.4 : 0.6,
          borderColor: 'rgba(102,126,234,0.4)',
          color: '#667eea',
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(12px)',
          transition: 'all 0.2s',
          '&:hover': {
            borderColor: '#667eea',
            background: 'rgba(102,126,234,0.08)',
            boxShadow: '0 2px 12px rgba(102,126,234,0.2)',
          },
          '&.Mui-disabled': {
            borderColor: 'rgba(0,0,0,0.12)',
            color: 'rgba(0,0,0,0.26)',
          },
        }}
      >
        {resolvedLabel}
      </Button>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              ...glassCard,
              borderRadius: '12px',
              minWidth: 180,
              mt: 0.5,
              boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
            },
          },
        }}
      >
        <MenuItem onClick={handleCSV} sx={{ borderRadius: '8px', mx: 0.5, fontSize: '0.85rem' }}>
          <ListItemIcon>
            <TableChartIcon sx={{ fontSize: 18, color: '#11998e' }} />
          </ListItemIcon>
          <ListItemText
            primary={t('csvDownload')}
            primaryTypographyProps={{ fontSize: '0.85rem', fontWeight: 500 }}
          />
        </MenuItem>

        {elementId && (
          <MenuItem onClick={handlePDF} sx={{ borderRadius: '8px', mx: 0.5, fontSize: '0.85rem' }}>
            <ListItemIcon>
              <PrintIcon sx={{ fontSize: 18, color: '#764ba2' }} />
            </ListItemIcon>
            <ListItemText
              primary={t('pdfPrint')}
              primaryTypographyProps={{ fontSize: '0.85rem', fontWeight: 500 }}
            />
          </MenuItem>
        )}
      </Menu>
    </>
  );
}
