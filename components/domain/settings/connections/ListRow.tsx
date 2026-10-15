/**
 * A 56px settings list row (leading · title + pill · caption · trailing). Stand-in for the DS `SettingsRow`
 * (DS §4.2), which is not in components/ds yet; built from tokens only, no MUI. Replace with
 * `SettingsRow` when the integrator adds it (see outOfScopeNeeds).
 * `stacked` (phones): logo + name + pill on line 1, caption on line 2, trailing full-width on line 3 (§5.1).
 */
import type { ReactNode } from 'react';
import { font, neutral as n, px, space, type as typeScale } from '@/lib/ds/tokens';

export interface ListRowProps {
  leading?: ReactNode;
  title: ReactNode;
  status?: ReactNode;
  caption?: ReactNode;
  /** Monospace caption (masked keys, ids). */
  captionMono?: boolean;
  trailing?: ReactNode;
  stacked?: boolean;
  /** Draw the 1px neutral-100 separator above the row. */
  divider?: boolean;
  id?: string;
  'data-testid'?: string;
}

export function ListRow({ leading, title, status, caption, captionMono, trailing, stacked, divider, id, 'data-testid': testId }: ListRowProps) {
  const [cs, cl] = typeScale.caption;
  const [ls, ll, lw] = typeScale.label;
  return (
    <div
      id={id}
      data-testid={testId}
      tabIndex={-1}
      style={{
        display: 'flex', flexDirection: stacked ? 'column' : 'row', alignItems: stacked ? 'stretch' : 'center',
        gap: px(stacked ? space[2] : space[3]), minHeight: 56, padding: `${px(space[2])} 0`,
        borderTop: divider ? `1px solid ${n[100]}` : undefined, outline: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: px(space[3]), flex: 1, minWidth: 0 }}>
        {leading}
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1, gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: px(space[2]), flexWrap: 'wrap', minWidth: 0 }}>
            <span style={{ fontSize: ls, lineHeight: px(ll), fontWeight: lw, color: n[900] }}>{title}</span>
            {status}
          </div>
          {caption ? (
            <span style={{
              fontSize: cs, lineHeight: px(cl), color: n[500], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontFamily: captionMono ? font.mono : undefined,
            }}>
              {caption}
            </span>
          ) : null}
        </div>
      </div>
      {trailing ? <div style={{ display: 'flex', alignItems: 'center', gap: px(space[2]), flexShrink: 0 }}>{trailing}</div> : null}
    </div>
  );
}

export default ListRow;
