/**
 * One integration tile (§4.1, §4.2): LogoTile 32 + name + ⋯ · StatusPill · one-line meta · one secondary
 * button. Pure presentation: the decision lives in `tileModel()`, the actions are built by IntegrationGrid.
 */
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { LogoTile } from '@/components/ds/data';
import { Section } from '@/components/ds/page';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { ActionButton, OverflowMenu, type ActionSpec, type OverflowItem } from '@/components/ds/overlay';
import { Button } from '@/components/ds/inputs';
import { Bone } from '@/components/ds/state';
import { useFormatters } from '@/lib/format';
import { focusRing, neutral as n, px, radius, space, tone, type as typeScale } from '@/lib/ds/tokens';
import type { IntegrationSpec } from '@/lib/settings/integrations';
import type { TileMeta, TileModel } from './connectionView';
import { formatElapsed } from './useWixInstallPoll';

export interface IntegrationTileProps {
  spec: IntegrationSpec;
  model: TileModel;
  /** The tile's single secondary button (already resolved: href / onClick / disabled + reason). */
  action?: ActionSpec | null;
  /** `ghost` for "Contact support" (§4.2); everything else is `secondary` (§4.3: no primary on a tile). */
  actionVariant?: 'secondary' | 'ghost';
  overflow: OverflowItem[];
  /** Inline ghost "Refresh all orders" after a stale "Refreshed …" meta. */
  onRefreshAll?: () => void;
  refreshing?: boolean;
  /** 1.5s focus ring after an OAuth return or a `&provider=` deep link (§3.3). */
  highlighted?: boolean;
  wixElapsedSec?: number;
}

const caption = typeScale.caption;
const titleSm = typeScale.titleSm;

/**
 * The card surface (border, radius, padding 16, background) is the DS `Section variant="card"` (§4.1); only
 * layout is set here: tile height, the column body (Section's single content box), and the focus ring.
 */
const tileSectionSx = (highlighted: boolean | undefined) => ({
  mb: 0, flex: 1, minWidth: 0, minHeight: 120, display: 'flex', flexDirection: 'column' as const,
  boxShadow: highlighted ? focusRing : 'none', transition: 'box-shadow 120ms ease',
  '& > div': { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' as const, gap: px(space[2]) },
});

function MetaLine({ spec, meta, wixElapsedSec, onRefreshAll, refreshing }: {
  spec: IntegrationSpec; meta: TileMeta; wixElapsedSec?: number; onRefreshAll?: () => void; refreshing?: boolean;
}) {
  const t = useTranslations('settings');
  const tc = useTranslations('settings.connections');
  const f = useFormatters();
  const text = (s: ReactNode, color: string = n[500]) => (
    <span style={{ fontSize: caption[0], lineHeight: px(caption[1]), color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
      {s}
    </span>
  );
  const join = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ');

  switch (meta.kind) {
    case 'none':
      return null;
    case 'blurb':
      return text(tc(`blurb.${spec.id}` as 'blurb.etsy'));
    case 'missingField':
      return text(tc('meta.missingField', { field: t(`credentials.field.${meta.field}` as 'credentials.field.apiKey') }));
    case 'reason':
      return text(join(meta.account, tc(meta.reason === 'incomplete' ? 'reason.incomplete' : 'reason.authExpired')), tone.warning.fg);
    case 'shops':
      return text(tc('meta.shops', { count: meta.count }));
    case 'account': {
      const refreshed = meta.lastSyncAt ? tc('meta.refreshed', { time: f.relative(meta.lastSyncAt) }) : null;
      const line = join(meta.name, refreshed);
      if (!line) return text(tc(`blurb.${spec.id}` as 'blurb.etsy'));
      if (!meta.stale) return text(line);
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: px(space[1]), minWidth: 0, flexWrap: 'wrap' }}>
          {text(line, tone.warning.fg)}
          {onRefreshAll && (
            <Button variant="ghost" size="sm" onClick={onRefreshAll} loading={refreshing} data-testid={`tile-${spec.id}-refresh-inline`}>
              {tc('menu.refreshAll')}
            </Button>
          )}
        </span>
      );
    }
    case 'supportManaged':
      return text(tc('meta.supportManaged'));
    case 'extension':
      return text(meta.lastActivityAt ? tc('meta.lastActivity', { time: f.relative(meta.lastActivityAt) }) : tc('blurb.chrome'));
    case 'notDetected':
      return text(tc('meta.notDetected'));
    case 'wixWaiting':
      return (
        <span role="status" style={{ display: 'contents' }}>
          {text(tc('meta.wixWaiting', { elapsed: formatElapsed(wixElapsedSec ?? 0) }), tone.info.fg)}
        </span>
      );
    case 'wixTimedOut':
      return (
        <span role="alert" style={{ display: 'contents' }}>
          {text(t('wixPollTimedOut'), tone.warning.fg)}
        </span>
      );
    default:
      return null;
  }
}

export function IntegrationTile({ spec, model, action, actionVariant = 'secondary', overflow, onRefreshAll, refreshing, highlighted, wixElapsedSec }: IntegrationTileProps) {
  const tc = useTranslations('settings.connections');
  const loading = model.status === 'loading';

  return (
    <div
      id={`integration-${spec.id}`}
      data-testid={`tile-${spec.id}`}
      data-provider={spec.id}
      data-status={model.status}
      data-highlighted={highlighted ? 'true' : undefined}
      tabIndex={-1}
      style={{ display: 'flex', minWidth: 0, outline: 'none' }}
    >
      <Section variant="card" sx={tileSectionSx(highlighted)} data-testid={`tile-${spec.id}-card`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: px(space[3]), minWidth: 0 }}>
          <LogoTile brand={spec.logo} size={32} label={spec.name} />
          <span style={{ flex: 1, minWidth: 0, fontSize: titleSm[0], lineHeight: px(titleSm[1]), fontWeight: titleSm[2], color: n[900], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {spec.name}
          </span>
          {!loading && (
            <OverflowMenu items={overflow} label={tc('menu.more', { provider: spec.name })} data-testid={`tile-${spec.id}-more`} itemTestIdPrefix={`tile-${spec.id}-menu-`} />
          )}
        </div>
        <div style={{ minHeight: 20, display: 'flex', alignItems: 'center' }}>
          {loading ? <Bone w={96} h={20} r={radius.full} /> : <StatusPill domain="connection" status={model.status === 'loading' ? null : model.status} />}
        </div>
        <div style={{ minHeight: 16, display: 'flex', alignItems: 'center', minWidth: 0 }}>
          {loading ? <Bone w="70%" h={12} /> : (
            <MetaLine spec={spec} meta={model.meta} wixElapsedSec={wixElapsedSec} onRefreshAll={onRefreshAll} refreshing={refreshing} />
          )}
        </div>
        <div style={{ marginTop: 'auto', display: 'flex' }}>
          {!loading && action && <ActionButton action={action} variant={actionVariant} size="sm" data-testid={`tile-${spec.id}-action`} />}
        </div>
      </Section>
    </div>
  );
}

export default IntegrationTile;
