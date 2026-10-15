// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act as rtlAct, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ActionMenu, Page, PageHeader, Section, StickyActionBar, SyncMeta, splitHeaderActions, orderMenuItems } from '@/components/ds/page';
import type { ActionSpec, PageShellMeta } from '@/components/ds/page';
import { hasCoarse44, LOCALES, renderDs } from './m1e-helpers';

afterEach(cleanup);

const T = {
  en: { title: 'Orders', more: 'More actions', back: 'Back' },
  tr: { title: 'Siparişler', more: 'Diğer işlemler', back: 'Geri' },
} as const;

const act = (id: string, extra: Partial<ActionSpec> = {}): ActionSpec => ({ id, label: id, onClick: vi.fn(), ...extra });

describe.each(LOCALES)('Page (%s)', (locale) => {
  it('renders children with the width variant and max width', () => {
    renderDs(
      <Page title={T[locale].title} width="detail">
        <p>{'body'}</p>
      </Page>,
      { locale },
    );
    const root = screen.getByTestId('ds-page');
    expect(root.getAttribute('data-width')).toBe('detail');
    expect(root.textContent).toContain('body');
  });

  it.each(['list', 'detail', 'form', 'reading'] as const)('accepts width=%s', (width) => {
    renderDs(
      <Page title="x" width={width}>
        <span />
      </Page>,
      { locale },
    );
    expect(screen.getByTestId('ds-page').getAttribute('data-width')).toBe(width);
  });

  it('emits shell meta with header actions (primary first, mobileOverflow = secondaries + overflow)', async () => {
    const onMeta = vi.fn<[PageShellMeta], void>();
    renderDs(
      <Page title={T[locale].title} width="list" backHref="/app" onShellMetaChange={onMeta} mobileAction={act('new')}>
        <PageHeader title={T[locale].title} primaryAction={act('create')} secondaryActions={[act('export')]} overflowActions={[act('manual')]} />
      </Page>,
      { locale },
    );
    await waitFor(() => {
      const last = onMeta.mock.calls.at(-1)?.[0];
      expect(last?.headerActions.map((a) => a.id)).toEqual(['create', 'export', 'manual']);
    });
    const last = onMeta.mock.calls.at(-1)![0];
    expect(last.title).toBe(T[locale].title);
    expect(last.backHref).toBe('/app');
    expect(last.mobileAction?.id).toBe('new');
    expect(last.mobileOverflow.map((a) => a.id)).toEqual(['export', 'manual']);
  });
});

describe.each(LOCALES)('PageHeader (%s)', (locale) => {
  it('renders title, locale-formatted count, subtitle and meta', () => {
    renderDs(<PageHeader title={T[locale].title} count={1284} subtitle="sub" meta={<span>{'meta'}</span>} />, { locale });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(T[locale].title);
    expect(screen.getByTestId('page-header-count').textContent).toBe(locale === 'tr' ? '1.284' : '1,284');
    expect(screen.getByTestId('page-header-subtitle').textContent).toBe('sub');
    expect(screen.getByTestId('page-header-meta').textContent).toBe('meta');
  });

  it('shows one primary, at most 2 secondaries and moves the rest to ⋯ (danger last)', () => {
    renderDs(
      <PageHeader
        title="t"
        primaryAction={act('primary')}
        secondaryActions={[act('s1'), act('s2'), act('s3')]}
        overflowActions={[act('del', { tone: 'danger' }), act('o1')]}
      />,
      { locale },
    );
    expect(screen.getByTestId('action-primary')).toBeTruthy();
    expect(screen.getByTestId('action-s1')).toBeTruthy();
    expect(screen.getByTestId('action-s2')).toBeTruthy();
    expect(screen.queryByTestId('action-s3')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: T[locale].more }));
    const items = screen.getAllByRole('menuitem').map((el) => el.getAttribute('data-testid'));
    expect(items).toEqual(['menu-s3', 'menu-o1', 'menu-del']);
  });

  it('renders a back link with the translated default label', () => {
    renderDs(<PageHeader title="t" backHref="/app/etsy-listings" />, { locale });
    const back = screen.getByTestId('page-header-back');
    expect(back.getAttribute('href')).toBe('/app/etsy-listings');
    expect(back.textContent).toBe(T[locale].back);
  });

  it('wraps a disabled action with its reason and keeps the button disabled', () => {
    renderDs(<PageHeader title="t" primaryAction={act('send', { disabled: true, disabledReason: 'limit' })} />, { locale });
    expect((screen.getByTestId('action-send') as HTMLButtonElement).disabled).toBe(true);
  });

  it('mobile: compact title row, actions in ⋯, primary in the StickyActionBar', () => {
    renderDs(
      <PageHeader title={T[locale].title} primaryAction={act('create')} secondaryActions={[act('export')]} />,
      { locale, viewport: 'mobile' },
    );
    const header = screen.getByTestId('page-header');
    expect(header.getAttribute('data-layout')).toBe('mobile');
    expect(screen.queryByTestId('action-export')).toBeNull();
    const bar = screen.getByTestId('sticky-action-bar');
    expect(bar.getAttribute('data-layout')).toBe('mobile');
    expect(within(bar).getByTestId('action-create')).toBeTruthy();
  });

  it('mobile under a shell-managed Page: no title row (the TopBar owns it)', () => {
    renderDs(
      <Page title="t" width="list" shellManaged>
        <PageHeader title="t" meta={<span>{'m'}</span>} mobilePrimary="none" primaryAction={act('p')} />
      </Page>,
      { locale, viewport: 'mobile' },
    );
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByTestId('page-header-meta').textContent).toBe('m');
    expect(screen.queryByTestId('sticky-action-bar')).toBeNull();
  });
});

