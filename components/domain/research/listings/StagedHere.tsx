// components/domain/research/listings/StagedHere.tsx — "Staged here (2) · Title → … · Price $58 → $45"
// (research.md §7.1). Accepted proposals of the open listing; they become ONE draft when the user presses
// "Stage N fixes" (never sent from here).
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { IconAction } from '@/components/ds/overlay/IconAction';
import { useDsFormat } from '@/components/ds/data/fmt';
import { icons } from '@/lib/ds/icons';
import { neutral as n } from '@/lib/ds/tokens';
import type { DoctorProposal } from './doctorModel';

export type StagedHereProps = {
  proposals: DoctorProposal[];
  onRemove: (field: DoctorProposal['field']) => void;
  disabled?: boolean;
  'data-testid'?: string;
};

export function StagedHere({ proposals, onRemove, disabled, 'data-testid': testId = 'doctor-staged-here' }: StagedHereProps) {
  const t = useTranslations('research.doc');
  const fmt = useDsFormat();
  if (!proposals.length) return null;
  return (
    <Box component="section" aria-label={t('stagedHere', { count: proposals.length })} data-testid={testId}>
      <Typography variant="titleSm" component="h3" sx={{ m: 0, mb: '4px', color: n[800] }}>
        {t('stagedHere', { count: proposals.length })}
      </Typography>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {proposals.map((p) => (
          <Box
            component="li"
            key={p.field}
            data-field={p.field}
            sx={{ display: 'flex', alignItems: 'center', gap: '8px', py: '4px', borderTop: `1px solid ${n[100]}`, '&:first-of-type': { borderTop: 'none' } }}
          >
            <Typography variant="dense" component="span" sx={{ flex: 1, minWidth: 0, color: n[800], wordBreak: 'break-word' }}>
              {p.field === 'price'
                ? t('proposal.priceChange', { from: p.from != null ? fmt.money(p.from, p.currency) : '—', to: fmt.money(p.to, p.currency) })
                : p.field === 'title'
                  ? t('proposal.titleChange', { title: p.to })
                  : t('proposal.tags', { count: p.to.length })}
            </Typography>
            <IconAction
              icon={icons.close}
              label={t('proposal.remove')}
              onClick={() => onRemove(p.field)}
              disabled={disabled}
              size="sm"
              data-testid={`doctor-proposal-remove-${p.field}`}
            />
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export default StagedHere;
