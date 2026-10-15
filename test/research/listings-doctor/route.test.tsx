// @vitest-environment jsdom
// research R1-D route: /app/research/listings always renders ResearchLayout (tab listings) + ListingDoctor. The
// `research` flag is retired: no pending phase, no legacy redirect, no legacy link.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const router = { query: {} as Record<string, string>, isReady: true, replace: vi.fn(async () => true), push: vi.fn(async () => true) };
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/components/withAuth', () => ({ default: (C: React.ComponentType) => C }));
const setMkt = vi.fn();
vi.mock('@/components/domain/research/ResearchLayout', () => ({
  useResearchMkt: () => ({ mkt: 'ebay', setMkt, explicit: true, options: [], connected: {} }),
  ResearchLayout: ({ tab, children }: { tab: string; children: React.ReactNode }) => <div data-testid={`layout-${tab}`}>{children}</div>,
}));
vi.mock('@/components/domain/research/listings/ListingDoctor', () => ({
  ListingDoctor: ({ mkt }: { mkt: string }) => <div data-testid={`doctor-${mkt}`} />,
}));

import Route from '@/pages/app/research/listings';
import * as RouteModule from '@/pages/app/research/listings';

beforeEach(() => {
  router.query = {};
  router.replace.mockClear();
});
afterEach(cleanup);

describe('/app/research/listings', () => {
  it('first render → ListingDoctor for the hub marketplace, never a replace', () => {
    render(<Route />);
    expect(screen.getByTestId('layout-listings')).toBeTruthy();
    expect(screen.getByTestId('doctor-ebay')).toBeTruthy();
    expect(screen.queryByTestId('research-legacy-link')).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('exports no legacy href helper any more', () => {
    expect('legacyDoctorHref' in RouteModule).toBe(false);
  });
});
