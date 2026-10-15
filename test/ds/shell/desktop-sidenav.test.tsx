// @vitest-environment jsdom
// SideNav / SideNavItem / SideNavFooter render tests (shell-nav §3.1, §3.2, §13): expanded rows and
// group labels, rail tooltips for every item, aria-current, dot text equivalents, counts, overlay, footer.
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within, waitFor } from '@testing-library/react';

vi.mock('next/router', () => ({ useRouter: () => ({ asPath: '/', pathname: '/', events: { on() {}, off() {} } }) }));

import { SideNav } from '@/components/ds/shell/SideNav';
import { deriveShellUsage } from '@/components/ds/shell/SideNavFooter';
import { renderShell, sampleModel } from './desktop-helpers';

afterEach(cleanup);

const allItems = (m: ReturnType<typeof sampleModel>) => [...m.topGroups, ...m.bottomGroups].flatMap((g) => g.items);

describe('SideNav expanded (≥ 1200)', () => {
  it.each(['en', 'tr'] as const)('renders every visible row with sentence-case group labels (%s)', (locale) => {
    const model = sampleModel('/app/etsy-listings', locale);
    renderShell(<SideNav model={model} viewport="wide" mode="expanded" onToggle={() => {}} usage={null} />, { locale });
    const nav = screen.getByRole('navigation', { name: locale === 'en' ? 'Main' : 'Ana menü' });
    for (const item of allItems(model)) expect(within(nav).getByTestId(`nav-item-${item.id}`)).toBeTruthy();
    expect(within(nav).getByText(locale === 'en' ? 'Listings' : 'İlanlar')).toBeTruthy();
    // Brand rows show the proper noun and use the real logo tile.
    const etsy = screen.getByTestId('nav-item-listings-etsy');
    expect(etsy.textContent).toContain('Etsy');
    expect(etsy.querySelector('[data-brand="etsy"]')).toBeTruthy();
  });

  it('marks exactly the active row with aria-current="page"', () => {
    renderShell(<SideNav model={sampleModel('/app/etsy-listings/42')} viewport="wide" mode="expanded" onToggle={() => {}} />);
    const current = document.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect((current[0] as HTMLElement).dataset.testid).toBe('nav-item-listings-etsy');
  });

  it('counts are neutral tabular text, red when overdue, with a text equivalent', () => {
    renderShell(<SideNav model={sampleModel()} viewport="wide" mode="expanded" onToggle={() => {}} />);
    const orders = screen.getByTestId('nav-item-orders');
    expect(screen.getByTestId('nav-count-orders').textContent).toBe('12');
    expect(orders.getAttribute('aria-label')).toBe('Orders, 12 to ship · 1 overdue');
    expect(screen.getByTestId('nav-count-messages').textContent).toBe('3');
  });

  it('a reconnect dot and an unsent dot each carry a sentence (dot is never the only signal)', () => {
    renderShell(<SideNav model={sampleModel()} viewport="wide" mode="expanded" onToggle={() => {}} />);
    expect(screen.getByTestId('nav-dot-listings-trendyol')).toBeTruthy();
    expect(screen.getByTestId('nav-item-listings-trendyol').getAttribute('aria-label')).toBe('Trendyol listings, Trendyol needs reconnecting');
    expect(screen.getByTestId('nav-item-listings-etsy').getAttribute('aria-label')).toBe('Etsy listings, 7 changes not sent yet');
    expect(screen.getByTestId('nav-item-settings').getAttribute('aria-label')).toBe('Settings, A store needs reconnecting');
  });

  it('footer: plan card with meters, and the collapse row with its [ shortcut', () => {
    const usage = deriveShellUsage(
      {
        subscriptionPlan: 'trial',
        subscriptionStatus: 'trialing',
        trialExpiresAt: new Date(Date.now() + 12 * 86_400_000 - 60_000).toISOString(),
        usageResetAt: null,
        orderSyncCount: 32,
        labelCount: 7,
        limits: { orderSync: 50, label: 10 },
      },
    );
    const onToggle = vi.fn();
    renderShell(<SideNav model={sampleModel()} viewport="wide" mode="expanded" onToggle={onToggle} usage={usage} />);
    const card = screen.getByTestId('usage-card');
    expect(card.textContent).toContain('Trial · 12 days left');
    expect(within(card).getAllByRole('meter')).toHaveLength(2);
    expect(card.getAttribute('href')).toBe('/ayarlar?tab=billing');
    const toggle = screen.getByTestId('sidenav-toggle');
    expect(toggle.getAttribute('aria-label')).toBe('Collapse sidebar');
    expect(toggle.getAttribute('aria-keyshortcuts')).toBe('[');
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('footer: Shopify-free shows one line and no bars; loading shows a skeleton', () => {
    const usage = deriveShellUsage({
      subscriptionPlan: 'shopify_free',
      subscriptionStatus: null,
      trialExpiresAt: null,
      usageResetAt: null,
      orderSyncCount: 0,
      labelCount: 0,
    });
    const { unmount } = renderShell(<SideNav model={sampleModel()} viewport="wide" mode="expanded" onToggle={() => {}} usage={usage} />);
    expect(screen.getByTestId('usage-card').textContent).toBe('Free via Shopify');
    expect(screen.queryAllByRole('meter')).toHaveLength(0);
    unmount();
    renderShell(<SideNav model={sampleModel()} viewport="wide" mode="expanded" onToggle={() => {}} usage={undefined} />);
    expect(screen.getByTestId('usage-skeleton')).toBeTruthy();
  });

  it('no model yet: brand row plus skeleton rows', () => {
    renderShell(<SideNav model={null} viewport="wide" mode="expanded" onToggle={() => {}} />);
    expect(screen.getByTestId('sidenav-brand')).toBeTruthy();
    expect(screen.getByTestId('sidenav-skeleton')).toBeTruthy();
  });
});

describe('SideNav rail (64 px)', () => {
  it('every rail item has a tooltip with its label (and the g shortcut when it has one)', async () => {
    const model = sampleModel('/app/labels');
    renderShell(<SideNav model={model} viewport="narrow" mode="rail" onToggle={() => {}} />, { viewport: 'narrow' });
    expect(screen.getByTestId('sidenav').getAttribute('data-mode')).toBe('rail');
    for (const item of allItems(model)) {
      const link = screen.getByTestId(`nav-item-${item.id}`);
      // Labels are not rendered as text in the rail; the link is named by aria-label.
      expect(link.getAttribute('aria-label')?.startsWith(item.ariaLabel)).toBe(true);
      fireEvent.mouseOver(link);
      const tip = await screen.findByRole('tooltip', {}, { timeout: 2000 });
      expect(tip.textContent).toContain(item.ariaLabel);
      if (item.gKey) expect(tip.textContent).toContain(`G ${item.gKey.toUpperCase()}`);
      fireEvent.mouseLeave(link);
      await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull(), { timeout: 2000 });
    }
  }, 30_000);

  it('rail counts become dots; the expand button says expand', () => {
    renderShell(<SideNav model={sampleModel()} viewport="narrow" mode="rail" onToggle={() => {}} />, { viewport: 'narrow' });
    expect(screen.queryByTestId('nav-count-orders')).toBeNull();
    expect(screen.getByTestId('nav-dot-orders')).toBeTruthy();
    expect(screen.getByTestId('sidenav-toggle').getAttribute('aria-label')).toBe('Expand sidebar');
  });

  it('900–1199 overlay: 240 px panel over the content, closes on outside click and on navigation', async () => {
    const onClose = vi.fn();
    renderShell(
      <div>
        <button type="button" data-testid="outside">
          x
        </button>
        <SideNav model={sampleModel()} viewport="narrow" mode="rail" overlayOpen onToggle={() => {}} onCloseOverlay={onClose} />
      </div>,
      { viewport: 'narrow' },
    );
    expect(screen.getByTestId('sidenav').getAttribute('data-mode')).toBe('overlay');
    // in-flow width stays the rail; labels render in the overlay
    expect(screen.getByTestId('nav-count-orders')).toBeTruthy();
    fireEvent.click(screen.getByTestId('nav-item-orders'));
    expect(onClose).toHaveBeenCalledTimes(1);
    // ClickAwayListener arms itself one tick after mount.
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.click(screen.getByTestId('outside'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
