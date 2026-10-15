// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { renderIntl, msg, LOCALES, MESSAGES } from './m1f-helpers';
import { tone } from '@/lib/ds/tokens';

const copySpy = vi.fn(async () => true);
vi.mock('@/lib/hooks/useCopy', () => ({
  useCopy: () => ({ copy: copySpy, copied: false }),
}));

const connections = { has: vi.fn<(p: string) => boolean | undefined>(), isLoading: false };
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => connections,
}));

import StatusBadge, { BADGE_TONE } from '@/components/ui/StatusBadge';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import ErrorState from '@/components/ui/ErrorState';
import StatCard from '@/components/ui/StatCard';
import LegacyConfirmDialog, { ConfirmDialog as NamedConfirmDialog, type ConfirmOptions } from '@/components/ui/ConfirmDialog';
import DsConfirmDialog from '@/components/ds/overlay/ConfirmDialog';
import ConnectEmptyState, { RequireConnection, connectHrefFor } from '@/components/ui/ConnectEmptyState';
import CopyButton from '@/components/ui/CopyButton';
import { Button as LegacyButton } from '@/components/ui/button';

afterEach(() => {
  cleanup();
  copySpy.mockClear();
});

function rgbOf(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

describe.each(LOCALES)('M1-f shims (%s)', (locale) => {
  it('StatusBadge renders the label as a DS tone pill', () => {
    renderIntl(<StatusBadge label="Bağlı" variant="error" data-testid="b" />, locale);
    const el = screen.getByTestId('b');
    expect(el.textContent).toBe('Bağlı');
    expect(el.getAttribute('data-tone')).toBe('danger');
    expect(getComputedStyle(el).color).toBe(rgbOf(tone.danger.fg));
  });

  it('StatusBadge maps every legacy variant onto a DS tone and can hide the dot', () => {
    expect(BADGE_TONE).toEqual({ success: 'success', warning: 'warning', error: 'danger', info: 'info', neutral: 'neutral', purple: 'neutral' });
    renderIntl(<StatusBadge label="x" variant="purple" dot={false} data-testid="b" />, locale);
    const el = screen.getByTestId('b');
    expect(el.getAttribute('data-tone')).toBe('neutral');
    expect(el.querySelectorAll('[aria-hidden]').length).toBe(0);
  });

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

  it('StatCard renders a neutral KPI tile with a locale-formatted delta', () => {
    renderIntl(<StatCard label="Revenue" value="₺1.200" icon={<svg />} trend={12.4} data-testid="k" />, locale);
    const el = screen.getByTestId('k');
    expect(el.textContent).toContain('Revenue');
    expect(el.textContent).toContain('₺1.200');
    const delta = el.querySelector('[data-trend]')!;
    expect(delta.getAttribute('data-trend')).toBe('up');
    expect(delta.textContent).toContain(locale === 'tr' ? '%12,4' : '12.4%');
    cleanup();
    renderIntl(<StatCard label="L" value={3} icon={<svg />} trend={-3} data-testid="k" />, locale);
    expect(screen.getByTestId('k').querySelector('[data-trend]')!.getAttribute('data-trend')).toBe('down');
    cleanup();
    renderIntl(<StatCard label="L" value={3} trend={0} data-testid="k" />, locale);
    const flat = screen.getByTestId('k').querySelector('[data-trend]')!;
    expect(flat.getAttribute('data-trend')).toBe('flat');
    expect(flat.textContent).not.toMatch(/[▲▼]/);
    expect((flat as HTMLElement).style.color || getComputedStyle(flat).color).toBe(rgbOf(tone.neutral.fg));
  });

  it('ConfirmDialog is the DS ConfirmDialog (re-export) and keeps the legacy option contract', () => {
    expect(LegacyConfirmDialog).toBe(DsConfirmDialog);
    expect(NamedConfirmDialog).toBe(DsConfirmDialog);
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
    renderIntl(<LegacyConfirmDialog {...legacyOptions} open onConfirm={onConfirm} onCancel={onCancel} />, locale);
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
      <LegacyConfirmDialog open title="X" typeToConfirm="12" confirmLabel={msg(locale, 'common.confirm')} onConfirm={onConfirm} onCancel={() => undefined} />,
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

  it('CopyButton (icon) copies without bubbling to the row and is labelled in the locale', async () => {
    const rowClick = vi.fn();
    renderIntl(
      <div onClick={rowClick}>
        <CopyButton value="1Z999" label="Tracking" />
      </div>,
      locale,
    );
    const btn = screen.getByRole('button', { name: msg(locale, 'ui.copy.copyLabel', { label: 'Tracking' }) });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(copySpy).toHaveBeenCalledWith('1Z999');
    expect(rowClick).not.toHaveBeenCalled();
  });

  it('CopyButton (chip) shows its label, resolves function values, and disables when empty', async () => {
    renderIntl(<CopyButton variant="chip" value={() => 'a\tb'} label="TSV" />, locale);
    const chip = screen.getByRole('button', { name: msg(locale, 'ui.copy.copyLabel', { label: 'TSV' }) });
    expect(chip.textContent).toContain('TSV');
    await act(async () => {
      fireEvent.click(chip);
    });
    expect(copySpy).toHaveBeenCalledWith('a\tb');
    cleanup();
    renderIntl(<CopyButton value="" />, locale);
    expect((screen.getByRole('button', { name: msg(locale, 'ui.copy.copy') }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('legacy button.js keeps its API with DS token classes', () => {
    const onClick = vi.fn();
    const ref = React.createRef<HTMLButtonElement>();
    renderIntl(
      <>
        <LegacyButton ref={ref} onClick={onClick} className="w-full">{msg(locale, 'common.save')}</LegacyButton>
        <LegacyButton variant="outline">{msg(locale, 'common.cancel')}</LegacyButton>
      </>,
      locale,
    );
    const primary = screen.getByRole('button', { name: msg(locale, 'common.save') });
    expect(ref.current).toBe(primary);
    expect(primary.className).toContain('bg-accent-600');
    expect(primary.className).toContain('w-full');
    expect(primary.className).not.toMatch(/blue-|gray-/);
    fireEvent.click(primary);
    expect(onClick).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: msg(locale, 'common.cancel') }).getAttribute('data-variant')).toBe('outline');
  });
});
