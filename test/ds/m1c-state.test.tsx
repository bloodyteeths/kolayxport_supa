// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, renderHook, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageSquare } from 'lucide-react';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { ConnectState } from '@/components/ds/state/ConnectState';
import { FeaturePreview } from '@/components/ds/state/FeaturePreview';
import { SlowState } from '@/components/ds/state/SlowState';
import { TableSkeleton, CardListSkeleton, PanelSkeleton, KpiSkeleton, ListSkeleton } from '@/components/ds/state/Skeletons';
import { useAsyncState as useAsyncStateFromDs } from '@/components/ds/state/useAsyncState';
import { resolveAsyncState, useAsyncRegion, useAsyncState, ASYNC_SLOW_MS, ASYNC_TIMEOUT_MS, type SwrLike } from '@/lib/ds/useAsyncState';
import { LOCALES, m, renderIntl, wrap } from './m1c-helpers';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe.each(LOCALES)('EmptyState (%s)', (locale) => {
  it('first-use with brand tile and a primary action', () => {
    renderIntl(
      <EmptyState kind="first-use" brand="etsy" title="Connect Etsy to see your listings" action={{ id: 'c', label: 'Connect Etsy', href: '/ayarlar?tab=connections' }} />,
      locale,
    );
    expect(screen.getByRole('img', { name: 'Etsy' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Connect Etsy' }).getAttribute('href')).toBe('/ayarlar?tab=connections');
  });

  it('no-results renders a secondary action; done renders no action', () => {
    const clear = vi.fn();
    renderIntl(<EmptyState kind="no-results" title="No orders match these filters" action={{ id: 'clear', label: 'Clear filters', onClick: clear }} />, locale);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(clear).toHaveBeenCalled();
    cleanup();
    renderIntl(<EmptyState kind="done" icon={MessageSquare} title="Every message has a reply" body="New messages show up here within 2 minutes." />, locale);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('empty-done').textContent).toContain('Every message has a reply');
  });

  it('locked: LockKeyhole tile (icon/brand ignored), one primary, footnote and a preview slot', () => {
    renderIntl(
      <EmptyState
        kind="locked"
        brand="etsy"
        title="Profit is part of Pro"
        body="See your real profit per order and per product."
        action={{ id: 'plans', label: 'See plans', href: '/fiyatlandirma?plan=pro&from=financials' }}
        footnote="Your trial included it until 29 Oct."
      >
        <FeaturePreview image={{ src: '/previews/profit.png', alt: 'Profit report' }} points={['a', 'b', 'c', 'd']} />
      </EmptyState>,
      locale,
    );
    const root = screen.getByTestId('empty-locked');
    expect(root.querySelector('svg.lucide-lock-keyhole')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Etsy' })).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText('Your trial included it until 29 Oct.')).toBeTruthy();
    expect(screen.getByText(m(locale, 'pro.preview.caption'))).toBeTruthy();
    expect(screen.getByTestId('feature-preview').querySelectorAll('li')).toHaveLength(3);
  });

  it('neutral locked (shopify_free): no action, no plan wording', () => {
    renderIntl(<EmptyState kind="locked" title="This isn't included in your plan" body="Your plan covers orders, labels, listings, bulk editing and research." />, locale);
    const root = screen.getByTestId('empty-locked');
    expect(root.querySelector('a,button')).toBeNull();
    expect(root.textContent).not.toMatch(/Pro|Stripe|fiyatlandirma|[$₺€]/);
  });
});

describe.each(LOCALES)('ErrorState (%s)', (locale) => {
  it('page: title, cause, Try again, Copy error ID', async () => {
    const retry = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderIntl(<ErrorState title="Couldn't load orders" cause="KolayXport's server didn't respond" errorId="err_123" onRetry={retry} />, locale);
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load orders");
    fireEvent.click(screen.getByRole('button', { name: m(locale, 'ds.state.error.retry') }));
    expect(retry).toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: m(locale, 'ds.state.error.copyId') }));
    });
    expect(writeText).toHaveBeenCalledWith('err_123');
    expect(screen.getByRole('button', { name: m(locale, 'ds.state.error.copied') })).toBeTruthy();
  });

  it('action + secondaryAction: cause-specific recovery as primary, Try again drops to secondary', () => {
    const reconnect = vi.fn();
    const openDraft = vi.fn();
    const retry = vi.fn();
    renderIntl(
      <ErrorState
        title="Etsy needs to be reconnected"
        action={{ id: 'reconnect', label: 'Reconnect Etsy', onClick: reconnect }}
        secondaryAction={{ id: 'draft', label: 'Open the draft', onClick: openDraft }}
        onRetry={retry}
        errorId="err_9"
      />,
      locale,
    );
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons.slice(0, 3)).toEqual(['Reconnect Etsy', 'Open the draft', m(locale, 'ds.state.error.retry')]);
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect Etsy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open the draft' }));
    expect(reconnect).toHaveBeenCalled();
    expect(openDraft).toHaveBeenCalled();
    cleanup();
    renderIntl(<ErrorState variant="inline" title="Listing not found" action={{ id: 'back', label: 'Back to listings', href: '/app/listings' }} />, locale);
    expect(screen.getByRole('link', { name: 'Back to listings' }).getAttribute('href')).toBe('/app/listings');
  });

  it('inline: compact danger box', () => {
    renderIntl(<ErrorState variant="inline" title="Couldn't create the label" cause="FedEx said: Postal code is invalid" />, locale);
    expect(screen.getByTestId('error-inline').textContent).toContain('FedEx said');
  });

  it('stale: default line formats the time in the UI locale; Retry is short', () => {
    const retry = vi.fn();
    const since = new Date('2026-10-15T07:42:00Z'); // 10:42 Europe/Istanbul
    renderIntl(<ErrorState variant="stale" staleSince={since} onRetry={retry} />, locale);
    expect(screen.getByTestId('error-stale').textContent).toContain(m(locale, 'ds.state.error.staleSince', { time: '10:42' }));
    fireEvent.click(screen.getByRole('button', { name: m(locale, 'ds.state.error.retryShort') }));
    expect(retry).toHaveBeenCalled();
  });
});

