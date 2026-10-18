// components/domain/messages/useThread.ts — messages §5.1 thread/composer rows, §5.3 (group G6).
//
// One open thread: the history (Wix `GET ?action=thread`; Trendyol straight from the list payload, no
// extra call), the composer text with a per-thread unsent draft in sessionStorage, send
// (`POST ?action=reply`, error `code` mapped, text kept on failure), read state (`POST ?action=markSeen`,
// fire-and-forget on open) and "Draft with AI" (`POST /api/messages/draft-reply`, never sent on its own).
//
// The hook is meant to live inside a component keyed by `threadKey(conversation)`, so switching threads
// resets every piece of state (ThreadPane does this). The pure helpers are exported for tests.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { composerMode, type ComposerMode } from '@/lib/messages/threadState';
import { findUnfilledTokens } from '@/lib/messages/fillVariables';
import { TRENDYOL_ANSWER_MIN } from '@/lib/messages/limits';
import { isQuestionPlatform, replyLimits } from '@/lib/messages/platforms';
import { DRAFT_MISSING_KEYS, type DraftMissing, type DraftReplyErrorCode } from '@/lib/messages/draftReply';
import { calendarDay } from '@/lib/format';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import type { MessagePlatform, ReplyErrorCode, UnifiedConversation, UnifiedMessage } from '@/types/messages';

// ─── keys and per-viewer drafts (sessionStorage, try/catch: DS browser-storage rule) ──────────────────

export const DRAFT_STORAGE_PREFIX = 'kx.msg.draft.';

export function threadKey(c: Pick<UnifiedConversation, 'platform' | 'id'>): string {
  return `${c.platform}:${c.id}`;
}

