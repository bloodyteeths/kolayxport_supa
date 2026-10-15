// components/domain/listing-editor/sections/CreateReturnPolicyModal.tsx — listing-editor §6.5: new return
// policy as a Modal md (3 fields). The parent stages `create_return_policy` with the drawer's payload
// ({ accepts_returns, accepts_exchanges, return_deadline }); Etsy creates it when the listing is sent.
// The return window is a Select of the values Etsy accepts (7–90 days), not a free number.
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ds/overlay/Modal';
import { FormField, Select, Switch } from '@/components/ds/inputs';
import { tone } from '@/lib/ds/tokens';
import { RETURN_DEADLINES } from './etsyShared';

export interface ReturnPolicyPayload {
  accepts_returns: boolean;
  accepts_exchanges: boolean;
  return_deadline?: number;
}

export interface CreateReturnPolicyModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: ReturnPolicyPayload) => Promise<void>;
  nested?: boolean;
}

/** Drawer payload: the deadline is sent only when returns or exchanges are accepted. */
export function returnPolicyPayload(accepts_returns: boolean, accepts_exchanges: boolean, deadline: number | null): ReturnPolicyPayload {
  return {
    accepts_returns,
    accepts_exchanges,
    return_deadline: (accepts_returns || accepts_exchanges) && deadline ? deadline : undefined,
  };
}

export function CreateReturnPolicyModal({ open, onClose, onSubmit, nested }: CreateReturnPolicyModalProps) {
  const t = useTranslations('listingEditor');
  const [returns, setReturns] = useState(true);
  const [exchanges, setExchanges] = useState(true);
  const [deadline, setDeadline] = useState<number>(30);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (open) { setReturns(true); setExchanges(true); setDeadline(30); setBusy(false); setFailed(false); }
  }, [open]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onSubmit(returnPolicyPayload(returns, exchanges, deadline));
      onClose();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      nested={nested}
      size="md"
      title={t('returnForm.title')}
      description={t('createdOnSend')}
      primary={{ id: 'create-return-policy', label: t('returnForm.create'), onClick: submit, loading: busy }}
      data-testid="le-new-return-policy-modal"
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Switch checked={returns} onChange={setReturns} label={t('returnForm.acceptsReturns')} />
        <Switch checked={exchanges} onChange={setExchanges} label={t('returnForm.acceptsExchanges')} />
        {returns || exchanges ? (
          <FormField label={t('returnForm.deadline')} width="short">
            <Select<number>
              value={deadline}
              onChange={setDeadline}
              options={RETURN_DEADLINES.map((d) => ({ value: d, label: t('returnForm.days', { count: d }) }))}
            />
          </FormField>
        ) : null}
        {failed ? (
          <Box role="alert" sx={{ fontSize: 12, lineHeight: '16px', color: tone.danger.fg }}>{t('stageFailed')}</Box>
        ) : null}
      </Box>
    </Modal>
  );
}

export default CreateReturnPolicyModal;
