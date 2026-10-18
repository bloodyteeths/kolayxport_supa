// @vitest-environment jsdom
// The buyer-data opt-in in the UI: Settings → AI personal-key form and the OAuth consent page send it only when the
// seller ticks the box (off by default), in EN and TR with no missing keys; the connection list shows it.
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import { FormatProvider } from '@/lib/format';
import { ConfirmProvider } from '@/components/ds/overlay';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';

const router = vi.hoisted(() => ({
  isReady: true,
  asPath: '/oauth/authorize',
  replace: () => Promise.resolve(true),
  query: { response_type: 'code', client_id: 'kxc_1', redirect_uri: 'https://claude.ai/api/mcp/auth_callback', state: 's', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', scope: 'read write orders:buyer' } as Record<string, string>,
}));
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('next/head', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import { AiConnectionsCard } from '@/components/domain/settings/AiConnectionsCard';
import OAuthAuthorize from '@/pages/oauth/authorize';

const errors: string[] = [];
function wrap(ui: React.ReactElement, locale: 'en' | 'tr') {
  return render(
    <NextIntlClientProvider locale={locale} messages={(locale === 'en' ? en : tr) as never} timeZone="Europe/Istanbul" onError={(e) => { errors.push(e.message); }}>
      <FormatProvider timeZone="Europe/Istanbul">
        <ThemeProvider theme={theme}>
          <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
            <ConfirmProvider>{ui}</ConfirmProvider>
          </SWRConfig>
        </ThemeProvider>
      </FormatProvider>
    </NextIntlClientProvider>,
  );
}

type Sent = { url: string; body: any };
function stubFetch(connections: any[] = []) {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    sent.push({ url, body });
    const json = (b: unknown) => ({ ok: true, status: 200, json: async () => b });
    if (url === '/api/auth/session') return json({ user: { id: 'u1' } });
    if (url.startsWith('/api/mcp/oauth/authorize?')) return json({ clientName: 'Claude', redirectHost: 'claude.ai' });
    if (url === '/api/mcp/oauth/authorize') return json({ redirect: 'https://claude.ai/api/mcp/auth_callback?code=x' });
    if (url === '/api/mcp/connections' && init?.method === 'POST') return json({ token: 'kxp_x', connection: {} });
    if (url === '/api/mcp/connections') return json({ connections });
    return json({});
  }));
  return sent;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); errors.length = 0; });

describe('personal-key form', () => {
  for (const locale of ['en', 'tr'] as const) {
    it(`off by default; sends shareBuyer only when ticked (${locale})`, async () => {
      const sent = stubFetch();
      wrap(<AiConnectionsCard />, locale);
      const msgs = (locale === 'en' ? en : tr).settings.aiConnect;
      expect(screen.getByText(msgs.key.shareBuyer)).toBeTruthy();
      expect(screen.getByText(msgs.key.shareBuyerHint)).toBeTruthy();
      const box = screen.getByTestId('ai-connections-share-buyer').querySelector('input') as HTMLInputElement;
      expect(box.checked).toBe(false);
      fireEvent.click(screen.getByText(msgs.key.create));
      await waitFor(() => expect(sent.some((s) => s.body?.scopes)).toBe(true));
      expect(sent.find((s) => s.body?.scopes)!.body.shareBuyer).toBe(false);
      fireEvent.click(box);
      expect(box.checked).toBe(true);
      fireEvent.click(screen.getByText(msgs.key.create));
      await waitFor(() => expect(sent.filter((s) => s.body?.scopes).length).toBe(2));
      expect(sent.filter((s) => s.body?.scopes)[1].body.shareBuyer).toBe(true);
      expect(errors).toEqual([]);
    });
  }
  it('the list says which connections share buyer details', async () => {
    stubFetch([
      { id: 'a', name: 'Claude', kind: 'oauth', scopes: ['read', 'orders:buyer'], tokenPrefix: 'kxo_', createdAt: new Date().toISOString(), lastUsedAt: null, expiresAt: null },
      { id: 'b', name: 'Cursor', kind: 'token', scopes: ['read', 'write'], tokenPrefix: 'kxp_abc', createdAt: new Date().toISOString(), lastUsedAt: null, expiresAt: null },
    ]);
    wrap(<AiConnectionsCard />, 'en');
    await waitFor(() => expect(screen.getByText('Cursor')).toBeTruthy());
    expect(screen.getByText(/· buyer names and addresses shared ·/)).toBeTruthy();
    expect(screen.getByText(/· country only ·/)).toBeTruthy();
  });
});

describe('OAuth consent page', () => {
  for (const locale of ['en', 'tr'] as const) {
    it(`buyer box off by default even when the app asks for it; sent only when ticked (${locale})`, async () => {
      const c = (locale === 'en' ? en : tr).mcp.consent;
      let sent = stubFetch();
      wrap(<OAuthAuthorize />, locale);
      await waitFor(() => expect(screen.getByTestId('consent-share-buyer')).toBeTruthy());
      expect(screen.getByText(c.shareBuyer)).toBeTruthy();
      expect(screen.getByTestId('consent-redirect-host').textContent).toContain('claude.ai');
      const box = screen.getByTestId('consent-share-buyer') as HTMLInputElement;
      expect(box.checked).toBe(false);
      fireEvent.click(screen.getByText(c.allow));
      await waitFor(() => expect(sent.some((s) => s.url === '/api/mcp/oauth/authorize' && s.body)).toBe(true));
      expect(sent.find((s) => s.url === '/api/mcp/oauth/authorize' && s.body)!.body.share_buyer).toBe(false);
      cleanup();

      sent = stubFetch();
      wrap(<OAuthAuthorize />, locale);
      await waitFor(() => expect(screen.getByTestId('consent-share-buyer')).toBeTruthy());
      fireEvent.click(screen.getByTestId('consent-share-buyer'));
      fireEvent.click(screen.getByText(c.allow));
      await waitFor(() => expect(sent.some((s) => s.url === '/api/mcp/oauth/authorize' && s.body)).toBe(true));
      expect(sent.find((s) => s.url === '/api/mcp/oauth/authorize' && s.body)!.body.share_buyer).toBe(true);
      expect(errors).toEqual([]);
    });
  }
});
