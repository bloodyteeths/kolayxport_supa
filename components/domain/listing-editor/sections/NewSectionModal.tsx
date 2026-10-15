// components/domain/listing-editor/sections/NewSectionModal.tsx — listing-editor §6.2/§6.5: "+ New section".
// Modal sm with one field. The parent stages `create_shop_section` (drawer payload, unchanged); nothing is
// created on Etsy until the user sends the listing.
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ds/overlay/Modal';
import { FormField, TextField } from '@/components/ds/inputs';

export interface NewSectionModalProps {
  open: boolean;
  onClose: () => void;
  /** Stages the queued action; reject to keep the modal open (the error line shows). */
  onSubmit: (title: string) => Promise<void>;
  /** Over a SidePanel / sheet. */
  nested?: boolean;
}

export function NewSectionModal({ open, onClose, onSubmit, nested }: NewSectionModalProps) {
  const t = useTranslations('listingEditor');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (open) { setTitle(''); setFailed(false); setBusy(false); }
  }, [open]);

  const submit = async () => {
    const value = title.trim();
    if (!value || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onSubmit(value);
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
      size="sm"
      title={t('sectionForm.title')}
      description={t('createdOnSend')}
      primary={{
        id: 'create-section',
        label: t('sectionForm.create'),
        onClick: submit,
        loading: busy,
        disabled: !title.trim(),
        disabledReason: t('sectionForm.nameRequired'),
      }}
      data-testid="le-new-section-modal"
    >
      <FormField label={t('sectionForm.name')} error={failed ? t('stageFailed') : null}>
        <TextField
          value={title}
          onChange={setTitle}
          autoFocus
          placeholder={t('sectionForm.placeholder')}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
        />
      </FormField>
    </Modal>
  );
}

export default NewSectionModal;
