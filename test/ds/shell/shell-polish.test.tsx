// @vitest-environment jsdom
// Shell polish: Trendyol's square small-size tile, the sidebar dot's own reason tooltip, and the neutral
// SoundToggleHost around the backend LiveSoundToggle (desktop TopBar, mobile top bar, More sheet).
import * as React from 'react';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

vi.mock('next/router', () => ({ useRouter: () => ({ asPath: '/', pathname: '/', push: vi.fn(), events: { on() {}, off() {} } }) }));
vi.mock('@/components/live/LiveSoundToggle', () => ({
  // Mirrors the real markup: an MUI IconButton with an SvgIcon whose inline color is the backend's palette.
  default: () => (
    <button type="button" className="MuiIconButton-root" aria-pressed="true" data-testid="live-sound-toggle" aria-label="sound">
      <svg className="MuiSvgIcon-root" data-testid="VolumeDownRoundedIcon" style={{ color: 'rgb(237, 108, 2)' }} />
    </button>
  ),
}));
vi.mock('@/lib/hooks/useNotifications', () => ({
  useNotifications: () => ({ items: [], unreadCount: 0, isLoading: false, error: undefined, markRead: async () => {}, markAllRead: async () => {}, refresh: async () => undefined }),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { name: 'A', email: 'a@example.com', image: null }, supabaseSignOut: async () => {} }) }));
vi.mock('@/components/notification-center/NotificationPanel', () => ({ default: () => <div /> }));

import { LOGOS, WORDMARK_MIN_SIZE, logoSrc } from '@/lib/ds/logos';
import { LogoTile } from '@/components/ds/data/LogoTile';
import { NEEDS_GESTURE_ICON_SELECTOR, SoundToggleHost, soundToggleHostSx } from '@/components/ds/shell/SoundToggleHost';
import { MoreSheetConnected } from '@/components/ds/shell/MoreSheet';
import { neutral as n, tone } from '@/lib/ds/tokens';
import { useShellStore } from '@/lib/nav/useShellStore';
import { SideNav } from '@/components/ds/shell/SideNav';
import { SideNavItem } from '@/components/ds/shell/SideNavItem';
import { TopBar } from '@/components/ds/shell/TopBar';
import type { NavItem } from '@/lib/nav/useNavModel';
import { renderShell, sampleModel } from './desktop-helpers';

afterEach(cleanup);

