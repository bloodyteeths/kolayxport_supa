// @vitest-environment jsdom
// messages G3 — SavedRepliesPicker / SaveReplyModal / SavedRepliesPanel with a fake fetch: platform filter,
// variable filling on insert + usage bump, save current text, one-time legacy import, the BR-4 guard
// (local read-only mode), panel create + delete with confirmation, TR wording.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { toastController } from '@/components/ds/feedback/toast';
import { __resetShortcutsForTests } from '@/lib/ds/useShortcuts';
import type { SavedReply } from '@/lib/messages/savedReplies';
import { G3_EN, G3_TR } from './g3-messages';

vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

import { SavedRepliesPicker } from '@/components/domain/messages/SavedRepliesPicker';
import { SavedRepliesPanel } from '@/components/domain/messages/SavedRepliesPanel';
import { __resetSavedRepliesImportForTests } from '@/lib/hooks/useSavedReplies';

type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}
const MESSAGES = { en: deepMerge(en as Obj, G3_EN as Obj), tr: deepMerge(tr as Obj, G3_TR as Obj) };

const iso = '2026-10-15T10:00:00.000Z';
const reply = (over: Partial<SavedReply>): SavedReply => ({
  id: 'a', title: 'Shipping time', body: 'Hi {customer}, order {order} ships in 1–3 days.', platform: null, usageCount: 41, createdAt: iso, updatedAt: iso, ...over,
});

let server: { replies: SavedReply[]; notReady: boolean };
const calls: { method: string; url: string; body: unknown }[] = [];

function jsonRes(status: number, body?: unknown) {
  return Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

beforeEach(() => {
  server = {
    replies: [
      reply({}),
      reply({ id: 'b', title: 'Size question', body: 'Our {product} is 25×18×10 cm.', platform: 'trendyol', usageCount: 7 }),
      reply({ id: 'c', title: 'Thank you', body: 'Thanks!', platform: 'wix', usageCount: 0 }),
    ],
    notReady: false,
  };
  calls.length = 0;
  __resetSavedRepliesImportForTests();
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    if (server.notReady) return jsonRes(503, { code: 'notReady' });
    const u = new URL(url, 'http://x');
    const action = u.searchParams.get('action');
    const id = u.searchParams.get('id');
    if (method === 'GET') return jsonRes(200, { replies: server.replies, limit: 50 });
    if (method === 'POST' && action === 'used') return jsonRes(204);
    if (method === 'POST' && action === 'import') {
      server.replies = (body.items as string[]).map((s, i) => reply({ id: `i${i}`, title: s.slice(0, 40), body: s, usageCount: 0 }));
      return jsonRes(200, { replies: server.replies, imported: server.replies.length, limit: 50 });
    }
    if (method === 'POST') {
      if (server.replies.some((r) => r.title.toLowerCase() === String(body.title).toLowerCase())) return jsonRes(409, { code: 'duplicate', field: 'title' });
      const created = reply({ id: `n${server.replies.length}`, ...body, usageCount: 0 });
      server.replies = [...server.replies, created];
      return jsonRes(201, { reply: created });
    }
    if (method === 'DELETE') {
      server.replies = server.replies.filter((r) => r.id !== id);
      return jsonRes(204);
    }
    return jsonRes(405, {});
  }));
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  toastController.dismiss();
  __resetShortcutsForTests();
});

function wrap(ui: React.ReactElement, locale: 'en' | 'tr' = 'en') {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Istanbul">
        <ThemeProvider theme={theme}>{ui}</ThemeProvider>
      </NextIntlClientProvider>
    </SWRConfig>,
  );
}

const ctx = { customerName: 'Mehmet Yılmaz', productTitle: 'Wooden box', orderNumber: '10482' };

