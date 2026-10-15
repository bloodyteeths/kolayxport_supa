// components/domain/messages/SavedRepliesPanel.tsx — messages §2.5 (group G3): "Manage saved replies"
// (SidePanel sm 440): search + New reply, the list (row ⋯ → Delete…), and the edit form for the selected
// reply. Footer: ⋯ (Delete saved reply…) · save state · [Save]. Deletes are confirmed (ConfirmDialog).
import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import { useLocale, useTranslations } from 'next-intl';
import { Banner } from '@/components/ds/feedback/Banner';
import { Button } from '@/components/ds/inputs/Button';
import { SearchField } from '@/components/ds/toolbar/SearchField';
import { ConfirmDialog } from '@/components/ds/overlay/ConfirmDialog';
import { OverflowMenu } from '@/components/ds/overlay/OverflowMenu';
import { SidePanel, type SaveState } from '@/components/ds/overlay/SidePanel';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { ListSkeleton } from '@/components/ds/state/Skeletons';
import { icons } from '@/lib/ds/icons';
import { rankByQuery } from '@/lib/ds/fuzzy';
import { accent, neutral, tone } from '@/lib/ds/tokens';
import { useSavedReplies, type UseSavedRepliesResult } from '@/lib/hooks/useSavedReplies';
import type { SavedReply, SavedReplyInput } from '@/lib/messages/savedReplies';
import {
  SavedReplyFields,
  platformName,
  useSavedReplyClientValidation,
  useSavedReplyErrorText,
  type SavedReplyFieldErrors,
} from './SavedReplyFields';

export interface SavedRepliesPanelProps {
  open: boolean;
  onClose: () => void;
  /** Opens with this reply in the edit form. */
  initialId?: string | null;
  /** Share the caller's hook instance; otherwise the panel opens its own (same SWR key). */
  store?: UseSavedRepliesResult;
}

const EMPTY: SavedReplyInput = { title: '', body: '', platform: null };
type Editing = { kind: 'none' } | { kind: 'new' } | { kind: 'existing'; id: string };

function toInput(r: SavedReply): SavedReplyInput {
  return { title: r.title, body: r.body, platform: r.platform };
}

function sameInput(a: SavedReplyInput, b: SavedReplyInput): boolean {
  return a.title === b.title && a.body === b.body && a.platform === b.platform;
}

