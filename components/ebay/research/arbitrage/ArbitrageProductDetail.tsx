import React from 'react';
import {
  Drawer, Box, Typography, IconButton, Avatar, Chip, Divider, Button,
  useMediaQuery, useTheme, Paper,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { ArbitrageResult } from '../../../../lib/arbitrage/types';
import { formatCurrency, formatPercent, getVerdictConfig } from './arbitrageConstants';

interface Props {
  result: ArbitrageResult | null;
  open: boolean;
  onClose: () => void;
}

export default function ArbitrageProductDetail({ result, open, onClose }: Props) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  if (!result) return null;

  const { trendyol, ebay, financials, score, verdict, matchTier, translatedQuery, exchangeRate } = result;
  const vc = getVerdictConfig(verdict);

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: { width: isMobile ? '100%' : 480, p: 2.5 },
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip
            label={`${vc.label} — ${score}`}
            size="small"
            sx={{ bgcolor: vc.bg, color: vc.color, fontWeight: 700 }}
          />
          {matchTier && (
            <Chip
              label={matchTier === 'gtin' ? 'GTIN' : matchTier === 'gemini' ? 'AI Eşleşme' : 'Fallback'}
              size="small"
              variant="outlined"
              sx={{ fontSize: '0.65rem' }}
            />
          )}
        </Box>
        <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
      </Box>

      {/* Trendyol Product */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="overline" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
          Trendyol Ürün
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
          <Avatar
            src={trendyol.imageUrl}
            variant="rounded"
            sx={{ width: 80, height: 80 }}
          />
          <Box sx={{ flex: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {trendyol.brand && `${trendyol.brand} — `}{trendyol.name}
            </Typography>
            <Typography variant="h6" sx={{ color: '#e65100', fontWeight: 700, mt: 0.5 }}>
              {formatCurrency(trendyol.priceTry, 'TRY')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              = {formatCurrency(trendyol.priceTry * exchangeRate)} | {trendyol.categoryName}
            </Typography>
          </Box>
        </Box>
        <Button
          size="small"
          variant="outlined"
          href={trendyol.url}
          target="_blank"
          startIcon={<OpenInNewIcon />}
          sx={{ mt: 1, fontSize: '0.7rem' }}
        >
          Trendyol'da Aç
        </Button>
      </Paper>

      {/* eBay Comparables */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="overline" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
          eBay Karşılaştırma ({ebay.totalListings} listing)
        </Typography>
        {translatedQuery && (
          <Typography variant="caption" display="block" sx={{ mb: 1, color: '#666' }}>
            Arama: "{translatedQuery}"
          </Typography>
        )}

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, mb: 1.5 }}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary">Min</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatCurrency(ebay.minPrice)}</Typography>
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary">Medyan</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, color: '#1565c0' }}>{formatCurrency(ebay.medianPrice)}</Typography>
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary">Max</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatCurrency(ebay.maxPrice)}</Typography>
          </Box>
        </Box>

        {/* Top 3 eBay items */}
        {ebay.topItems.slice(0, 3).map((item, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 1, py: 0.75, borderTop: '1px solid #eee' }}>
            <Avatar src={item.imageUrl} variant="rounded" sx={{ width: 40, height: 40 }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="caption" noWrap>{item.title}</Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>{formatCurrency(item.price)}</Typography>
                {item.soldQuantity > 0 && (
                  <Typography variant="caption" color="text.secondary">{item.soldQuantity} satıldı</Typography>
                )}
              </Box>
            </Box>
          </Box>
        ))}
      </Paper>

      {/* Financial Breakdown */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="overline" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
          Finansal Analiz
        </Typography>

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75, mt: 1 }}>
          {[
            ['Ürün Maliyeti', formatCurrency(financials.costUsd)],
            ['Kargo', formatCurrency(financials.shippingUsd)],
            ['eBay Komisyon', `${formatCurrency(financials.ebayFeeUsd)} (${financials.ebayFeePercent}%)`],
            ['Ödeme İşleme', formatCurrency(financials.paymentFeeUsd)],
            ['Uluslararası', formatCurrency(financials.internationalFeeUsd)],
          ].map(([label, val]) => (
            <React.Fragment key={label}>
              <Typography variant="caption" color="text.secondary">{label}</Typography>
              <Typography variant="caption" sx={{ textAlign: 'right' }}>{val}</Typography>
            </React.Fragment>
          ))}
        </Box>

        <Divider sx={{ my: 1 }} />

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>Toplam Maliyet</Typography>
          <Typography variant="body2" sx={{ fontWeight: 600, textAlign: 'right' }}>
            {formatCurrency(financials.totalCostUsd)}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>Satış Fiyatı</Typography>
          <Typography variant="body2" sx={{ fontWeight: 600, textAlign: 'right', color: '#1565c0' }}>
            {formatCurrency(financials.suggestedPriceUsd)}
          </Typography>
        </Box>

        <Divider sx={{ my: 1 }} />

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, textAlign: 'center' }}>
          <Box>
            <Typography variant="caption" color="text.secondary">Kâr</Typography>
            <Typography variant="h6" sx={{
              fontWeight: 700,
              color: financials.profitUsd > 0 ? '#2e7d32' : '#c62828',
            }}>
              {formatCurrency(financials.profitUsd)}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">ROI</Typography>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {formatPercent(financials.roiPercent)}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Marj</Typography>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {formatPercent(financials.marginPercent)}
            </Typography>
          </Box>
        </Box>
      </Paper>

      {/* Exchange Rate Info */}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center' }}>
        1 TRY = ${exchangeRate.toFixed(4)} USD
      </Typography>
    </Drawer>
  );
}
