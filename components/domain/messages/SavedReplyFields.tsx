// components/domain/messages/SavedReplyFields.tsx — messages §2.5 (group G3): the three saved-reply fields
// (Name · Use for · Text with "Insert:" variable chips), shared by SaveReplyModal and SavedRepliesPanel.
import { useRef } from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ds/inputs/Button';
import { FormField } from '@/components/ds/inputs/FormField';
import { Select, type SelectOption } from '@/components/ds/inputs/Select';
import { TextArea } from '@/components/ds/inputs/TextArea';
import { TextField } from '@/components/ds/inputs/TextField';
import { neutral } from '@/lib/ds/tokens';
import { getLogo } from '@/lib/ds/logos';
import { SAVED_REPLY_VARIABLES, insertAtCaret, tokenOf, type SavedReplyVariable } from '@/lib/messages/fillVariables';
import {
  SAVED_REPLY_BODY_MAX,
  SAVED_REPLY_TITLE_MAX,
  type SavedReplyErrorBody,
  type SavedReplyInput,
  type SavedReplyPlatform,
} from '@/lib/messages/savedReplies';

export interface SavedReplyFieldErrors {
  title?: string | null;
  body?: string | null;
}

type PlatformValue = 'all' | SavedReplyPlatform;

export function platformName(p: SavedReplyPlatform): string {
  return getLogo(p).name;
}

/** Maps an API / hook error onto field errors or a form-level message (already translated). */
export function useSavedReplyErrorText() {
  const t = useTranslations('messages.saved');
  return (err: SavedReplyErrorBody): { fields: SavedReplyFieldErrors; form: string | null } => {
    if (err.code === 'duplicate') return { fields: { title: t('errors.duplicate') }, form: null };
    if (err.code === 'limit') return { fields: {}, form: t('errors.limit', { max: err.max ?? 50 }) };
    if (err.code === 'notReady') return { fields: {}, form: t('notReadyShort') };
    if (err.code === 'invalid' && err.field === 'title') {
      return { fields: { title: err.reason === 'tooLong' ? t('errors.titleTooLong', { max: err.max ?? SAVED_REPLY_TITLE_MAX }) : t('errors.titleRequired') }, form: null };
    }
    if (err.code === 'invalid' && err.field === 'body') {
      return { fields: { body: err.reason === 'tooLong' ? t('errors.tooLong', { max: err.max ?? SAVED_REPLY_BODY_MAX }) : t('errors.bodyRequired') }, form: null };
    }
    return { fields: {}, form: t('errors.generic') };
  };
}

/** Client-side check before a request (same limits as the server). */
export function useSavedReplyClientValidation() {
  const t = useTranslations('messages.saved');
  return (v: SavedReplyInput): SavedReplyFieldErrors | null => {
    const errors: SavedReplyFieldErrors = {};
    const title = v.title.trim();
    const body = v.body.trim();
    if (!title) errors.title = t('errors.titleRequired');
    else if (title.length > SAVED_REPLY_TITLE_MAX) errors.title = t('errors.titleTooLong', { max: SAVED_REPLY_TITLE_MAX });
    if (!body) errors.body = t('errors.bodyRequired');
    else if (body.length > SAVED_REPLY_BODY_MAX) errors.body = t('errors.tooLong', { max: SAVED_REPLY_BODY_MAX });
    return errors.title || errors.body ? errors : null;
  };
}

export interface SavedReplyFieldsProps {
  value: SavedReplyInput;
  onChange: (next: SavedReplyInput) => void;
  errors?: SavedReplyFieldErrors;
  disabled?: boolean;
  autoFocusTitle?: boolean;
  /** Prefix for field ids and test ids (two forms can be on screen: panel + modal). */
  idPrefix: string;
}

export function SavedReplyFields({ value, onChange, errors, disabled, autoFocusTitle, idPrefix }: SavedReplyFieldsProps) {
  const t = useTranslations('messages.saved');
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const caretRef = useRef<{ start: number; end: number } | null>(null);

  const platformOptions: SelectOption<PlatformValue>[] = [
    { value: 'all', label: t('fields.allStores') },
    { value: 'wix', label: platformName('wix') },
    { value: 'trendyol', label: platformName('trendyol') },
  ];

  const rememberCaret = () => {
    const el = bodyRef.current;
    if (el) caretRef.current = { start: el.selectionStart, end: el.selectionEnd };
  };

  const insertToken = (v: SavedReplyVariable) => {
    const el = bodyRef.current;
    const sel = el && document.activeElement === el ? { start: el.selectionStart, end: el.selectionEnd } : caretRef.current;
    const { text, caret } = insertAtCaret(value.body, tokenOf(v), sel?.start ?? value.body.length, sel?.end ?? value.body.length, {
      newLineWhenAppending: false,
    });
    onChange({ ...value, body: text });
    caretRef.current = { start: caret, end: caret };
    // Put the caret after the token once React has written the new value.
    requestAnimationFrame(() => {
      const node = bodyRef.current;
      if (!node) return;
      node.focus();
      try {
        node.setSelectionRange(caret, caret);
      } catch {
        /* detached node */
      }
    });
  };

  const varLabel: Record<SavedReplyVariable, string> = {
    customer: t('var.customer'),
    product: t('var.product'),
    order: t('var.order'),
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <FormField label={t('fields.title')} htmlFor={`${idPrefix}-title`} error={errors?.title ?? null} counter={value.title.length > SAVED_REPLY_TITLE_MAX - 10 ? { value: value.title.length, max: SAVED_REPLY_TITLE_MAX } : undefined}>
        <TextField
          id={`${idPrefix}-title`}
          value={value.title}
          onChange={(title) => onChange({ ...value, title })}
          disabled={disabled}
          autoFocus={autoFocusTitle}
          fullWidth
          data-testid={`${idPrefix}-title`}
        />
      </FormField>
      <FormField label={t('fields.platform')} htmlFor={`${idPrefix}-platform`} width="medium">
        <Select<PlatformValue>
          id={`${idPrefix}-platform`}
          value={value.platform ?? 'all'}
          onChange={(p) => onChange({ ...value, platform: p === 'all' ? null : p })}
          options={platformOptions}
          disabled={disabled}
          fullWidth
          data-testid={`${idPrefix}-platform`}
        />
      </FormField>
      <FormField
        label={t('fields.body')}
        htmlFor={`${idPrefix}-body`}
        error={errors?.body ?? null}
        counter={{ value: value.body.length, max: SAVED_REPLY_BODY_MAX }}
      >
        <TextArea
          id={`${idPrefix}-body`}
          value={value.body}
          onChange={(body) => onChange({ ...value, body })}
          onBlur={rememberCaret}
          inputRef={bodyRef}
          minRows={4}
          maxRows={12}
          disabled={disabled}
          data-testid={`${idPrefix}-body`}
        />
      </FormField>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }} role="group" aria-label={t('insert')}>
        <Box component="span" sx={{ fontSize: 12, lineHeight: '16px', color: neutral[500], mr: '4px' }}>
          {t('insert')}
        </Box>
        {SAVED_REPLY_VARIABLES.map((v) => (
          <Button
            key={v}
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => insertToken(v)}
            data-testid={`${idPrefix}-var-${v}`}
          >
            {varLabel[v]}
          </Button>
        ))}
      </Box>
    </Box>
  );
}
