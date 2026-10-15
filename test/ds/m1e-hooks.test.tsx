// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import {
  __resetShortcutsForTests,
  dispatchShortcutEvent,
  formatShortcut,
  matchCombo,
  useShortcutList,
  useShortcuts,
} from '@/lib/ds/useShortcuts';
import { __resetUrlStateForTests, applyUrlPatch, parseUrlState, urlField, useUrlState, writeUrlState } from '@/lib/ds/useUrlState';

// ── next/router mock ─────────────────────────────────────────────────────────
type Q = Record<string, string | string[]>;
const router = {
  pathname: '/app/labels',
  asPath: '/app/labels',
  isReady: true,
  query: {} as Q,
  replace: vi.fn(),
  push: vi.fn(),
};
vi.mock('next/router', () => ({ useRouter: () => router }));

function setQuery(q: Q) {
  router.query = q;
  router.asPath = `/app/labels?${new URLSearchParams(Object.entries(q).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]))).toString()}`;
}

beforeEach(() => {
  __resetShortcutsForTests();
  __resetUrlStateForTests();
  router.replace.mockReset();
  router.push.mockReset();
  router.isReady = true;
  setQuery({});
});
afterEach(cleanup);

// ── useUrlState ──────────────────────────────────────────────────────────────
const ordersSchema = {
  view: urlField.enum(['to_ship', 'overdue', 'all'] as const, 'to_ship'),
  q: urlField.string(),
  store: urlField.list(),
  status: urlField.list({ values: ['to_ship', 'shipped'] as const }),
  stores: urlField.list({ format: 'comma' }),
  from: urlField.date(),
  page: urlField.int(1, { min: 1 }),
  size: urlField.int(50, { allowed: [50, 100, 250] }),
  compact: urlField.bool(),
  open: urlField.string(),
};

describe('useUrlState (pure)', () => {
  it('parses typed values and falls back to defaults on garbage', () => {
    const s = parseUrlState(ordersSchema, {
      view: 'nope',
      q: 'mug',
      store: ['etsy', 'ebay', 'etsy'],
      status: ['shipped', 'bogus'],
      stores: 'etsy,ebay',
      from: '2026-13-x',
      page: '3',
      size: '75',
      compact: '1',
    });
    expect(s).toEqual({
      view: 'to_ship',
      q: 'mug',
      store: ['etsy', 'ebay'],
      status: ['shipped'],
      stores: ['etsy', 'ebay'],
      from: undefined,
      page: 3,
      size: 50,
      compact: true,
      open: undefined,
    });
  });

  it('writes only non-defaults and preserves foreign params', () => {
    const state = parseUrlState(ordersSchema, {});
    const q = writeUrlState(ordersSchema, { utm: 'x', page: '4' }, { ...state, view: 'all', store: ['etsy', 'ebay'], stores: ['a', 'b'], compact: true });
    expect(q).toEqual({ utm: 'x', view: 'all', store: ['etsy', 'ebay'], stores: 'a,b', compact: '1' });
  });

  it('resets page when another field changes, not when page itself is set', () => {
    const prev = { ...parseUrlState(ordersSchema, {}), page: 5 };
    expect(applyUrlPatch(ordersSchema, prev, { q: 'x' }).page).toBe(1);
    expect(applyUrlPatch(ordersSchema, prev, { page: 6 }).page).toBe(6);
    expect(applyUrlPatch(ordersSchema, prev, { q: 'x', page: 2 }).page).toBe(2);
  });

  it('an explicit empty list differs from a non-empty default', () => {
    const schema = { status: urlField.list({ default: ['open'] }) };
    expect(parseUrlState(schema, { status: '' }).status).toEqual([]);
    expect(writeUrlState(schema, {}, { status: [] })).toEqual({ status: '' });
    expect(writeUrlState(schema, {}, { status: ['open'] })).toEqual({});
  });
});

