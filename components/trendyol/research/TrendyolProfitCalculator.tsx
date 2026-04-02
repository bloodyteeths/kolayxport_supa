import React, { useState, useMemo } from 'react';
import {
  Box, Typography, Paper, TextField, Select, MenuItem, InputLabel, FormControl,
  useMediaQuery, InputAdornment,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  DollarSign, TrendingUp, Percent, Package, Truck, Calculator, Target,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  calculateTrendyolProfit,
  TRENDYOL_COMMISSION_RATES,
  DEFAULT_COMMISSION_RATE,
  VAT_RATES,
} from '@/lib/trendyolCommissions';
import { glassCard } from '@/components/etsy/research/shared/ui';

function fmtTry(n: number): string {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(n);
}

function ResultCard({
  label, value, icon, positive,
}: {
  label: string; value: string; icon: React.ReactNode; positive?: boolean;
}) {
  const isNeg = positive === false;
  const bgColor = positive === undefined
    ? 'rgba(33,150,243,0.06)'
    : positive
      ? 'rgba(17,153,142,0.08)'
      : 'rgba(244,67,54,0.08)';
  const borderColor = positive === undefined
    ? 'rgba(33,150,243,0.2)'
    : positive
      ? 'rgba(17,153,142,0.25)'
      : 'rgba(244,67,54,0.25)';
  const textColor = positive === undefined
    ? '#2196F3'
    : positive
      ? '#11998e'
      : '#f44336';

  return (
    <Paper sx={{
      p: 2,
      borderRadius: '14px',
      background: bgColor,
      border: `1px solid ${borderColor}`,
      textAlign: 'center',
      transition: 'transform 0.2s',
      '&:hover': { transform: 'translateY(-2px)' },
    }}>
      <Box sx={{ mb: 0.5, opacity: 0.7 }}>{icon}</Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ fontWeight: 800, color: textColor }}>
        {value}
      </Typography>
    </Paper>
  );
}

export default function TrendyolProfitCalculator() {
  const t = useTranslations('trendyolResearch');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [salePrice, setSalePrice] = useState<number>(0);
  const [costPrice, setCostPrice] = useState<number>(0);
  const [cargoCost, setCargoCost] = useState<number>(0);
  const [packagingCost, setPackagingCost] = useState<number>(0);
  const [commissionKey, setCommissionKey] = useState<string>('');
  const [vatRate, setVatRate] = useState<number>(20);

  const commissionRate = commissionKey
    ? TRENDYOL_COMMISSION_RATES[commissionKey]?.rate ?? DEFAULT_COMMISSION_RATE
    : DEFAULT_COMMISSION_RATE;

  const result = useMemo(
    () => calculateTrendyolProfit({ salePrice, costPrice, cargoCost, packagingCost, commissionRate, vatRate }),
    [salePrice, costPrice, cargoCost, packagingCost, commissionRate, vatRate],
  );

  const hasInput = salePrice > 0;
  const isProfitable = result.netProfit > 0;

  return (
    <Box>
      {/* Input fields */}
      <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Calculator size={20} />
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{t('profitCalculator')}</Typography>
        </Box>

        <Box sx={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
          gap: 2,
        }}>
          <TextField
            label={t('salePrice')}
            type="number"
            size="small"
            value={salePrice || ''}
            onChange={e => setSalePrice(Number(e.target.value) || 0)}
            InputProps={{
              startAdornment: <InputAdornment position="start"><DollarSign size={16} /></InputAdornment>,
              endAdornment: <InputAdornment position="end">TRY</InputAdornment>,
            }}
            fullWidth
          />
          <TextField
            label={t('costPrice')}
            type="number"
            size="small"
            value={costPrice || ''}
            onChange={e => setCostPrice(Number(e.target.value) || 0)}
            InputProps={{
              startAdornment: <InputAdornment position="start"><DollarSign size={16} /></InputAdornment>,
              endAdornment: <InputAdornment position="end">TRY</InputAdornment>,
            }}
            fullWidth
          />
          <TextField
            label={t('cargoCost')}
            type="number"
            size="small"
            value={cargoCost || ''}
            onChange={e => setCargoCost(Number(e.target.value) || 0)}
            InputProps={{
              startAdornment: <InputAdornment position="start"><Truck size={16} /></InputAdornment>,
              endAdornment: <InputAdornment position="end">TRY</InputAdornment>,
            }}
            fullWidth
          />
          <TextField
            label={t('packagingCost')}
            type="number"
            size="small"
            value={packagingCost || ''}
            onChange={e => setPackagingCost(Number(e.target.value) || 0)}
            InputProps={{
              startAdornment: <InputAdornment position="start"><Package size={16} /></InputAdornment>,
              endAdornment: <InputAdornment position="end">TRY</InputAdornment>,
            }}
            fullWidth
          />
          <FormControl size="small" fullWidth>
            <InputLabel>{t('commissionRate')}</InputLabel>
            <Select
              value={commissionKey}
              label={t('commissionRate')}
              onChange={e => setCommissionKey(e.target.value)}
            >
              <MenuItem value="">
                <em>{`${t('category')} (${DEFAULT_COMMISSION_RATE}%)`}</em>
              </MenuItem>
              {Object.entries(TRENDYOL_COMMISSION_RATES).map(([key, cr]) => (
                <MenuItem key={key} value={key}>
                  {cr.description} ({cr.rate}%)
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth>
            <InputLabel>{t('vatRate')}</InputLabel>
            <Select
              value={vatRate}
              label={t('vatRate')}
              onChange={e => setVatRate(Number(e.target.value))}
            >
              {VAT_RATES.map(r => (
                <MenuItem key={r} value={r}>{r}%</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      </Paper>

      {/* Results */}
      {hasInput && (
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, 1fr)',
          gap: 1.5,
        }}>
          <ResultCard
            label={t('netProfit')}
            value={fmtTry(result.netProfit)}
            icon={<DollarSign size={20} color={isProfitable ? '#11998e' : '#f44336'} />}
            positive={isProfitable}
          />
          <ResultCard
            label={t('margin')}
            value={`${result.marginPercent}%`}
            icon={<Percent size={20} color={isProfitable ? '#11998e' : '#f44336'} />}
            positive={isProfitable}
          />
          <ResultCard
            label={t('roi')}
            value={`${result.roiPercent}%`}
            icon={<TrendingUp size={20} color={isProfitable ? '#11998e' : '#f44336'} />}
            positive={isProfitable}
          />
          <ResultCard
            label={t('breakEven')}
            value={fmtTry(result.breakEvenPrice)}
            icon={<Target size={20} color="#2196F3" />}
          />
          <ResultCard
            label={t('commission')}
            value={fmtTry(result.commissionAmount)}
            icon={<Percent size={20} color="#F2994A" />}
          />
          <ResultCard
            label={t('totalCost')}
            value={fmtTry(result.totalCost)}
            icon={<Calculator size={20} color="#7B1FA2" />}
          />
        </Box>
      )}
    </Box>
  );
}
