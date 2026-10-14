import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import { useTranslations } from 'next-intl';

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  /** Preview of affected items; first `maxItems` (default 10) shown + "and N more". */
  items?: string[];
  maxItems?: number;
  /** Default: common.confirm (or common.delete when destructive). */
  confirmLabel?: string;
  /** Default: common.cancel. */
  cancelLabel?: string;
  /** Red confirm button + warning icon. */
  destructive?: boolean;
  /** User must type this exact text (trimmed, case-sensitive) to enable confirm. */
  typeToConfirm?: string;
}

export interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Presentational confirm dialog. Prefer `useConfirm()` (lib/hooks/useConfirm)
 * which renders this through ConfirmProvider and returns a Promise<boolean>.
 */
export default function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  description,
  items,
  maxItems = 10,
  confirmLabel,
  cancelLabel,
  destructive = false,
  typeToConfirm,
}: ConfirmDialogProps) {
  const t = useTranslations('ui');
  const tc = useTranslations('common');
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (open) setTyped('');
  }, [open, typeToConfirm]);

  const needsTyping = !!typeToConfirm;
  const typedOk = !needsTyping || typed.trim() === typeToConfirm!.trim();
  const shown = items ? items.slice(0, maxItems) : [];
  const hidden = items ? Math.max(0, items.length - shown.length) : 0;

  const submit = () => {
    if (typedOk) onConfirm();
  };

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      fullWidth
      maxWidth="xs"
      sx={{
        zIndex: 1600,
        '& .MuiDialog-paper': {
          m: { xs: 2, sm: 4 },
          width: { xs: 'calc(100% - 32px)', sm: '100%' },
          borderRadius: 3,
        },
      }}
      aria-labelledby="confirm-dialog-title"
    >
      <DialogTitle id="confirm-dialog-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
        {destructive && <WarningAmberRoundedIcon color="error" fontSize="small" />}
        <Box component="span" sx={{ fontSize: '1rem', fontWeight: 600 }}>
          {title}
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: 0 }}>
        {description && (
          <Typography variant="body2" color="text.secondary" component="div" sx={{ mb: shown.length || needsTyping ? 1.5 : 0 }}>
            {description}
          </Typography>
        )}

        {shown.length > 0 && (
          <Box
            component="ul"
            sx={{
              m: 0,
              mb: needsTyping ? 1.5 : 0,
              pl: 2.5,
              maxHeight: 220,
              overflowY: 'auto',
              bgcolor: 'grey.50',
              borderRadius: 2,
              py: 1,
              pr: 1,
            }}
          >
            {shown.map((item, i) => (
              <Typography
                key={`${i}-${item}`}
                component="li"
                variant="body2"
                sx={{ wordBreak: 'break-word', py: 0.25 }}
              >
                {item}
              </Typography>
            ))}
            {hidden > 0 && (
              <Typography component="li" variant="body2" color="text.secondary" sx={{ listStyle: 'none', ml: -2.5, pt: 0.5 }}>
                {t('confirm.andMore', { count: hidden })}
              </Typography>
            )}
          </Box>
        )}

        {needsTyping && (
          <>
            <Typography variant="body2" sx={{ mb: 1 }}>
              {t.rich('confirm.typeToConfirm', {
                text: typeToConfirm!,
                b: (chunks) => <strong>{chunks}</strong>,
              })}
            </Typography>
            <TextField
              autoFocus
              fullWidth
              size="small"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={typeToConfirm}
              inputProps={{ 'aria-label': t('confirm.typeToConfirmAria'), autoComplete: 'off', autoCapitalize: 'off', spellCheck: false }}
            />
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1, flexWrap: 'wrap-reverse' }}>
        <Button onClick={onCancel} color="inherit" autoFocus={!needsTyping && !!destructive} sx={{ minHeight: 44, flex: { xs: 1, sm: 'none' } }}>
          {cancelLabel || tc('cancel')}
        </Button>
        <Button
          onClick={submit}
          variant="contained"
          color={destructive ? 'error' : 'primary'}
          disabled={!typedOk}
          // Destructive: focus Cancel so a stray Enter/Space can't confirm a delete.
          autoFocus={!needsTyping && !destructive}
          sx={{ minHeight: 44, flex: { xs: 1, sm: 'none' }, ml: '0 !important' }}
        >
          {confirmLabel || (destructive ? tc('delete') : tc('confirm'))}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export { ConfirmDialog };
