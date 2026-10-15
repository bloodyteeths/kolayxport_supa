// @vitest-environment jsdom
// research R1-D route: /app/research/listings is gated by R1-C's `useResearchRouteGate` (two-phase: 'pending' on
// the first render, resolved in an effect once the viewer's `?ui=` override is read). on → ResearchLayout (tab
// listings) + ListingDoctor; off-redirect → the legacy tool (Etsy grader / eBay optimizer); off-link → a link.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const router = { query: {} as Record<string, string>, isReady: true, replace: vi.fn(async () => true), push: vi.fn(async () => true) };
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/components/withAuth', () => ({ default: (C: React.ComponentType) => C }));
vi.mock('@/components/ds/state/EmptyState', () => ({
  EmptyState: ({ action, ...p }: { action: { href: string }; 'data-testid'?: string }) => <a data-testid={p['data-testid']} href={action.href} />,
}));
vi.mock('@/lib/ds/icons', () => ({ icons: { research: 'research' } }));
type GateState = 'on' | 'off-redirect' | 'off-link';
let resolved: GateState = 'on';
const setMkt = vi.fn();
vi.mock('@/components/domain/research/ResearchLayout', () => ({
  useResearchMkt: () => ({ mkt: 'ebay', setMkt, explicit: true, options: [], connected: {} }),
  ResearchLayout: ({ tab, children }: { tab: string; children: React.ReactNode }) => <div data-testid={`layout-${tab}`}>{children}</div>,
  // Same two-phase shape as the real gate: 'pending' first, the resolved state after mount.
  useResearchRouteGate: () => {
    const [state, setState] = React.useState<'pending' | GateState>('pending');
    React.useEffect(() => setState(resolved), []);
    return { state };
  },
}));
vi.mock('@/components/domain/research/listings/ListingDoctor', () => ({
  ListingDoctor: ({ mkt }: { mkt: string }) => <div data-testid={`doctor-${mkt}`} />,
}));

import Route, { legacyDoctorHref } from '@/pages/app/research/listings';

beforeEach(() => {
  resolved = 'on';
  router.query = {};
  router.isReady = true;
  router.replace.mockClear();
});
afterEach(cleanup);

describe('/app/research/listings', () => {
  it('flag resolves on after a pending first render → ListingDoctor, never a replace (no legacy bounce)', () => {
    render(<Route />);
    expect(screen.getByTestId('layout-listings')).toBeTruthy();
    expect(screen.getByTestId('doctor-ebay')).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('off-redirect → forwards to the legacy tool for the marketplace', () => {
    resolved = 'off-redirect';
    router.query = { mkt: 'ebay' };
    render(<Route />);
    expect(router.replace).toHaveBeenCalledWith('/app/ebay-research?sub=listing_optimizer');
  });

  it('off-link (build default on, viewer opted out) → a link, no redirect', () => {
    resolved = 'off-link';
    render(<Route />);
    expect(screen.getByTestId('research-legacy-link').getAttribute('href')).toBe('/app/etsy-research?tab=grader');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('legacy targets', () => {
    expect(legacyDoctorHref(undefined)).toBe('/app/etsy-research?tab=grader');
    expect(legacyDoctorHref('etsy')).toBe('/app/etsy-research?tab=grader');
    expect(legacyDoctorHref('ebay')).toBe('/app/ebay-research?sub=listing_optimizer');
  });
});
