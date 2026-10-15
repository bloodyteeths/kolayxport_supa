// components/domain/settings/sender/PanelHeading.tsx — settings §1.3: each settings section starts with one
// title (title-md) + caption description (≤ 2 lines), optional meta line and one action on the right. It is the
// only heading in the content column. Shared by the group C panels (Sender, Preferences, Refresh history).
// Below 900px the mobile TopBar already names the section (settings §3.2), so the title is visually hidden there
// (kept for screen readers and the document outline); description, meta and action still show.
import type { ReactNode } from 'react';
import { useIsMobile } from '@/components/ds/page';
import { neutral, px, space, type as typeScale } from '@/lib/ds/tokens';

const srOnly = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
} as const;

export interface PanelHeadingProps {
  title: string;
  description?: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  id?: string;
}

export function PanelHeading({ title, description, meta, action, id }: PanelHeadingProps) {
  const mobile = useIsMobile();
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: px(space[3]), marginBottom: px(space[4]) }} data-testid="settings-panel-heading">
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2
          id={id}
          style={mobile ? srOnly : {
            margin: 0, fontSize: typeScale.titleMd[0], lineHeight: px(typeScale.titleMd[1]), fontWeight: typeScale.titleMd[2],
            letterSpacing: typeScale.titleMd[3], color: neutral[900],
          }}
        >
          {title}
        </h2>
        {description ? (
          <div style={{ marginTop: mobile ? 0 : px(2), fontSize: typeScale.caption[0], lineHeight: px(typeScale.caption[1]), color: neutral[500] }}>{description}</div>
        ) : null}
        {meta ? (
          <div style={{ marginTop: px(space[1]), fontSize: typeScale.caption[0], lineHeight: px(typeScale.caption[1]), color: neutral[600] }} data-testid="settings-panel-meta">{meta}</div>
        ) : null}
      </div>
      {action ? <div style={{ flexShrink: 0 }}>{action}</div> : null}
    </div>
  );
}

export default PanelHeading;
