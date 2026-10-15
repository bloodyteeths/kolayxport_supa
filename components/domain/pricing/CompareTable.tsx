// components/domain/pricing/CompareTable.tsx — "Compare plans", desktop only (≥ 900px; settings §10.2).
// Limits and features only, no money, so it renders at once for every viewer (§10.5). Sticky header 36,
// rows 44, numbers right-aligned and tabular, "—" = not included, (?) TermHints on orders / stores / AI.
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { TermHint } from '@/components/ds/format';
import { neutral, radius, type as typeScale } from '@/lib/ds/tokens';
import { COMPARE_ROWS, PRICING_PLANS } from './pricingModel';
import { CompareValue } from './compareCell';

const [labelSize, labelLine, labelWeight] = typeScale.label;

export function CompareTable() {
  const t = useTranslations('marketing.pricingV2');
  return (
    <Box
      sx={{ display: { xs: 'none', md: 'block' }, bgcolor: neutral[0], border: `1px solid ${neutral[200]}`, borderRadius: `${radius.md}px` }}
      data-testid="compare-table"
    >
      <Box
        component="table"
        sx={{
          width: '100%',
          borderCollapse: 'separate',
          borderSpacing: 0,
          fontSize: 14,
          '& th, & td': { px: '16px', borderBottom: `1px solid ${neutral[100]}`, textAlign: 'left', color: neutral[800] },
          '& tbody tr:last-of-type td, & tbody tr:last-of-type th': { borderBottom: 0 },
          '& thead th': {
            position: 'sticky', top: 0, zIndex: 1, height: 36, bgcolor: neutral[50], color: neutral[600],
            fontSize: labelSize, lineHeight: `${labelLine}px`, fontWeight: labelWeight, borderBottom: `1px solid ${neutral[200]}`,
          },
          '& thead th:first-of-type': { borderTopLeftRadius: `${radius.md}px` },
          '& thead th:last-of-type': { borderTopRightRadius: `${radius.md}px` },
          '& tbody td, & tbody th': { height: 44 },
          '& .num': { textAlign: 'right', fontVariantNumeric: 'tabular-nums', width: 140 },
        }}
      >
        <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{t('compare.title')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('compare.feature')}</th>
            {PRICING_PLANS.map((plan) => (
              <th key={plan} scope="col" className="num">{t(`plans.${plan}.name`)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPARE_ROWS.map((row) => (
            <tr key={row.id} data-testid={`compare-row-${row.id}`}>
              <Typography component="th" scope="row" variant="body1" sx={{ fontWeight: 400 }}>
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  {t(row.labelKey)}
                  {row.hintKey ? <TermHint label={t(row.labelKey)} body={t(`hint.${row.hintKey}`)} /> : null}
                </Box>
              </Typography>
              {PRICING_PLANS.map((plan) => (
                <td key={plan} className="num">
                  <CompareValue cell={row.cell(plan)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}

export default CompareTable;
