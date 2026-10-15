/**
 * OrderPanel › Private note (orders §2.4, §5): a TextArea that autosaves 600 ms after typing stops, on blur
 * and on ⌘S (the panel's onSave). "Saving…" / "Saved" / "Couldn't save the note · Retry". 1000 characters.
 * Never sent to a marketplace. The save logic lives in `useOrderNote` (owned by OrderPanel so ⌘S can flush it).
 */
import React from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslations } from 'next-intl';
import { SidePanelSection } from '@/components/ds/overlay/SidePanelSection';
import { CharCount } from '@/components/ds/inputs/FormField';
import { TextArea } from '@/components/ds/inputs/TextArea';
import { Button } from '@/components/ds/inputs/Button';
import { neutral as n, tone } from '@/lib/ds/tokens';
import type { UseOrderNoteResult } from './useOrderNote';

export interface NoteSectionProps {
  note: UseOrderNoteResult;
}

export function NoteSection({ note }: NoteSectionProps) {
  const t = useTranslations('orders.panel');
  const { value, setValue, flush, state, max } = note;

  const status =
    state === 'saving' ? (
      <Typography variant="caption" component="span" sx={{ color: n[500] }}>{t('noteSaving')}</Typography>
    ) : state === 'saved' ? (
      <Typography variant="caption" component="span" sx={{ color: tone.success.fg }}>{t('noteSaved')}</Typography>
    ) : state === 'error' ? (
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        <Typography variant="caption" component="span" role="alert" sx={{ color: tone.danger.fg }}>{t('noteSaveFailed')}</Typography>
        <Button variant="ghost" size="sm" onClick={flush} data-testid="note-retry">{t('retry')}</Button>
      </Box>
    ) : null;

  return (
    <SidePanelSection id="order-note" title={t('note')}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: 24, mt: '-8px', mb: '6px' }}>
        <Box aria-live="polite" data-testid="note-state" data-state={state} sx={{ flex: 1, minWidth: 0 }}>{status}</Box>
        <CharCount id="order-note-count" value={value.length} max={max} />
      </Box>
      <TextArea
        id="order-note-text"
        aria-label={t('note')}
        value={value}
        onChange={(v) => setValue(v)}
        onBlur={flush}
        placeholder={t('notePlaceholder')}
        minRows={2}
        maxRows={8}
        maxLength={max}
        data-testid="order-note"
      />
      <Typography variant="caption" component="p" sx={{ m: 0, mt: '6px', color: n[500] }}>{t('noteHint')}</Typography>
    </SidePanelSection>
  );
}

export default NoteSection;
