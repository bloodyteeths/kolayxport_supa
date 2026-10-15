/**
 * Group headings + 2-column tile grid (§4.1): 432px columns in the 880 content column, 1 column below
 * ~600px (auto-fill with a 320px minimum, so no media query and no MUI). Headings are sentence-case
 * captions (12/500 neutral-500), 24px above and 8px below.
 */
import type { ReactNode } from 'react';
import { neutral as n, px, space, type as typeScale } from '@/lib/ds/tokens';

export interface IntegrationGridGroup {
  id: string;
  heading: string;
  /** Right side of the heading row (the "Compare plans" link next to the store meter). */
  trailing?: ReactNode;
  tiles: ReactNode[];
}

export function IntegrationGrid({ groups }: { groups: IntegrationGridGroup[] }) {
  const [cs, cl] = typeScale.caption;
  return (
    <div data-testid="integration-grid">
      {groups.filter((g) => g.tiles.length > 0).map((g, i) => (
        <section key={g.id} aria-labelledby={`integration-group-${g.id}`} data-testid={`integration-group-${g.id}`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: px(space[2]), margin: `${px(i === 0 ? space[4] : space[6])} 0 ${px(space[2])}`, minHeight: 16 }}>
            <h3 id={`integration-group-${g.id}`} style={{ margin: 0, flex: 1, fontSize: cs, lineHeight: px(cl), fontWeight: 500, color: n[500] }}>
              {g.heading}
            </h3>
            {g.trailing}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: px(space[4]) }}>
            {g.tiles}
          </div>
        </section>
      ))}
    </div>
  );
}

export default IntegrationGrid;
