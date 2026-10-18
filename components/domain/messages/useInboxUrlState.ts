// components/domain/messages/useInboxUrlState.ts (messages G5) — the inbox's URL state (DS P3, messages §1,
// §5.3): saved view, store filter, search and the open thread live in the query, so a reload or a shared
// link restores them. `open` is `{platform}:{id}` (`wix:abc`, `trendyol:123`, `hepsiburada:4567`).
import { useCallback, useMemo } from 'react';
import { urlField, useUrlState, type UrlStateOf } from '@/lib/ds/useUrlState';
import type { InboxView, MessagePlatform } from '@/types/messages';

export const INBOX_VIEWS = ['needs_reply', 'unread', 'all'] as const satisfies readonly InboxView[];
export const INBOX_STORES = ['all', 'wix', 'trendyol', 'hepsiburada'] as const;
export type InboxStore = (typeof INBOX_STORES)[number];

export const INBOX_URL_SCHEMA = {
  view: urlField.enum(INBOX_VIEWS, 'needs_reply'),
  store: urlField.enum(INBOX_STORES, 'all'),
  q: urlField.string(undefined, { maxLength: 200 }),
  open: urlField.string(undefined, { maxLength: 300 }),
};

export type InboxUrlState = UrlStateOf<typeof INBOX_URL_SCHEMA>;

export interface OpenRef {
  platform: MessagePlatform;
  id: string;
}

/** `wix:abc` → `{ platform: 'wix', id: 'abc' }`; anything else → null. Ids may contain ':'. */
export function parseOpenKey(raw: string | null | undefined): OpenRef | null {
  if (!raw) return null;
  const i = raw.indexOf(':');
  if (i <= 0) return null;
  const platform = raw.slice(0, i);
  const id = raw.slice(i + 1);
  if ((platform !== 'wix' && platform !== 'trendyol' && platform !== 'hepsiburada') || !id) return null;
  return { platform, id };
}

/** The `open` value (and the stable row key) of a conversation. */
export function toOpenKey(c: { platform: string; id: string }): string {
  return `${c.platform}:${c.id}`;
}

export interface InboxUrlApi {
  state: InboxUrlState;
  ready: boolean;
  /** Parsed `open`, or null. */
  openRef: OpenRef | null;
  setView: (view: InboxView) => void;
  setStore: (store: InboxStore) => void;
  setSearch: (q: string) => void;
  setOpen: (key: string | null) => void;
  /** Clears search and the store filter (the "Clear filters" action); keeps the view and the open thread. */
  clearFilters: () => void;
}

export function useInboxUrlState(): InboxUrlApi {
  const [state, setState, helpers] = useUrlState(INBOX_URL_SCHEMA);
  const openRef = useMemo(() => parseOpenKey(state.open), [state.open]);

  const setView = useCallback((view: InboxView) => setState({ view }), [setState]);
  const setStore = useCallback((store: InboxStore) => setState({ store }), [setState]);
  const setSearch = useCallback((q: string) => setState({ q: q.trim() ? q : undefined }), [setState]);
  const setOpen = useCallback((key: string | null) => setState({ open: key ?? undefined }), [setState]);
  const clearFilters = useCallback(() => setState({ q: undefined, store: 'all' }), [setState]);

  return { state, ready: helpers.ready, openRef, setView, setStore, setSearch, setOpen, clearFilters };
}

export default useInboxUrlState;
