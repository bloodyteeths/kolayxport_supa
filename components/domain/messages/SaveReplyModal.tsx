// components/domain/messages/SaveReplyModal.tsx — messages §2.5 (group G3): "Save as saved reply" quick
// save (Modal sm, 3 fields — DS §3.6). Opened from the picker's "Save current text as a saved reply".
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ds/overlay/Modal';
import { tone } from '@/lib/ds/tokens';
import { useSavedReplies, type UseSavedRepliesResult } from '@/lib/hooks/useSavedReplies';
import type { SavedReply, SavedReplyInput, SavedReplyPlatform } from '@/lib/messages/savedReplies';
import {
  SavedReplyFields,
  useSavedReplyClientValidation,
  useSavedReplyErrorText,
  type SavedReplyFieldErrors,
} from './SavedReplyFields';

export interface SaveReplyModalProps {
  open: boolean;
  onClose: () => void;
  /** The composer text (stored literally, `{tokens}` included). */
  initialBody?: string;
  /** Preselects "Use for"; default All stores. */
  initialPlatform?: SavedReplyPlatform | null;
  onSaved?: (reply: SavedReply) => void;
  /** Rendered above another dialog (z nestedModal). */
  nested?: boolean;
  /** Share the caller's hook instance (picker); otherwise the modal opens its own (same SWR key). */
  store?: UseSavedRepliesResult;
}

function SaveReplyModalBody({ store, ...props }: SaveReplyModalProps & { store: UseSavedRepliesResult }) {
  const { open, onClose, initialBody = '', initialPlatform = null, onSaved, nested } = props;
  const t = useTranslations('messages.saved');
  const errorText = useSavedReplyErrorText();
  const validate = useSavedReplyClientValidation();
  const [value, setValue] = useState<SavedReplyInput>({ title: '', body: initialBody, platform: initialPlatform });
  const [errors, setErrors] = useState<SavedReplyFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValue({ title: '', body: initialBody, platform: initialPlatform });
    setErrors({});
    setFormError(null);
    setSaving(false);
  }, [open, initialBody, initialPlatform]);

  const save = async () => {
    if (saving) return;
    const local = validate(value);
    if (local) {
      setErrors(local);
      return;
    }
    setSaving(true);
    setFormError(null);
    const r = await store.create({ title: value.title.trim(), body: value.body.trim(), platform: value.platform });
    setSaving(false);
    if (!r.ok) {
      const mapped = errorText(r.error);
      setErrors(mapped.fields);
      setFormError(mapped.form);
      return;
    }
    onSaved?.(r.reply);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('modalTitle')}
      size="sm"
      nested={nested}
      primary={{
        id: 'save',
        label: t('save'),
        onClick: () => void save(),
        loading: saving,
        disabled: store.mode === 'local',
        disabledReason: store.mode === 'local' ? t('notReadyShort') : undefined,
      }}
      data-testid="save-reply-modal"
    >
      <SavedReplyFields
        idPrefix="save-reply"
        value={value}
        onChange={(next) => {
          setValue(next);
          if (errors.title || errors.body) setErrors({});
        }}
        errors={errors}
        disabled={saving}
        autoFocusTitle
      />
      {formError ? (
        <Box role="alert" sx={{ mt: '12px', fontSize: 12, lineHeight: '16px', color: tone.danger.fg }} data-testid="save-reply-form-error">
          {formError}
        </Box>
      ) : null}
    </Modal>
  );
}

function SaveReplyModalOwnStore(props: SaveReplyModalProps) {
  const store = useSavedReplies({ enabled: props.open });
  return <SaveReplyModalBody {...props} store={store} />;
}

export function SaveReplyModal(props: SaveReplyModalProps) {
  if (props.store) return <SaveReplyModalBody {...props} store={props.store} />;
  return <SaveReplyModalOwnStore {...props} />;
}

export default SaveReplyModal;
