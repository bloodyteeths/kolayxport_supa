import React, { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useTranslations } from 'next-intl';

interface ErrorDetailsDialogProps {
  open: boolean;
  errors: any;
  onClose: () => void;
}

/** Themed dialog for sync error JSON. Replaces alert(JSON.stringify(...)). */
export default function ErrorDetailsDialog({ open, errors, onClose }: ErrorDetailsDialogProps) {
  const t = useTranslations('settings');
  const [copied, setCopied] = useState(false);
  const text = errors != null ? JSON.stringify(errors, null, 2) : '';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 700 }}>
        {t('errorDialog.title')}
        <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Box
          component="pre"
          sx={{ m: 0, p: 2, bgcolor: 'grey.50', borderRadius: 1, fontSize: '0.78rem', lineHeight: 1.5, overflow: 'auto', maxHeight: '60vh', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
        >
          {text}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={handleCopy} startIcon={<ContentCopyIcon fontSize="small" />} sx={{ textTransform: 'none' }}>
          {copied ? t('errorDialog.copied') : t('errorDialog.copy')}
        </Button>
        <Button variant="contained" onClick={onClose} sx={{ textTransform: 'none' }}>
          {t('errorDialog.close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
