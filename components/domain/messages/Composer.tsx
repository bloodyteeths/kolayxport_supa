// components/domain/messages/Composer.tsx — messages §2.1–2.3 composer region, §3.2 mobile footer, §5.1
// composer / AI rows, §5.3 send + AI draft (group G6).
//
// The region follows `thread.mode` (lib/messages/threadState.ts):
//   reply / answer   field + Saved replies + Draft with AI + the view's one primary (Send reply / Send answer)
//   rejected         danger Banner, then the same composer prefilled with the rejected answer
//   answered         caption only (no composer, no primary: a button that cannot do anything is not rendered)
//   in_review        StatusPill + caption
//   cannot_answer    note + "View on Trendyol"
// Enter is a newline; ⌘/Ctrl+Enter sends; Esc leaves the field. Errors show inline under the field
// (no toast), the text is always kept. The AI draft never sends itself.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { Banner, isBannerDismissed } from '@/components/ds/feedback/Banner';
import { formatKeys, isApplePlatform } from '@/components/ds/format/Kbd';
import { Button } from '@/components/ds/inputs/Button';
import { FormField } from '@/components/ds/inputs/FormField';
import { IconButton } from '@/components/ds/inputs/IconButton';
import { TextArea } from '@/components/ds/inputs/TextArea';
import { ConfirmDialog } from '@/components/ds/overlay/ConfirmDialog';
import { ICON_STROKE, iconSize, icons } from '@/lib/ds/icons';
import { logoDisplayName } from '@/lib/ds/logos';
import { neutral as n, tone, type as typeScale } from '@/lib/ds/tokens';
import { useFormatters } from '@/lib/format';
import { insertAtCaret, type FillContext } from '@/lib/messages/fillVariables';
import type { DraftMissing } from '@/lib/messages/draftReply';
import { composerAcceptsText } from '@/lib/messages/threadState';
import { isQuestionPlatform } from '@/lib/messages/platforms';
import type { MessagePlatform } from '@/types/messages';
import { SavedRepliesPicker } from './SavedRepliesPicker';
import { maxLengthFor, type AiDraftResult, type ComposerError, type UseThreadResult } from './useThread';

export const PUBLIC_NOTE_DISMISS_KEY = 'msg.trendyol.public';

export interface ComposerProps {
  thread: UseThreadResult;
  /** `{customer}`, `{product}`, `{order}` for saved replies (ThreadPane builds it). */
  fillContext: FillContext;
  layout?: 'pane' | 'sheet';
  /** Overrides the picker's own SavedRepliesPanel (the page renders one). */
  onManageSavedReplies?: () => void;
  inputRef?: Ref<HTMLTextAreaElement>;
}

type T = ReturnType<typeof useTranslations>;

export function platformLabel(p: MessagePlatform): string {
  return logoDisplayName(p) ?? (p === 'wix' ? 'Wix' : p === 'hepsiburada' ? 'Hepsiburada' : 'Trendyol');
}

/** Inline error copy under the field (`messages.composer.errors.*`). Wix length errors say "Replies". */
export function composerErrorText(err: ComposerError, t: T, platform: MessagePlatform = 'trendyol'): string {
  switch (err.kind) {
    case 'empty':
      return t('errors.empty');
    case 'tooShort':
      return t('errors.tooShort', { min: err.min });
    case 'tooLong':
      return platform === 'wix' ? t('errors.tooLongReply', { max: err.max }) : t('errors.tooLong', { max: err.max });
    case 'unfilled':
      return t('errors.unfilled', { tokens: err.tokens.join(', ') });
    case 'alreadyAnswered':
      return platform === 'hepsiburada' ? t('errors.alreadyAnsweredHepsiburada') : t('errors.alreadyAnswered');
    case 'auth':
      return t('errors.auth', { name: platformLabel(err.platform) });
    default:
      return t('errors.generic');
  }
}

/** "⌘↵" / "Ctrl+↵" for the send hint. */
export function sendKeysLabel(mac: boolean): string {
  return formatKeys('mod+enter', mac).map((chord) => chord.join(mac ? '' : '+')).join(' ');
}

function Caption({ children, color = n[500], testId }: { children: ReactNode; color?: string; testId?: string }) {
  const [size, line] = typeScale.caption;
  return (
    <Box data-testid={testId} sx={{ fontSize: size, lineHeight: `${line}px`, color }}>
      {children}
    </Box>
  );
}

const DoneIcon = icons.done;

