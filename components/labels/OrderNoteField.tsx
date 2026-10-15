import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, ButtonBase, CircularProgress, TextField, Typography } from '@mui/material';
import StickyNote2OutlinedIcon from '@mui/icons-material/StickyNote2Outlined';
import { useTranslations } from 'next-intl';
import { notify } from '@/lib/notify';

/** Keep in sync with pages/api/orders/[orderId]/updateNoteAndStatus.ts. */
export const ORDER_NOTE_MAX_LENGTH = 1000;
const AUTOSAVE_DELAY_MS = 600;

interface Props {
  orderId: string;
  /** Saved note from the orders API (senkronData.internalNote). */
  note: string | null | undefined;
  /** Show the "Add note" trigger when there is no note yet (e.g. only on expanded cards). */
  showEmpty?: boolean;
  /** Called after the server confirmed a save, with the stored note (null = cleared). */
  onSaved?: (note: string | null) => void;
}

const normalize = (v: string | null | undefined) => (v ?? '').trim();

/**
 * Private per-order note on a labels-page order card. Never sent to a
 * marketplace. Tap to edit inline; saves 600ms after typing stops, on blur,
 * or with the explicit Save button (mobile). Optimistic, reverted on error.
 *
 * Every event is stopped here so typing or clicking never toggles the card.
 */
