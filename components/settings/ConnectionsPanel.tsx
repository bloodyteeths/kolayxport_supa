// Settings › Connections entry point (settings §17 Group B).
// Inside the new SettingsPage (flag `settings`, SettingsShellContext present) it renders the DS rebuild
// (components/domain/settings/connections/ConnectionsSection). On the legacy page it renders the legacy
// body, moved unchanged to components/legacy/settings/ConnectionsPanelLegacy.tsx.
import { ConnectionsSection } from '@/components/domain/settings/connections';
import { useSettingsShell } from '@/components/domain/settings/settingsNav';
import ConnectionsPanelLegacy from '@/components/legacy/settings/ConnectionsPanelLegacy';

export interface ConnectionsPanelProps {
  /** Bump to refetch provider details (e.g. after an OAuth callback). */
  refreshKey: number;
}

export default function ConnectionsPanel({ refreshKey }: ConnectionsPanelProps) {
  const shell = useSettingsShell();
  return shell ? <ConnectionsSection refreshKey={refreshKey} /> : <ConnectionsPanelLegacy refreshKey={refreshKey} />;
}
