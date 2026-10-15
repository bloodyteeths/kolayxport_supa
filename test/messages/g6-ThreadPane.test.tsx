// @vitest-environment jsdom
// messages G6 — ThreadPane / Composer / ContextRail with a fake fetch, against G1's fixtures:
// Wix history + send (⌘/Ctrl+Enter only, Enter is a newline), markSeen on open, Trendyol min length,
// alreadyAnswered from a second tab, in-review / answered / rejected composer regions, AI draft
// (fill, missing caption, replace confirm, failure inline), rail orders (502 → inline error, never "no
// orders"), product not in catalog, unsent text survives switching threads, EN/TR without missing keys.
import * as React from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider, type IntlError } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { FormatProvider } from '@/lib/format';
import { __resetShortcutsForTests } from '@/lib/ds/useShortcuts';
import type { UnifiedConversation } from '@/types/messages';
import listFixture from '../fixtures/messages/list.json';
import threadWix from '../fixtures/messages/thread-wix.json';
import orderContext from '../fixtures/messages/order-context.json';
import productContext from '../fixtures/messages/product-context.json';
import { G3_EN, G3_TR } from './g3-messages';
import { G6_EN, G6_TR } from './g6-messages';
import { WIX_REPLY_MAX } from '@/lib/messages/limits';
import { ConfirmProvider } from '@/components/ds/overlay/ConfirmDialog';

// Fetch-driven assertions: a loaded CI box can exceed the 1s default (seen once in review).
configure({ asyncUtilTimeout: 5000 });

vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
const router = { pathname: '/app/mesajlar', asPath: '/app/mesajlar', query: {}, events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() }, beforePopState: vi.fn(), push: vi.fn() };
vi.mock('next/router', () => ({ useRouter: () => router }));

import { ThreadPane, ThreadSheet } from '@/components/domain/messages/ThreadPane';
import { ContextRail } from '@/components/domain/messages/ContextRail';
import { useUnsentReplyGuard } from '@/components/domain/messages/useThread';

/** The most recent `router.beforePopState` callback (the guard registers one on mount). */
function popGuard(): (state: { as?: string }) => boolean {
  const calls = router.beforePopState.mock.calls;
  return calls[calls.length - 1][0] as (state: { as?: string }) => boolean;
}

/** Holds `/api/messages/draft-reply` until `release()` (the field stays editable meanwhile). */
function gateDraftFetch(): () => void {
  const base = globalThis.fetch;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    if (String(input) === '/api/messages/draft-reply') await gate;
    return base(input, init);
  }));
  return release;
}

type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}
const MESSAGES = {
  en: deepMerge(deepMerge(en as Obj, G3_EN as Obj), G6_EN as Obj),
  tr: deepMerge(deepMerge(tr as Obj, G3_TR as Obj), G6_TR as Obj),
};
const intlErrors: string[] = [];

const NOW = new Date('2026-10-15T10:00:00.000Z');
const convs = (listFixture as { conversations: UnifiedConversation[] }).conversations;
const wixConv = convs.find((c) => c.platform === 'wix')!;
const tyWaiting = convs.find((c) => c.platformStatus === 'WAITING_FOR_ANSWER')!;
const tyRejected = convs.find((c) => c.platformStatus === 'REJECTED')!;
const tyInReview = convs.find((c) => c.platformStatus === 'WAITING_FOR_APPROVE')!;

type Handler = (method: string, url: URL, body: any) => { status: number; body?: unknown } | undefined;
let handler: Handler;
const calls: { method: string; url: string; body: any }[] = [];

function defaultHandler(method: string, url: URL): { status: number; body?: unknown } {
  const action = url.searchParams.get('action');
  if (url.pathname === '/api/messages/saved-replies') return { status: 200, body: { replies: [], limit: 50 } };
  if (action === 'thread') return { status: 200, body: threadWix };
  if (action === 'orderContext') return { status: 200, body: orderContext };
  if (action === 'productContext') {
    const id = url.searchParams.get('productMainId');
    return { status: 200, body: id === 'PMI-77' ? productContext.inCatalog : productContext.notInCatalog };
  }
  if (action === 'markSeen') return { status: 204 };
  if (action === 'reply') return { status: 200, body: { ok: true } };
  return { status: 404, body: { code: 'notFound' } };
}

