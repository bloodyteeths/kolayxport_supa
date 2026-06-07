/**
 * Compose-and-send dialog for the SP-API Buyer-Seller Messaging templates
 * plus the Solicitations review-request action.
 *
 * SP-API messaging is one-way: no inbox, no replies. This dialog exposes
 * the entire surface area available to the seller — pick a template,
 * type the body, send.
 */
import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Select, MenuItem, FormControl, InputLabel,
  Box, Typography, Chip, Alert, CircularProgress, Divider,
} from '@mui/material';
import { useTranslations } from 'next-intl';
import axios from 'axios';

type MessageType =
  | 'confirmCustomizationDetails'
  | 'confirmDeliveryDetails'
  | 'confirmOrderDetails'
  | 'confirmServiceDetails'
  | 'unexpectedProblem';

interface Props {
  open: boolean;
  onClose: () => void;
  orderId: string;
  marketplaceId?: string;
  defaultType?: MessageType;
}

const TYPES: { value: MessageType; tKey: string }[] = [
  { value: 'unexpectedProblem',          tKey: 'amazonMsgTypeUnexpected' },
  { value: 'confirmDeliveryDetails',     tKey: 'amazonMsgTypeDelivery' },
  { value: 'confirmOrderDetails',        tKey: 'amazonMsgTypeOrder' },
  { value: 'confirmCustomizationDetails',tKey: 'amazonMsgTypeCustomization' },
  { value: 'confirmServiceDetails',      tKey: 'amazonMsgTypeService' },
];

export default function AmazonMessageDialog({ open, onClose, orderId, marketplaceId, defaultType = 'unexpectedProblem' }: Props) {
  const t = useTranslations('labels');
  const [messageType, setMessageType] = useState<MessageType>(defaultType);
  const [text, setText] = useState('');
  const [allowedActions, setAllowedActions] = useState<string[] | null>(null);
  const [isMCF, setIsMCF] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Load allowed actions for this order on open.
  useEffect(() => {
    if (!open || !orderId) return;
    setAllowedActions(null);
    setIsMCF(false);
    setError(null);
    setSuccess(null);
    setText('');
    setLoading(true);
    axios
      .get('/api/integrations/amazon/messages', {
        params: { orderId, ...(marketplaceId ? { marketplaceId } : {}) },
      })
      .then((r) => {
        setAllowedActions(r.data?.allowedActions || []);
        setIsMCF(Boolean(r.data?.mcf));
      })
      .catch((e) => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [open, orderId, marketplaceId]);

  const send = async () => {
    setSending(true);
    setError(null);
    setSuccess(null);
    try {
      await axios.post('/api/integrations/amazon/messages', {
        orderId,
        marketplaceId,
        messageType,
        text,
      });
      setSuccess(t('amazonMsgSent'));
      setText('');
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSending(false);
    }
  };

  const sendReviewRequest = async () => {
    setSending(true);
    setError(null);
    setSuccess(null);
    try {
      await axios.post('/api/integrations/amazon/messages', {
        orderId,
        marketplaceId,
        action: 'productReviewAndSellerFeedback',
      });
      setSuccess(t('amazonMsgReviewRequested'));
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSending(false);
    }
  };

  const isAllowedTemplate = (mt: MessageType) =>
    !allowedActions || allowedActions.length === 0 || allowedActions.includes(mt);
  // The Solicitations API is a separate API from Messaging; its actions are
  // never returned in /messaging/v1/orders/{id}'s allowed actions. So we
  // can't gate the review request on that list — always allow the user to
  // try, and let Amazon return the real verdict.
  const hasSendInvoice = (allowedActions || []).includes('sendInvoice');
  const hasUpdateFeedback = (allowedActions || []).includes('updateFeedback');

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {t('amazonMsgTitle')}
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
          {t('amazonMsgOrder', { id: orderId })}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('amazonMsgOutboundOnly')}
        </Alert>

        {isMCF && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t('amazonMsgMcf')}
          </Alert>
        )}

        {loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <CircularProgress size={16} />
            <Typography variant="body2">{t('amazonMsgCheckingActions')}</Typography>
          </Box>
        )}

        {allowedActions && allowedActions.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary">{t('amazonMsgAllowedActions')}</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
              {allowedActions.map((a) => <Chip key={a} size="small" label={a} />)}
            </Box>
          </Box>
        )}

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
          <InputLabel>{t('amazonMsgType')}</InputLabel>
          <Select
            value={messageType}
            label={t('amazonMsgType')}
            onChange={(e) => setMessageType(e.target.value as MessageType)}
          >
            {TYPES.map((t2) => (
              <MenuItem key={t2.value} value={t2.value} disabled={!isAllowedTemplate(t2.value)}>
                {t(t2.tKey as any)} {!isAllowedTemplate(t2.value) && '(not allowed for this order)'}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          label={t('amazonMsgBody')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          multiline
          minRows={5}
          fullWidth
          inputProps={{ maxLength: 4000 }}
          helperText={`${text.length} / 4000`}
        />

        <Divider sx={{ my: 2 }} />

        <Box>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t('amazonMsgSolicitations')}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            {t('amazonMsgSolicitationsHelp')}
          </Typography>
          <Button
            size="small"
            variant="outlined"
            disabled={sending || isMCF}
            onClick={sendReviewRequest}
          >
            {t('amazonMsgRequestReview')}
          </Button>
        </Box>

        {(hasSendInvoice || hasUpdateFeedback) && (
          <>
            <Divider sx={{ my: 2 }} />
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t('amazonMsgOtherActions')}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                {t('amazonMsgOtherActionsHelp')}
              </Typography>
              {hasSendInvoice && (
                <Button
                  size="small"
                  variant="outlined"
                  sx={{ mr: 1, mb: 1 }}
                  href={`https://sellercentral.amazon.com/orders-v3/order/${orderId}/messaging-center`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('amazonMsgSendInvoice')}
                </Button>
              )}
              {hasUpdateFeedback && (
                <Button
                  size="small"
                  variant="outlined"
                  sx={{ mr: 1, mb: 1 }}
                  href={`https://sellercentral.amazon.com/feedback-manager/index.html`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('amazonMsgRespondFeedback')}
                </Button>
              )}
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={sending}>{t('cancel')}</Button>
        <Button
          variant="contained"
          onClick={send}
          disabled={sending || isMCF || !text.trim() || !isAllowedTemplate(messageType)}
        >
          {sending ? <CircularProgress size={18} sx={{ color: 'inherit' }} /> : t('amazonMsgSend')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
