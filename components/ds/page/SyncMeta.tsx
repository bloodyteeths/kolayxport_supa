// DS §4.2 SyncMeta: the pull control, living in PageHeader `meta` (push and pull never share a control).
// "Refreshed from Etsy 12 min ago ⟳" · "Refreshing from Etsy… · 120 / 340" · "Couldn't refresh from Etsy · Retry".
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { keyframes } from '@mui/material/styles';
import { useNow, useTranslations } from 'next-intl';
import { getLogo, toLogoProvider } from '@/lib/ds/logos';
import { useFormatters } from '@/lib/format';
import { accent, neutral, tone, zIndex } from '@/lib/ds/tokens';
import { dsIcons, ICON_STROKE } from './icons';
import type { DsBaseProps } from './types';

export type SyncMetaState = 'idle' | 'pulling' | 'failed';

/** Custom wording for surfaces whose subject is not a marketplace ("Orders refreshed 2 min ago"). */
export type SyncMetaCopy = {
  /** Receives the formatted relative time ("2 min ago"). */
  refreshed: (relative: string) => string;
  refreshing: string;
  failed: string;
  /** Accessible label / tooltip of ⟳. */
  pullLabel: string;
};

export type SyncMetaProps = DsBaseProps & {
  /** Marketplace key from lib/ds/logos (name shown as-is) or 'all'. */
  source: string;
  lastPulledAt?: Date | string | number | null;
  state: SyncMetaState;
  progress?: { done: number; total: number };
  onPull?: () => void;
  /** ⟳ disabled with a reason (P1), e.g. usage limit reached. */
  pullDisabledReason?: string;
  /** Extra tooltip line on ⟳, e.g. "Uses 1 of your 50 order syncs (12 used)". */
  pullHint?: string;
  copy?: SyncMetaCopy;
  /**
   * For tests / server render: the "now" used for relative time. Without it the relative time
   * re-renders every 30 s (P6: an idle page never keeps showing a stale "2 min ago").
   */
  now?: Date;
};

export const RELATIVE_TICK_MS = 30_000;

const spin = keyframes`from { transform: rotate(0deg); } to { transform: rotate(360deg); }`;

function toDate(v: SyncMetaProps['lastPulledAt']): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function SyncMeta({
  source,
  lastPulledAt,
  state,
  progress,
  onPull,
  pullDisabledReason,
  pullHint,
  copy,
  now,
  className,
  ...rest
}: SyncMetaProps) {
  const t = useTranslations('ds.syncMeta');
  const fmt = useFormatters();
  const ticking = useNow({ updateInterval: now ? undefined : RELATIVE_TICK_MS });
  const all = source === 'all';
  const name = all ? '' : getLogo(source)?.name ?? source;
  // ICU select key for TR case suffixes ("Etsy'den", "Trendyol'dan"); unknown sources fall to `other`.
  const key = toLogoProvider(source) ?? 'other';
  const vars = { source: name, key };
  const at = toDate(lastPulledAt);
  // lib/format short relative ("12 min ago" / "12 dk önce"), the glossary form.
  const relative = at ? fmt.relative(at, now ?? ticking) : null;

  let text: string | null;
  if (state === 'pulling') {
    text = copy?.refreshing ?? (all ? t('refreshingAll') : t('refreshing', vars));
    if (progress && progress.total > 0) {
      text = `${text} · ${t('progress', { done: progress.done, total: progress.total })}`;
    }
  } else if (state === 'failed') {
    text = copy?.failed ?? (all ? t('failedAll') : t('failed', vars));
  } else if (relative) {
    text = copy ? copy.refreshed(relative) : all ? t('refreshedAll', { relative }) : t('refreshed', { ...vars, relative });
  } else {
    // A4: no known time → ⟳ only, never a guessed time.
    text = null;
  }

  const pullLabel = copy?.pullLabel ?? (all ? t('pullAll') : t('pull', vars));
  const PullIcon = dsIcons.pull;
  const disabled = Boolean(pullDisabledReason) || state === 'pulling';
  const tooltip = pullDisabledReason ?? (pullHint ? `${pullLabel} · ${pullHint}` : pullLabel);
  const failed = state === 'failed';

  return (
    <Box
      className={className}
      data-testid={rest['data-testid'] ?? 'sync-meta'}
      data-state={state}
      aria-live="polite"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: 12,
        lineHeight: '16px',
        color: failed ? tone.danger.fg : neutral[500],
        minWidth: 0,
      }}
    >
      {text ? (
        <Box component="span" className="tnum" sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {text}
        </Box>
      ) : null}
      {failed && onPull && !pullDisabledReason ? (
        <>
          <Box component="span" aria-hidden>
            {'·'}
          </Box>
          <ButtonBase
            onClick={onPull}
            data-testid="sync-meta-retry"
            sx={{ fontSize: 12, fontWeight: 500, color: accent[600], borderRadius: '4px', px: '2px', '@media (pointer: coarse)': { minHeight: 44 } }}
          >
            {t('retry')}
          </ButtonBase>
        </>
      ) : null}
      {onPull && !failed ? (
        <Tooltip title={tooltip} PopperProps={{ sx: { zIndex: zIndex.tooltip } }}>
          <span>
            <IconButton
              size="small"
              aria-label={pullLabel}
              onClick={onPull}
              disabled={disabled}
              data-testid="sync-meta-pull"
              sx={{ width: 24, height: 24, padding: '4px', '@media (pointer: coarse)': { width: 44, height: 44 } }}
            >
              <Box
                component="span"
                sx={{
                  display: 'inline-flex',
                  animation: state === 'pulling' ? `${spin} 1s linear infinite` : 'none',
                  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                }}
              >
                <PullIcon size={14} strokeWidth={ICON_STROKE} aria-hidden />
              </Box>
            </IconButton>
          </span>
        </Tooltip>
      ) : null}
    </Box>
  );
}
