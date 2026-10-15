// @vitest-environment jsdom
// M9 Group C: /app/reports is a flag switch (§0.3). `reports` on → the Sales report; off → router.replace to the legacy
// Home (/app/analytics) with the query kept, after the viewer's `?ui=` override is known (never on the first render).
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

const flag = { reports: false };
const router = { isReady: true, query: {} as Record<string, string>, replace: vi.fn(async () => true) };
vi.mock('@/lib/ds/uiFlags', () => ({
  defaultUiFlags: () => new Set(flag.reports ? ['reports'] : []),
  readClientUiOverride: () => null,
  resolveUiFlag: (key: string, defaults: Set<string>) => defaults.has(key),
  useUiFlag: (key: string) => (key === 'reports' ? flag.reports : false),
}));
vi.mock('@/components/withAuth', () => ({ default: (C: React.ComponentType) => C }));
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('@/components/domain/reports/sales/SalesReport', () => ({ SalesReport: () => <div data-testid="new-sales" /> }));

import ReportsIndexRoute from '@/pages/app/reports/index';

beforeEach(() => {
  router.query = {};
  router.replace.mockClear();
});
afterEach(cleanup);

describe('/app/reports flag switch', () => {
  it('flag on → Sales report', async () => {
    flag.reports = true;
    render(<ReportsIndexRoute />);
    await act(async () => {});
    expect(screen.getByTestId('new-sales')).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('flag off → legacy Home with the query', async () => {
    flag.reports = false;
    router.query = { preset: 'last7' };
    render(<ReportsIndexRoute />);
    await act(async () => {});
    expect(screen.queryByTestId('new-sales')).toBeNull();
    expect(router.replace).toHaveBeenCalledWith('/app/analytics?preset=last7');
  });
});