describe.each(LOCALES)('ConnectState (%s)', (locale) => {
  it('replaces the body with the real logo and a translated Connect {name} link', () => {
    renderIntl(<ConnectState brand="etsy" title="Connect Etsy to see your listings" body="Your listings appear here." connectHref="/ayarlar?tab=connections" />, locale);
    const link = screen.getByRole('link', { name: m(locale, 'ds.state.connect.cta', { name: 'Etsy' }) });
    expect(link.getAttribute('href')).toBe('/ayarlar?tab=connections');
    expect(screen.getByTestId('connect-etsy')).toBeTruthy();
  });

  it('unknown brand falls back to a monogram', () => {
    renderIntl(<ConnectState brand="n11" title="Connect n11" connectHref="/x" />, locale);
    const tile = screen.getByRole('img', { name: 'N11' });
    expect(tile.textContent).toBe('N');
    expect(tile.getAttribute('data-monogram')).toBe('true');
  });
});

describe.each(LOCALES)('Skeletons + SlowState (%s)', (locale) => {
  it('appear only after 200ms and match the layout', () => {
    vi.useFakeTimers();
    renderIntl(<TableSkeleton rows={5} thumb />, locale);
    const region = screen.getByRole('status', { name: m(locale, 'ds.state.loading') });
    expect(region.getAttribute('data-visible')).toBe('false');
    act(() => {
      vi.advanceTimersByTime(201);
    });
    expect(region.getAttribute('data-visible')).toBe('true');
    expect(screen.getAllByTestId('skeleton-row')).toHaveLength(5);
  });

  it('every skeleton renders with delayMs=0', () => {
    renderIntl(
      <div>
        <CardListSkeleton delayMs={0} count={3} />
        <PanelSkeleton delayMs={0} sections={2} />
        <KpiSkeleton delayMs={0} count={4} />
        <ListSkeleton delayMs={0} rows={5} />
      </div>,
      locale,
    );
    expect(screen.getAllByTestId('skeleton-card')).toHaveLength(3);
    expect(screen.getAllByTestId('skeleton-section')).toHaveLength(2);
    expect(screen.getAllByTestId('skeleton-kpi-tile')).toHaveLength(4);
    expect(screen.getAllByTestId('skeleton-list-row')).toHaveLength(5);
  });

  it('SlowState: "Still loading…" + Retry', () => {
    const retry = vi.fn();
    renderIntl(<SlowState onRetry={retry} />, locale);
    expect(screen.getByTestId('slow-state').textContent).toContain(m(locale, 'ds.state.slow'));
    fireEvent.click(screen.getByRole('button', { name: m(locale, 'ds.state.error.retryShort') }));
    expect(retry).toHaveBeenCalled();
  });

  it('server render (renderToStaticMarkup) works for state components', () => {
    const html = renderToStaticMarkup(
      wrap(
        <div>
          <EmptyState kind="done" title="All caught up" />
          <ErrorState title="Couldn't load" />
          <TableSkeleton />
        </div>,
        locale,
      ),
    );
    expect(html).toContain('All caught up');
    expect(html).toContain('aria-busy="true"');
  });
});