beforeEach(() => {
  intlErrors.length = 0;
  calls.length = 0;
  handler = () => undefined;
  try { window.sessionStorage.clear(); window.localStorage.clear(); } catch { /* ignore */ }
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url: input, body });
    const url = new URL(input, 'http://x');
    const r = handler(method, url, body) ?? defaultHandler(method, url);
    return Promise.resolve(new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } }));
  }));
});

afterEach(() => {
  cleanup();
  __resetShortcutsForTests();
  vi.unstubAllGlobals();
});

function Providers({ locale = 'en', children }: { locale?: 'en' | 'tr'; children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale] as never} timeZone="Europe/Istanbul" onError={(e: IntlError) => intlErrors.push(`${e.code}: ${e.message}`)}>
      <FormatProvider timeZone="Europe/Istanbul">
        <ThemeProvider theme={theme}>
          <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
            <ConfirmProvider>{children}</ConfirmProvider>
          </SWRConfig>
        </ThemeProvider>
      </FormatProvider>
    </NextIntlClientProvider>
  );
}

function renderPane(props: Partial<React.ComponentProps<typeof ThreadPane>> & { conversation: UnifiedConversation }, locale: 'en' | 'tr' = 'en') {
  return render(<Providers locale={locale}><ThreadPane now={NOW} {...props} /></Providers>);
}

const input = () => screen.getByTestId('composer-input').querySelector('textarea') as HTMLTextAreaElement;
const replyCalls = () => calls.filter((c) => c.url.includes('action=reply'));

