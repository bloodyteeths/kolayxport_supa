// @vitest-environment jsdom
// orders G2: /app/labels renders the Orders page (orders §1.1) behind withAuth.
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@/components/withAuth', () => ({ default: (C: React.ComponentType) => C }));
vi.mock('@/components/domain/orders/OrdersPage', () => ({ default: () => <div data-testid="new-orders" /> }));

import LabelsRoute from '@/pages/app/labels';

afterEach(cleanup);

describe('/app/labels', () => {
  it('renders the Orders page', () => {
    render(<LabelsRoute />);
    expect(screen.getByTestId('new-orders')).toBeTruthy();
  });
});
