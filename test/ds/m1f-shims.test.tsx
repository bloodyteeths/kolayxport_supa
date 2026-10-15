// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { renderIntl, msg, LOCALES, MESSAGES } from './m1f-helpers';

const connections = { has: vi.fn<(p: string) => boolean | undefined>(), isLoading: false };
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => connections,
}));

import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import ErrorState from '@/components/ui/ErrorState';
import DsConfirmDialog, { type ConfirmOptions } from '@/components/ds/overlay/ConfirmDialog';
import ConnectEmptyState, { RequireConnection, connectHrefFor } from '@/components/ui/ConnectEmptyState';

afterEach(() => {
  cleanup();
});

describe.each(LOCALES)('M1-f shims (%s)', (locale) => {
  it('EmptyState renders icon tile, title, body and the action node', () => {
    renderIntl(
      <EmptyState
        icon={<svg data-testid="icon" />}
        title={msg(locale, 'common.noData')}
        message={msg(locale, 'ui.errorState.message')}
        action={<button type="button">{msg(locale, 'common.refresh')}</button>}
      />,
      locale,
    );
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe(msg(locale, 'common.noData'));
    expect(screen.getByText(msg(locale, 'ui.errorState.message'))).toBeTruthy();
    expect(screen.getByRole('button').textContent).toBe(msg(locale, 'common.refresh'));
    expect(screen.getByTestId('icon')).toBeTruthy();
    expect(document.body.innerHTML).not.toMatch(/gradient/);
  });

  it('PageHeader renders title, subtitle and right-aligned actions', () => {
    renderIntl(
      <PageHeader title={msg(locale, 'common.settings')} subtitle={msg(locale, 'common.notifications')}>
        <button type="button">{msg(locale, 'common.save')}</button>
      </PageHeader>,
      locale,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(msg(locale, 'common.settings'));
    expect(screen.getByRole('banner').getAttribute('data-testid')).toBe('page-header'); // the DS PageHeader
    expect(screen.getByText(msg(locale, 'common.notifications'))).toBeTruthy();
    expect(screen.getByRole('button').textContent).toBe(msg(locale, 'common.save'));
  });

  it('ErrorState (page) uses i18n defaults and retries', () => {
    const onRetry = vi.fn();
    renderIntl(<ErrorState onRetry={onRetry} />, locale);
    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('data-testid')).toBe('error-page');
    expect(alert.textContent).toContain(msg(locale, 'ui.errorState.title'));
    expect(alert.textContent).toContain(msg(locale, 'ui.errorState.message'));
    fireEvent.click(screen.getByRole('button', { name: msg(locale, 'errors.tryAgain') }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('ErrorState compact → DS inline variant, explicit title + message, retry ignored while retrying', () => {
    const onRetry = vi.fn();
    const parentClick = vi.fn();
    renderIntl(
      <div onClick={parentClick}>
        <ErrorState compact title="T" message="M" onRetry={onRetry} retrying data-testid="err" />
      </div>,
      locale,
    );
    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('data-testid')).toBe('err');
    expect(alert.textContent).toContain('T');
    expect(alert.textContent).toContain('M');
    const retryBtn = screen.getByRole('button', { name: msg(locale, 'errors.tryAgain') });
    // DS ErrorState `retrying` → ActionSpec loading: native disabled + aria-busy + spinner.
    expect(retryBtn.hasAttribute('disabled') || retryBtn.getAttribute('aria-disabled') === 'true').toBe(true);
    expect(retryBtn.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(retryBtn);
    expect(onRetry).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('ErrorState: retry is enabled and fires when not retrying; busy marks clear when retrying ends', () => {
    const onRetry = vi.fn();
    const { rerender } = renderIntl(<ErrorState title="T" onRetry={onRetry} retrying />, locale);
    rerender(
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Istanbul" onError={() => undefined}>
        <ErrorState title="T" onRetry={onRetry} retrying={false} />
      </NextIntlClientProvider>,
    );
    const retryBtn = screen.getByRole('button', { name: msg(locale, 'errors.tryAgain') });
    expect(retryBtn.getAttribute('aria-disabled')).toBeNull();
    expect(retryBtn.hasAttribute('disabled')).toBe(false);
    expect(retryBtn.getAttribute('aria-busy')).toBeNull();
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('ErrorState accepts the DS variant alias and never shows raw JSON from an error object', () => {
    renderIntl(<ErrorState variant="inline" error={{ response: { data: { foo: 'bar' } } }} />, locale);
    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('data-testid')).toBe('error-inline');
    expect(alert.textContent).not.toContain('{');
  });

  it('ConfirmDialog keeps the older option contract (description / destructive aliases)', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const legacyOptions: ConfirmOptions = {
      title: 'Delete?',
      description: msg(locale, 'ui.errorState.message'),
      items: ['a', 'b', 'c'],
      maxItems: 2,
      destructive: true,
      confirmLabel: msg(locale, 'common.delete'),
      cancelLabel: msg(locale, 'common.cancel'),
    };
    renderIntl(<DsConfirmDialog {...legacyOptions} open onConfirm={onConfirm} onCancel={onCancel} />, locale);
    expect(screen.getByText('Delete?')).toBeTruthy();
    expect(screen.getByText(msg(locale, 'ui.errorState.message'))).toBeTruthy();
    const list = screen.getByTestId('confirm-items');
    const lis = Array.from(list.querySelectorAll('li')).map((li) => li.textContent);
    expect(lis.slice(0, 2)).toEqual(['a', 'b']);
    expect(lis).toHaveLength(3); // 2 shown + "and 1 more"
    expect(lis).not.toContain('c');
    fireEvent.click(screen.getByRole('button', { name: msg(locale, 'common.delete') }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: msg(locale, 'common.cancel') }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('ConfirmDialog typeToConfirm keeps confirm disabled until the text matches', () => {
    const onConfirm = vi.fn();
    renderIntl(
      <DsConfirmDialog open title="X" typeToConfirm="12" confirmLabel={msg(locale, 'common.confirm')} onConfirm={onConfirm} onCancel={() => undefined} />,
      locale,
    );
    const confirm = screen.getByRole('button', { name: msg(locale, 'common.confirm') }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    const input = screen.getByTestId('confirm-type-input');
    fireEvent.change(input, { target: { value: '12' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('ConnectEmptyState shows the real logo, i18n copy and links to the right settings tab', () => {
    renderIntl(<ConnectEmptyState provider="etsy" />, locale);
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe(msg(locale, 'ui.connectEmpty.title', { name: 'Etsy' }));
    expect(screen.getByText(msg(locale, 'ui.connectEmpty.description', { name: 'Etsy' }))).toBeTruthy();
    const link = screen.getByRole('link', { name: msg(locale, 'ui.connectEmpty.cta', { name: 'Etsy' }) });
    expect(link.getAttribute('href')).toBe('/ayarlar?tab=connections');
    const tile = screen.getByRole('img', { name: 'Etsy' });
    expect(tile.querySelector('img')!.getAttribute('src')).toBe('/logos/etsy.svg');
  });

  it('ConnectEmptyState falls back to a monogram when the logo fails, and names MNG as DHL eCommerce', () => {
    renderIntl(<ConnectEmptyState provider={'mng' as never} description="d" />, locale);
    expect(screen.getByText('d')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe(msg(locale, 'ui.connectEmpty.title', { name: 'DHL eCommerce' }));
    const tile = screen.getByTestId('brand-mng');
    act(() => {
      fireEvent.error(tile.querySelector('img')!);
    });
    expect(tile.querySelector('img')).toBeNull();
    expect(tile.textContent).toBe('D');
    expect(connectHrefFor('mng')).toBe('/ayarlar?tab=apiKeys');
  });

  it('RequireConnection: children when connected, connect state when not, skeleton while loading', () => {
    connections.has.mockReturnValue(true);
    connections.isLoading = false;
    renderIntl(<RequireConnection provider="wix"><p>{'child'}</p></RequireConnection>, locale);
    expect(screen.getByText('child')).toBeTruthy();
    cleanup();
    connections.has.mockReturnValue(false);
    renderIntl(<RequireConnection provider="wix"><p>{'child'}</p></RequireConnection>, locale);
    expect(screen.queryByText('child')).toBeNull();
    expect(screen.getByRole('link').getAttribute('href')).toBe('/ayarlar?tab=connections');
    cleanup();
    connections.has.mockReturnValue(undefined);
    connections.isLoading = true;
    vi.useFakeTimers();
    try {
      renderIntl(<RequireConnection provider="wix"><p>{'child'}</p></RequireConnection>, locale);
      const loading = screen.getByTestId('require-connection-loading');
      expect(loading.getAttribute('aria-busy')).toBe('true');
      // DS delay: no bones before 200ms, so fast loads never flash.
      expect(loading.getAttribute('data-visible')).toBe('false');
      expect(loading.children.length).toBe(0);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.getByTestId('require-connection-loading').getAttribute('data-visible')).toBe('true');
    } finally {
      vi.useRealTimers();
      connections.isLoading = false;
    }
  });

});