export function Composer({ thread, fillContext, layout = 'pane', onManageSavedReplies, inputRef }: ComposerProps) {
  const t = useTranslations('messages.composer');
  const tThread = useTranslations('messages.thread');
  const tAi = useTranslations('messages.ai');
  const f = useFormatters();
  const { conversation: c, mode } = thread;
  const sheet = layout === 'sheet';
  const isTrendyol = c.platform === 'trendyol';
  const isHepsiburada = c.platform === 'hepsiburada';
  // Q&A platforms (Trendyol, Hepsiburada): "answer" wording and a length counter.
  const isQuestion = isQuestionPlatform(c.platform);

  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const setRefs = (el: HTMLTextAreaElement | null) => {
    localRef.current = el;
    if (typeof inputRef === 'function') inputRef(el);
    else if (inputRef && typeof inputRef === 'object') (inputRef as { current: HTMLTextAreaElement | null }).current = el;
  };

  const [mac, setMac] = useState(false);
  useEffect(() => setMac(isApplePlatform(typeof navigator === 'undefined' ? undefined : navigator)), []);

  const [noteDismissed, setNoteDismissed] = useState(() => isBannerDismissed(PUBLIC_NOTE_DISMISS_KEY));
  const [pendingDraft, setPendingDraft] = useState<AiDraftResult | null>(null);
  const caretRef = useRef<number | null>(null);

  // Restore the caret after a saved reply was inserted.
  useEffect(() => {
    const el = localRef.current;
    if (el && caretRef.current != null) {
      el.focus();
      el.setSelectionRange(caretRef.current, caretRef.current);
      caretRef.current = null;
    }
  }, [thread.text]);

  // ── regions without a composer ───────────────────────────────────────────────────────────────────
  if (!composerAcceptsText(mode)) {
    let body: ReactNode = null;
    if (mode.kind === 'answered') {
      body = (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }} data-testid="composer-answered">
          <DoneIcon size={iconSize.control} strokeWidth={ICON_STROKE} color={tone.success.fg} aria-hidden />
          <Caption color={n[600]}>
            {isHepsiburada
              ? (mode.answeredAt ? tThread('answeredHepsiburada', { date: f.date(mode.answeredAt, 'datetime') }) : tThread('answeredHepsiburadaNoDate'))
              : (mode.answeredAt ? tThread('answered', { date: f.date(mode.answeredAt, 'datetime') }) : tThread('answeredNoDate'))}
          </Caption>
        </Box>
      );
    } else if (mode.kind === 'in_review') {
      body = (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }} data-testid="composer-in-review">
          <StatusPill domain="message" status="in_review" />
          <Caption color={n[600]}>{tThread('inReview')}</Caption>
        </Box>
      );
    } else if (mode.kind === 'cannot_answer') {
      body = (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }} data-testid="composer-cannot-answer">
          <Caption color={n[600]}>{tThread('cannotAnswer')}</Caption>
          {c.productInfo?.webUrl && (
            <Button variant="ghost" size="sm" icon={icons.externalLink} href={c.productInfo.webUrl} external>
              {isHepsiburada ? tThread('viewOnHepsiburada') : tThread('viewOnTrendyol')}
            </Button>
          )}
        </Box>
      );
    }
    return (
      <Box data-testid="composer" data-mode={mode.kind} sx={{ flexShrink: 0, px: '16px', py: '12px', borderTop: `1px solid ${n[200]}`, bgcolor: n[0] }}>
        {body}
      </Box>
    );
  }

  // ── composer ─────────────────────────────────────────────────────────────────────────────────────
  const max = maxLengthFor(c.platform);
  const label = isQuestion ? t('labelAnswer') : t('labelReply');
  const name = c.customerName?.trim() || tThread('customer');
  const placeholder = isTrendyol
    ? t('placeholderTrendyol')
    : isHepsiburada
      ? t('placeholderHepsiburada')
      : t('placeholderWix', { name: name.split(/\s+/)[0] });
  const sendLabel = isQuestion ? t('sendAnswer') : t('sendReply');
  const errorText = thread.sendError ? composerErrorText(thread.sendError, t, c.platform) : null;
  const aiLoading = thread.ai.status === 'loading';
  const hasText = thread.text.trim().length > 0;

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void thread.send();
    } else if (e.key === 'Escape') {
      // Esc leaves the composer first; the page's Esc (clear search, close sheet) runs on the next press.
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.blur();
    }
  };

  const onInsert = (inserted: string) => {
    const el = localRef.current;
    const res = insertAtCaret(thread.text, inserted, el?.selectionStart ?? null, el?.selectionEnd ?? null);
    caretRef.current = res.caret;
    thread.setText(res.text);
  };

  const onDraft = async () => {
    const draft = await thread.requestDraft();
    if (!draft) return;
    // The live text, not this render's snapshot: the field stays editable while the draft loads.
    if (thread.getText().trim()) setPendingDraft(draft);
    else thread.applyDraft(draft);
  };

  const missingText = (missing: DraftMissing[]) => missing.map((m) => tAi(`missingItem.${m}`)).join(', ');

  const picker = (
    <SavedRepliesPicker
      platform={c.platform}
      context={fillContext}
      onInsert={onInsert}
      currentText={thread.text}
      onManage={onManageSavedReplies}
      size={sheet ? 'md' : 'sm'}
      disabled={thread.sending}
    />
  );
  const aiLabel = thread.aiNote ? tAi('redo') : tAi('draft');
  const aiButton = sheet ? (
    <IconButton icon={icons.ai} label={aiLoading ? tAi('drafting') : aiLabel} size="lg" onClick={() => void onDraft()} disabled={aiLoading || thread.sending} disabledReason={aiLoading ? tAi('drafting') : t('sending')} data-testid="composer-ai" />
  ) : (
    <Button variant="ghost" size="sm" icon={icons.ai} loading={aiLoading} loadingLabel={tAi('drafting')} onClick={() => void onDraft()} disabled={thread.sending} disabledReason={t('sending')} data-testid="composer-ai">
      {aiLabel}
    </Button>
  );
  const sendButton = (
    <Button
      variant="primary"
      size={sheet ? 'xl' : 'md'}
      icon={icons.push}
      loading={thread.sending}
      loadingLabel={t('sending')}
      onClick={() => void thread.send()}
      data-testid="composer-send"
    >
      {sendLabel}
    </Button>
  );

  return (
    <Box
      data-testid="composer"
      data-mode={mode.kind}
      sx={{
        flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px', px: '16px', pt: '12px',
        pb: sheet ? 'calc(12px + env(safe-area-inset-bottom, 0px))' : '12px',
        borderTop: `1px solid ${n[200]}`, bgcolor: n[0],
      }}
    >
      {mode.kind === 'rejected' && (
        <Banner tone="danger" title={mode.reason ? tThread('rejected', { reason: mode.reason }) : tThread('rejectedNoReason')} data-testid="composer-rejected" />
      )}
      {isTrendyol && !noteDismissed && (
        <Banner
          tone="info"
          title={tThread('publicNote')}
          dismissKey={hasText ? undefined : PUBLIC_NOTE_DISMISS_KEY}
          onDismiss={() => setNoteDismissed(true)}
          data-testid="composer-public-note"
        />
      )}

      {isHepsiburada && c.expiresAt && (
        <Caption color={n[600]} testId="composer-deadline">
          {tThread('answerBy', { date: f.date(c.expiresAt, 'datetime') })}
        </Caption>
      )}

      <FormField
        label={label}
        hideLabel={sheet}
        error={errorText}
        counter={isQuestion ? { value: thread.text.trim().length, max } : undefined}
      >
        <TextArea
          value={thread.text}
          onChange={(v) => thread.setText(v)}
          placeholder={placeholder}
          minRows={sheet ? 1 : 3}
          maxRows={sheet ? 5 : 10}
          readOnly={thread.sending}
          onKeyDown={onKeyDown}
          inputRef={setRefs}
          aria-label={label}
          data-testid="composer-input"
        />
      </FormField>

      {thread.aiNote && (
        <Box data-testid="composer-ai-note">
          <Caption>{tAi('note')}</Caption>
          {thread.aiNote.missing.length > 0 && <Caption>{tAi('missing', { items: missingText(thread.aiNote.missing) })}</Caption>}
        </Box>
      )}
      {thread.ai.status === 'error' && (
        <Caption color={tone.danger.fg} testId="composer-ai-error">
          {tAi('failed')}
        </Caption>
      )}
      {thread.sendError?.kind === 'auth' && (
        <Box>
          <Button variant="ghost" size="sm" href={thread.sendError.platform === 'wix' ? '/ayarlar?tab=connections' : '/ayarlar?tab=apiKeys'} data-testid="composer-reconnect">
            {t('reconnect', { name: platformLabel(thread.sendError.platform) })}
          </Button>
        </Box>
      )}

      {sheet ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {picker}
          {aiButton}
          <Box sx={{ flex: 1 }} />
          {sendButton}
        </Box>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {picker}
          {aiButton}
          <Box sx={{ flex: 1 }} />
          <Caption>{t('shortcut', { keys: sendKeysLabel(mac) })}</Caption>
          {sendButton}
        </Box>
      )}

      <ConfirmDialog
        open={!!pendingDraft}
        title={tAi('replace.title')}
        confirmLabel={tAi('replace.confirm')}
        onConfirm={() => {
          if (pendingDraft) thread.applyDraft(pendingDraft);
          setPendingDraft(null);
        }}
        onCancel={() => setPendingDraft(null)}
        data-testid="composer-ai-replace"
      />
    </Box>
  );
}

export default Composer;
