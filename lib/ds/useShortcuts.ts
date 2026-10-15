// DS §1 P3 / §4.1: `useShortcuts(map, { scope })`, key-based and input-aware.
//
// - Matches on `KeyboardEvent.key` (never `code`), so it works on Turkish Q and F layouts.
// - Never fires while focus is in an input/textarea/select/contenteditable, except `Escape`,
//   `mod+Enter` and `mod+s` (or any binding with `allowInInput: true`).
// - `mod` = ⌘ on macOS, Ctrl elsewhere (either modifier is accepted).
// - Sequences: "g o" (second key within 1s).
// - Scopes stack: modal > panel > page > global. A `modal` registration blocks every lower scope;
//   within a scope the most recent registration wins.
// - `describe: true` publishes the bindings (with descriptions) for the `?` shortcut sheet
//   (`useShortcutList()`).
// Handlers are read through a ref, so passing a new map object on every render is fine.
import { useEffect, useId, useRef, useSyncExternalStore } from 'react';

export type ShortcutScope = 'global' | 'page' | 'panel' | 'modal';

export type ShortcutHandler = (event: KeyboardEvent) => void | boolean;

export type ShortcutBinding =
  | ShortcutHandler
  | {
      handler: ShortcutHandler;
      /** Translated label for the shortcut sheet. */
      description?: string;
      /** Fire even when focus is in a text field. */
      allowInInput?: boolean;
      enabled?: boolean;
      /** Default true. */
      preventDefault?: boolean;
    };

export type ShortcutMap = Record<string, ShortcutBinding | undefined | null | false>;

export type UseShortcutsOptions = {
  scope?: ShortcutScope;
  enabled?: boolean;
  /** Publish described bindings for the shortcut sheet. */
  describe?: boolean;
};

export type DescribedShortcut = { combo: string; description: string; scope: ShortcutScope };

type ParsedCombo = { key: string; mod: boolean; shift: boolean; alt: boolean };
type Registration = {
  id: string;
  order: number;
  scope: ShortcutScope;
  describe: boolean;
  mapRef: { current: ShortcutMap };
  enabledRef: { current: boolean };
};

const SCOPE_RANK: Record<ShortcutScope, number> = { global: 0, page: 1, panel: 2, modal: 3 };
const ALWAYS_IN_INPUT = new Set(['escape', 'mod+enter', 'mod+s']);
const SEQUENCE_TIMEOUT = 1000;

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  space: ' ',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  del: 'delete',
};

export function parseCombo(combo: string): ParsedCombo {
  const parts = combo === '+' ? ['+'] : combo.split('+').filter(Boolean);
  const out: ParsedCombo = { key: '', mod: false, shift: false, alt: false };
  for (const raw of parts) {
    const p = raw.toLowerCase();
    if (p === 'mod' || p === 'cmd' || p === 'meta' || p === 'ctrl') out.mod = true;
    else if (p === 'shift') out.shift = true;
    else if (p === 'alt' || p === 'option') out.alt = true;
    else out.key = KEY_ALIASES[p] ?? p;
  }
  return out;
}

function normalizedKey(e: Pick<KeyboardEvent, 'key'>): string {
  const k = e.key ?? '';
  // Turkish dotted/dotless i both map to their Latin forms for matching.
  const lower = k.length === 1 ? k.toLocaleLowerCase('en-US') : k.toLowerCase();
  return lower === 'ı' ? 'i' : lower;
}

/** Pure matcher for one step of a combo (exported for tests). */
export function matchCombo(combo: string, e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>): boolean {
  const c = parseCombo(combo);
  const key = normalizedKey(e);
  if (key !== c.key) return false;
  const mod = Boolean(e.metaKey || e.ctrlKey);
  if (mod !== c.mod) return false;
  if (Boolean(e.altKey) !== c.alt) return false;
  // Shift only matters for letters and named keys; for symbols ("?", "/") it is part of the layout.
  const isSymbol = c.key.length === 1 && !/[a-z0-9]/.test(c.key);
  if (!isSymbol && Boolean(e.shiftKey) !== c.shift) return false;
  return true;
}

function isTextInput(el: EventTarget | null): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== 'string') return false;
  const node = el as HTMLElement;
  const tag = node.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = ((node as HTMLInputElement).type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
  }
  return node.isContentEditable || node.getAttribute?.('contenteditable') === 'true';
}

function isActivatable(el: EventTarget | null): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== 'string') return false;
  const node = el as HTMLElement;
  const tag = node.tagName.toLowerCase();
  if (tag === 'button' || tag === 'a' || tag === 'summary') return true;
  const role = node.getAttribute?.('role');
  return role === 'button' || role === 'menuitem' || role === 'option' || role === 'link' || role === 'checkbox' || role === 'tab';
}

// ── global registry ─────────────────────────────────────────────────────────
const registry = new Map<string, Registration>();
const listeners = new Set<() => void>();
let counter = 0;
let pending: { first: string; at: number } | null = null;
let attached = false;
let snapshot: DescribedShortcut[] = [];

function emit() {
  snapshot = computeDescribed();
  listeners.forEach((l) => l());
}

function computeDescribed(): DescribedShortcut[] {
  const out: DescribedShortcut[] = [];
  for (const r of [...registry.values()].sort((a, b) => a.order - b.order)) {
    if (!r.describe || !r.enabledRef.current) continue;
    for (const [combo, b] of Object.entries(r.mapRef.current)) {
      if (!b || typeof b === 'function' || !b.description || b.enabled === false) continue;
      out.push({ combo, description: b.description, scope: r.scope });
    }
  }
  return out;
}

