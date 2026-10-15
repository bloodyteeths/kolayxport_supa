// Settings › Plan & billing entry point (settings §17 Group D).
// Inside the new SettingsPage (flag `settings`, SettingsShellContext present) it renders the new Billing
// tab (components/domain/billing/BillingPanel), which reads its own data (`useEntitlement`, invoices,
// billing summary), so the legacy props are unused there. On the legacy page it renders the legacy panel,
// moved unchanged to components/legacy/settings/BillingPanelLegacy.tsx.
import { BillingPanel as BillingTab } from '@/components/domain/billing/BillingPanel';
import { useSettingsShell } from '@/components/domain/settings/settingsNav';
import BillingPanelLegacy, { type BillingPanelProps } from '@/components/legacy/settings/BillingPanelLegacy';

export type { BillingPanelProps };

export default function BillingPanel(props: BillingPanelProps) {
  const shell = useSettingsShell();
  return shell ? <BillingTab /> : <BillingPanelLegacy {...props} />;
}
