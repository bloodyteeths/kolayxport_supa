// @vitest-environment jsdom
// orders G2: /app/labels is a flag switch (orders §1.1, BUILD_PLAN §3): `orders` on → new OrdersPage
// (behind withAuth), off → the legacy labels page moved unchanged to components/legacy/LegacyLabelsPage.tsx.
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const flag = { orders: false };
vi.mock('@/lib/ds/uiFlags', () => ({ useUiFlag: (key: string) => (key === 'orders' ? flag.orders : false) }));
vi.mock('@/components/withAuth', () => ({ default: (C: React.ComponentType) => C }));
vi.mock('@/components/domain/orders/OrdersPage', () => ({ default: () => <div data-testid="new-orders" /> }));
vi.mock('@/components/legacy/LegacyLabelsPage', () => ({ default: () => <div data-testid="legacy-labels" /> }));

import LabelsRoute from '@/pages/app/labels';

afterEach(cleanup);

describe('/app/labels flag switch', () => {
  it('flag off → legacy labels page', () => {
    flag.orders = false;
    render(<LabelsRoute />);
    expect(screen.getByTestId('legacy-labels')).toBeTruthy();
    expect(screen.queryByTestId('new-orders')).toBeNull();
  });
  it('flag on → new Orders page', () => {
    flag.orders = true;
    render(<LabelsRoute />);
    expect(screen.getByTestId('new-orders')).toBeTruthy();
    expect(screen.queryByTestId('legacy-labels')).toBeNull();
  });
});
