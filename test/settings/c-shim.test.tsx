// @vitest-environment jsdom
// components/settings/SenderProfilePanel.tsx + SyncPanel.tsx: DS sections inside the new SettingsPage (shell
// context), the moved legacy bodies on the legacy page (flag `settings` off).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import SenderProfilePanel from '@/components/settings/SenderProfilePanel';
import SyncPanel from '@/components/settings/SyncPanel';
import { SettingsShellContext, type SettingsShellValue } from '@/components/domain/settings/settingsNav';

vi.mock('@/components/domain/settings/sender', () => ({ SenderForm: () => <div data-testid="new-sender" /> }));
vi.mock('@/components/domain/settings/refresh', () => ({ RefreshOverview: () => <div data-testid="new-refresh" /> }));
vi.mock('@/components/legacy/settings/SenderProfilePanelLegacy', () => ({ default: () => <div data-testid="legacy-sender" /> }));
vi.mock('@/components/legacy/settings/SyncPanelLegacy', () => ({ default: () => <div data-testid="legacy-sync" /> }));

afterEach(cleanup);

const senderProps = {
  shipperProfile: {}, shippingSettings: {}, onChangeProfile: () => {}, onChangeShipping: () => {},
  importerJsonError: null, etgbCollapsed: false,
};
const shell = { tab: 'senderProfile' } as unknown as SettingsShellValue;

describe('settings group C shims', () => {
  it('legacy page (no shell): legacy sender + sync bodies', () => {
    render(<><SenderProfilePanel {...senderProps} /><SyncPanel /></>);
    expect(screen.getByTestId('legacy-sender')).toBeTruthy();
    expect(screen.getByTestId('legacy-sync')).toBeTruthy();
    expect(screen.queryByTestId('new-sender')).toBeNull();
    expect(screen.queryByTestId('new-refresh')).toBeNull();
  });

  it('new SettingsPage (shell): DS sender form + refresh overview', () => {
    render(
      <SettingsShellContext.Provider value={shell}>
        <SenderProfilePanel {...senderProps} />
        <SyncPanel />
      </SettingsShellContext.Provider>,
    );
    expect(screen.getByTestId('new-sender')).toBeTruthy();
    expect(screen.getByTestId('new-refresh')).toBeTruthy();
    expect(screen.queryByTestId('legacy-sender')).toBeNull();
  });
});