export default function OrderNoteField({ orderId, note, showEmpty = false, onSaved }: Props) {
  const t = useTranslations('labels');
  const tc = useTranslations('common');

  // `shown` is what the card displays (optimistic); `confirmedRef` is the last
  // value the server accepted, used to revert on error.
  const [shown, setShown] = useState<string>(normalize(note));
  const [draft, setDraft] = useState<string>(normalize(note));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const confirmedRef = useRef<string>(normalize(note));
  const lastSentRef = useRef<string>(normalize(note));
  const seqRef = useRef(0);
  const inFlightRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adopt fresh server data (revalidation) unless the user is mid-edit or a save is pending.
  useEffect(() => {
    if (editing || inFlightRef.current > 0) return;
    const next = normalize(note);
    confirmedRef.current = next;
    lastSentRef.current = next;
    setShown(next);
    setDraft(next);
  }, [note, editing]);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => clearTimer, []);

  // Requests run strictly one after another so the server applies them in the
  // order the user typed them, and responses can never arrive out of order.
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  const send = useCallback(async (value: string, seq: number) => {
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/updateNoteAndStatus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        // Only the note: customStatus is left untouched by the API.
        body: JSON.stringify({ not: value || null }),
      });
      const data = await res.json().catch(() => ({}));
      // Status only (no server text): the toast always shows the localized message,
      // while a 402 is still recognized by notify.error.
      if (!res.ok) throw { status: res.status };
      const stored = normalize(data?.internalNote ?? value);
      confirmedRef.current = stored;
      if (seq === seqRef.current) onSaved?.(stored || null);
    } catch (err) {
      if (seq === seqRef.current) {
        const back = confirmedRef.current;
        lastSentRef.current = back;
        setShown(back);
        setDraft((d) => (normalize(d) === value ? back : d));
        // Network failures (TypeError) map to the localized network message;
        // anything else gets the localized save-failed key.
        notify.error(err instanceof TypeError ? err : { status: (err as any)?.status }, 'labels.orderNote.saveFailed');
      }
    } finally {
      inFlightRef.current -= 1;
      if (seq === seqRef.current) setSaving(false);
    }
  }, [orderId, onSaved]);

  const save = useCallback((raw: string) => {
    const value = normalize(raw).slice(0, ORDER_NOTE_MAX_LENGTH);
    if (value === lastSentRef.current) return;
    lastSentRef.current = value;
    const seq = ++seqRef.current;
    inFlightRef.current += 1;
    setShown(value);
    setSaving(true);
    chainRef.current = chainRef.current.then(() => send(value, seq));
  }, [send]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const next = e.target.value.slice(0, ORDER_NOTE_MAX_LENGTH);
    cancelingRef.current = false;
    setDraft(next);
    clearTimer();
    timerRef.current = setTimeout(() => { timerRef.current = null; save(next); }, AUTOSAVE_DELAY_MS);
  };

  // Note value when editing began: Cancel restores it (autosave may already
  // have stored intermediate typing).
  const editStartRef = useRef<string>('');
  // Set while a press on Cancel is in progress so the TextField blur it may
  // cause (touch browsers) does not commit the typing being cancelled.
  const cancelingRef = useRef(false);

  const commit = () => {
    if (cancelingRef.current) return;
    clearTimer();
    save(draft);
    setEditing(false);
  };

  const cancel = () => {
    cancelingRef.current = false;
    clearTimer();
    const original = editStartRef.current;
    save(original);
    setDraft(original);
    setEditing(false);
  };

  const startEditing = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    editStartRef.current = shown;
    cancelingRef.current = false;
    setDraft(shown);
    setEditing(true);
  };

  // Keep every interaction inside the field from reaching the card header.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const wrapperProps = {
    'data-no-card-toggle': true,
    onClick: stop,
    onMouseDown: stop,
    onTouchStart: stop,
    onKeyDown: stop,
  } as const;

  if (editing) {
    return (
      <Box {...wrapperProps} sx={{ mt: 0.5, width: '100%' }}>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={2}
          maxRows={6}
          size="small"
          value={draft}
          onChange={handleChange}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
          }}
          placeholder={t('orderNote.placeholder')}
          label={t('orderNote.label')}
          helperText={`${t('orderNote.privateHint')} · ${draft.length}/${ORDER_NOTE_MAX_LENGTH}`}
          inputProps={{ maxLength: ORDER_NOTE_MAX_LENGTH }}
          FormHelperTextProps={{ sx: { mx: 0, fontSize: '0.65rem' } }}
          sx={{ '& .MuiInputBase-input': { fontSize: '0.8rem' } }}
        />
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1, mt: 0.5 }}>
          {saving && <CircularProgress size={14} aria-label={t('orderNote.saving')} />}
          <Button
            size="small"
            color="inherit"
            // Prevent the TextField blur (which would commit) before cancel runs.
            onPointerDown={() => { cancelingRef.current = true; }}
            onPointerCancel={() => { cancelingRef.current = false; }}
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={(e) => { e.stopPropagation(); cancel(); }}
            sx={{ minHeight: { xs: 44, md: 30 }, textTransform: 'none' }}
          >
            {tc('cancel')}
          </Button>
          <Button
            size="small"
            variant="contained"
            onPointerDown={() => { cancelingRef.current = false; }}
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={(e) => { e.stopPropagation(); commit(); }}
            sx={{ minHeight: { xs: 44, md: 30 }, textTransform: 'none' }}
          >
            {tc('save')}
          </Button>
        </Box>
      </Box>
    );
  }

  if (!shown) {
    if (!showEmpty) return null;
    return (
      <Box {...wrapperProps} sx={{ mt: 0.25 }}>
        <ButtonBase
          onClick={startEditing}
          aria-label={t('orderNote.add')}
          sx={{
            minHeight: { xs: 44, md: 26 },
            my: { xs: -0.75, md: 0 },
            display: 'inline-flex', alignItems: 'center', gap: 0.5,
            borderRadius: 1, px: 0.5,
            color: 'text.secondary', fontSize: '0.68rem',
            '&:hover': { color: 'primary.main' },
            '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
          }}
        >
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, border: '1px dashed', borderColor: 'divider', borderRadius: '9px', px: 0.75, py: 0.2 }}>
            <StickyNote2OutlinedIcon sx={{ fontSize: 13 }} />
            {t('orderNote.add')}
          </Box>
        </ButtonBase>
      </Box>
    );
  }

  return (
    <Box {...wrapperProps} sx={{ mt: 0.25, minWidth: 0 }}>
      <ButtonBase
        onClick={startEditing}
        aria-label={t('orderNote.edit')}
        title={t('orderNote.privateHint')}
        sx={{
          minHeight: { xs: 44, md: 24 },
          my: { xs: -0.5, md: 0 },
          maxWidth: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'flex-start', textAlign: 'left',
          borderRadius: 1,
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, minWidth: 0, maxWidth: '100%', bgcolor: '#f3e8ff', color: '#5b21b6', borderRadius: 1, px: 0.75, py: 0.25 }}>
          <StickyNote2OutlinedIcon sx={{ fontSize: 13, mt: '2px', flexShrink: 0 }} />
          <Typography
            component="span"
            sx={{
              fontSize: '0.7rem', lineHeight: 1.4, minWidth: 0,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}
          >
            {shown}
          </Typography>
          {saving && <CircularProgress size={10} sx={{ mt: '3px', flexShrink: 0 }} aria-label={t('orderNote.saving')} />}
        </Box>
      </ButtonBase>
    </Box>
  );
}
