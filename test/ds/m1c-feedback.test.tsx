// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Toaster } from 'react-hot-toast';
import { renderToStaticMarkup } from 'react-dom/server';
import { Banner, BANNER_STORAGE_PREFIX } from '@/components/ds/feedback/Banner';
import {
  createToastController, toastController, useToast, ToastView, TOAST_DURATION, type ToastAdapter, type ToastApi, type ToastItem,
} from '@/components/ds/feedback/toast';
import { tone } from '@/lib/ds/tokens';
import { LOCALES, m, renderIntl, wrap } from './m1c-helpers';

afterEach(() => {
  cleanup();
  toastController.reset();
  vi.useRealTimers();
});

describe.each(LOCALES)('Banner (%s)', (locale) => {
  beforeEach(() => window.localStorage.clear());

  it.each(['info', 'warning', 'danger', 'success', 'attention', 'neutral'] as const)('renders tone %s with soft background and one action', (tn) => {
    const onClick = vi.fn();
    renderIntl(<Banner tone={tn} title="Couldn't check Etsy" action={{ id: 'retry', label: 'Retry', onClick }} />, locale);
    const el = screen.getByTestId(`banner-${tn}`);
    expect(el.getAttribute('role')).toBe(tn === 'danger' || tn === 'warning' ? 'alert' : 'status');
    expect(getComputedStyle(el).borderColor).toBeTruthy();
    expect(el.getAttribute('data-tone')).toBe(tn);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onClick).toHaveBeenCalled();
    expect(tone[tn].bg).toMatch(/^#/);
  });

  it('dismissKey: shows a translated ✕, persists the dismissal and stays hidden on remount', () => {
    const onDismiss = vi.fn();
    const { unmount } = renderIntl(<Banner tone="info" title="Tip" dismissKey={`msg-tip-${locale}`} onDismiss={onDismiss} />, locale);
    fireEvent.click(screen.getByRole('button', { name: m(locale, 'ds.feedback.banner.dismiss') }));
    expect(onDismiss).toHaveBeenCalled();
    expect(screen.queryByText('Tip')).toBeNull();
    expect(window.localStorage.getItem(`${BANNER_STORAGE_PREFIX}msg-tip-${locale}`)).toBe('1');
    unmount();
    renderIntl(<Banner tone="info" title="Tip" dismissKey={`msg-tip-${locale}`} />, locale);
    expect(screen.queryByText('Tip')).toBeNull();
  });

  it('dismissKey: SSR / first paint render nothing, so a dismissed banner never flashes', () => {
    const html = renderToStaticMarkup(wrap(<Banner tone="info" title="Range note" dismissKey={`range-${locale}`} />, locale));
    expect(html).not.toContain('Range note');
    const plain = renderToStaticMarkup(wrap(<Banner tone="info" title="Always" />, locale));
    expect(plain).toContain('Always');
  });

  it('without dismissKey there is no ✕ (blocking banners)', () => {
    renderIntl(<Banner tone="danger" title="Your trial has ended">{'Choose a plan to keep creating labels.'}</Banner>, locale);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Choose a plan to keep creating labels.')).toBeTruthy();
  });

  it('survives a throwing localStorage', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderIntl(<Banner tone="info" title="Still here" dismissKey="blocked" />, locale);
    expect(screen.getByText('Still here')).toBeTruthy();
    spy.mockRestore();
  });
});

function fakeAdapter() {
  const shown: string[] = [];
  const hidden: string[] = [];
  const adapter: ToastAdapter = { show: (i) => shown.push(i.id), hide: (id) => hidden.push(id) };
  return { adapter, shown, hidden };
}
const item = (id: string, duration = 4000): ToastItem => ({ id, tone: 'info', message: id, duration, dismissLabel: 'x' });

describe.each(LOCALES)('ToastView touch targets (%s)', (locale) => {
  it('✕ and action reach 44×44 on a coarse pointer', () => {
    renderIntl(
      <ToastView item={{ id: 't', tone: 'error', message: 'Couldn\'t send', duration: Infinity, dismissLabel: m(locale, 'ds.feedback.toast.dismiss'), action: { label: 'Retry', onClick: () => {} } }} onDismiss={() => {}} />,
      locale,
    );
    const css = Array.from(document.querySelectorAll('style')).map((st) => st.textContent).join('\n');
    expect(css).toMatch(/@media \(pointer: coarse\)\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px/);
    expect(screen.getByRole('button', { name: m(locale, 'ds.feedback.toast.dismiss') })).toBeTruthy();
    expect(screen.getByTestId('toast-action').tagName).toBe('BUTTON');
  });
});