function orderedRegistrations(): Registration[] {
  const regs = [...registry.values()].filter((r) => r.enabledRef.current);
  regs.sort((a, b) => SCOPE_RANK[b.scope] - SCOPE_RANK[a.scope] || b.order - a.order);
  const top = regs[0];
  if (top && top.scope === 'modal') return regs.filter((r) => r.scope === 'modal');
  return regs;
}

function normalizeBinding(b: ShortcutBinding) {
  return typeof b === 'function' ? { handler: b, allowInInput: false, enabled: true, preventDefault: true } : { allowInInput: false, enabled: true, preventDefault: true, ...b };
}

/** Dispatch one keydown through the registry. Exported for tests; the hook attaches it to `window`. */
export function dispatchShortcutEvent(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.isComposing || (e as KeyboardEvent & { keyCode?: number }).keyCode === 229) return false;
  if (['shift', 'control', 'meta', 'alt'].includes((e.key ?? '').toLowerCase())) return false;
  const inText = isTextInput(e.target);
  const onActivatable = isActivatable(e.target);
  const now = Date.now();
  const seq = pending && now - pending.at < SEQUENCE_TIMEOUT ? pending : null;
  pending = null;

  let startedSequence: string | null = null;
  for (const reg of orderedRegistrations()) {
    for (const [combo, raw] of Object.entries(reg.mapRef.current)) {
      if (!raw) continue;
      const b = normalizeBinding(raw);
      if (!b.enabled) continue;
      const steps = combo.trim().split(/\s+/);
      let matched = false;
      if (steps.length === 2) {
        if (seq && seq.first === steps[0] && matchCombo(steps[1], e)) matched = true;
        else if (!seq && matchCombo(steps[0], e) && !inText) startedSequence = startedSequence ?? steps[0];
      } else if (matchCombo(steps[0], e)) {
        matched = true;
      }
      if (!matched) continue;
      const lc = steps[steps.length - 1].toLowerCase();
      const alwaysInInput = ALWAYS_IN_INPUT.has(KEY_ALIASES[lc] ?? lc) || ALWAYS_IN_INPUT.has(lc.replace(/^(cmd|ctrl|meta)\+/, 'mod+'));
      if (inText && !b.allowInInput && !alwaysInInput) continue;
      const parsed = parseCombo(steps[steps.length - 1]);
      if (onActivatable && !parsed.mod && (parsed.key === 'enter' || parsed.key === ' ')) continue;
      const result = b.handler(e);
      if (result === false) continue;
      if (b.preventDefault) e.preventDefault();
      return true;
    }
  }
  if (startedSequence) pending = { first: startedSequence, at: now };
  return false;
}

function onKeyDown(e: KeyboardEvent) {
  dispatchShortcutEvent(e);
}

function attach() {
  if (attached || typeof window === 'undefined') return;
  window.addEventListener('keydown', onKeyDown);
  attached = true;
}

function detachIfIdle() {
  if (!attached || registry.size > 0 || typeof window === 'undefined') return;
  window.removeEventListener('keydown', onKeyDown);
  attached = false;
}

/** Test helper: clear every registration and pending sequence. */
export function __resetShortcutsForTests() {
  registry.clear();
  pending = null;
  emit();
  detachIfIdle();
}

export function useShortcuts(map: ShortcutMap, options: UseShortcutsOptions = {}): void {
  const { scope = 'page', enabled = true, describe = false } = options;
  const id = useId();
  const mapRef = useRef(map);
  mapRef.current = map;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // Re-publish the sheet only when the described keys change (not on every render).
  const describeKey = describe
    ? Object.entries(map)
        .map(([k, b]) => (b && typeof b !== 'function' && b.description && b.enabled !== false ? `${k}=${b.description}` : ''))
        .join('|')
    : '';

  useEffect(() => {
    const reg: Registration = { id, order: ++counter, scope, describe, mapRef, enabledRef };
    registry.set(id, reg);
    attach();
    emit();
    return () => {
      registry.delete(id);
      emit();
      detachIfIdle();
    };
  }, [id, scope, describe]);

  useEffect(() => {
    if (describe) emit();
  }, [describe, describeKey, enabled]);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const getSnapshot = () => snapshot;
const getServerSnapshot = (): DescribedShortcut[] => [];

/** Described shortcuts of every mounted `useShortcuts(…, { describe: true })`, for the `?` sheet. */
export function useShortcutList(): DescribedShortcut[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** "mod+k" → "⌘K" on macOS, "Ctrl+K" elsewhere; "g o" → "G then O" is left to the sheet. */
export function formatShortcut(combo: string, platform: 'mac' | 'other' = detectPlatform()): string {
  return combo
    .trim()
    .split(/\s+/)
    .map((step) => {
      const c = parseCombo(step);
      const keyLabel: Record<string, string> = {
        escape: 'Esc',
        enter: '↵',
        arrowup: '↑',
        arrowdown: '↓',
        arrowleft: '←',
        arrowright: '→',
        ' ': 'Space',
      };
      const key = keyLabel[c.key] ?? (c.key.length === 1 ? c.key.toLocaleUpperCase('en-US') : c.key);
      if (platform === 'mac') return `${c.mod ? '⌘' : ''}${c.alt ? '⌥' : ''}${c.shift ? '⇧' : ''}${key}`;
      return [c.mod ? 'Ctrl' : '', c.alt ? 'Alt' : '', c.shift ? 'Shift' : '', key].filter(Boolean).join('+');
    })
    .join(' ');
}

function detectPlatform(): 'mac' | 'other' {
  if (typeof navigator === 'undefined') return 'other';
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent) ? 'mac' : 'other';
}
