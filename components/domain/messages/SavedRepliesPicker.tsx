// components/domain/messages/SavedRepliesPicker.tsx — messages §2.4 (group G3). Ghost "Saved replies ▾"
// button in the composer; opens a searchable popover (z 1600). Choosing a reply fills `{customer}`,
// `{product}`, `{order}` from `context` and hands the text to `onInsert` (the composer inserts it at the
// caret, or appends it on a new line). Footer: "Save current text as a saved reply" (only with text) and
// "Manage saved replies". Inserting never sends anything.
//
// Contract published for G6 (messages §8): `{ platform; context: FillContext; onInsert(text); currentText }`.
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import MenuList from '@mui/material/MenuList';
import Popover from '@mui/material/Popover';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ds/inputs/Button';
import { SearchField } from '@/components/ds/toolbar/SearchField';
import { useToast } from '@/components/ds/feedback/toast';
import { icons } from '@/lib/ds/icons';
import { rankByQuery } from '@/lib/ds/fuzzy';
import { neutral, zIndex } from '@/lib/ds/tokens';
import { useSavedReplies } from '@/lib/hooks/useSavedReplies';
import { fillVariables, type FillContext, type FillResult } from '@/lib/messages/fillVariables';
import { repliesForPlatform, type SavedReply, type SavedReplyPlatform } from '@/lib/messages/savedReplies';
import { platformName } from './SavedReplyFields';
import { SaveReplyModal } from './SaveReplyModal';
import { SavedRepliesPanel } from './SavedRepliesPanel';

export interface SavedRepliesPickerProps {
  /** Platform of the open thread: lists "All stores" replies plus this store's own. */
  platform: SavedReplyPlatform;
  context: FillContext;
  /** Receives the filled text; unfilled variables stay as `{token}` (see `result.unfilled`). */
  onInsert: (text: string, result: FillResult, reply: SavedReply) => void;
  /** Composer text; enables "Save current text as a saved reply". */
  currentText: string;
  /** Overrides the built-in SavedRepliesPanel (e.g. the page already renders one). */
  onManage?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  size?: 'sm' | 'md';
}

const SavedIcon = icons.message;
const AddIcon = icons.add;

