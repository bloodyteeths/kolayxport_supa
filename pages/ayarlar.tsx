// /ayarlar — Settings. Flag `settings` (lib/ds/uiFlags.ts, DS §7.1.5): the new shell
// (components/domain/settings/SettingsPage.tsx) or the legacy page, moved unchanged to
// components/legacy/settings/SettingsLegacy.tsx (deleted one release after the flag flips).
import SettingsPage from '@/components/domain/settings/SettingsPage';
import SettingsLegacy from '@/components/legacy/settings/SettingsLegacy';
import { useUiFlag } from '@/lib/ds/uiFlags';

export default function AyarlarPage() {
  const v2 = useUiFlag('settings');
  return v2 ? <SettingsPage /> : <SettingsLegacy />;
}
