// components/settings/SettingsSection.tsx — shim (settings §17 Group A): the legacy props on the DS
// `Section variant="card"`. Kept for the legacy panels until Groups B/C move them onto DS parts; the
// integrator deletes it once nothing imports it (settings §17 G).
import * as React from 'react';
import { Section } from '@/components/ds/page';
import { IconButton } from '@/components/ds/inputs';
import { icons } from '@/lib/ds/icons';

interface SettingsSectionProps {
  title: string;
  description?: string;
  /** Free content right of the title (legacy: a Button). Rendered in the DS `headerSlot`. */
  action?: React.ReactNode;
  /** Disclosure (legacy MUI Accordion): a ghost chevron toggles the body. */
  collapsible?: boolean;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}

export default function SettingsSection({
  title, description, action, collapsible, defaultExpanded = true, children,
}: SettingsSectionProps) {
  const [open, setOpen] = React.useState(defaultExpanded);
  const bodyId = React.useId();
  const expanded = !collapsible || open;

  const toggle = collapsible ? (
    <IconButton
      icon={icons.disclosure}
      label={title}
      aria-expanded={open}
      aria-controls={bodyId}
      onClick={() => setOpen((v) => !v)}
      data-testid="settings-section-toggle"
    />
  ) : null;

  return (
    <Section
      variant="card"
      title={title}
      description={description}
      headerSlot={action || toggle ? <>{action}{toggle}</> : undefined}
    >
      <div id={bodyId} hidden={!expanded}>
        {expanded ? children : null}
      </div>
    </Section>
  );
}