export function SavedRepliesPicker({
  platform, context, onInsert, currentText, onManage, disabled, disabledReason, size = 'sm',
}: SavedRepliesPickerProps) {
  const t = useTranslations('messages.saved');
  const locale = useLocale();
  const toast = useToast();
  const listId = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [everOpened, setEverOpened] = useState(false);
  const [query, setQuery] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  // The one-time legacy import toast is shown by the hook (whichever instance runs the import).
  const store = useSavedReplies({ enabled: everOpened || saveOpen || panelOpen });
  const listRef = useRef<HTMLUListElement | null>(null);

  const visible = useMemo(() => {
    const rows = repliesForPlatform(store.replies, platform).map((r) => ({ reply: r, label: r.title, hint: r.body }));
    return rankByQuery(rows, query, locale);
  }, [store.replies, platform, query, locale]);

  const close = () => {
    setAnchor(null);
    setQuery('');
  };

  const pick = (reply: SavedReply) => {
    const result = fillVariables(reply.body, context);
    store.markUsed(reply.id);
    close();
    onInsert(result.text, result, reply);
  };

  const hasText = currentText.trim().length > 0;

  return (
    <>
      <Button
        variant="ghost"
        size={size}
        icon={SavedIcon}
        trailingIcon={icons.disclosure}
        disabled={disabled}
        disabledReason={disabledReason}
        onClick={(e) => {
          setEverOpened(true);
          setAnchor(e.currentTarget);
        }}
        data-testid="saved-replies-button"
      >
        {t('button')}
      </Button>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        sx={{ zIndex: zIndex.popover }}
        slotProps={{
          paper: {
            sx: { mb: '4px', width: 360, maxWidth: 'calc(100vw - 32px)', maxHeight: 440, display: 'flex', flexDirection: 'column' },
            'aria-label': t('button'),
            'data-testid': 'saved-replies-popover',
          } as Record<string, unknown>,
        }}
      >
        <Box
          sx={{ p: '8px', borderBottom: `1px solid ${neutral[200]}` }}
          onKeyDown={(e: KeyboardEvent) => {
            // Combobox keys (§2.4): ↓ moves into the options; Enter (SearchField onSubmit) inserts the top match.
            if (e.key !== 'ArrowDown') return;
            const first = listRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
            if (!first) return;
            e.preventDefault();
            first.focus();
          }}
        >
          <SearchField
            value={query}
            onChange={setQuery}
            onSubmit={() => {
              const top = visible[0];
              if (top) pick(top.reply);
            }}
            placeholder={t('search')}
            shortcut={null}
            debounceMs={0}
            fullWidth
            autoFocus
          />
        </Box>
        <MenuList ref={listRef} id={listId} aria-label={t('button')} dense sx={{ overflowY: 'auto', py: '4px', flex: 1, minHeight: 0 }}>
          {store.isLoading ? (
            <Box sx={{ px: '12px', py: '8px', fontSize: 12, color: neutral[500] }} data-testid="saved-replies-loading">
              {t('loading')}
            </Box>
          ) : null}
          {store.mode === 'error' ? (
            <Box role="alert" sx={{ px: '12px', py: '8px', fontSize: 12, color: neutral[600] }}>
              {t('loadError')}
            </Box>
          ) : null}
          {!store.isLoading && store.mode !== 'error' && !visible.length ? (
            <Box sx={{ px: '12px', py: '8px', fontSize: 12, color: neutral[500] }} data-testid="saved-replies-empty">
              {query ? t('noMatches') : t('empty')}
            </Box>
          ) : null}
          {visible.map(({ reply }) => (
            <MenuItem
              key={reply.id}
              onClick={() => pick(reply)}
              data-testid={`saved-reply-option-${reply.id}`}
              sx={{ display: 'block', py: '6px', whiteSpace: 'normal' }}
            >
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                <Box sx={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: '18px', fontWeight: 500, color: neutral[900], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {reply.title}
                  {reply.platform ? (
                    <Box component="span" sx={{ color: neutral[500], fontWeight: 400 }}>
                      {' · '}
                      {platformName(reply.platform)}
                    </Box>
                  ) : null}
                </Box>
                {reply.usageCount > 0 ? (
                  <Box component="span" className="tnum" sx={{ fontSize: 12, lineHeight: '16px', color: neutral[500], flexShrink: 0 }}>
                    {t('used', { count: reply.usageCount })}
                  </Box>
                ) : null}
              </Box>
              <Box sx={{ fontSize: 12, lineHeight: '16px', color: neutral[500], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {reply.body}
              </Box>
            </MenuItem>
          ))}
        </MenuList>
        <Divider />
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', p: '4px' }}>
          {hasText ? (
            <Button
              variant="ghost"
              size="sm"
              icon={AddIcon}
              disabled={store.mode === 'local'}
              disabledReason={store.mode === 'local' ? t('notReadyShort') : undefined}
              onClick={() => {
                close();
                setSaveOpen(true);
              }}
              data-testid="saved-replies-save-current"
            >
              {t('saveCurrent')}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              close();
              if (onManage) onManage();
              else setPanelOpen(true);
            }}
            data-testid="saved-replies-manage"
          >
            {t('manage')}
          </Button>
        </Box>
      </Popover>
      <SaveReplyModal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        initialBody={currentText}
        initialPlatform={null}
        onSaved={() => toast.success(t('saved'))}
        store={store}
      />
      {onManage ? null : <SavedRepliesPanel open={panelOpen} onClose={() => setPanelOpen(false)} store={store} />}
    </>
  );
}

/** Re-exported so G6 imports one module. */
export type { FillContext } from '@/lib/messages/fillVariables';

export default SavedRepliesPicker;
