// @vitest-environment jsdom
// overview G6: /app renders OverviewPage (behind withAuth) with the Stripe `session_id` toast (§8 G6).
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const router = { query: {} as Record<string, string> };
const toast = { success: vi.fn() };
vi.mock('@/components/withAuth', () => ({ default: (C: React.ComponentType) => C }));
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('next-intl', () => ({ useTranslations: (ns: string) => (k: string) => `${ns}.${k}` }));
vi.mock('@/components/ds/feedback/toast', () => ({ useToast: () => toast }));
vi.mock('@/components/domain/overview/OverviewPage', () => ({ default: () => <div data-testid="new-overview" /> }));

import AppIndexRoute from '@/pages/app/index';

beforeEach(() => {
  router.query = {};
  toast.success.mockClear();
});
afterEach(cleanup);

describe('/app', () => {
  it('renders the Overview, session_id toast once', () => {
    router.query = { session_id: 'cs_1' };
    const view = render(<AppIndexRoute />);
    view.rerender(<AppIndexRoute />);
    expect(screen.getByTestId('new-overview')).toBeTruthy();
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('overview.subscriptionActivated');
  });
  it('without session_id → no toast', () => {
    render(<AppIndexRoute />);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
