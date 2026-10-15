// lib/hooks/useSavedReplies.ts — messages §6.4 (group G3). SWR over `/api/messages/saved-replies` plus
// the one-time import of the legacy per-browser list (`kx.messages.savedReplies.{userId}`).
//
// Modes:
//   'loading' — first request in flight
//   'server'  — the API answered; create / update / delete / markUsed work
//   'local'   — the API answered 503 notReady (BR-4 migration not deployed): the legacy browser list is
//               shown read-only so the seller keeps inserting their replies; edits are disabled
//   'error'   — the API failed for another reason (list empty, `error` set)
import useSWR from 'swr';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/ds/feedback/toast';
import {
  SAVED_REPLY_LIMIT,
  buildImportRows,
  legacySavedRepliesKey,
  parseLegacySavedReplies,
  sortSavedReplies,
  type SavedReply,
  type SavedReplyErrorBody,
  type SavedReplyInput,
} from '@/lib/messages/savedReplies';

export const SAVED_REPLIES_KEY = '/api/messages/saved-replies';

export type SavedRepliesMode = 'loading' | 'server' | 'local' | 'error';

export type SavedReplyMutation =
  | { ok: true; reply: SavedReply }
  | { ok: false; error: SavedReplyErrorBody };
export type SavedReplyVoidMutation = { ok: true } | { ok: false; error: SavedReplyErrorBody };

interface ListPayload {
  replies: SavedReply[];
  limit: number;
  /** true when the server has no SavedReply table yet (503 notReady). */
  notReady?: boolean;
}

export class SavedRepliesFetchError extends Error {
  status: number;
  code: string | undefined;
  constructor(status: number, code?: string) {
    super(`saved replies request failed (${status})`);
    this.status = status;
    this.code = code;
  }
}

async function readError(res: Response): Promise<SavedReplyErrorBody> {
  try {
    const body = (await res.json()) as Partial<SavedReplyErrorBody>;
    if (body && typeof body.code === 'string') return body as SavedReplyErrorBody;
  } catch {
    /* non-JSON error page */
  }
  return { code: res.status === 401 ? 'unauthorized' : 'unavailable' };
}

const fetchList = async (url: string): Promise<ListPayload> => {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (res.status === 503) {
    const err = await readError(res);
    if (err.code === 'notReady') return { replies: [], limit: SAVED_REPLY_LIMIT, notReady: true };
    throw new SavedRepliesFetchError(503, err.code);
  }
  if (!res.ok) {
    const err = await readError(res);
    throw new SavedRepliesFetchError(res.status, err.code);
  }
  const body = (await res.json()) as Partial<ListPayload>;
  return { replies: Array.isArray(body.replies) ? body.replies : [], limit: typeof body.limit === 'number' ? body.limit : SAVED_REPLY_LIMIT };
};

function readLegacy(userId: string | null): string[] {
  if (!userId || typeof window === 'undefined') return [];
  try {
    return parseLegacySavedReplies(window.localStorage.getItem(legacySavedRepliesKey(userId)));
  } catch {
    return [];
  }
}

/**
 * Marker set once the legacy list reached the account. The legacy key itself is KEPT while the legacy
 * Messages page (still the default screen, which reads that key) exists, so turning the `messages` flag
 * off never makes a seller's replies vanish. Delete the key together with the legacy page.
 */
export const legacyImportedMarkerKey = (userId: string) => `kx.messages.savedReplies.imported.${userId}`;

function isLegacyImported(userId: string): boolean {
  try {
    return window.localStorage.getItem(legacyImportedMarkerKey(userId)) === '1';
  } catch {
    return false;
  }
}

function markLegacyImported(userId: string) {
  try {
    window.localStorage.setItem(legacyImportedMarkerKey(userId), '1');
  } catch {
    /* storage blocked: a second import is refused by the server (notEmpty) */
  }
}

/**
 * Users whose import was started in this tab. Module-level (not per hook instance) so the picker and the
 * page-level panel — separate instances on one SWR key — never both POST action=import or both toast.
 */
const importStarted = new Set<string>();

/** Tests only. */
export function __resetSavedRepliesImportForTests() {
  importStarted.clear();
}

/** Legacy texts as read-only SavedReply rows (ids `local:N`, never sent to the server). */
export function legacyAsReplies(items: string[]): SavedReply[] {
  const epoch = new Date(0).toISOString();
  return buildImportRows(items).map((r, i) => ({
    id: `local:${i}`,
    title: r.title,
    body: r.body,
    platform: null,
    usageCount: 0,
    createdAt: epoch,
    updatedAt: epoch,
  }));
}

export interface UseSavedRepliesOptions {
  /**
   * Called once after the legacy list was moved to the account (`count` rows). Default: the
   * "N saved replies moved to your account" toast. Only the instance that ran the import calls it.
   */
  onImported?: (count: number) => void;
  /** Skip fetching (picker closed and never opened, tests). Default true. */
  enabled?: boolean;
}

export interface UseSavedRepliesResult {
  replies: SavedReply[];
  mode: SavedRepliesMode;
  /** False in 'local' mode (BR-4 not deployed). create / update / remove also try while 'loading' / 'error'. */
  canEdit: boolean;
  limit: number;
  isLoading: boolean;
  error: Error | undefined;
  create(input: SavedReplyInput): Promise<SavedReplyMutation>;
  update(id: string, patch: Partial<SavedReplyInput>): Promise<SavedReplyMutation>;
  remove(id: string): Promise<SavedReplyVoidMutation>;
  /** Fire-and-forget usage bump when a reply is inserted (optimistic). */
  markUsed(id: string): void;
  refresh(): void;
}