describe('Wix thread', () => {
  it('loads the history oldest first, marks it seen on open, and sends only with mod+Enter', async () => {
    const onSent = vi.fn();
    const onSeen = vi.fn();
    renderPane({ conversation: wixConv, onSent, onSeen });
    await waitFor(() => expect(screen.getAllByTestId('message-bubble')).toHaveLength(3));
    const bubbles = screen.getAllByTestId('message-bubble');
    expect(bubbles[0]).toHaveTextContent('Hello, I ordered the keepsake box.');
    expect(bubbles[1].getAttribute('data-sender')).toBe('seller');
    expect(onSeen).toHaveBeenCalledWith(expect.objectContaining({ id: 'c-wix-1' }));
    expect(calls.find((c) => c.url.includes('action=markSeen'))?.body).toEqual({ platform: 'wix', id: 'c-wix-1', seen: true });
    expect(screen.getByText('Send reply')).toBeInTheDocument();
    expect(input().placeholder).toBe('Write a reply to Mehmet');

    fireEvent.change(input(), { target: { value: 'It ships tomorrow.' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(replyCalls()).toHaveLength(0);

    await act(async () => {
      fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true });
    });
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(replyCalls()[0].body).toEqual({ platform: 'wix', conversationId: 'c-wix-1', text: 'It ships tomorrow.' });
    expect(onSent.mock.calls[0][0]).toMatchObject({ id: 'c-wix-1' });
    expect(onSent.mock.calls[0][1]).toMatchObject({ text: 'It ships tomorrow.' });
    expect(input().value).toBe('');
    await waitFor(() => expect(screen.getAllByTestId('message-bubble')).toHaveLength(4));
    expect(window.sessionStorage.getItem('kx.msg.draft.wix:c-wix-1')).toBeNull();
    expect(intlErrors).toEqual([]);
  });

  it('keeps the text and shows the mapped cause inline when Wix refuses (no toast)', async () => {
    handler = (m, url) => (url.searchParams.get('action') === 'reply' ? { status: 401, body: { code: 'auth', error: 'raw upstream text' } } : undefined);
    renderPane({ conversation: wixConv });
    fireEvent.change(input(), { target: { value: 'Hello' } });
    await act(async () => { fireEvent.click(screen.getByTestId('composer-send')); });
    await waitFor(() => expect(screen.getByText('Wix connection expired. Your text is kept.')).toBeInTheDocument());
    expect(input().value).toBe('Hello');
    expect(screen.getByTestId('composer-reconnect')).toHaveAttribute('href', '/ayarlar?tab=connections');
    expect(screen.queryByText('raw upstream text')).toBeNull();
  });

  it('shows an inline error with retry when the thread fails, and the composer stays', async () => {
    handler = (m, url) => (url.searchParams.get('action') === 'thread' ? { status: 502, body: { code: 'unavailable' } } : undefined);
    renderPane({ conversation: wixConv });
    await waitFor(() => expect(screen.getByTestId('thread-error')).toBeInTheDocument());
    expect(screen.getByText("Couldn't load this conversation")).toBeInTheDocument();
    expect(screen.getByTestId('composer-send')).toBeInTheDocument();
  });

  it('blocks send while a saved-reply token is unfilled', async () => {
    renderPane({ conversation: wixConv });
    fireEvent.change(input(), { target: { value: 'Hi, order {order} ships soon' } });
    await act(async () => { fireEvent.click(screen.getByTestId('composer-send')); });
    expect(screen.getByText('Replace {order} before sending')).toBeInTheDocument();
    expect(replyCalls()).toHaveLength(0);
  });
});

describe('Trendyol thread', () => {
  it('renders the question from the list payload (no thread call), with the public note and counter', async () => {
    renderPane({ conversation: tyWaiting });
    expect(screen.getAllByTestId('message-bubble')).toHaveLength(1);
    expect(calls.some((c) => c.url.includes('action=thread'))).toBe(false);
    expect(screen.getByTestId('composer-public-note')).toHaveTextContent('You can answer once.');
    expect(screen.getByText('Send answer')).toBeInTheDocument();
    expect(screen.getByText(/^0 \/ 2,000$/)).toBeInTheDocument();
  });

  it('Wix length errors say "Replies", not "Answers"', async () => {
    renderPane({ conversation: wixConv });
    fireEvent.change(input(), { target: { value: 'x'.repeat(WIX_REPLY_MAX + 1) } });
    await act(async () => { fireEvent.click(screen.getByTestId('composer-send')); });
    expect(screen.getByText(/^Replies can have at most [\d,.]+ characters$/)).toBeInTheDocument();
    expect(replyCalls()).toHaveLength(0);
  });

  it('enforces the maximum length client-side', async () => {
    renderPane({ conversation: tyWaiting });
    fireEvent.change(input(), { target: { value: 'x'.repeat(2001) } });
    await act(async () => { fireEvent.click(screen.getByTestId('composer-send')); });
    expect(screen.getByText(/^Answers can have at most 2,?000 characters$/)).toBeInTheDocument();
    expect(replyCalls()).toHaveLength(0);
  });

  it('a second tab answering first shows "already has an answer" and keeps the text', async () => {
    handler = (m, url) => (url.searchParams.get('action') === 'reply' ? { status: 409, body: { code: 'alreadyAnswered' } } : undefined);
    renderPane({ conversation: tyWaiting });
    fireEvent.change(input(), { target: { value: 'İç ölçüler 24×17×9 cm.' } });
    await act(async () => { fireEvent.click(screen.getByTestId('composer-send')); });
    await waitFor(() => expect(screen.getByText('This question already has an answer on Trendyol')).toBeInTheDocument());
    expect(replyCalls()[0].body).toEqual({ platform: 'trendyol', questionId: '881234', text: 'İç ölçüler 24×17×9 cm.' });
    expect(input().value).toBe('İç ölçüler 24×17×9 cm.');
  });

  it('after a successful answer the composer becomes the answered note (one-shot), even before the poll', async () => {
    const onSent = vi.fn();
    renderPane({ conversation: tyWaiting, onSent, nextUp: { name: 'Can', onOpen: vi.fn() } });
    fireEvent.change(input(), { target: { value: 'İç ölçüler 24×17×9 cm.' } });
    await act(async () => { fireEvent.click(screen.getByTestId('composer-send')); });
    await waitFor(() => expect(screen.getByTestId('composer-answered')).toBeInTheDocument());
    expect(screen.queryByTestId('composer-send')).toBeNull();
    expect(screen.getByTestId('thread-next-up')).toHaveTextContent('Next: Can');
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it('in review: pill + caption, no field and no primary', () => {
    renderPane({ conversation: tyInReview });
    expect(screen.getByTestId('composer-in-review')).toHaveTextContent("Your answer is waiting for Trendyol's approval.");
    expect(screen.queryByTestId('composer-input')).toBeNull();
    expect(screen.queryByTestId('composer-send')).toBeNull();
  });

  it('rejected: danger banner with the reason and the composer prefilled with the rejected text', () => {
    renderPane({ conversation: tyRejected });
    expect(screen.getByTestId('composer-rejected')).toHaveTextContent('Trendyol rejected your answer: Contains contact details. You can answer again.');
    expect(input().value).toBe('Bize www.example.com üzerinden yazın');
    expect(screen.getByText('Customer')).toBeInTheDocument(); // empty customerName falls back
  });

  it('locallyAnsweredAt from the page keeps a polled WAITING_FOR_ANSWER closed', () => {
    renderPane({ conversation: tyWaiting, locallyAnsweredAt: '2026-10-15T09:59:00.000Z' });
    expect(screen.getByTestId('composer-answered')).toBeInTheDocument();
  });
});

describe('AI draft', () => {
  it('fills an empty composer, shows the note and what the AI did not have; never sends', async () => {
    handler = (m, url) => (url.pathname === '/api/messages/draft-reply' ? { status: 200, body: { reply: 'Merhaba, iç ölçüler 24×17×9 cm.', missing: ['delivery', 'bogus'] } } : undefined);
    renderPane({ conversation: tyWaiting });
    await act(async () => { fireEvent.click(screen.getByTestId('composer-ai')); });
    await waitFor(() => expect(input().value).toBe('Merhaba, iç ölçüler 24×17×9 cm.'));
    expect(calls.find((c) => c.url === '/api/messages/draft-reply')?.body).toEqual({ platform: 'trendyol', id: '881234' });
    expect(screen.getByTestId('composer-ai-note')).toHaveTextContent('AI draft · check facts before sending');
    expect(screen.getByTestId('composer-ai-note')).toHaveTextContent("AI didn't have: delivery date");
    expect(screen.getByTestId('composer-ai')).toHaveTextContent('Try another draft');
    expect(replyCalls()).toHaveLength(0);
  });

  it('asks before replacing existing text', async () => {
    handler = (m, url) => (url.pathname === '/api/messages/draft-reply' ? { status: 200, body: { reply: 'Draft text here', missing: [] } } : undefined);
    renderPane({ conversation: wixConv });
    fireEvent.change(input(), { target: { value: 'My own words' } });
    await act(async () => { fireEvent.click(screen.getByTestId('composer-ai')); });
    await waitFor(() => expect(screen.getByText('Replace your text with the AI draft?')).toBeInTheDocument());
    expect(input().value).toBe('My own words');
    await act(async () => { fireEvent.click(screen.getByText('Replace')); });
    expect(input().value).toBe('Draft text here');
  });

  it('text typed while the draft loads is never overwritten without the confirm', async () => {
    handler = (m, url) => (url.pathname === '/api/messages/draft-reply' ? { status: 200, body: { reply: 'Draft text here', missing: [] } } : undefined);
    const release = gateDraftFetch();
    renderPane({ conversation: wixConv });
    await act(async () => { fireEvent.click(screen.getByTestId('composer-ai')); });
    fireEvent.change(input(), { target: { value: 'Typed meanwhile' } });
    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByText('Replace your text with the AI draft?')).toBeInTheDocument());
    expect(input().value).toBe('Typed meanwhile');
  });

  it('switching threads while the draft loads leaves the old thread untouched', async () => {
    handler = (m, url) => (url.pathname === '/api/messages/draft-reply' ? { status: 200, body: { reply: 'Draft text here', missing: [] } } : undefined);
    const release = gateDraftFetch();
    const { rerender } = renderPane({ conversation: wixConv });
    await act(async () => { fireEvent.click(screen.getByTestId('composer-ai')); });
    rerender(<Providers><ThreadPane now={NOW} conversation={tyWaiting} /></Providers>);
    await act(async () => { release(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(window.sessionStorage.getItem('kx.msg.draft.wix:c-wix-1')).toBeNull();
    expect(window.sessionStorage.getItem('kx.msg.draft.trendyol:881234')).toBeNull();
    expect(input().value).toBe('');
  });

  it('a malformed or failed draft shows the inline failure, never raw text', async () => {
    handler = (m, url) => (url.pathname === '/api/messages/draft-reply' ? { status: 422, body: { code: 'badDraft', reply: ['garbled'] } } : undefined);
    renderPane({ conversation: wixConv });
    await act(async () => { fireEvent.click(screen.getByTestId('composer-ai')); });
    await waitFor(() => expect(screen.getByTestId('composer-ai-error')).toHaveTextContent("Couldn't draft a reply. Try again."));
    expect(input().value).toBe('');
  });
});

describe('unsent text', () => {
  it('survives switching threads (sessionStorage) and returns when the thread reopens', async () => {
    const { rerender } = renderPane({ conversation: wixConv });
    fireEvent.change(input(), { target: { value: 'Half-written reply' } });
    rerender(<Providers><ThreadPane now={NOW} conversation={tyWaiting} /></Providers>);
    expect(input().value).toBe('');
    rerender(<Providers><ThreadPane now={NOW} conversation={wixConv} /></Providers>);
    expect(input().value).toBe('Half-written reply');
    expect(router.events.on).toHaveBeenCalledWith('routeChangeStart', expect.any(Function));
  });

  it('browser/OS back with unsent text asks, even though window.location already moved', async () => {
    renderPane({ conversation: wixConv });
    fireEvent.change(input(), { target: { value: 'Half-written reply' } });
    const before = window.location.pathname;
    window.history.replaceState(null, '', '/app/labels'); // the browser moved the URL before Next sees it
    let allowed = true;
    act(() => { allowed = popGuard()({ as: '/app/labels' }); });
    window.history.replaceState(null, '', before);
    expect(allowed).toBe(false);
    await waitFor(() => expect(screen.getByText('Discard your unsent reply?')).toBeInTheDocument());
  });

  it('a hash/query-only popstate inside the inbox does not ask', () => {
    renderPane({ conversation: wixConv });
    fireEvent.change(input(), { target: { value: 'Half-written reply' } });
    expect(popGuard()({ as: '/app/mesajlar?open=trendyol:881234' })).toBe(true);
  });

  it('the untouched rejected-answer prefill is not an unsent reply', () => {
    renderPane({ conversation: tyRejected });
    expect(input().value).toBe('Bize www.example.com üzerinden yazın');
    expect(window.sessionStorage.getItem('kx.msg.draft.trendyol:' + tyRejected.id)).toBeNull();
    expect(popGuard()({ as: '/app/labels' })).toBe(true);
    fireEvent.change(input(), { target: { value: 'Bize www.example.com üzerinden yazın.' } });
    expect(popGuard()({ as: '/app/labels' })).toBe(false);
  });

  it('the page-level guard covers drafts of threads that are no longer open (closed mobile sheet)', async () => {
    window.sessionStorage.setItem('kx.msg.draft.wix:c-wix-1', 'Left in a closed sheet');
    function Harness() {
      useUnsentReplyGuard({ title: 'Discard your unsent reply?', keep: 'Keep editing', discard: 'Discard' });
      return null;
    }
    render(<Providers><Harness /></Providers>);
    let allowed = true;
    act(() => { allowed = popGuard()({ as: '/app/labels' }); });
    expect(allowed).toBe(false);
    await waitFor(() => expect(screen.getByText('Discard your unsent reply?')).toBeInTheDocument());
  });
});

describe('ContextRail', () => {
  it('Wix: customer, orders with Money, ship-by, tracking copy and Open order to the OrderPanel', async () => {
    render(<Providers><ContextRail conversation={wixConv} now={NOW} /></Providers>);
    expect(screen.getByText('Customer & orders')).toBeInTheDocument();
    expect(screen.getByTestId('context-customer-name')).toHaveTextContent('Mehmet Yılmaz');
    await waitFor(() => expect(screen.getAllByTestId('order-context-row')).toHaveLength(2));
    const [first, second] = screen.getAllByTestId('order-context-row');
    expect(first).toHaveTextContent('#10482');
    expect(first).toHaveTextContent('$64.50');
    expect(within(first).getByTestId('open-order')).toHaveAttribute('href', '/app/labels?view=all&open=ckx_order_1');
    expect(second).toHaveTextContent('Tracking');
  });

  it('a 502 from orderContext is an inline error with retry, never "No orders"', async () => {
    handler = (m, url) => (url.searchParams.get('action') === 'orderContext' ? { status: 502, body: { code: 'unavailable' } } : undefined);
    render(<Providers><ContextRail conversation={wixConv} now={NOW} /></Providers>);
    await waitFor(() => expect(screen.getByTestId('order-context-error')).toHaveTextContent("Couldn't load Wix orders"));
    expect(screen.queryByText('No orders from this customer')).toBeNull();
  });

  it('Trendyol: product facts from the local catalog, Open listing and View on Trendyol', async () => {
    const onShow = vi.fn();
    render(<Providers><ContextRail conversation={tyWaiting} otherQuestions={{ count: 2, onShow }} /></Providers>);
    // editor-trendyol is on by default (M10) → the full-page editor.
    await waitFor(() => expect(screen.getByTestId('open-listing')).toHaveAttribute('href', '/app/trendyol-urunler/8680001112223'));
    expect(screen.getByText('In stock')).toBeInTheDocument();
    expect(screen.getByTestId('view-on-trendyol')).toHaveAttribute('href', 'https://www.trendyol.com/x');
    fireEvent.click(screen.getByTestId('other-questions'));
    expect(onShow).toHaveBeenCalled();
    expect(screen.getByTestId('other-questions')).toHaveTextContent('2 other questions about this product');
  });

  it('Trendyol: product not in KolayXport shows one caption and no Open listing', async () => {
    render(<Providers><ContextRail conversation={tyRejected} /></Providers>);
    await waitFor(() => expect(screen.getByTestId('product-not-in-catalog')).toBeInTheDocument());
    expect(screen.queryByTestId('open-listing')).toBeNull();
  });
});

describe('mobile sheet and TR', () => {
  it('ThreadSheet renders ✕, the context summary row and the sheet composer; TR copy has no missing keys', async () => {
    const onClose = vi.fn();
    render(<Providers locale="tr"><ThreadSheet open onClose={onClose} conversation={wixConv} now={NOW} /></Providers>);
    expect(screen.getByTestId('thread-sheet')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('context-summary-row')).toHaveTextContent('2 sipariş · #10482'));
    expect(screen.getByText('Yanıtı gönder')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('thread-close'));
    expect(onClose).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('context-summary-row'));
    await waitFor(() => expect(screen.getByTestId('context-sheet')).toBeInTheDocument());
    expect(intlErrors).toEqual([]);
  });

  it('the summary row shows the orders error on a 502, never "No orders" (D9)', async () => {
    handler = (m, url) => (url.searchParams.get('action') === 'orderContext' ? { status: 502, body: { code: 'unavailable' } } : undefined);
    render(<Providers><ThreadSheet open onClose={vi.fn()} conversation={wixConv} now={NOW} /></Providers>);
    await waitFor(() => expect(screen.getByTestId('context-summary-row')).toHaveTextContent("Couldn't load Wix orders"));
    expect(screen.getByTestId('context-summary-row')).not.toHaveTextContent('No orders from this customer');
  });

  it('TR Trendyol rejected thread', () => {
    renderPane({ conversation: tyRejected }, 'tr');
    expect(screen.getByTestId('composer-rejected')).toHaveTextContent('Trendyol yanıtınızı reddetti: Contains contact details. Yeniden yanıt verebilirsiniz.');
    expect(screen.getByText('Cevabı gönder')).toBeInTheDocument();
    expect(intlErrors).toEqual([]);
  });
});