describe('SavedRepliesPicker', () => {
  it('lists all-store + this platform replies and inserts filled text, bumping usage', async () => {
    const onInsert = vi.fn();
    wrap(<SavedRepliesPicker platform="wix" context={ctx} onInsert={onInsert} currentText="" />);
    fireEvent.click(screen.getByTestId('saved-replies-button'));
    await screen.findByTestId('saved-reply-option-a');
    expect(screen.getByTestId('saved-reply-option-c')).toBeTruthy();
    expect(screen.queryByTestId('saved-reply-option-b')).toBeNull(); // Trendyol-only reply hidden on Wix
    expect(screen.getByText('Used 41 times')).toBeTruthy();
    // no composer text → no "Save current text"
    expect(screen.queryByTestId('saved-replies-save-current')).toBeNull();
    fireEvent.click(screen.getByTestId('saved-reply-option-a'));
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert.mock.calls[0][0]).toBe('Hi Mehmet, order #10482 ships in 1–3 days.');
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.includes('action=used') && c.url.includes('id=a'))).toBe(true));
  });

  it('leaves unknown variables as tokens and reports them', async () => {
    const onInsert = vi.fn();
    wrap(<SavedRepliesPicker platform="trendyol" context={{ customerName: 'Ayşe' }} onInsert={onInsert} currentText="" />);
    fireEvent.click(screen.getByTestId('saved-replies-button'));
    fireEvent.click(await screen.findByTestId('saved-reply-option-b'));
    expect(onInsert.mock.calls[0][0]).toBe('Our {product} is 25×18×10 cm.');
    expect(onInsert.mock.calls[0][1].unfilled).toEqual(['product']);
  });

  it('saves the current composer text through the modal', async () => {
    wrap(<SavedRepliesPicker platform="wix" context={ctx} onInsert={vi.fn()} currentText="Merhaba {customer}!" />);
    fireEvent.click(screen.getByTestId('saved-replies-button'));
    fireEvent.click(await screen.findByTestId('saved-replies-save-current'));
    const title = (await screen.findByTestId('save-reply-title')).querySelector('input')!;
    expect((screen.getByTestId('save-reply-body').querySelector('textarea') as HTMLTextAreaElement).value).toBe('Merhaba {customer}!');
    // empty name → inline error, no request
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Give this reply a name')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST' && !c.url.includes('action='))).toBe(false);
    // duplicate name → server 409 shown on the field
    fireEvent.change(title, { target: { value: 'shipping time' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('A saved reply with this name already exists')).toBeTruthy();
    fireEvent.change(title, { target: { value: 'Greeting' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(server.replies.some((r) => r.title === 'Greeting' && r.body === 'Merhaba {customer}!' && r.platform === null)).toBe(true));
    await waitFor(() => expect(screen.queryByTestId('save-reply-title')).toBeNull());
  });

  it('imports the legacy browser list once, keeps the key for the legacy page and marks it imported', async () => {
    server.replies = [];
    window.localStorage.setItem('kx.messages.savedReplies.u1', JSON.stringify(['Kargonuz yolda.', 'Teşekkürler!']));
    const enqueue = vi.spyOn(toastController, 'enqueue');
    wrap(<SavedRepliesPicker platform="wix" context={ctx} onInsert={vi.fn()} currentText="" />);
    fireEvent.click(screen.getByTestId('saved-replies-button'));
    await screen.findByTestId('saved-reply-option-i0');
    expect(calls.filter((c) => c.url.includes('action=import'))).toHaveLength(1);
    expect(calls.find((c) => c.url.includes('action=import'))!.body).toEqual({ items: ['Kargonuz yolda.', 'Teşekkürler!'] });
    // The legacy Messages page (still the default) reads this key, so it stays; the marker stops re-imports.
    expect(window.localStorage.getItem('kx.messages.savedReplies.u1')).not.toBeNull();
    expect(window.localStorage.getItem('kx.messages.savedReplies.imported.u1')).toBe('1');
    await waitFor(() => expect(enqueue.mock.calls.map((c) => c[0].message)).toContain('2 saved replies moved to your account'));
    enqueue.mockRestore();
  });

  it('never re-imports once marked, even when the server list is empty', async () => {
    server.replies = [];
    window.localStorage.setItem('kx.messages.savedReplies.u1', JSON.stringify(['Kargonuz yolda.']));
    window.localStorage.setItem('kx.messages.savedReplies.imported.u1', '1');
    wrap(<SavedRepliesPicker platform="wix" context={ctx} onInsert={vi.fn()} currentText="" />);
    fireEvent.click(screen.getByTestId('saved-replies-button'));
    await screen.findByTestId('saved-replies-empty');
    expect(calls.some((c) => c.url.includes('action=import'))).toBe(false);
  });

  it('keyboard: Enter in search inserts the top match; ArrowDown moves into the options', async () => {
    const onInsert = vi.fn();
    wrap(<SavedRepliesPicker platform="wix" context={ctx} onInsert={onInsert} currentText="" />);
    fireEvent.click(screen.getByTestId('saved-replies-button'));
    await screen.findByTestId('saved-reply-option-a');
    const input = screen.getByTestId('search-field-input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('saved-reply-option-a'));
    fireEvent.change(input, { target: { value: 'thank' } });
    await waitFor(() => expect(screen.queryByTestId('saved-reply-option-a')).toBeNull());
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert.mock.calls[0][2].id).toBe('c');
  });

  it('BR-4 not deployed: shows the legacy list read-only and disables saving', async () => {
    server.notReady = true;
    window.localStorage.setItem('kx.messages.savedReplies.u1', JSON.stringify(['Eski yanıt']));
    const onInsert = vi.fn();
    wrap(<SavedRepliesPicker platform="wix" context={ctx} onInsert={onInsert} currentText="draft text" />);
    fireEvent.click(screen.getByTestId('saved-replies-button'));
    fireEvent.click(await screen.findByTestId('saved-reply-option-local:0'));
    expect(onInsert.mock.calls[0][0]).toBe('Eski yanıt');
    // no usage call and no import attempt in local mode
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect(window.localStorage.getItem('kx.messages.savedReplies.u1')).not.toBeNull();
    fireEvent.click(screen.getByTestId('saved-replies-button'));
    const save = await screen.findByTestId('saved-replies-save-current');
    expect(save.hasAttribute('disabled') || save.getAttribute('aria-disabled') === 'true' || !!save.querySelector('[disabled]')).toBe(true);
  });

  it('TR wording', async () => {
    wrap(<SavedRepliesPicker platform="wix" context={ctx} onInsert={vi.fn()} currentText="x" />, 'tr');
    expect(screen.getByText('Hazır yanıtlar')).toBeTruthy();
    fireEvent.click(screen.getByTestId('saved-replies-button'));
    expect(await screen.findByText('41 kez kullanıldı')).toBeTruthy();
    expect(screen.getByText('Bu metni hazır yanıt olarak kaydet')).toBeTruthy();
    expect(screen.getByText('Hazır yanıtları yönet')).toBeTruthy();
  });
});