export function useSavedReplies(options: UseSavedRepliesOptions = {}): UseSavedRepliesResult {
  const { enabled = true, onImported } = options;
  // auth-context is plain JS; its user shape is untyped.
  const { user } = useAuth() as { user: { id?: string | number } | null };
  const userId = user?.id ? String(user.id) : null;
  const { data, error, isLoading, mutate } = useSWR<ListPayload>(enabled && userId ? SAVED_REPLIES_KEY : null, fetchList, {
    dedupingInterval: 30_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });

  const t = useTranslations('messages.saved');
  const toast = useToast();
  const onImportedRef = useRef<(count: number) => void>(() => undefined);
  onImportedRef.current = onImported ?? ((count) => toast.success(t('imported', { count })));

  // One-time import (§6.4): server list empty + legacy key non-empty + not imported yet → import, mark, toast.
  useEffect(() => {
    if (!userId || !data || data.notReady || data.replies.length > 0) return;
    if (importStarted.has(userId) || isLegacyImported(userId)) return;
    const items = readLegacy(userId);
    if (!items.length) return;
    importStarted.add(userId);
    void (async () => {
      try {
        const res = await fetch(`${SAVED_REPLIES_KEY}?action=import`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items }),
        });
        if (res.ok) {
          const body = (await res.json()) as { replies?: SavedReply[]; imported?: number; limit?: number };
          markLegacyImported(userId);
          await mutate({ replies: Array.isArray(body.replies) ? body.replies : [], limit: body.limit ?? SAVED_REPLY_LIMIT }, { revalidate: false });
          if (body.imported && body.imported > 0) onImportedRef.current?.(body.imported);
        } else {
          const err = await readError(res);
          // Another device/tab already imported: the server list wins; never import this copy again.
          if (err.code === 'notEmpty') {
            markLegacyImported(userId);
            void mutate();
          } else {
            importStarted.delete(userId);
          }
        }
      } catch {
        /* offline: the key stays and the import runs on a later visit */
        importStarted.delete(userId);
      }
    })();
  }, [data, mutate, userId]);

  const mode: SavedRepliesMode = !data ? (error ? 'error' : 'loading') : data.notReady ? 'local' : 'server';

  const replies = useMemo<SavedReply[]>(() => {
    if (!data) return [];
    if (data.notReady) return legacyAsReplies(readLegacy(userId));
    return sortSavedReplies(data.replies);
  }, [data, userId]);

  const send = useCallback(
    async (url: string, method: string, body?: unknown): Promise<{ ok: true; json: unknown } | { ok: false; error: SavedReplyErrorBody }> => {
      try {
        const res = await fetch(url, {
          method,
          credentials: 'same-origin',
          headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!res.ok) return { ok: false, error: await readError(res) };
        if (res.status === 204) return { ok: true, json: null };
        return { ok: true, json: await res.json() };
      } catch {
        return { ok: false, error: { code: 'unavailable' } };
      }
    },
    [],
  );

  const notEditable = useCallback((): { ok: false; error: SavedReplyErrorBody } => ({ ok: false, error: { code: 'notReady' } }), []);

  const create = useCallback<UseSavedRepliesResult['create']>(
    async (input) => {
      if (mode === 'local') return notEditable();
      const r = await send(SAVED_REPLIES_KEY, 'POST', input);
      if (!r.ok) return r;
      const reply = (r.json as { reply: SavedReply }).reply;
      await mutate((prev) => (prev ? { ...prev, replies: sortSavedReplies([...prev.replies, reply]) } : prev), { revalidate: false });
      return { ok: true, reply };
    },
    [mode, mutate, notEditable, send],
  );

  const update = useCallback<UseSavedRepliesResult['update']>(
    async (id, patch) => {
      if (mode === 'local') return notEditable();
      const r = await send(`${SAVED_REPLIES_KEY}?id=${encodeURIComponent(id)}`, 'PATCH', patch);
      if (!r.ok) return r;
      const reply = (r.json as { reply: SavedReply }).reply;
      await mutate((prev) => (prev ? { ...prev, replies: sortSavedReplies(prev.replies.map((x) => (x.id === id ? reply : x))) } : prev), { revalidate: false });
      return { ok: true, reply };
    },
    [mode, mutate, notEditable, send],
  );

  const remove = useCallback<UseSavedRepliesResult['remove']>(
    async (id) => {
      if (mode === 'local') return notEditable();
      const r = await send(`${SAVED_REPLIES_KEY}?id=${encodeURIComponent(id)}`, 'DELETE');
      if (!r.ok && r.error.code !== 'notFound') return r;
      await mutate((prev) => (prev ? { ...prev, replies: prev.replies.filter((x) => x.id !== id) } : prev), { revalidate: false });
      return { ok: true };
    },
    [mode, mutate, notEditable, send],
  );

  const markUsed = useCallback<UseSavedRepliesResult['markUsed']>(
    (id) => {
      if (mode !== 'server' || id.startsWith('local:')) return;
      void mutate(
        (prev) => (prev ? { ...prev, replies: prev.replies.map((x) => (x.id === id ? { ...x, usageCount: x.usageCount + 1 } : x)) } : prev),
        { revalidate: false },
      );
      void send(`${SAVED_REPLIES_KEY}?action=used&id=${encodeURIComponent(id)}`, 'POST');
    },
    [mode, mutate, send],
  );

  return {
    replies,
    mode,
    canEdit: mode !== 'local',
    limit: data?.limit ?? SAVED_REPLY_LIMIT,
    isLoading: isLoading && !data,
    error: data ? undefined : (error as Error | undefined),
    create,
    update,
    remove,
    markUsed,
    refresh: () => void mutate(),
  };
}
