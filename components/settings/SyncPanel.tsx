// Settings › Refresh history entry point (settings §8, §17 Group C).
// Inside the new SettingsPage (flag `settings`, SettingsShellContext present) it renders the DS RefreshOverview.
// On the legacy page it renders the legacy body, moved unchanged to components/legacy/settings/SyncPanelLegacy.tsx.
import { RefreshOverview, type RefreshOverviewProps } from '@/components/domain/settings/refresh';
import { useSettingsShell } from '@/components/domain/settings/settingsNav';
import SyncPanelLegacy from '@/components/legacy/settings/SyncPanelLegacy';

export type SyncPanelProps = RefreshOverviewProps;

export default function SyncPanel(props: SyncPanelProps) {
  const shell = useSettingsShell();
  return shell ? <RefreshOverview {...props} /> : <SyncPanelLegacy />;
}