function PanelBody({ open, onClose, initialId, store }: SavedRepliesPanelProps & { store: UseSavedRepliesResult }) {
  const t = useTranslations('messages.saved');
  const tOverlay = useTranslations('ds.overlay');
  const locale = useLocale();
  const errorText = useSavedReplyErrorText();
  const validate = useSavedReplyClientValidation();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Editing>({ kind: 'none' });
  const [value, setValue] = useState<SavedReplyInput>(EMPTY);
  const [errors, setErrors] = useState<SavedReplyFieldErrors>({});
  const [status, setStatus] = useState<'idle' | 'saving' | 'error' | 'saved'>('idle');
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<Editing | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SavedReply | null>(null);
  const [deleting, setDeleting] = useState(false);

  const current = editing.kind === 'existing' ? store.replies.find((r) => r.id === editing.id) ?? null : null;
  const baseline = current ? toInput(current) : EMPTY;
  const dirty = editing.kind !== 'none' && !sameInput(value, baseline);

  // Set when `begin` targeted a reply that was not loaded yet (`initialId` on first open): the form is
  // filled once it arrives, unless the seller already typed.
  const [awaitingId, setAwaitingId] = useState<string | null>(null);

  const begin = (next: Editing) => {
    setEditing(next);
    const r = next.kind === 'existing' ? store.replies.find((x) => x.id === next.id) : null;
    setAwaitingId(next.kind === 'existing' && !r ? next.id : null);
    setValue(r ? toInput(r) : EMPTY);
    setErrors({});
    setFormError(null);
    setStatus('idle');
  };
  const request = (next: Editing) => {
    if (dirty) setPendingSwitch(next);
    else begin(next);
  };

  // Reset on open; open on `initialId` when it exists.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    begin(initialId ? { kind: 'existing', id: initialId } : { kind: 'none' });
  }, [open, initialId]);

  useEffect(() => {
    if (!awaitingId || !current || current.id !== awaitingId) return;
    setAwaitingId(null);
    if (sameInput(value, EMPTY)) setValue(toInput(current));
  }, [awaitingId, current, value]);

  const saveState: SaveState = status === 'saving' || status === 'error' ? status : dirty ? 'dirty' : status === 'saved' ? 'saved' : 'idle';

  const visible = useMemo(() => {
    const rows = store.replies.map((r) => ({ ...r, label: r.title, hint: r.body }));
    return rankByQuery(rows, query, locale);
  }, [store.replies, query, locale]);

  const save = async () => {
    if (editing.kind === 'none' || status === 'saving') return;
    const local = validate(value);
    if (local) {
      setErrors(local);
      setStatus('error');
      return;
    }
    setStatus('saving');
    setFormError(null);
    const input = { title: value.title.trim(), body: value.body.trim(), platform: value.platform };
    const r = editing.kind === 'new' ? await store.create(input) : await store.update(editing.id, input);
    if (!r.ok) {
      const mapped = errorText(r.error);
      setErrors(mapped.fields);
      setFormError(mapped.form);
      setStatus('error');
      return;
    }
    setEditing({ kind: 'existing', id: r.reply.id });
    setValue(toInput(r.reply));
    setErrors({});
    setStatus('saved');
  };

  const doDelete = async (reply: SavedReply) => {
    setDeleting(true);
    const r = await store.remove(reply.id);
    setDeleting(false);
    setConfirmDelete(null);
    if (!r.ok) {
      setFormError(t('errors.deleteFailed'));
      return;
    }
    if (editing.kind === 'existing' && editing.id === reply.id) begin({ kind: 'none' });
  };

  const editable = store.canEdit;
  const deleteAction = (reply: SavedReply) => ({
    id: 'delete',
    label: t('delete'),
    icon: icons.delete,
    tone: 'danger' as const,
    onClick: () => setConfirmDelete(reply),
    disabled: !editable,
    disabledReason: editable ? undefined : t('notReadyShort'),
  });

  const header = store.mode === 'local' ? (
    <Box sx={{ px: '20px', pt: '12px' }}>
      <Banner tone="info" title={t('notReady')} data-testid="saved-replies-not-ready" />
    </Box>
  ) : undefined;

  let list: React.ReactNode;
  if (store.isLoading) list = <ListSkeleton rows={4} />;
  else if (store.mode === 'error') list = <ErrorState variant="inline" title={t('loadError')} onRetry={store.refresh} />;
  else if (!store.replies.length) {
    list = (
      <EmptyState
        kind="first-use"
        compact
        icon={icons.message}
        title={t('empty')}
        body={t('emptyBody')}
        action={editable ? { id: 'new', label: t('new'), icon: icons.add, onClick: () => request({ kind: 'new' }) } : undefined}
      />
    );
  } else if (!visible.length) {
    list = <EmptyState kind="no-results" compact title={t('noMatches')} />;
  } else {
    list = (
      <Box role="list" sx={{ border: `1px solid ${neutral[200]}`, borderRadius: '8px', overflow: 'hidden' }} data-testid="saved-replies-list">
        {visible.map((r, i) => {
          const selected = editing.kind === 'existing' && editing.id === r.id;
          return (
            <Box
              key={r.id}
              role="listitem"
              sx={{
                display: 'flex', alignItems: 'center', gap: '4px', pr: '4px',
                borderTop: i ? `1px solid ${neutral[200]}` : 0,
                bgcolor: selected ? accent[50] : neutral[0],
              }}
            >
              <ButtonBase
                onClick={() => request({ kind: 'existing', id: r.id })}
                aria-current={selected || undefined}
                data-testid={`saved-reply-row-${r.id}`}
                sx={{ flex: 1, minWidth: 0, justifyContent: 'flex-start', textAlign: 'left', px: '12px', py: '8px', minHeight: 44 }}
              >
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Box sx={{ fontSize: 13, lineHeight: '18px', fontWeight: 500, color: neutral[900], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.title}
                    <Box component="span" sx={{ color: neutral[500], fontWeight: 400 }}>
                      {' · '}
                      {r.platform ? platformName(r.platform) : t('fields.allStores')}
                    </Box>
                  </Box>
                  <Box sx={{ fontSize: 12, lineHeight: '16px', color: neutral[500], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.body}
                  </Box>
                </Box>
              </ButtonBase>
              {editable ? <OverflowMenu items={[deleteAction(r)]} size="sm" itemTestIdPrefix={`saved-reply-menu-${r.id}`} /> : null}
            </Box>
          );
        })}
      </Box>
    );
  }

  const editTitle = editing.kind === 'new' ? t('new') : current ? t('editTitle', { name: current.title }) : null;

  return (
    <>
      <SidePanel
        open={open}
        onClose={onClose}
        size="sm"
        title={t('panelTitle')}
        dirty={dirty}
        headerSlot={header}
        onSave={editing.kind !== 'none' && editable ? () => void save() : undefined}
        primary={editing.kind !== 'none' && editable ? { id: 'save', label: t('save'), onClick: () => void save(), loading: saveState === 'saving' } : undefined}
        saveState={editing.kind === 'none' ? 'idle' : saveState}
        saveNote={saveState === 'saved' ? t('saved') : undefined}
        overflow={current && editable ? [deleteAction(current)] : undefined}
        data-testid="saved-replies-panel"
      >
        <Box sx={{ p: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Box sx={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <SearchField value={query} onChange={setQuery} placeholder={t('search')} shortcut={null} debounceMs={0} fullWidth />
            </Box>
            {editable ? (
              <Button variant="secondary" size="sm" icon={icons.add} onClick={() => request({ kind: 'new' })} data-testid="saved-replies-new">
                {t('new')}
              </Button>
            ) : null}
          </Box>
          {list}
          {editTitle ? (
            <Box component="section" aria-label={editTitle} sx={{ borderTop: `1px solid ${neutral[200]}`, pt: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <Box component="h3" sx={{ m: 0, fontSize: 14, lineHeight: '20px', fontWeight: 600, color: neutral[900] }}>
                {editTitle}
              </Box>
              <SavedReplyFields
                idPrefix="saved-reply-edit"
                value={value}
                onChange={(next) => {
                  setValue(next);
                  if (errors.title || errors.body) setErrors({});
                  if (status === 'error' || status === 'saved') setStatus('idle');
                }}
                errors={errors}
                disabled={!editable || saveState === 'saving'}
                autoFocusTitle={editing.kind === 'new'}
              />
            </Box>
          ) : null}
          {formError ? (
            <Box role="alert" sx={{ fontSize: 12, lineHeight: '16px', color: tone.danger.fg }} data-testid="saved-replies-form-error">
              {formError}
            </Box>
          ) : null}
        </Box>
      </SidePanel>
      <ConfirmDialog
        open={!!pendingSwitch}
        nested
        title={tOverlay('dirtyGuard.title')}
        body={tOverlay('dirtyGuard.body')}
        confirmLabel={tOverlay('dirtyGuard.discard')}
        cancelLabel={tOverlay('dirtyGuard.keep')}
        tone="danger"
        onCancel={() => setPendingSwitch(null)}
        onConfirm={() => {
          const next = pendingSwitch;
          setPendingSwitch(null);
          if (next) begin(next);
        }}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        nested
        title={confirmDelete ? t('deleteTitle', { name: confirmDelete.title }) : ''}
        confirmLabel={tOverlay('confirm.delete')}
        tone="danger"
        onCancel={() => (deleting ? undefined : setConfirmDelete(null))}
        onConfirm={() => {
          if (confirmDelete && !deleting) void doDelete(confirmDelete);
        }}
      />
    </>
  );
}

function PanelOwnStore(props: SavedRepliesPanelProps) {
  const store = useSavedReplies({ enabled: props.open });
  return <PanelBody {...props} store={store} />;
}

export function SavedRepliesPanel(props: SavedRepliesPanelProps) {
  if (props.store) return <PanelBody {...props} store={props.store} />;
  return <PanelOwnStore {...props} />;
}

export default SavedRepliesPanel;
