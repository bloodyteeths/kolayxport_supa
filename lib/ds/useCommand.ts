// lib/ds/useCommand.ts — the ⌘K command registry (DS §4.2, shell-nav §3.6).
//
// Anything mounted can add commands to the palette while it is mounted:
//   useCommand({ id: 'overview.refresh', label: t('refresh'), group: 'actions', icon: icons.pull, run })
// Page header actions arrive the same way through `usePageActions` (source 'page' → "On this page").
// The palette reads `useRegisteredCommands()`. Handlers are read through a ref, so a new `run` closure on
// every render never re-publishes and is never stale; only the displayed fields re-publish.
//
// Recent: the last `RECENT_LIMIT` commands run are kept in `localStorage['kx.palette.recent.v1']`
// (try/catch: blocked storage just means no Recent group).
import { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import type { LucideIcon } from '@/lib/ds/icons';
import type { MarketplaceKey } from '@/components/ds/data/types';

/** Palette group a command lists under. 'recent' is assigned by the palette, never registered. */
export type CommandGroup = 'actions' | 'goto' | 'search' | 'recent';

export type Command = {
  /** Unique and stable (also the Recent key), e.g. 'orders.refresh'. */
  id: string;
  /** Already translated. */
  label: string;
  group: Exclude<CommandGroup, 'recent'>;
  icon?: LucideIcon;
  /** Marketplace mark instead of the icon (`LogoTile` 16). */
  brand?: MarketplaceKey;
  /** Display-only hint (`Kbd` keys syntax, e.g. "mod+enter" or "g o"). */
  shortcut?: string;
  /** Extra search words (not displayed). */
  keywords?: string[];
  /** Secondary line / right-hand caption (e.g. the section). */
  hint?: string;
  disabled?: boolean;
  /** Shown as the hint while disabled (P1). */
  disabledReason?: string;
  /** List under "On this page" (page header actions without a `paletteGroup`). */
  onThisPage?: boolean;
  /** Navigation target; used when `run` is absent. */
  href?: string;
  run?: () => void | Promise<void>;
};

/** Where a registration came from: `page` = header actions ("On this page"), `app` = useCommand. */
export type CommandSource = 'page' | 'app';

export type RegisteredCommand = Command & { source: CommandSource; order: number };

type Entry = { owner: string; order: number; source: CommandSource; ref: { current: Command } };

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let seq = 0;
let snapshot: RegisteredCommand[] = [];

function keyOf(owner: string, id: string) {
  return `${owner}\u0000${id}`;
}

function compute(): RegisteredCommand[] {
  const byId = new Map<string, RegisteredCommand>();
  // Later registrations win on a duplicate id (the most recently mounted page owns it).
  for (const e of [...entries.values()].sort((a, b) => a.order - b.order)) {
    const c = e.ref.current;
    byId.set(c.id, {
      ...c,
      // Resolve the current handler at call time.
      run: c.run || !c.href ? () => e.ref.current.run?.() : undefined,
      source: e.source,
      order: e.order,
    });
  }
  return [...byId.values()].sort((a, b) => a.order - b.order);
}

function emit() {
  snapshot = compute();
  listeners.forEach((l) => l());
}

/**
 * Imperative registration (tests, non-React callers). Returns the unregister function. `owner` scopes the
 * id so two owners can register the same id without removing each other.
 */
export function registerCommand(cmd: Command, source: CommandSource = 'app', owner = 'imperative'): () => void {
  const k = keyOf(owner, cmd.id);
  entries.set(k, { owner, order: ++seq, source, ref: { current: cmd } });
  emit();
  return () => {
    if (entries.delete(k)) emit();
  };
}

/** Displayed fields only: a changed handler does not re-publish. */
export function commandSignature(c: Command): string {
  const icon = c.icon as { displayName?: string; name?: string } | undefined;
  return JSON.stringify([
    c.id, c.label, c.group, c.brand ?? null, c.shortcut ?? null, c.keywords ?? null, c.hint ?? null,
    c.disabled ?? false, c.disabledReason ?? null, c.onThisPage ?? false, c.href ?? null, Boolean(c.run),
    icon ? icon.displayName ?? icon.name ?? 'icon' : null,
  ]);
}

/** Low-level hook behind `useCommand`, `useCommands` and `usePageActions`. */
export function useCommandRegistrations(commands: readonly Command[], source: CommandSource = 'app', enabled = true): void {
  const owner = useId();
  const refs = useRef(new Map<string, { current: Command }>());
  const list = enabled ? commands : [];
  // Keep handlers current without re-publishing.
  for (const c of list) {
    const r = refs.current.get(c.id);
    if (r) r.current = c;
  }
  const signature = list.map(commandSignature).join('\n');

  useEffect(() => {
    const keys: string[] = [];
    for (const c of list) {
      const k = keyOf(owner, c.id);
      const ref = { current: c };
      refs.current.set(c.id, ref);
      entries.set(k, { owner, order: ++seq, source, ref });
      keys.push(k);
    }
    emit();
    return () => {
      let changed = false;
      for (const k of keys) changed = entries.delete(k) || changed;
      refs.current.clear();
      if (changed) emit();
    };
    // `list` is captured through `signature`; handlers stay live through the refs above.
  }, [owner, source, signature]);
}

/** Registers one command while the caller is mounted. Pass `null`/`false` to register nothing. */
export function useCommand(cmd: Command | null | false | undefined): void {
  useCommandRegistrations(cmd ? [cmd] : [], 'app');
}

/** Registers several commands while the caller is mounted. */
export function useCommands(cmds: readonly Command[], options: { enabled?: boolean } = {}): void {
  useCommandRegistrations(cmds, 'app', options.enabled ?? true);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const getSnapshot = () => snapshot;
const EMPTY: RegisteredCommand[] = [];
const getServerSnapshot = () => EMPTY;

/** Every registered command (deduped by id, registration order). For the palette. */
export function useRegisteredCommands(): RegisteredCommand[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Test helper. */
export function __resetCommandsForTests(): void {
  entries.clear();
  seq = 0;
  emit();
}

// ── Recent ──────────────────────────────────────────────────────────────────
export const RECENT_KEY = 'kx.palette.recent.v1';
export const RECENT_LIMIT = 5;

/** What Recent remembers: enough to re-find the command (`id`) or navigate (`href`) and to label it. */
export type RecentEntry = { id: string; label: string; href?: string };

function isRecentEntry(v: unknown): v is RecentEntry {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.id === 'string' && r.id !== '' && typeof r.label === 'string' && (r.href === undefined || typeof r.href === 'string');
}

export function readRecent(): RecentEntry[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentEntry).slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

/** Pure: puts `entry` first, drops its older copy, caps at `RECENT_LIMIT`. */
export function addRecent(list: readonly RecentEntry[], entry: RecentEntry): RecentEntry[] {
  return [entry, ...list.filter((e) => e.id !== entry.id)].slice(0, RECENT_LIMIT);
}

export function pushRecent(entry: RecentEntry): RecentEntry[] {
  const next = addRecent(readRecent(), entry);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // storage blocked: Recent lasts for this session only
  }
  return next;
}