export function draftStorageKey(platform: MessagePlatform | string, id: string): string {
  return `${DRAFT_STORAGE_PREFIX}${platform}:${id}`;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readDraft(key: string): string | null {
  try {
    const v = storage()?.getItem(key);
    return typeof v === 'string' && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Fired on `window` whenever a stored unsent reply is written or removed in this tab. */
export const DRAFTS_CHANGED_EVENT = 'kx:msg-drafts-changed';

function notifyDraftsChanged(): void {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(DRAFTS_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

export function writeDraft(key: string, text: string): void {
  try {
    const s = storage();
    if (!s) return;
    const had = s.getItem(key);
    if (text.trim()) s.setItem(key, text);
    else s.removeItem(key);
    // Only an appear/disappear changes "is anything unsent?"; typing inside a draft does not.
    if ((had === null) !== !text.trim()) notifyDraftsChanged();
  } catch {
    /* per-viewer convenience only */
  }
}

export function clearDraft(key: string): void {
  writeDraft(key, '');
}

/** Every stored unsent reply key (all threads). */
export function listDraftKeys(): string[] {
  try {
    const s = storage();
    if (!s) return [];
    const out: string[] = [];
    for (let i = 0; i < s.length; i += 1) {
      const k = s.key(i);
      if (k && k.startsWith(DRAFT_STORAGE_PREFIX)) out.push(k);
    }
    return out;
  } catch {
    return [];
  }
}

export function clearAllDrafts(): void {
  for (const k of listDraftKeys()) clearDraft(k);
}

// ─── composer validation and error mapping ─────────────────────────────────────────────────────────────

/** What the composer shows under the field (`messages.composer.errors.*`). */
export type ComposerError =
  | { kind: 'empty' }
  | { kind: 'tooShort'; min: number }
  | { kind: 'tooLong'; max: number }
  | { kind: 'unfilled'; tokens: string[] }
  | { kind: 'alreadyAnswered' }
  | { kind: 'auth'; platform: MessagePlatform }
  | { kind: 'generic' };

export function maxLengthFor(platform: MessagePlatform): number {
  return replyLimits(platform).max;
}

/** Client-side checks before the POST (messages §5.3 "Send: validates"). */
export function validateComposerText(platform: MessagePlatform, text: string): ComposerError | null {
  const trimmed = text.trim();
  if (!trimmed) return { kind: 'empty' };
  const tokens = findUnfilledTokens(text);
  if (tokens.length > 0) return { kind: 'unfilled', tokens };
  const { min } = replyLimits(platform);
  if (isQuestionPlatform(platform) && trimmed.length < min) return { kind: 'tooShort', min };
  if (trimmed.length > maxLengthFor(platform)) return { kind: 'tooLong', max: maxLengthFor(platform) };
  return null;
}

/** `POST ?action=reply` failure → composer error (the route sends `code`, plus `min`/`max` for length). */
export function mapReplyError(platform: MessagePlatform, body: unknown): ComposerError {
  const b = (body && typeof body === 'object' ? body : {}) as { code?: ReplyErrorCode | string; min?: unknown; max?: unknown };
  switch (b.code) {
    case 'tooShort':
      return { kind: 'tooShort', min: typeof b.min === 'number' ? b.min : TRENDYOL_ANSWER_MIN };
    case 'tooLong':
      return { kind: 'tooLong', max: typeof b.max === 'number' ? b.max : maxLengthFor(platform) };
    case 'alreadyAnswered':
      return { kind: 'alreadyAnswered' };
    case 'auth':
    case 'permission':
      return { kind: 'auth', platform };
    default:
      return { kind: 'generic' };
  }
}

/** Drops `missing` values outside the documented enum (the server already does; belt and braces). */
export function cleanMissing(raw: unknown): DraftMissing[] {
  if (!Array.isArray(raw)) return [];
  const out: DraftMissing[] = [];
  for (const v of raw) {
    if ((DRAFT_MISSING_KEYS as readonly string[]).includes(v) && !out.includes(v as DraftMissing)) out.push(v as DraftMissing);
  }
  return out;
}

// ─── history ───────────────────────────────────────────────────────────────────────────────────────────

export interface DayGroup {
  /** "YYYY-MM-DD" in the seller timezone; '' for leading messages without a time. */
  day: string;
  /** First dated message of the day (for the divider), null when unknown. */
  date: string | null;
  messages: UnifiedMessage[];
}

/** Groups oldest-first messages by calendar day. A message without a time joins the group before it. */
export function groupByDay(messages: readonly UnifiedMessage[], timeZone?: string): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const m of messages) {
    const d = m.date ? new Date(m.date) : null;
    const valid = d && !Number.isNaN(d.getTime()) ? d : null;
    const day = valid ? calendarDay(valid, timeZone) : null;
    const last = groups[groups.length - 1];
    if (day === null) {
      if (last) last.messages.push(m);
      else groups.push({ day: '', date: null, messages: [m] });
    } else if (last && (last.day === day || last.day === '')) {
      if (last.day === '') {
        last.day = day;
        last.date = m.date;
      }
      last.messages.push(m);
    } else {
      groups.push({ day, date: m.date, messages: [m] });
    }
  }
  return groups;
}

/** Clock skew allowed between this browser and the marketplace when matching a sent bubble. */
export const LOCAL_ECHO_SKEW_MS = 2 * 60_000;

function timeOf(date: string | null | undefined): number | null {
  if (!date) return null;
  const t = new Date(date).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Appends bubbles sent from this tab that the server history does not show yet. A local bubble is
 * dropped once the server returns a seller message with the same text dated at or after the send
 * (minus `LOCAL_ECHO_SKEW_MS`); each server message accounts for at most one local bubble, so an
 * earlier identical reply ("Teşekkürler!") or the rejected Trendyol answer never hides a new send.
 * A server message without a time still matches (it cannot be placed before the send).
 */
export function mergeThreadMessages(base: readonly UnifiedMessage[], localSent: readonly UnifiedMessage[]): UnifiedMessage[] {
  if (localSent.length === 0) return base as UnifiedMessage[];
  const used = new Set<number>();
  const pending = localSent.filter((local) => {
    const text = local.text.trim();
    const sentAt = timeOf(local.date);
    const idx = base.findIndex((m, i) => {
      if (used.has(i) || m.sender !== 'seller' || m.text.trim() !== text) return false;
      const at = timeOf(m.date);
      return at === null || sentAt === null || at >= sentAt - LOCAL_ECHO_SKEW_MS;
    });
    if (idx === -1) return true;
    used.add(idx);
    return false;
  });
  return [...base, ...pending];
}

// ─── network ──────────────────────────────────────────────────────────────────────────────────────────

export const MESSAGES_API = '/api/messages';
export const DRAFT_REPLY_API = '/api/messages/draft-reply';

export function wixThreadUrl(id: string): string {
  return `${MESSAGES_API}?action=thread&platform=wix&conversationId=${encodeURIComponent(id)}`;
}

export class MessagesHttpError extends Error {
  status: number;
  code: string | null;
  constructor(status: number, code: string | null) {
    super(`messages ${status}${code ? ` ${code}` : ''}`);
    this.status = status;
    this.code = code;
  }
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function jsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin' });
  const body = await readJson(res);
  if (!res.ok) {
    const code = body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string' ? (body as { code: string }).code : null;
    throw new MessagesHttpError(res.status, code);
  }
  return body as T;
}

function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Fire-and-forget read state. Never throws. */
export function postMarkSeen(platform: MessagePlatform, id: string, seen = true): Promise<boolean> {
  return postJson(`${MESSAGES_API}?action=markSeen`, { platform, id, seen })
    .then((r) => r.ok)
    .catch(() => false);
}

export function replyBody(c: Pick<UnifiedConversation, 'platform' | 'id'>, text: string): Record<string, string> {
  return isQuestionPlatform(c.platform)
    ? { platform: c.platform, questionId: c.id, text }
    : { platform: 'wix', conversationId: c.id, text };
}

const NO_MESSAGES: UnifiedMessage[] = [];

// ─── the hook ──────────────────────────────────────────────────────────────────────────────────────────

export interface ThreadSentInfo {
  text: string;
  /** ISO time of the send (use it for the `locallyAnswered` map). */
  at: string;
}

export interface UseThreadOptions {
  /** From the page's `locallyAnswered` map: a Trendyol one-shot answer sent from this tab. */
  locallyAnsweredAt?: string | null;
  onSent?: (conversation: UnifiedConversation, info: ThreadSentInfo) => void;
  /** Called right after markSeen is fired (optimistic: clear the dot). */
  onSeen?: (conversation: UnifiedConversation) => void;
  onMarkedUnread?: (conversation: UnifiedConversation) => void;
  /**
   * true (default): the hook posts `markSeen` on open and on `markUnread()`. false: the page owns read
   * state (G5 `useInbox.markSeen` posts and clears the dot), so the hook only calls the callbacks.
   */
  postReadState?: boolean;
}

export type AiDraftState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; code: DraftReplyErrorCode | 'network' };

export interface AiDraftResult {
  reply: string;
  missing: DraftMissing[];
}

export interface UseThreadResult {
  conversation: UnifiedConversation;
  mode: ComposerMode;
  /** Oldest first, with bubbles sent from this tab appended. */
  messages: UnifiedMessage[];
  loading: boolean;
  loadError: boolean;
  retry: () => void;

  text: string;
  /** The live text (updated synchronously by `setText`), for code that runs after an await. */
  getText: () => string;
  setText: (text: string) => void;
  sending: boolean;
  sendError: ComposerError | null;
  clearSendError: () => void;
  /** Validates, posts, and on success clears the field. Resolves true when sent. */
  send: () => Promise<boolean>;
  /** True after a successful send from this thread (shows "Next: …"). */
  justSent: boolean;

  ai: AiDraftState;
  /** Non-null once a draft was inserted (and until the field is emptied or sent). */
  aiNote: { missing: DraftMissing[] } | null;
  /** Fetches a draft; does not touch the text. Resolves null when the thread was closed meanwhile. */
  requestDraft: () => Promise<AiDraftResult | null>;
  /** No-op once the thread was closed (never writes another thread's stored text). */
  applyDraft: (draft: AiDraftResult) => void;

  markUnread: () => Promise<void>;
}

export function useThread(conversation: UnifiedConversation, options: UseThreadOptions = {}): UseThreadResult {
  const { locallyAnsweredAt, postReadState = true } = options;
  const optsRef = useRef(options);
  optsRef.current = options;
  const convRef = useRef(conversation);
  convRef.current = conversation;

  const { platform, id } = conversation;
  const storageKey = draftStorageKey(platform, id);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const mode = composerMode(conversation, {
    locallyAnsweredAt: locallyAnsweredAt ?? (isQuestionPlatform(platform) ? sentAt : null),
  });

  // History. Wix fetches the thread; Trendyol renders the list payload.
  const isWix = platform === 'wix';
  const swr = useSWR<{ messages?: UnifiedMessage[] }>(isWix ? wixThreadUrl(id) : null, jsonFetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const { mutate } = swr;

  // A poll that moves the newest message re-fetches the open Wix thread (no skeleton swap).
  const lastAtRef = useRef(conversation.lastMessageAt);
  useEffect(() => {
    if (!isWix || lastAtRef.current === conversation.lastMessageAt) return;
    lastAtRef.current = conversation.lastMessageAt;
    void mutate();
  }, [isWix, conversation.lastMessageAt, mutate]);

  const [localSent, setLocalSent] = useState<UnifiedMessage[]>([]);
  const base = (isWix ? swr.data?.messages : conversation.messages) ?? NO_MESSAGES;
  const messages = useMemo(() => mergeThreadMessages(base, localSent), [base, localSent]);

  // False once the component holding this hook unmounted (thread switched / sheet closed).
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Composer text: stored unsent draft first, then the rejected Trendyol answer. The prefill is not an
  // edit: it is never stored, so it does not count as an unsent reply.
  const prefillRef = useRef<string>(mode.kind === 'rejected' ? mode.prefill : '');
  const [text, setTextState] = useState<string>(() => readDraft(storageKey) ?? prefillRef.current);
  const textRef = useRef(text);
  const [aiNote, setAiNote] = useState<{ missing: DraftMissing[] } | null>(null);
  const [sendError, setSendError] = useState<ComposerError | null>(null);
  const setText = useCallback((next: string) => {
    textRef.current = next;
    setTextState(next);
    writeDraft(storageKey, prefillRef.current && next === prefillRef.current ? '' : next);
    if (!next.trim()) setAiNote(null);
    setSendError((e) => (e && e.kind !== 'auth' && e.kind !== 'alreadyAnswered' ? null : e));
  }, [storageKey]);
  const getText = useCallback(() => textRef.current, []);

  // Read state on open.
  useEffect(() => {
    const c = convRef.current;
    if (postReadState) void postMarkSeen(c.platform, c.id, true);
    optsRef.current.onSeen?.(c);
  }, [postReadState]);

  const [sending, setSending] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const sendingRef = useRef(false);

  const send = useCallback(async (): Promise<boolean> => {
    if (sendingRef.current) return false;
    const c = convRef.current;
    const text = textRef.current.trim();
    const invalid = validateComposerText(c.platform, text);
    if (invalid) {
      setSendError(invalid);
      return false;
    }
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    try {
      const res = await postJson(`${MESSAGES_API}?action=reply`, replyBody(c, text));
      if (!res.ok) {
        setSendError(mapReplyError(c.platform, await readJson(res)));
        return false;
      }
      const at = new Date().toISOString();
      const bubble: UnifiedMessage = { id: `local-${at}`, sender: 'seller', text, date: at };
      setLocalSent((prev) => [...prev, bubble]);
      if (c.platform === 'wix') {
        void mutate((cur) => (cur ? { ...cur, messages: [...(cur.messages ?? []), bubble] } : cur), { revalidate: false });
      }
      clearDraft(storageKey);
      textRef.current = '';
      setTextState('');
      setAiNote(null);
      setSentAt(at);
      setJustSent(true);
      optsRef.current.onSent?.(c, { text, at });
      return true;
    } catch {
      setSendError({ kind: 'generic' });
      return false;
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [storageKey, mutate]);

  const [ai, setAi] = useState<AiDraftState>({ status: 'idle' });
  const requestDraft = useCallback(async (): Promise<AiDraftResult | null> => {
    const c = convRef.current;
    setAi({ status: 'loading' });
    try {
      const res = await postJson(DRAFT_REPLY_API, { platform: c.platform, id: c.id });
      const body = (await readJson(res)) as { reply?: unknown; missing?: unknown; code?: DraftReplyErrorCode } | null;
      if (!aliveRef.current) return null;
      if (!res.ok || !body || typeof body.reply !== 'string' || !body.reply.trim()) {
        setAi({ status: 'error', code: (res.ok ? 'badDraft' : body?.code) || 'unavailable' });
        return null;
      }
      setAi({ status: 'idle' });
      return { reply: body.reply, missing: cleanMissing(body.missing) };
    } catch {
      if (aliveRef.current) setAi({ status: 'error', code: 'network' });
      return null;
    }
  }, []);

  const applyDraft = useCallback((draft: AiDraftResult) => {
    if (!aliveRef.current) return;
    textRef.current = draft.reply;
    setTextState(draft.reply);
    writeDraft(storageKey, draft.reply);
    setAiNote({ missing: draft.missing });
    setSendError(null);
  }, [storageKey]);

  const markUnread = useCallback(async () => {
    const c = convRef.current;
    if (postReadState) await postMarkSeen(c.platform, c.id, false);
    optsRef.current.onMarkedUnread?.(c);
  }, [postReadState]);

  return {
    conversation,
    mode,
    messages,
    loading: isWix && !swr.data && !swr.error,
    loadError: isWix && !!swr.error && !swr.data,
    retry: () => void mutate(),
    text,
    getText,
    setText,
    sending,
    sendError,
    clearSendError: () => setSendError(null),
    send,
    justSent,
    ai,
    aiNote,
    requestDraft,
    applyDraft,
    markUnread,
  };
}

// ─── leaving the page with unsent text (messages §5.3 "Dirty guard") ─────────────────────────────────

export interface UnsentReplyGuardLabels {
  title: string;
  keep: string;
  discard: string;
}

/** Path part of a URL (no query, no hash). */
export function pathOf(url: string): string {
  return url.split('#')[0].split('?')[0];
}

/** True while any unsent reply is stored (any thread), kept live via `DRAFTS_CHANGED_EVENT`. */
export function useHasUnsentReplies(): boolean {
  const [has, setHas] = useState(() => listDraftKeys().length > 0);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const sync = () => setHas(listDraftKeys().length > 0);
    sync();
    window.addEventListener(DRAFTS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(DRAFTS_CHANGED_EVENT, sync);
  }, []);
  return has;
}

/**
 * Switching threads (`?open=` changes) never asks: the text stays in sessionStorage. Only leaving
 * `/app/mesajlar` while an unsent reply is stored (this thread or any other) opens "Discard your unsent
 * reply?". Discard clears every stored unsent reply.
 *
 * Mount it once per page: the inbox page mounts it itself (so it also covers a closed mobile sheet) and
 * turns the pane's copy off (`ThreadPane guardNavigation={false}`); a standalone ThreadPane keeps its own.
 * The stored drafts are the source of truth: `setText` writes them synchronously, a send clears them, and
 * the untouched rejected-answer prefill is never stored.
 */
export function useUnsentReplyGuard(labels: UnsentReplyGuardLabels, opts: { enabled?: boolean } = {}): void {
  const { enabled = true } = opts;
  const dirty = useHasUnsentReplies();
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  // The path this page was mounted on. Browser back/forward has already moved `window.location` when the
  // guard sees the popstate, so compare with the router (not yet moved) or the mount-time path.
  const [homePath] = useState(() => pathOf(router?.asPath ?? (typeof window === 'undefined' ? '' : window.location.pathname)));
  useUnsavedChangesGuard(dirty, {
    enabled,
    labels,
    onDiscard: clearAllDrafts,
    shouldBlock: (url) => pathOf(url) !== pathOf(routerRef.current?.asPath ?? homePath),
  });
}
