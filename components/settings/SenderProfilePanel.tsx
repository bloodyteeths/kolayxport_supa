// Settings › Sender profile entry point (settings §6, §17 Group C).
// Inside the new SettingsPage (flag `settings`, SettingsShellContext present) it renders the DS SenderForm; the
// page passes the optional save/validation props (`state`, `dirty`, `saving`, `onSave`, `onDiscard`) through.
// On the legacy page it renders the legacy body, moved unchanged to
// components/legacy/settings/SenderProfilePanelLegacy.tsx.
import type { UserSettingsResponse } from '@/lib/hooks/useSettings';
import { SenderForm, type SenderFormProps } from '@/components/domain/settings/sender';
import { useSettingsShell } from '@/components/domain/settings/settingsNav';
import SenderProfilePanelLegacy from '@/components/legacy/settings/SenderProfilePanelLegacy';

export interface SenderProfilePanelProps
  extends Omit<SenderFormProps, 'shipperProfile' | 'shippingSettings'> {
  shipperProfile: NonNullable<UserSettingsResponse['shipperProfile']>;
  shippingSettings: NonNullable<UserSettingsResponse['shippingSettings']>;
}

export default function SenderProfilePanel(props: SenderProfilePanelProps) {
  const shell = useSettingsShell();
  if (shell) return <SenderForm {...props} />;
  const { shipperProfile, shippingSettings, onChangeProfile, onChangeShipping, importerJsonError, etgbCollapsed } = props;
  return (
    <SenderProfilePanelLegacy
      shipperProfile={shipperProfile}
      shippingSettings={shippingSettings}
      onChangeProfile={onChangeProfile}
      onChangeShipping={onChangeShipping}
      importerJsonError={importerJsonError}
      etgbCollapsed={etgbCollapsed}
    />
  );
}
