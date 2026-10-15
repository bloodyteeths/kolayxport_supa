// @vitest-environment jsdom
// components/settings/BillingPanel.tsx: new Billing tab inside the new SettingsPage (shell context),
// the moved legacy panel on the legacy page (flag `settings` off).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import BillingPanel from '@/components/settings/BillingPanel';
import { SettingsShellContext, type SettingsShellValue } from '@/components/domain/settings/settingsNav';

vi.mock('@/components/domain/billing/BillingPanel', () => ({ BillingPanel: () => <div data-testid="new-billing" /> }));
vi.mock('@/components/legacy/settings/BillingPanelLegacy', () => ({ default: () => <div data-testid="legacy-billing" /> }));

afterEach(cleanup);

describe('settings/BillingPanel shim', () => {
  it('legacy page (no shell): legacy panel', () => {
    render(<BillingPanel subscriptionData={null} ready />);
    expect(screen.getByTestId('legacy-billing')).toBeTruthy();
  });

  it('new SettingsPage (shell): new Billing tab', () => {
    render(
      <SettingsShellContext.Provider value={{ tab: 'billing' } as unknown as SettingsShellValue}>
        <BillingPanel subscriptionData={null} ready />
      </SettingsShellContext.Provider>,
    );
    expect(screen.getByTestId('new-billing')).toBeTruthy();
  });
});
