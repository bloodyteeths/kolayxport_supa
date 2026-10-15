// ScorePanel: listing health with an actionable fixes checklist (DESIGN_SYSTEM §3.10, listing-editor §4.4,
// research §7 "Compared with peers"). Every fix STAGES something or focuses a field; nothing is pushed.
import { useState } from 'react';
import { Box, Button, ButtonBase, Typography } from '@mui/material';
import { useTranslations } from 'next-intl';
import { neutral as n, tone as toneTokens, px, space, control, radius } from '@/lib/ds/tokens';
import { sortChecks, type Check, type ScoreResult } from '@/lib/listingScore/types';
import { ScoreMeter } from './ScoreMeter';
import { FailIcon, PassIcon, WarnIcon } from './dataIcons';
import type { DsBaseProps } from './types';

export type ScorePanelProps = DsBaseProps & {
  result: ScoreResult;
  onFix(check: Check): void;
  /** Editor: score after staged edits are sent. */
  afterScore?: number | null;
  /** Collapse passing checks into "✓ 8 checks pass · Show" (default true). */
  collapsePasses?: boolean;
  /** Fix ids that are currently running (button shows the loading label). */
  busyFixIds?: string[];
  /** Hide the header meter (e.g. when the host already shows it). */
  hideHeader?: boolean;
};

function StatusGlyph({ status }: { status: Check['status'] }) {
  const t = useTranslations('ds.score');
  const common = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const;
  if (status === 'fail') return <FailIcon {...common} color={toneTokens.danger.fg} />;
  if (status === 'warn') return <WarnIcon {...common} color={toneTokens.warning.fg} />;
  if (status === 'pass') return <PassIcon {...common} color={toneTokens.success.fg} />;
  return <Typography component="span" variant="micro" sx={{ color: n[500], whiteSpace: 'nowrap' }}>{t('na')}</Typography>;
}

function CheckRow({ check, onFix, busy }: { check: Check; onFix(c: Check): void; busy: boolean }) {
  const t = useTranslations();
  const ts = useTranslations('ds.score');
  const label = t(check.label, check.params ?? {});
  const statusText = ts(`status.${check.status}`);
  const showFix = !!check.fix && check.status !== 'pass';
  return (
    <Box
      component="li"
      data-check-id={check.id}
      data-status={check.status}
      sx={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto auto',
        alignItems: 'center',
        columnGap: px(space[3]),
        py: px(space[2]),
        borderTop: `1px solid ${n[100]}`,
        '&:first-of-type': { borderTop: 'none' },
      }}
    >
      <Box sx={{ display: 'inline-flex', minWidth: px(16) }} title={statusText}>
        <StatusGlyph status={check.status} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="dense" component="span" sx={{ color: check.status === 'na' ? n[500] : n[800] }}>
          <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            {statusText}
          </Box>
          {label}
        </Typography>
        {check.status === 'na' && check.naReason && (
          <Typography variant="caption" component="span" sx={{ display: 'block', color: n[500] }}>
            {t(check.naReason)}
          </Typography>
        )}
      </Box>
      <Typography variant="micro" component="span" sx={{ color: n[500], fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
        {(check.gain ?? 0) > 0 ? ts('gain', { points: check.gain ?? 0 }) : null}
      </Typography>
      <Box>
        {showFix && check.fix && (
          <Button
            variant="outlined"
            size="small"
            disabled={busy}
            onClick={() => onFix(check)}
            sx={{ minHeight: px(control.sm), whiteSpace: 'nowrap' }}
          >
            {busy ? ts('fixRunning') : t(check.fix.label)}
          </Button>
        )}
      </Box>
    </Box>
  );
}

export function ScorePanel({
  result, onFix, afterScore, collapsePasses = true, busyFixIds = [], hideHeader, className, 'data-testid': testId,
}: ScorePanelProps) {
  const t = useTranslations('ds.score');
  const [showPasses, setShowPasses] = useState(!collapsePasses);
  const sorted = sortChecks(result.checks);
  const listing = sorted.filter((c) => (c.group ?? 'listing') === 'listing');
  const peers = sorted.filter((c) => c.group === 'peers');
  const open = listing.filter((c) => c.status === 'fail' || c.status === 'warn');
  const passes = listing.filter((c) => c.status === 'pass');
  const nas = listing.filter((c) => c.status === 'na');
  const noData = result.checksUsed === 0;

  const renderList = (items: Check[]) => (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {items.map((c) => (
        <CheckRow key={c.id} check={c} onFix={onFix} busy={busyFixIds.includes(c.id)} />
      ))}
    </Box>
  );

  return (
    <Box className={className} data-testid={testId} sx={{ display: 'flex', flexDirection: 'column', gap: px(space[3]) }}>
      {!hideHeader && (
        noData ? (
          <Box>
            <Typography variant="titleSm" component="p" sx={{ m: 0, color: n[800] }}>{t('title')}</Typography>
            <Typography variant="caption" component="p" sx={{ m: 0, color: n[500] }}>{t('notEnoughData')}</Typography>
          </Box>
        ) : (
          <ScoreMeter
            variant="panel"
            score={result.score}
            checksUsed={result.checksUsed}
            checksTotal={result.checksTotal}
            afterScore={afterScore}
          />
        )
      )}
      {open.length > 0 && renderList(open)}
      {passes.length > 0 && (
        showPasses ? renderList(passes) : (
          <ButtonBase
            onClick={() => setShowPasses(true)}
            sx={{
              alignSelf: 'flex-start', gap: px(space[2]), py: px(space[1]), color: n[600], borderRadius: px(radius.xs),
              '@media (pointer: coarse)': { minHeight: px(control.lg), minWidth: px(control.lg) },
            }}
          >
            <PassIcon size={16} strokeWidth={1.75} aria-hidden color={toneTokens.success.fg} />
            <Typography variant="dense" component="span">{t('passesCollapsed', { count: passes.length })}</Typography>
          </ButtonBase>
        )
      )}
      {nas.length > 0 && renderList(nas)}
      {peers.length > 0 && (
        <Box>
          <Typography variant="titleSm" component="p" sx={{ m: 0, mb: px(space[1]), color: n[800] }}>{t('peersTitle')}</Typography>
          {renderList(peers)}
        </Box>
      )}
    </Box>
  );
}

export default ScorePanel;
