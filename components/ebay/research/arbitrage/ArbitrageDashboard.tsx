import React from 'react';
import { Box, Paper, Typography, Chip, useMediaQuery, useTheme } from '@mui/material';
import { useTranslations } from 'next-intl';
import type { ArbitrageScanResponse } from '../../../../lib/arbitrage/types';
import useLocaleStore from '../../../../lib/stores/useLocaleStore';
import { VERDICT_CONFIG, formatCurrency, formatPercent } from './arbitrageConstants';
import { useArbitrageStore } from './useArbitrageStore';

interface Props {
  response: ArbitrageScanResponse;
}

export default function ArbitrageDashboard({ response }: Props) {
  const ta = useTranslations('ebay.research.arbitrage');
  const locale = useLocaleStore(s => s.locale);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { filterVerdict, setFilterVerdict } = useArbitrageStore();

  const { results, totalScanned, profitable, scanDurationMs, exchangeRate } = response;

  const profitableResults = results.filter(r => r.financials.profitUsd > 0);
  const avgProfit = profitableResults.length > 0
    ? profitableResults.reduce((s, r) => s + r.financials.profitUsd, 0) / profitableResults.length
    : 0;
  const bestRoi = results.length > 0
    ? Math.max(...results.map(r => r.financials.roiPercent))
    : 0;
  const bestProfit = results.length > 0
    ? Math.max(...results.map(r => r.financials.profitUsd))
    : 0;

  const kpis = [
    { label: ta('scanned'), value: String(totalScanned), color: '#666' },
    { label: ta('matched'), value: String(results.length), color: '#1565c0' },
    { label: ta('profitable'), value: String(profitable), color: '#2e7d32' },
    { label: ta('avgProfitKpi'), value: formatCurrency(avgProfit, 'USD', locale), color: '#2e7d32' },
    { label: ta('bestRoi'), value: formatPercent(bestRoi), color: '#e65100' },
    { label: ta('bestProfitKpi'), value: formatCurrency(bestProfit, 'USD', locale), color: '#2e7d32' },
  ];

  // Count by verdict
  const verdictCounts = { all: results.length, excellent: 0, good: 0, marginal: 0, skip: 0 };
  results.forEach(r => { verdictCounts[r.verdict as keyof typeof verdictCounts]++; });

  return (
    <Box>
      {/* KPI Cards */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(6, 1fr)',
        gap: 1.5,
        mb: 2,
      }}>
        {kpis.map((kpi) => (
          <Paper key={kpi.label} sx={{ p: 1.5, textAlign: 'center' }} variant="outlined">
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.82rem' }}>
              {kpi.label}
            </Typography>
            <Typography variant="h6" sx={{ color: kpi.color, fontWeight: 700, fontSize: isMobile ? '1.1rem' : '1.35rem' }}>
              {kpi.value}
            </Typography>
          </Paper>
        ))}
      </Box>

      {/* Scan info */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="caption" color="text.secondary">
          {(scanDurationMs / 1000).toFixed(1)}s | 1 TRY = ${exchangeRate.toFixed(4)}
        </Typography>
      </Box>

      {/* Verdict filter chips */}
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 2 }}>
        <Chip
          label={`${ta('all')} (${verdictCounts.all})`}
          size="small"
          variant={filterVerdict === 'all' ? 'filled' : 'outlined'}
          onClick={() => setFilterVerdict('all')}
          sx={{ fontWeight: filterVerdict === 'all' ? 700 : 400 }}
        />
        {Object.entries(VERDICT_CONFIG).map(([key, cfg]) => (
          <Chip
            key={key}
            label={`${ta(cfg.label)} (${verdictCounts[key as keyof typeof verdictCounts] || 0})`}
            size="small"
            variant={filterVerdict === key ? 'filled' : 'outlined'}
            onClick={() => setFilterVerdict(key)}
            sx={{
              fontWeight: filterVerdict === key ? 700 : 400,
              color: filterVerdict === key ? '#fff' : cfg.color,
              bgcolor: filterVerdict === key ? cfg.color : 'transparent',
              borderColor: cfg.color,
              '&:hover': { bgcolor: cfg.bg },
            }}
          />
        ))}
      </Box>
    </Box>
  );
}
