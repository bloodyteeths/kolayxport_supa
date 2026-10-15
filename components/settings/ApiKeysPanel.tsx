// Settings › Carriers & API keys entry point (settings §17 Group B).
// Inside the new SettingsPage (flag `settings`, SettingsShellContext present) it renders the provider list
// (components/domain/settings/connections/CredentialsSection); every save goes through
// ProviderCredentialsPanel, so `integrationSettings` / `onChange` are unused there. On the legacy page it
// renders the legacy 3-column form, moved unchanged to components/legacy/settings/ApiKeysPanelLegacy.tsx.
import { CredentialsSection } from '@/components/domain/settings/connections';
import { useSettingsShell } from '@/components/domain/settings/settingsNav';
import ApiKeysPanelLegacy from '@/components/legacy/settings/ApiKeysPanelLegacy';
import type { UserSettingsResponse } from '@/lib/hooks/useSettings';

export interface ApiKeysPanelProps {
  integrationSettings: NonNullable<UserSettingsResponse['integrationSettings']>;
  onChange: (name: string, value: string) => void;
}

export default function ApiKeysPanel(props: ApiKeysPanelProps) {
  const shell = useSettingsShell();
  return shell ? <CredentialsSection /> : <ApiKeysPanelLegacy {...props} />;
}
