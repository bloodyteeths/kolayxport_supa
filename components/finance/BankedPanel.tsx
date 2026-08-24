import React, { useState } from 'react';
import { Box, Paper, Typography, Grid, Collapse, IconButton, Divider, Tooltip } from '@mui/material';
import { Landmark, Wallet, ChevronDown, ChevronUp, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DashboardData } from '@/lib/stores/useFinanceStore';

const SYMBOL: Record<string, string> = { TRY: '₺', USD: '$', EUR: '€', GBP: '£', TL: '₺' };

function fmt(val: number, cur = '$'): string {
  const abs = Math.abs(val);
  const s = abs >= 1000 ? `${(abs / 1000).toFixed(1)}K` : abs.toFixed(2);
  return `${val < 0 ? '-' : ''}${cur}${s}`;
}

/**
 * "Money banked" panel — Etsy only. Shows what was actually disbursed to the
 * seller's bank in the period, the current Etsy balance (earned, not yet paid
 * out), and an itemized deposit list. Reserve/held amounts and release dates
 * are intentionally absent: Etsy's Open API v3 does not expose them.
 */
export default function BankedPanel({ data, marketplace }: { data: DashboardData; marketplace: string }) {
  const t = useTranslations('financials');
  const [open, setOpen] = useState(false);
  const { summary } = data;
  const disbursements = data.disbursements || [];

  // Etsy, eBay and Amazon provide banking data (ledger / payouts / settlements).
  if (marketplace !== 'etsy' && marketplace !== 'ebay' && marketplace !== 'amazon') return null;
  const banked = summary.banked || 0;
  const balance = summary.currentBalance;
  const held = summary.heldFunds; // eBay only — Etsy's API doesn't expose it
  const cur = SYMBOL[summary.balanceCurrency || 'USD'] || '$';
  if (!banked && balance == null && held == null && disbursements.length === 0) return null;

  // Marketplace-aware label — the balance card previously hardcoded "Etsy".
  const mpName = marketplace === 'ebay' ? 'eBay' : marketplace.charAt(0).toUpperCase() + marketplace.slice(1);

  return (
    <Paper sx={{ borderRadius: '12px', p: 2, mb: 2, border: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Landmark size={18} color="#0369a1" />
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{t('bankedTitle')}</Typography>
      </Box>

      <Grid container spacing={1.5}>
        <Grid item xs={12} sm={held != null ? 4 : 6}>
          <Box sx={{ p: 1.5, borderRadius: '10px', background: 'linear-gradient(135deg, #ecfeff, #cffafe)' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
              <Landmark size={16} color="#0369a1" />
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{t('bankedInPeriod')}</Typography>
            </Box>
            <Typography variant="h5" sx={{ fontWeight: 800, color: '#0369a1' }}>{fmt(banked, cur)}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t('bankedDepositCount', { count: summary.disbursementCount || disbursements.length })}
            </Typography>
          </Box>
        </Grid>
        <Grid item xs={12} sm={held != null ? 4 : 6}>
          <Box sx={{ p: 1.5, borderRadius: '10px', background: 'linear-gradient(135deg, #f5f3ff, #ede9fe)' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
              <Wallet size={16} color="#7c3aed" />
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{t('bankedCurrentBalanceMp', { marketplace: mpName })}</Typography>
            </Box>
            {/* Etsy/Amazon: balance is an estimate and reserve/release isn't in
                the API — explain on hover. eBay: held funds shown separately. */}
            {marketplace === 'etsy' || marketplace === 'amazon' ? (
              <Tooltip title={marketplace === 'amazon' ? t('bankedBalanceApproxNote') : t('bankedReserveNote')} arrow placement="top">
                <Typography variant="h5" sx={{ fontWeight: 800, color: '#7c3aed', display: 'inline-block', cursor: 'help', borderBottom: '1px dotted', borderColor: 'rgba(124,58,237,0.4)' }}>
                  {balance != null ? fmt(balance, cur) : '—'}
                </Typography>
              </Tooltip>
            ) : (
              <Typography variant="h5" sx={{ fontWeight: 800, color: '#7c3aed' }}>
                {balance != null ? fmt(balance, cur) : '—'}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t('bankedBalanceHint')}</Typography>
          </Box>
        </Grid>
        {held != null && (
          <Grid item xs={12} sm={4}>
            <Box sx={{ p: 1.5, borderRadius: '10px', background: 'linear-gradient(135deg, #fff7ed, #ffedd5)' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                <Lock size={16} color="#c2410c" />
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{t('bankedHeldFunds')}</Typography>
              </Box>
              <Typography variant="h5" sx={{ fontWeight: 800, color: '#c2410c' }}>{fmt(held, cur)}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t('bankedHeldHint')}</Typography>
            </Box>
          </Grid>
        )}
      </Grid>

      {disbursements.length > 0 && (
        <>
          <Box
            onClick={() => setOpen(o => !o)}
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1.5, cursor: 'pointer', py: 0.5 }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary' }}>{t('bankedDepositList')}</Typography>
            <IconButton size="small">{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</IconButton>
          </Box>
          <Collapse in={open}>
            <Divider sx={{ mb: 1 }} />
            <Box sx={{ maxHeight: 260, overflowY: 'auto' }}>
              {[...disbursements].reverse().map((d, i) => (
                <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.6, borderBottom: i < disbursements.length - 1 ? '1px solid' : 'none', borderColor: 'divider' }}>
                  <Typography variant="body2" color="text.secondary">{d.date}</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: '#0369a1' }}>{fmt(d.amount, cur)}</Typography>
                </Box>
              ))}
            </Box>
          </Collapse>
        </>
      )}

    </Paper>
  );
}
