// @vitest-environment jsdom
// M9 Group C: /app/reports renders the Sales report (§0.3), no redirect.
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const router = { isReady: true, query: {} as Record<string, string>, replace: vi.fn(async () => true) };
vi.mock('@/components/withAuth', () => ({ default: (C: React.ComponentType) => C }));
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('@/components/domain/reports/sales/SalesReport', () => ({ SalesReport: () => <div data-testid="new-sales" /> }));

import ReportsIndexRoute from '@/pages/app/reports/index';

afterEach(cleanup);

describe('/app/reports', () => {
  it('renders the Sales report', () => {
    render(<ReportsIndexRoute />);
    expect(screen.getByTestId('new-sales')).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