describe('useAsyncState', () => {
  it('resolveAsyncState maps every case', () => {
    expect(resolveAsyncState({}, 0)).toBe('loading');
    expect(resolveAsyncState({}, ASYNC_SLOW_MS)).toBe('slow');
    expect(resolveAsyncState({}, ASYNC_TIMEOUT_MS)).toBe('error');
    expect(resolveAsyncState({ data: [] }, 0)).toBe('empty');
    expect(resolveAsyncState({ data: [1] }, 0)).toBe('ready');
    expect(resolveAsyncState({ error: new Error('x') }, 0)).toBe('error');
    expect(resolveAsyncState({ data: [1], error: new Error('x') }, 0)).toBe('stale');
    expect(resolveAsyncState({ data: { items: [] } }, 0, { isEmpty: (d) => d.items.length === 0 })).toBe('empty');
    // paused SWR (null key): idle, never slow/error
    expect(resolveAsyncState({ isLoading: false }, ASYNC_TIMEOUT_MS)).toBe('empty');
    expect(resolveAsyncState({ isLoading: false }, 0, { idle: 'loading' })).toBe('loading');
    expect(resolveAsyncState({ isLoading: false, isValidating: true }, ASYNC_SLOW_MS)).toBe('slow');
  });

  it('idle region (null SWR key: isLoading false) starts no timers', () => {
    vi.useFakeTimers();
    const swr: SwrLike<number[]> = { data: undefined, error: undefined, isLoading: false, isValidating: false };
    const { result } = renderHook(() => useAsyncRegion(swr));
    expect(result.current.state).toBe('empty');
    act(() => {
      vi.advanceTimersByTime(ASYNC_TIMEOUT_MS + 5);
    });
    expect(result.current.state).toBe('empty');
    expect(result.current.timedOut).toBe(false);
    vi.useRealTimers();
  });

  it('loading → slow at 15s → error at 30s; retry restarts and revalidates', () => {
    vi.useFakeTimers();
    const mutate = vi.fn();
    const swr: SwrLike<number[]> = { isLoading: true, mutate };
    const { result } = renderHook(() => useAsyncRegion(swr));
    expect(result.current.state).toBe('loading');
    act(() => {
      vi.advanceTimersByTime(ASYNC_SLOW_MS + 5);
    });
    expect(result.current.state).toBe('slow');
    act(() => {
      vi.advanceTimersByTime(ASYNC_TIMEOUT_MS - ASYNC_SLOW_MS + 5);
    });
    expect(result.current.state).toBe('error');
    expect(result.current.timedOut).toBe(true);
    act(() => result.current.retry());
    expect(mutate).toHaveBeenCalled();
    expect(result.current.state).toBe('loading');
  });

  it('data arriving resolves to ready; the components/ds/state path re-exports the hook', () => {
    let swr: SwrLike<number[]> = { isLoading: true };
    const { result, rerender } = renderHook(() => useAsyncState(swr));
    expect(result.current).toBe('loading');
    swr = { data: [1, 2] };
    rerender();
    expect(result.current).toBe('ready');
    expect(useAsyncStateFromDs).toBe(useAsyncState);
  });
});
