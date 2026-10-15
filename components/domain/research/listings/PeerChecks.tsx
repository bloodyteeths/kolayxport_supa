// components/domain/research/listings/PeerChecks.tsx — the Doctor panel's health block (research.md §7.1):
// the SAME listing ScorePanel as the grid and the editor, plus the research-only "Compared with peers" group
// (`group: 'peers'`, `na` under 20 peers). Peer checks never change the stored health score.
// Peers unavailable (Etsy budget, Etsy down, eBay) → the peer group reads n/a with the reason; the rest works.
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { ScorePanel } from '@/components/ds/data/ScorePanel';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { SlowState } from '@/components/ds/state/SlowState';
import { ApiSourceNote } from '@/components/domain/research/products/ApiSourceNote';
import { neutral as n } from '@/lib/ds/tokens';
import type { Check } from '@/lib/listingScore/types';
import type { DoctorRow } from '@/lib/research/types';
import type { UseDoctorPeers } from '@/lib/research/hooks/useDoctor';
import { isBudgetError, sectionError } from '@/lib/research/hooks/useDoctor';
import { buildDoctorScore } from './doctorModel';

export type PeerChecksProps = {
  row: DoctorRow;
  peers: UseDoctorPeers;
  /** False for eBay: peers come from Etsy search only. */
  peersSupported: boolean;
  onFix: (check: Check) => void;
  busyFixIds?: string[];
  /** Score after the staged proposals are sent (ScorePanel "45 → 58 after you send"). */
  afterScore?: number | null;
};

/** The reason line when the peer group is unavailable (i18n key under `research`). */
export function peersUnavailableKey(p: Pick<UseDoctorPeers, 'state' | 'errors'>, supported: boolean): string | null {
  if (!supported) return 'research.doc.peersEtsyOnly';
  if (isBudgetError(p.errors)) return 'research.error.budget';
  const peerErr = sectionError(p.errors, 'peers');
  if (peerErr) return peerErr.key;
  if (p.state === 'error') return 'research.error.etsy';
  return null;
}

export function PeerChecks({ row, peers, peersSupported, onFix, busyFixIds, afterScore }: PeerChecksProps) {
  const t = useTranslations();
  const loading = peersSupported && (peers.state === 'loading' || peers.state === 'slow');
  const serverChecks = React.useMemo(
    () => [...(peers.data?.listingChecks ?? []), ...(peers.data?.checks ?? [])],
    [peers.data],
  );
  const { result } = React.useMemo(() => buildDoctorScore(row.listing, serverChecks), [row.listing, serverChecks]);
  const unavailable = loading ? null : peersUnavailableKey(peers, peersSupported);
  const hasPeerChecks = result.checks.some((c) => c.group === 'peers');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }} data-testid="doctor-peer-checks">
      <ScorePanel result={result} onFix={onFix} busyFixIds={busyFixIds} afterScore={afterScore} data-testid="doctor-score" />
      {loading ? (
        peers.state === 'slow' ? (
          <SlowState onRetry={peers.retry} data-testid="doctor-peers-slow" />
        ) : (
          <Typography variant="caption" component="p" sx={{ m: 0, color: n[500] }} data-testid="doctor-peers-loading">
            {t('research.doc.peersLoading')}
          </Typography>
        )
      ) : unavailable && !hasPeerChecks ? (
        <Box data-testid="doctor-peers-na">
          <Typography variant="titleSm" component="p" sx={{ m: 0, color: n[800] }}>
            {t('research.doc.peers')}
          </Typography>
          <Typography variant="caption" component="p" sx={{ m: 0, color: n[500] }}>
            {t('research.doc.peersNa', { reason: t.has(unavailable) ? t(unavailable) : t('research.error.etsy') })}
          </Typography>
          {peersSupported && peers.state === 'error' ? (
            <ErrorState variant="inline" title={t('research.error.etsy')} onRetry={peers.retry} data-testid="doctor-peers-error" />
          ) : null}
        </Box>
      ) : null}
      {peers.source ? <ApiSourceNote source={peers.source} data-testid="doctor-peers-source" /> : null}
    </Box>
  );
}

export default PeerChecks;