describe('useUrlState (hook)', () => {
  it('reads the router query and writes shallow replaces', () => {
    setQuery({ view: 'overdue', page: '2', utm: 'mail' });
    const { result } = renderHook(() => useUrlState(ordersSchema));
    expect(result.current[0].view).toBe('overdue');
    expect(result.current[0].page).toBe(2);
    expect(result.current[2].dirtyKeys).toEqual(['view', 'page']);
    act(() => result.current[1]({ store: ['etsy'] }));
    expect(router.replace).toHaveBeenCalledWith(
      { pathname: '/app/labels', query: { view: 'overdue', utm: 'mail', store: ['etsy'] } },
      undefined,
      { shallow: true, scroll: false },
    );
  });

  it('composes two sets in the same tick', () => {
    const { result } = renderHook(() => useUrlState(ordersSchema));
    act(() => {
      result.current[1]({ q: 'a' });
      result.current[1]((prev) => ({ view: prev.q === 'a' ? 'all' : 'overdue' }));
    });
    expect(router.replace).toHaveBeenLastCalledWith({ pathname: '/app/labels', query: { q: 'a', view: 'all' } }, undefined, {
      shallow: true,
      scroll: false,
    });
  });

  it('push history and reset keep unrelated params', () => {
    setQuery({ view: 'all', q: 'x', utm: 'm' });
    const { result } = renderHook(() => useUrlState(ordersSchema, { history: 'push' }));
    act(() => result.current[2].reset({ keep: ['view'] }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/app/labels', query: { view: 'all', utm: 'm' } }, undefined, { shallow: true, scroll: false });
  });

  it('toQuery builds link queries; prefix namespaces keys', () => {
    setQuery({ 'f.status': ['shipped'] });
    const { result } = renderHook(() => useUrlState({ status: urlField.list() }, { prefix: 'f.' }));
    expect(result.current[0].status).toEqual(['shipped']);
    expect(result.current[2].toQuery({ status: ['a', 'b'] })).toEqual({ 'f.status': ['a', 'b'] });
  });

  it('runs migrate once when ready (legacy bookmarks)', () => {
    setQuery({ label: 'unlabeled' });
    const migrate = vi.fn((q: Record<string, unknown>) => (q.label === 'unlabeled' ? { view: 'to_ship' } : null));
    const { rerender } = renderHook(() => useUrlState(ordersSchema, { migrate }));
    rerender();
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/app/labels', query: { view: 'to_ship' } }, undefined, { shallow: true, scroll: false });
  });

  it('two instances (main + prefixed) compose writes in the same tick; resetsPage sends the user to page 1', () => {
    setQuery({ view: 'all', page: '3' });
    const { result } = renderHook(() => ({
      main: useUrlState(ordersSchema),
      facets: useUrlState({ material: urlField.list() }, { prefix: 'f.', resetsPage: 'page' }),
    }));
    act(() => {
      result.current.main[1]({ q: 'mug' });
      result.current.facets[1]({ material: ['wood'] });
    });
    expect(router.replace).toHaveBeenLastCalledWith(
      { pathname: '/app/labels', query: { view: 'all', q: 'mug', 'f.material': ['wood'] } },
      undefined,
      { shallow: true, scroll: false },
    );
  });

  it('a pending write is dropped once the router lands on a different URL', () => {
    const { result, rerender } = renderHook(() => useUrlState(ordersSchema));
    act(() => result.current[1]({ q: 'a' }));
    setQuery({ view: 'overdue' });
    rerender();
    act(() => result.current[1]({ store: ['etsy'] }));
    expect(router.replace).toHaveBeenLastCalledWith({ pathname: '/app/labels', query: { view: 'overdue', store: ['etsy'] } }, undefined, {
      shallow: true,
      scroll: false,
    });
  });

  it('returns defaults and ready=false before the router is ready', () => {
    router.isReady = false;
    const { result } = renderHook(() => useUrlState(ordersSchema));
    expect(result.current[2].ready).toBe(false);
    expect(result.current[0].page).toBe(1);
  });
});

// ── useShortcuts ─────────────────────────────────────────────────────────────
const kd = (init: KeyboardEventInit, target: EventTarget = document.body) => {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};

describe('matchCombo', () => {
  it('matches on key, not code, with mod = ⌘ or Ctrl', () => {
    expect(matchCombo('j', { key: 'j', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false })).toBe(true);
    expect(matchCombo('j', { key: 'j', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false })).toBe(false);
    expect(matchCombo('mod+k', { key: 'k', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false })).toBe(true);
    expect(matchCombo('mod+k', { key: 'k', metaKey: false, ctrlKey: true, shiftKey: false, altKey: false })).toBe(true);
    expect(matchCombo('mod+Enter', { key: 'Enter', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false })).toBe(true);
    // "?" needs Shift on most layouts; symbols ignore Shift.
    expect(matchCombo('?', { key: '?', metaKey: false, ctrlKey: false, shiftKey: true, altKey: false })).toBe(true);
    expect(matchCombo('x', { key: 'X', metaKey: false, ctrlKey: false, shiftKey: true, altKey: false })).toBe(false);
    expect(matchCombo('Esc', { key: 'Escape', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false })).toBe(true);
    // Turkish dotless ı on a TR-Q layout still matches "i".
    expect(matchCombo('i', { key: 'ı', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false })).toBe(true);
  });

  it('formats for the platform', () => {
    expect(formatShortcut('mod+k', 'mac')).toBe('⌘K');
    expect(formatShortcut('mod+k', 'other')).toBe('Ctrl+K');
    expect(formatShortcut('mod+Enter', 'mac')).toBe('⌘↵');
    expect(formatShortcut('g o', 'other')).toBe('G O');
  });
});

describe('useShortcuts', () => {
  it('fires page shortcuts and ignores them inside inputs, except Esc / ⌘↵ / ⌘S', () => {
    const j = vi.fn();
    const esc = vi.fn();
    const send = vi.fn();
    const save = vi.fn();
    renderHook(() => useShortcuts({ j, Escape: esc, 'mod+Enter': send, 'mod+s': save }));
    kd({ key: 'j' });
    expect(j).toHaveBeenCalledTimes(1);

    const input = document.createElement('input');
    document.body.appendChild(input);
    kd({ key: 'j' }, input);
    expect(j).toHaveBeenCalledTimes(1);
    kd({ key: 'Escape' }, input);
    kd({ key: 'Enter', metaKey: true }, input);
    const e = kd({ key: 's', ctrlKey: true }, input);
    expect(esc).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    input.remove();
  });

  it('allowInInput opts a binding in; Enter on a button is left to the button', () => {
    const slash = vi.fn();
    const enter = vi.fn();
    renderHook(() => useShortcuts({ '/': { handler: slash, allowInInput: true }, Enter: enter }));
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    kd({ key: '/' }, ta);
    expect(slash).toHaveBeenCalledTimes(1);
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    kd({ key: 'Enter' }, btn);
    expect(enter).not.toHaveBeenCalled();
    kd({ key: 'Enter' });
    expect(enter).toHaveBeenCalledTimes(1);
    ta.remove();
    btn.remove();
  });

  it('modal scope blocks lower scopes; panel wins over page; unmount restores', () => {
    const page = vi.fn();
    const panel = vi.fn();
    const modal = vi.fn();
    renderHook(() => useShortcuts({ Escape: page, j: page }, { scope: 'page' }));
    const p = renderHook(() => useShortcuts({ Escape: panel }, { scope: 'panel' }));
    kd({ key: 'Escape' });
    expect(panel).toHaveBeenCalledTimes(1);
    expect(page).not.toHaveBeenCalled();
    const m = renderHook(() => useShortcuts({ Escape: modal }, { scope: 'modal' }));
    kd({ key: 'j' });
    expect(page).not.toHaveBeenCalled();
    m.unmount();
    p.unmount();
    kd({ key: 'Escape' });
    expect(page).toHaveBeenCalledTimes(1);
  });

  it('a handler returning false passes the key on', () => {
    const lower = vi.fn();
    renderHook(() => useShortcuts({ Escape: lower }, { scope: 'page' }));
    renderHook(() => useShortcuts({ Escape: () => false }, { scope: 'panel' }));
    kd({ key: 'Escape' });
    expect(lower).toHaveBeenCalledTimes(1);
  });

  it('supports "g o" sequences and disabled hooks', () => {
    const go = vi.fn();
    const off = vi.fn();
    renderHook(() => useShortcuts({ 'g o': go }));
    renderHook(() => useShortcuts({ x: off }, { enabled: false }));
    kd({ key: 'g' });
    kd({ key: 'o' });
    expect(go).toHaveBeenCalledTimes(1);
    kd({ key: 'o' });
    expect(go).toHaveBeenCalledTimes(1);
    kd({ key: 'x' });
    expect(off).not.toHaveBeenCalled();
  });

  it('uses the latest handler without re-registering', () => {
    const a = vi.fn();
    const b = vi.fn();
    const { rerender } = renderHook(({ h }) => useShortcuts({ k: h }), { initialProps: { h: a } });
    rerender({ h: b });
    kd({ key: 'k' });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('publishes described bindings for the "?" sheet', () => {
    function Sheet() {
      const list = useShortcutList();
      return <ul>{list.map((s) => <li key={s.combo}>{`${s.combo}:${s.description}`}</li>)}</ul>;
    }
    function Page() {
      useShortcuts({ j: { handler: () => undefined, description: 'Next row' }, k: () => undefined }, { describe: true });
      return null;
    }
    render(
      <>
        <Page />
        <Sheet />
      </>,
    );
    expect(screen.getAllByRole('listitem').map((l) => l.textContent)).toEqual(['j:Next row']);
  });

  it('dispatchShortcutEvent ignores IME composition', () => {
    const j = vi.fn();
    renderHook(() => useShortcuts({ j }));
    const e = new KeyboardEvent('keydown', { key: 'j', isComposing: true });
    expect(dispatchShortcutEvent(e)).toBe(false);
    expect(j).not.toHaveBeenCalled();
  });

  it('SearchField-style stopPropagation keeps Esc local', () => {
    const esc = vi.fn();
    renderHook(() => useShortcuts({ Escape: esc }));
    function Field() {
      return <input data-testid="f" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), e.preventDefault())} />;
    }
    render(<Field />);
    fireEvent.keyDown(screen.getByTestId('f'), { key: 'Escape' });
    expect(esc).not.toHaveBeenCalled();
  });
});
