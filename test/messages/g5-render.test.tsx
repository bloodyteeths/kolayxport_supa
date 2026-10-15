// @vitest-environment jsdom
// messages G5 render tests: ConversationRow (dot, bold, "You:", "—", pill, chips), ConversationList (load more,
// selection), PlatformBanners (one banner per platform, actions) in EN and TR.
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { ConversationRow } from '@/components/domain/messages/ConversationRow';
import { ConversationList } from '@/components/domain/messages/ConversationList';
import { PlatformBanners } from '@/components/domain/messages/PlatformBanners';
import { messageRowState } from '@/lib/messages/threadState';
import type { UnifiedConversation } from '@/types/messages';
import { setViewport } from '../ds/m1e-helpers';
import { G5_EN, G5_TR } from './g5-messages';

type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}
const MESSAGES = { en: deepMerge(en as Obj, G5_EN as Obj), tr: deepMerge(tr as Obj, G5_TR as Obj) };
const NOW = new Date('2026-10-15T10:04:00.000Z');

function wrap(node: React.ReactNode, locale: 'en' | 'tr' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Istanbul" now={NOW} onError={() => {}}>
      <ThemeProvider theme={theme}>{node}</ThemeProvider>
    </NextIntlClientProvider>,
  );
}

function conv(p: Partial<UnifiedConversation> & { id: string }): UnifiedConversation {
  return {
    platform: 'wix', status: 'unanswered', needsReply: true, unread: true, customerName: 'Ayşe Kaya', subject: '',
    lastMessageText: 'Siparişim ne zaman kargoya verilir?', lastMessageAt: '2026-10-15T10:00:00.000Z',
    lastMessageDate: '2026-10-15T10:00:00.000Z', lastFromCustomer: true, unreadCount: 1, messages: [], ...p,
  };
}

afterEach(() => cleanup());
setViewport('desktop');

describe('ConversationRow', () => {
  it('unread needs-reply Wix row: dot, bold name, pill, order chip; click opens', () => {
    const c = conv({ id: 'a', orderRef: '10482' });
    const onOpen = vi.fn();
    wrap(<ConversationRow conversation={c} rowState={messageRowState(c)} onOpen={onOpen} now={NOW} />);
    expect(screen.getByTestId('unread-dot').getAttribute('aria-label')).toBe('Unread');
    expect(screen.getByTestId('conversation-name').textContent).toBe('Ayşe Kaya');
    expect(screen.getByText('Needs reply')).toBeTruthy();
    expect(screen.getByText('#10482')).toBeTruthy();
    fireEvent.click(screen.getByTestId('conversation-row-wix-a'));
    expect(onOpen).toHaveBeenCalledWith(c);
  });

  it('seller-last row: "You:" prefix, no pill; unknown time renders —; empty text caption (TR)', () => {
    const c = conv({ id: 'b', needsReply: false, unread: false, lastFromCustomer: false, lastMessageText: 'Teşekkürler', lastMessageAt: null });
    wrap(<ConversationRow conversation={c} rowState={messageRowState(c)} onOpen={() => {}} now={NOW} />, 'tr');
    expect(screen.getByTestId('conversation-preview').textContent).toBe('Siz: Teşekkürler');
    expect(screen.queryByTestId('unread-dot')).toBeNull();
    expect(screen.getByLabelText('Zaman bilinmiyor')).toBeTruthy();
    cleanup();
    const d = conv({ id: 'c', lastMessageText: '' });
    wrap(<ConversationRow conversation={d} rowState={messageRowState(d)} onOpen={() => {}} now={NOW} />, 'tr');
    expect(screen.getByTestId('conversation-preview').textContent).toBe('Mesaj metni yok');
  });

  it('Trendyol in-review row is muted with the in_review pill and product chip', () => {
    const c = conv({ id: 't', platform: 'trendyol', needsReply: false, unread: false, platformStatus: 'WAITING_FOR_APPROVE', productInfo: { id: 'p', title: 'Ahşap anı kutusu' } });
    wrap(<ConversationRow conversation={c} rowState={messageRowState(c)} onOpen={() => {}} now={NOW} />);
    const row = screen.getByTestId('conversation-row-trendyol-t');
    expect(row.getAttribute('data-muted')).toBe('true');
    expect(screen.getByText('Answer in review')).toBeTruthy();
    expect(screen.getByText('Ahşap anı kutusu')).toBeTruthy();
  });

  it('a row answered from this tab loses pill and dot', () => {
    const c = conv({ id: 'x' });
    wrap(<ConversationRow conversation={c} rowState={messageRowState(c, { locallyAnsweredAt: NOW.toISOString() })} onOpen={() => {}} now={NOW} />);
    expect(screen.queryByTestId('unread-dot')).toBeNull();
    expect(screen.queryByText('Needs reply')).toBeNull();
  });
});

describe('ConversationList', () => {
  it('marks the open row, shows Load more and calls it', () => {
    const onLoadMore = vi.fn();
    wrap(
      <ConversationList rows={[conv({ id: 'a' }), conv({ id: 'b' })]} openKey="wix:b" onOpen={() => {}} locallyAnsweredAt={() => null} hasMore onLoadMore={onLoadMore} now={NOW} />,
    );
    expect(screen.getByTestId('conversation-row-wix-b').getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getByText('Load more'));
    expect(onLoadMore).toHaveBeenCalled();
  });

  it('placeholder replaces the rows and hides Load more', () => {
    wrap(<ConversationList rows={[conv({ id: 'a' })]} openKey={null} onOpen={() => {}} locallyAnsweredAt={() => null} hasMore onLoadMore={() => {}} placeholder={<div>empty</div>} />);
    expect(screen.queryByTestId('conversation-row-wix-a')).toBeNull();
    expect(screen.queryByText('Load more')).toBeNull();
  });
});

describe('PlatformBanners', () => {
  it('one banner per failed platform with its action (EN + TR)', () => {
    const onRetry = vi.fn();
    wrap(
      <PlatformBanners
        errors={[
          { platform: 'wix', code: 'auth', detail: '' },
          { platform: 'trendyol', code: 'unavailable', detail: '' },
        ]}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('Wix connection expired.')).toBeTruthy();
    expect(screen.getByText('Reconnect Wix').closest('a')?.getAttribute('href')).toBe('/ayarlar?tab=connections');
    fireEvent.click(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalled();
    cleanup();
    wrap(<PlatformBanners errors={[{ platform: 'trendyol', code: 'credentials', detail: '' }]} onRetry={() => {}} />, 'tr');
    expect(screen.getByText('Trendyol kurulumu eksik.')).toBeTruthy();
    expect(screen.getByText('Kurulumu tamamla')).toBeTruthy();
  });

  it('renders nothing without errors', () => {
    const { container } = wrap(<PlatformBanners errors={[]} onRetry={() => {}} />);
    expect(container.querySelector('[data-testid="platform-banners"]')).toBeNull();
  });
});