describe('toast controller: one visible, the rest queued', () => {
  it('a new timed toast replaces the visible timed toast', () => {
    const { adapter, shown, hidden } = fakeAdapter();
    const c = createToastController(adapter);
    c.enqueue(item('a'));
    c.enqueue(item('b'));
    expect(shown).toEqual(['a', 'b']);
    expect(hidden).toEqual(['a']);
    expect(c.visible()?.id).toBe('b');
  });

  it('a persistent error holds the slot; later toasts queue and show after dismiss', () => {
    vi.useFakeTimers();
    const { adapter, shown } = fakeAdapter();
    const c = createToastController(adapter);
    c.enqueue(item('err', Infinity));
    c.enqueue(item('b'));
    c.enqueue(item('c'));
    expect(shown).toEqual(['err']);
    expect(c.queued().map((q) => q.id)).toEqual(['b', 'c']);
    c.dismiss('err');
    expect(c.visible()?.id).toBe('b');
    vi.advanceTimersByTime(4001);
    expect(c.visible()?.id).toBe('c');
    vi.advanceTimersByTime(4001);
    expect(c.visible()).toBeNull();
  });

  it('dismiss(id) removes a queued toast; dismiss() clears everything', () => {
    const { adapter } = fakeAdapter();
    const c = createToastController(adapter);
    c.enqueue(item('err', Infinity));
    c.enqueue(item('b'));
    c.enqueue(item('c'));
    c.dismiss('b');
    expect(c.queued().map((q) => q.id)).toEqual(['c']);
    c.dismiss();
    expect(c.visible()).toBeNull();
    expect(c.queued()).toEqual([]);
  });
});

describe.each(LOCALES)('useToast + ToastView (%s)', (locale) => {
  beforeEach(() => {
    // jsdom has no matchMedia; react-hot-toast reads prefers-reduced-motion.
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  });

  it('renders through the app Toaster: success with Undo (6s), error persists with Retry, translated dismiss', async () => {
    const api: { current: ToastApi | null } = { current: null };
    function Grab() {
      api.current = useToast();
      return null;
    }
    render(
      wrap(
        <>
          <Grab />
          <Toaster />
        </>,
        locale,
      ),
    );
    const undo = vi.fn();
    act(() => {
      api.current!.success('12 listings moved to draft', { undo });
    });
    expect(await screen.findByText('12 listings moved to draft')).toBeTruthy();
    expect(toastController.visible()?.duration).toBe(TOAST_DURATION.undo);
    fireEvent.click(screen.getByRole('button', { name: m(locale, 'ds.feedback.toast.undo') }));
    expect(undo).toHaveBeenCalled();
    expect(toastController.visible()).toBeNull();

    const retry = vi.fn();
    act(() => {
      api.current!.error("Couldn't send 1 change", { action: { onClick: retry } });
    });
    expect(await screen.findByText("Couldn't send 1 change")).toBeTruthy();
    expect(toastController.visible()?.duration).toBe(Infinity);
    act(() => {
      api.current!.info('Queued behind the error');
    });
    expect(toastController.queued()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: m(locale, 'ds.feedback.toast.retry') }));
    expect(retry).toHaveBeenCalled();
    expect(toastController.visible()?.message).toBe('Queued behind the error');
  });

  it('ToastView is neutral-900 with an alert role for errors', () => {
    const onDismiss = vi.fn();
    renderIntl(<ToastView item={{ id: 't', tone: 'error', message: 'Failed', duration: Infinity, dismissLabel: m(locale, 'ds.feedback.toast.dismiss') }} onDismiss={onDismiss} />, locale);
    expect(screen.getByRole('alert').textContent).toContain('Failed');
    fireEvent.click(screen.getByRole('button', { name: m(locale, 'ds.feedback.toast.dismiss') }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
