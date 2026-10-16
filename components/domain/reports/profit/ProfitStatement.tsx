// Reports › Profit "Profit and loss" (finance-analytics §2.2): gross sales, every cost line as a negative in
// neutral-800 (red only for a negative result), a share bar of gross sales (DS A4 `share`), the net profit line
// in title-sm with success-fg / danger-fg. Mobile: a one-column KeyValueList with the share bars hidden.
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { ShareBar } from '@/components/ds/data/ShareBar';
import { KeyValueList } from '@/components/ds/data/KeyValueList';
import { Money } from '@/components/ds/format/Money';
import { TermHint } from '@/components/ds/format/TermHint';
import { Section } from '@/components/ds/page/Section';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { neutral as n, tone, px, space } from '@/lib/ds/tokens';
import { profitStatement, type FinanceDashboard, type StatementLine, type StatementLineKey } from '@/lib/reports/useFinanceReport';

const LINE_KEY: Record<StatementLineKey, string> = {
  gross: 'profit.line.gross',
  refunds: 'profit.line.refunds',
  discounts: 'profit.line.discounts',
  fees: 'profit.line.fees',
  ads: 'profit.line.ads',
  shipping: 'profit.line.shipping',
  otherFees: 'profit.line.otherFees',
  productCost: 'profit.line.productCost',
  net: 'profit.line.net',
};

export function useStatementLabel() {
  const t = useTranslations('reports');
  return (key: StatementLineKey, d?: FinanceDashboard) => {
    const cov = d?.costCoverage;
    if (key === 'productCost' && cov && cov.products > 0 && cov.productsWithoutCost > 0) {
      return t('profit.line.productCostCoverage', { with: cov.productsWithCost, total: cov.products });
    }
    return t(LINE_KEY[key]);
  };
}

export interface ProfitStatementProps {
  data: FinanceDashboard;
  loading?: boolean;
}

export function ProfitStatement({ data, loading }: ProfitStatementProps) {
  const t = useTranslations('reports');
  const label = useStatementLabel();
  const mobile = useIsMobile();
  const c = data.summary.currency;
  const lines = profitStatement(data.summary);
  const join = (parts: string[]) => (parts.length ? parts.join(' · ') : null);
  const excludedNote = join([
    ...data.cogsExcluded.map((x) => t('profit.line.cogsExcluded', { count: x.products, currency: x.currency })),
    ...data.cogsUnverified.map((x) => t('profit.line.cogsUnverified', { count: x.products, currency: x.currency, base: c })),
  ]);
  // Ledger rows in another currency (DS §3.12): converted ≈, or left out without a rate.
  const ledgerNote = join([
    ...data.ledgerConverted.map((x) => t('profit.line.ledgerConverted', { count: x.rows, currency: x.currency, base: c })),
    ...data.ledgerExcluded.map((x) => t('profit.line.ledgerExcluded', { count: x.rows, currency: x.currency })),
  ]);

  const lineLabel = (l: StatementLine) => (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: px(space[1]) }}>
      {label(l.key, data)}
      {l.key === 'productCost' && excludedNote ? (
        <TermHint label={label(l.key, data)} body={excludedNote} data-testid="cogs-excluded-hint" />
      ) : null}
      {l.key === 'gross' && ledgerNote ? (
        <TermHint label={label(l.key, data)} body={ledgerNote} data-testid="ledger-currency-hint" />
      ) : null}
    </Box>
  );
  const net = lines[lines.length - 1];
  const netColor = net.amount < 0 ? tone.danger.fg : tone.success.fg;

  return (
    <Section title={t('profit.statement.title')} variant="card" data-testid="profit-statement">
      <Box aria-busy={loading || undefined} sx={{ opacity: loading ? 0.6 : 1 }}>
        {mobile ? (
          <KeyValueList
            items={lines.map((l) => ({
              label: label(l.key, data),
              value: (
                <Box component="span" sx={{ color: l.key === 'net' ? netColor : n[800], fontWeight: l.key === 'net' ? 600 : 400 }}>
                  <Money amount={l.amount} currency={c} />
                </Box>
              ),
            }))}
          />
        ) : (
          <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }} aria-label={t('profit.statement.title')}>
            <Box component="thead" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
              <tr>
                <th scope="col">{t('profit.statement.title')}</th>
                <th scope="col">{t('profit.products.revenue')}</th>
                <th scope="col">{t('profit.statement.share')}</th>
              </tr>
            </Box>
            <tbody>
              {/* Zero deduction lines are noise ("Discounts $0.00"); gross and net always show. */}
              {lines.filter((l) => l.key === 'gross' || l.key === 'net' || l.amount !== 0).map((l) => {
                const isNet = l.key === 'net';
                const isDeduction = !isNet && l.key !== 'gross';
                return (
                  <Box
                    component="tr"
                    key={l.key}
                    data-line={l.key}
                    sx={{
                      borderTop: isNet ? `1px solid ${n[200]}` : undefined,
                      bgcolor: isNet ? n[50] : undefined,
                      '& td': { py: px(isNet ? space[3] : space[1.5]) },
                      '& td:first-of-type': { pl: px(isDeduction ? space[4] : space[2]) },
                      '& td:last-of-type': { pr: px(space[2]) },
                    }}
                  >
                    <Box component="td" sx={{ color: n[700] }}>
                      <Typography variant={isNet ? 'titleSm' : 'dense'} component="span" sx={{ color: isNet ? n[900] : n[700] }}>
                        {lineLabel(l)}
                      </Typography>
                    </Box>
                    <Box component="td" sx={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      <Typography variant={isNet ? 'titleSm' : 'dense'} component="span" sx={{ color: isNet ? netColor : n[800] }}>
                        <Money amount={l.amount} currency={c} />
                      </Typography>
                    </Box>
                    <Box component="td" sx={{ textAlign: 'right', width: px(120), pl: px(space[3]) }}>
                      <ShareBar value={l.share} compact={isNet || l.key === 'gross'} />
                    </Box>
                  </Box>
                );
              })}
            </tbody>
          </Box>
        )}
      </Box>
    </Section>
  );
}

export default ProfitStatement;