describe('SavedRepliesPanel', () => {
  it('creates a new reply with a variable chip, then deletes it after confirmation', async () => {
    wrap(<SavedRepliesPanel open onClose={vi.fn()} />);
    await screen.findByTestId('saved-reply-row-a');
    fireEvent.click(screen.getByTestId('saved-replies-new'));
    const title = (await screen.findByTestId('saved-reply-edit-title')).querySelector('input')!;
    const body = screen.getByTestId('saved-reply-edit-body').querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(title, { target: { value: 'Delay' } });
    fireEvent.change(body, { target: { value: 'Sorry ' } });
    fireEvent.blur(body);
    fireEvent.click(screen.getByTestId('saved-reply-edit-var-customer'));
    expect(body.value).toBe('Sorry {customer}');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    await waitFor(() => expect(server.replies.some((r) => r.title === 'Delay' && r.body === 'Sorry {customer}')).toBe(true));
    const created = server.replies.find((r) => r.title === 'Delay')!;
    await screen.findByTestId(`saved-reply-row-${created.id}`);
    expect(screen.getByText('Edit: Delay')).toBeTruthy();

    // footer ⋯ → Delete saved reply… → confirm
    const more = screen.getAllByRole('button', { name: 'More actions' });
    fireEvent.click(more[more.length - 1]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete saved reply…' }));
    expect(await screen.findByText('Delete saved reply "Delay"?')).toBeTruthy();
    expect(server.replies.some((r) => r.id === created.id)).toBe(true); // nothing deleted before confirming
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(server.replies.some((r) => r.id === created.id)).toBe(false));
    await waitFor(() => expect(screen.queryByTestId(`saved-reply-row-${created.id}`)).toBeNull());
  });

  it('own store (page-level panel) runs the legacy import with the toast; a second instance does not import again', async () => {
    server.replies = [];
    window.localStorage.setItem('kx.messages.savedReplies.u1', JSON.stringify(['Kargonuz yolda.', 'Teşekkürler!']));
    const enqueue = vi.spyOn(toastController, 'enqueue');
    wrap(
      <>
        <SavedRepliesPanel open onClose={vi.fn()} />
        <SavedRepliesPicker platform="wix" context={ctx} onInsert={vi.fn()} currentText="" />
      </>,
    );
    fireEvent.click(screen.getByTestId('saved-replies-button'));
    await screen.findByTestId('saved-reply-row-i0');
    await waitFor(() => expect(enqueue.mock.calls.map((c) => c[0].message)).toContain('2 saved replies moved to your account'));
    expect(calls.filter((c) => c.url.includes('action=import'))).toHaveLength(1);
    expect(enqueue.mock.calls.filter((c) => c[0].message === '2 saved replies moved to your account')).toHaveLength(1);
    enqueue.mockRestore();
  });

  it('initialId before the list loads: fills the form once the reply arrives, not dirty', async () => {
    wrap(<SavedRepliesPanel open onClose={vi.fn()} initialId="b" />);
    const title = (await screen.findByTestId('saved-reply-edit-title')).querySelector('input')!;
    await waitFor(() => expect(title.value).toBe('Size question'));
    expect((screen.getByTestId('saved-reply-edit-body').querySelector('textarea') as HTMLTextAreaElement).value).toBe('Our {product} is 25×18×10 cm.');
  });

  it('local mode shows the not-ready banner and no edit controls', async () => {
    server.notReady = true;
    window.localStorage.setItem('kx.messages.savedReplies.u1', JSON.stringify(['Eski yanıt']));
    wrap(<SavedRepliesPanel open onClose={vi.fn()} />);
    expect(await screen.findByTestId('saved-replies-not-ready')).toBeTruthy();
    expect(screen.getByTestId('saved-reply-row-local:0')).toBeTruthy();
    expect(screen.queryByTestId('saved-replies-new')).toBeNull();
  });
});
