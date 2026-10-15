// @vitest-environment jsdom
// overview G6: /app is a flag switch (§8 G6): `overview` on → OverviewPage (behind withAuth) with the Stripe
// `session_id` toast, off → the legacy landing page moved verbatim to components/legacy/LegacyOverview.js.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const flag = { overview: false };
const router = { query: {} as Record<string, string> };
const toast = { success: vi.fn() };
vi.mock('@/lib/ds/uiFlags', () => ({ useUiFlag: (key: string) => (key === 'overview' ? flag.overview : false) }));
vi.mock('@/components/withAuth', () => ({ default: (C: React.ComponentType) => C }));
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('next-intl', () => ({ useTranslations: (ns: string) => (k: string) => `${ns}.${k}` }));
vi.mock('@/components/ds/feedback/toast', () => ({ useToast: () => toast }));
vi.mock('@/components/domain/overview/OverviewPage', () => ({ default: () => <div data-testid="new-overview" /> }));
vi.mock('@/components/legacy/LegacyOverview', () => ({ default: () => <div data-testid="legacy-overview" /> }));

import AppIndexRoute from '@/pages/app/index';

beforeEach(() => {
  router.query = {};
  toast.success.mockClear();
});
afterEach(cleanup);

describe('/app flag switch', () => {
  it('flag off → legacy overview (it keeps its own toast)', () => {
    flag.overview = false;
    router.query = { session_id: 'cs_1' };
    render(<AppIndexRoute />);
    expect(screen.getByTestId('legacy-overview')).toBeTruthy();
    expect(screen.queryByTestId('new-overview')).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it('flag on → new Overview, session_id toast once', () => {
    flag.overview = true;
    router.query = { session_id: 'cs_1' };
    const view = render(<AppIndexRoute />);
    view.rerender(<AppIndexRoute />);
    expect(screen.getByTestId('new-overview')).toBeTruthy();
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('overview.subscriptionActivated');
  });
  it('flag on without session_id → no toast', () => {
    flag.overview = true;
    render(<AppIndexRoute />);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