const pub = (p: string) => join(process.cwd(), 'public', p.replace(/^\//, ''));

describe('logo registry: legible at 16-20 px', () => {
  it('every src / monoSrc / wordmarkSrc file exists', () => {
    for (const a of Object.values(LOGOS)) {
      for (const p of [a.src, a.monoSrc, a.wordmarkSrc].filter(Boolean) as string[]) expect(existsSync(pub(p)), p).toBe(true);
    }
  });

  it('Trendyol uses a square tile at small sizes; eBay keeps the spec\'d four-color letters', () => {
    expect(LOGOS.ebay.src).toBe('/logos/ebay.svg');
    expect(LOGOS.ebay.wordmarkSrc).toBeUndefined();
    expect(LOGOS.trendyol.src).toBe('/logos/trendyol-square.svg');
    expect(LOGOS.trendyol.monoSrc).toBe('/logos/trendyol-square-mono.svg');
    expect(LOGOS.trendyol.fullBleed).toBe(true);
    for (const size of [16, 20, 24]) {
      expect(logoSrc(LOGOS.trendyol, size)).toBe('/logos/trendyol-square.svg');
      expect(logoSrc(LOGOS.ebay, size)).toBe('/logos/ebay.svg');
    }
    expect(logoSrc(LOGOS.trendyol, WORDMARK_MIN_SIZE)).toBe('/logos/trendyol.png');
    expect(logoSrc(LOGOS.trendyol, 40, 'mono')).toBe('/logos/trendyol-square-mono.svg');
    expect(logoSrc(LOGOS.etsy, 40)).toBe('/logos/etsy.svg');
  });

  it('LogoTile (today) draws the square Trendyol src and the eBay letters at every size', () => {
    for (const size of [16, 40] as const) {
      const { container, unmount } = renderShell(<><LogoTile brand="trendyol" size={size} /><LogoTile brand="ebay" size={size} /></>);
      expect(container.querySelector('[data-brand="trendyol"] img')?.getAttribute('src')).toBe('/logos/trendyol-square.svg');
      expect(container.querySelector('[data-brand="ebay"] img')?.getAttribute('src')).toBe('/logos/ebay.svg');
      unmount();
    }
  });

  it('square SVGs are square 24 x 24 with role="img" and a title', () => {
    for (const f of ['trendyol-square.svg', 'trendyol-square-mono.svg']) {
      const svg = readFileSync(pub(`logos/${f}`), 'utf8');
      expect(svg, f).toContain('viewBox="0 0 24 24"');
      expect(svg, f).toContain('role="img"');
      expect(svg, f).toContain('<title>Trendyol</title>');
    }
    expect(readFileSync(pub('logos/trendyol-square-mono.svg'), 'utf8')).toContain('fill="currentColor"');
    expect(readFileSync(pub('logos/trendyol-square.svg'), 'utf8')).toContain('#F27A1A');
  });
});

describe('SideNavItem dot reason', () => {
  it('expanded: Etsy unsent and Trendyol reconnect dots expose their reason on hover', async () => {
    renderShell(<SideNav model={sampleModel()} viewport="wide" mode="expanded" onToggle={() => {}} />);
    const etsyHint = screen.getByTestId('nav-dot-listings-etsy-hint');
    expect(etsyHint.getAttribute('data-reason')).toBe('7 changes not sent yet');
    expect(screen.getByTestId('nav-dot-listings-trendyol-hint').getAttribute('data-reason')).toBe('Trendyol needs reconnecting');
    // The link still carries the sentence for screen readers.
    expect(screen.getByTestId('nav-item-listings-etsy').getAttribute('aria-label')).toBe('Etsy listings, 7 changes not sent yet');
    fireEvent.mouseOver(etsyHint);
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toContain('7 changes not sent yet'));
  });

  it('an eBay unsent dot gets the same hint', () => {
    const item: NavItem = {
      ...(sampleModel().topGroups.flatMap((g) => g.items).find((i) => i.id === 'listings-etsy') as NavItem),
      id: 'listings-ebay',
      brand: 'ebay',
      label: 'eBay',
      ariaLabel: 'eBay listings',
      dot: 'attention',
      dotLabel: '2 changes not sent yet',
    };
    renderShell(<ul><SideNavItem item={item} rail={false} /></ul>);
    expect(screen.getByTestId('nav-dot-listings-ebay-hint').getAttribute('data-reason')).toBe('2 changes not sent yet');
    expect(screen.getByTestId('nav-item-listings-ebay').querySelector('[data-brand="ebay"] img')?.getAttribute('src')).toBe('/logos/ebay.svg');
  });

  it('rail: no separate hint (the row tooltip already carries the reason)', () => {
    renderShell(<SideNav model={sampleModel()} viewport="wide" mode="rail" onToggle={() => {}} />);
    expect(screen.getByTestId('nav-dot-listings-etsy')).toBeTruthy();
    expect(screen.queryByTestId('nav-dot-listings-etsy-hint')).toBeNull();
  });
});

describe('SoundToggleHost', () => {
  it('TopBar hosts the backend LiveSoundToggle inside the neutral container', () => {
    renderShell(
      <TopBar
        breadcrumbs={sampleModel('/app/etsy-listings').breadcrumbs}
        user={{ name: 'A', email: 'a@example.com', image: null }}
        signedIn
        onOpenPalette={() => {}}
        onShowShortcuts={() => {}}
        onSignOut={() => {}}
      />,
    );
    const host = screen.getByTestId('topbar-sound-host');
    expect(host.getAttribute('data-size')).toBe('sm');
    expect(host.contains(screen.getByTestId('live-sound-toggle'))).toBe(true);
  });

  it('neutralizes the backend icon colors and keeps a DS warning tone for "needs a click"', () => {
    const sx = soundToggleHostSx('sm') as Record<string, Record<string, unknown>>;
    expect(sx['& .MuiIconButton-root .MuiSvgIcon-root'].color).toBe(n[500]);
    expect(sx['& .MuiIconButton-root[aria-pressed="false"] .MuiSvgIcon-root'].color).toBe(n[400]);
    const needsKey = `& .MuiIconButton-root .MuiSvgIcon-root${NEEDS_GESTURE_ICON_SELECTOR}`;
    expect(sx[needsKey].color).toBe(tone.warning.fg);
    // The needs-gesture rule comes after the hover rule so it wins at equal specificity.
    const keys = Object.keys(sx);
    expect(keys.indexOf(needsKey)).toBeGreaterThan(keys.indexOf('& .MuiIconButton-root:hover .MuiSvgIcon-root'));
    expect((soundToggleHostSx('touch') as Record<string, Record<string, unknown>>)['& .MuiIconButton-root'].width).toBe(44);
  });

  it('the injected rule targets the real icon markup', () => {
    renderShell(<SoundToggleHost data-testid="h"><span data-testid="slot" /></SoundToggleHost>);
    const css = Array.from(document.querySelectorAll('style')).map((st) => st.textContent ?? '').join('\n');
    expect(css).toMatch(/\.MuiIconButton-root \.MuiSvgIcon-root\[data-testid="VolumeDownRoundedIcon"\]\{color:#B45309;?\}/i);
  });

  it('More sheet renders the toggle inside a touch-size host', async () => {
    act(() => useShellStore.getState().setMoreOpen(true));
    renderShell(<MoreSheetConnected ctx={{ model: sampleModel(), signedIn: true, signOut: async () => {} }} />);
    const host = await screen.findByTestId('more-sheet-sound-host');
    expect(host.getAttribute('data-size')).toBe('touch');
    expect(host.contains(screen.getByTestId('live-sound-toggle'))).toBe(true);
    act(() => useShellStore.getState().setMoreOpen(false));
  });
});