describe('PageHeader helpers', () => {
  it('splitHeaderActions caps visible secondaries at 2', () => {
    const r = splitHeaderActions([act('a'), act('b'), act('c')], [act('d')]);
    expect(r.visible.map((a) => a.id)).toEqual(['a', 'b']);
    expect(r.overflow.map((a) => a.id)).toEqual(['c', 'd']);
  });
  it('orderMenuItems puts danger last behind a divider', () => {
    expect(orderMenuItems([act('x', { tone: 'danger' }), act('y')]).map((i) => (i === 'divider' ? i : i.id))).toEqual(['y', 'divider', 'x']);
  });
});

describe.each(LOCALES)('SyncMeta (%s)', (locale) => {
  const now = new Date('2026-10-15T10:42:00Z');
  const twelveMinAgo = new Date('2026-10-15T10:30:00Z');

  it('idle: names the source and the relative time', () => {
    renderDs(<SyncMeta source="etsy" state="idle" lastPulledAt={twelveMinAgo} now={now} onPull={() => undefined} />, { locale });
    const text = screen.getByTestId('sync-meta').textContent ?? '';
    expect(text).toContain('Etsy');
    expect(text).toMatch(locale === 'en' ? /Refreshed from Etsy 12 min ago/ : /Etsy'den 12 dk önce yenilendi/);
    expect(screen.getByRole('button', { name: locale === 'en' ? 'Refresh from Etsy' : "Etsy'den yenile" })).toBeTruthy();
  });

  it('idle without a time shows only ⟳ (never a guessed time)', () => {
    renderDs(<SyncMeta source="all" state="idle" onPull={() => undefined} />, { locale });
    expect(screen.getByTestId('sync-meta').textContent).toBe('');
    expect(screen.getByTestId('sync-meta-pull')).toBeTruthy();
  });

  it('pulling with progress disables ⟳', () => {
    renderDs(<SyncMeta source="etsy" state="pulling" progress={{ done: 120, total: 1340 }} onPull={() => undefined} />, { locale });
    const text = screen.getByTestId('sync-meta').textContent ?? '';
    expect(text).toContain(locale === 'en' ? 'Refreshing from Etsy…' : "Etsy'den yenileniyor…");
    expect(text).toContain(locale === 'en' ? '120 / 1,340' : '120 / 1.340');
    expect((screen.getByTestId('sync-meta-pull') as HTMLButtonElement).disabled).toBe(true);
  });

  it('failed shows the cause in danger and a Retry that pulls', () => {
    const onPull = vi.fn();
    renderDs(<SyncMeta source="ebay" state="failed" onPull={onPull} />, { locale });
    expect(screen.getByTestId('sync-meta').textContent).toContain(locale === 'en' ? "Couldn't refresh from eBay" : "eBay'den yenilenemedi");
    fireEvent.click(screen.getByTestId('sync-meta-retry'));
    expect(onPull).toHaveBeenCalledTimes(1);
  });

  it('custom copy for non-marketplace subjects (orders)', () => {
    renderDs(
      <SyncMeta
        source="all"
        state="idle"
        lastPulledAt={twelveMinAgo}
        now={now}
        copy={{ refreshed: (r) => `Orders refreshed ${r}`, refreshing: 'Refreshing orders…', failed: "Couldn't refresh orders", pullLabel: 'Refresh orders' }}
        onPull={() => undefined}
      />,
      { locale },
    );
    expect(screen.getByTestId('sync-meta').textContent).toMatch(/^Orders refreshed 12/);
  });

  it('disabled reason blocks the pull', () => {
    renderDs(<SyncMeta source="etsy" state="idle" pullDisabledReason="paused" onPull={() => undefined} />, { locale });
    expect((screen.getByTestId('sync-meta-pull') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe.each(LOCALES)('Section (%s)', (locale) => {
  it('plain: heading + description + ghost action', () => {
    const onClick = vi.fn();
    renderDs(
      <Section id="s" title="Title" description="desc" action={{ id: 'all', label: 'View all', onClick }}>
        <p>{'content'}</p>
      </Section>,
      { locale },
    );
    const section = screen.getByTestId('ds-section');
    expect(section.getAttribute('data-variant')).toBe('plain');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Title');
    expect(section.getAttribute('aria-labelledby')).toBe('s-title');
    fireEvent.click(screen.getByTestId('action-all'));
    expect(onClick).toHaveBeenCalled();
  });

  it('card variant with h3', () => {
    renderDs(
      <Section variant="card" title="Card" headingLevel={3}>
        <p>{'c'}</p>
      </Section>,
      { locale },
    );
    expect(screen.getByTestId('ds-section').getAttribute('data-variant')).toBe('card');
    expect(screen.getByRole('heading', { level: 3 })).toBeTruthy();
  });
});

describe.each(LOCALES)('StickyActionBar (%s)', (locale) => {
  it('desktop: status, secondary, primary, ⋯', () => {
    renderDs(
      <StickyActionBar status="Saved · 3 edits not sent yet" primary={act('send')} secondary={act('discard')} overflow={[act('o')]} />,
      { locale },
    );
    const bar = screen.getByTestId('sticky-action-bar');
    expect(bar.getAttribute('data-layout')).toBe('desktop');
    expect(screen.getByTestId('sticky-action-bar-status').textContent).toContain('3 edits');
    expect(screen.getByTestId('action-send')).toBeTruthy();
    expect(screen.getByTestId('action-discard')).toBeTruthy();
    expect(screen.getByRole('button', { name: T[locale].more })).toBeTruthy();
  });

  it('mobile: fixed bar; hidden when visible=false', () => {
    const { rerender } = renderDs(<StickyActionBar primary={act('go')} />, { locale, viewport: 'mobile' });
    expect(screen.getByTestId('sticky-action-bar').getAttribute('data-layout')).toBe('mobile');
    rerender(<StickyActionBar primary={act('go')} visible={false} variant="mobile" />);
    expect(screen.queryByTestId('sticky-action-bar')).toBeNull();
  });
});

describe.each(LOCALES)('Page / PageHeader shell reporting (%s)', (locale) => {
  it('does not re-emit meta when a parent re-renders with new inline mobileAction / breadcrumbs', async () => {
    const onMeta = vi.fn<[PageShellMeta], void>();
    const ui = (n: number) => (
      <Page
        title={T[locale].title}
        width="list"
        onShellMetaChange={onMeta}
        breadcrumbs={[{ label: 'Orders', href: '/app/orders' }]}
        mobileAction={{ id: 'new', label: 'New', onClick: () => n }}
      >
        <PageHeader title={T[locale].title} primaryAction={{ id: 'create', label: 'Create', onClick: () => n }} />
      </Page>
    );
    const { rerender } = renderDs(ui(1), { locale });
    await waitFor(() => expect(onMeta.mock.calls.at(-1)?.[0].headerActions.map((a) => a.id)).toEqual(['create']));
    const calls = onMeta.mock.calls.length;
    rerender(ui(2));
    rerender(ui(3));
    expect(onMeta.mock.calls.length).toBe(calls);
    // A displayed change does re-emit.
    rerender(
      <Page title={T[locale].title} width="list" onShellMetaChange={onMeta} breadcrumbs={[{ label: 'Orders', href: '/app/orders' }]} mobileAction={{ id: 'new', label: 'New', disabled: true, disabledReason: 'Limit' }}>
        <PageHeader title={T[locale].title} primaryAction={{ id: 'create', label: 'Create', onClick: () => 4 }} />
      </Page>,
    );
    await waitFor(() => expect(onMeta.mock.calls.at(-1)?.[0].mobileAction?.disabledReason).toBe('Limit'));
  });

  it('reported actions call the latest onClick; a changed disabledReason is re-reported', async () => {
    const onMeta = vi.fn<[PageShellMeta], void>();
    const first = vi.fn();
    const second = vi.fn();
    const ui = (onClick: () => void, reason?: string) => (
      <Page title="x" width="list" onShellMetaChange={onMeta}>
        <PageHeader title="x" overflowActions={[{ id: 'export', label: 'Export', onClick, disabled: Boolean(reason), disabledReason: reason }]} />
      </Page>
    );
    const { rerender } = renderDs(ui(first), { locale });
    await waitFor(() => expect(onMeta.mock.calls.at(-1)?.[0].headerActions.map((a) => a.id)).toEqual(['export']));
    const calls = onMeta.mock.calls.length;
    rerender(ui(second));
    expect(onMeta.mock.calls.length).toBe(calls);
    onMeta.mock.calls.at(-1)![0].headerActions[0].onClick?.();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    rerender(ui(second, 'Usage limit reached'));
    await waitFor(() => expect(onMeta.mock.calls.at(-1)?.[0].headerActions[0].disabledReason).toBe('Usage limit reached'));
  });

  it("shellManaged + mobilePrimary='menu' puts the primary first in mobileOverflow", async () => {
    const onMeta = vi.fn<[PageShellMeta], void>();
    renderDs(
      <Page title="x" width="list" shellManaged onShellMetaChange={onMeta}>
        <PageHeader title="x" mobilePrimary="menu" primaryAction={act('manual')} secondaryActions={[act('export')]} />
      </Page>,
      { locale, viewport: 'mobile' },
    );
    await waitFor(() => expect(onMeta.mock.calls.at(-1)?.[0].mobileOverflow.map((a) => a.id)).toEqual(['manual', 'export']));
  });

  it("sticky mobilePrimary keeps the primary out of mobileOverflow", async () => {
    const onMeta = vi.fn<[PageShellMeta], void>();
    renderDs(
      <Page title="x" width="list" shellManaged onShellMetaChange={onMeta}>
        <PageHeader title="x" primaryAction={act('save')} secondaryActions={[act('export')]} />
      </Page>,
      { locale, viewport: 'mobile' },
    );
    await waitFor(() => expect(onMeta.mock.calls.at(-1)?.[0].mobileOverflow.map((a) => a.id)).toEqual(['export']));
  });
});

describe.each(LOCALES)('SyncMeta freshness (%s)', (locale) => {
  afterEach(() => vi.useRealTimers());
  it('re-renders the relative time while idle when no `now` is passed', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-10-15T10:32:00Z'));
    renderDs(<SyncMeta source="etsy" state="idle" lastPulledAt={new Date('2026-10-15T10:30:00Z')} onPull={() => undefined} />, { locale });
    expect(screen.getByTestId('sync-meta').textContent).toContain(locale === 'en' ? '2 min ago' : '2 dk önce');
    rtlAct(() => {
      // Ten minutes idle: the 30 s tick re-renders (advancing timers also advances the fake clock).
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(screen.getByTestId('sync-meta').textContent).toContain(locale === 'en' ? '12 min ago' : '12 dk önce');
  });

  it('TR ablative follows the brand (Trendyol\'dan, Wix\'ten); unknown sources fall back', () => {
    renderDs(<SyncMeta source="trendyol" state="failed" onPull={() => undefined} />, { locale });
    expect(screen.getByTestId('sync-meta').textContent).toContain(locale === 'en' ? "Couldn't refresh from Trendyol" : "Trendyol'dan yenilenemedi");
    cleanup();
    renderDs(<SyncMeta source="wix" state="pulling" />, { locale });
    expect(screen.getByTestId('sync-meta').textContent).toContain(locale === 'en' ? 'Refreshing from Wix…' : "Wix'ten yenileniyor…");
    cleanup();
    renderDs(<SyncMeta source="Acme" state="failed" />, { locale });
    expect(screen.getByTestId('sync-meta').textContent).toContain(locale === 'en' ? "Couldn't refresh from Acme" : 'Acme kaynağından yenilenemedi');
  });
});

describe.each(LOCALES)('touch targets (%s)', (locale) => {
  it('the ⋯ trigger grows to 44 on pointer: coarse', () => {
    renderDs(<ActionMenu items={[act('a')]} />, { locale });
    expect(hasCoarse44(screen.getByTestId('action-menu'))).toBe(true);
  });
});
