import React from 'react';
import {
  Drawer, Box, Typography, IconButton, Avatar, Chip, Divider, Button,
  useMediaQuery, useTheme, Paper,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PostAddIcon from '@mui/icons-material/PostAdd';
import { useTranslations } from 'next-intl';
import type { ArbitrageResult } from '../../../../lib/arbitrage/types';
import useLocaleStore from '../../../../lib/stores/useLocaleStore';
import { formatCurrency, formatPercent, getVerdictConfig } from './arbitrageConstants';
import useCreateListingPrefill, { keywordsFromTitle } from '../useCreateListingPrefill';

interface Props {
  result: ArbitrageResult | null;
  open: boolean;
  onClose: () => void;
}

export default function ArbitrageProductDetail({ result, open, onClose }: Props) {
  const ta = useTranslations('ebay.research.arbitrage');
  const locale = useLocaleStore(s => s.locale);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const createListing = useCreateListingPrefill();

  if (!result) return null;

  const { trendyol, ebay, financials, score, verdict, matchTier, translatedQuery, exchangeRate } = result;
  const vc = getVerdictConfig(verdict);

  /** Open the eBay creator prefilled with this product. The seller reviews everything; nothing is published here. */
  const handleListOnEbay = () => {
    const englishSeed = translatedQuery || ebay.topItems[0]?.title || '';
    const images = [...(Array.isArray(trendyol.images) ? trendyol.images : []), trendyol.imageUrl]
      .filter((u): u is string => typeof u === 'string' && u.startsWith('https://'));
    createListing({
      target: 'ebay',
      source: 'arbitrage',
      title: englishSeed || trendyol.name,
      keywords: keywordsFromTitle([englishSeed, ...ebay.topItems.slice(0, 3).map(i => i.title)].join(' ')),
      price: financials.suggestedPriceUsd > 0 ? financials.suggestedPriceUsd : undefined,
      currency: 'USD',
      imageUrls: images,
      categoryHint: ebay.categoryName || ebay.categoryId || undefined,
      research: {
        tool: 'arbitrage',
        trendyolUrl: trendyol.url,
        trendyolName: trendyol.name,
        brand: trendyol.brand,
        barcode: trendyol.barcode,
        ebayCategoryId: ebay.categoryId,
        ebayMedianPriceUsd: ebay.medianPrice,
        ebayTotalListings: ebay.totalListings,
        totalCostUsd: financials.totalCostUsd,
        profitUsd: financials.profitUsd,
        roiPercent: financials.roiPercent,
        comparables: ebay.topItems.slice(0, 5).map(i => ({ title: i.title, price: i.price, sold: i.soldQuantity })),
      },
    });
  };

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
            label={`${ta(vc.label)} — ${score}`}
            size="small"
            sx={{ bgcolor: vc.bg, color: vc.color, fontWeight: 700 }}
          />
          {matchTier && (
            <Chip
              label={matchTier === 'gtin' ? 'GTIN' : matchTier === 'gemini' ? ta('aiMatch') : ta('fallback')}
              size="small"
              variant="outlined"
              sx={{ fontSize: '0.8rem' }}
            />
          )}
        </Box>
        <IconButton onClick={onClose} size="small" aria-label={ta('close')}><CloseIcon /></IconButton>
      </Box>

      {/* Trendyol Product */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="overline" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
          {ta('trendyolProduct')}
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
              {formatCurrency(trendyol.priceTry, 'TRY', locale)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              = {formatCurrency(trendyol.priceTry * exchangeRate, 'USD', locale)} | {trendyol.categoryName}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
          <Button
            size="small"
            variant="contained"
            onClick={handleListOnEbay}
            startIcon={<PostAddIcon />}
            sx={{ fontSize: '0.82rem', minHeight: 44, flex: isMobile ? '1 1 100%' : '0 0 auto' }}
          >
            {ta('listOnEbay')}
          </Button>
          <Button
            size="small"
            variant="outlined"
            href={trendyol.url}
            target="_blank"
            rel="noopener noreferrer"
            startIcon={<OpenInNewIcon />}
            sx={{ fontSize: '0.82rem', minHeight: 44, flex: isMobile ? '1 1 100%' : '0 0 auto' }}
          >
            {ta('openOnTrendyol')}
          </Button>
        </Box>
      </Paper>

      {/* eBay Comparables */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="overline" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
          {ta('ebayComparison', { count: ebay.totalListings })}
        </Typography>
        {translatedQuery && (
          <Typography variant="caption" display="block" sx={{ mb: 1, color: '#666' }}>
            {ta('search')}: "{translatedQuery}"
          </Typography>
        )}

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, mb: 1.5 }}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary">Min</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatCurrency(ebay.minPrice, 'USD', locale)}</Typography>
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary">{ta('median')}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, color: '#1565c0' }}>{formatCurrency(ebay.medianPrice, 'USD', locale)}</Typography>
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary">Max</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatCurrency(ebay.maxPrice, 'USD', locale)}</Typography>
          </Box>
        </Box>

        {/* Top 3 eBay items */}
        {ebay.topItems.slice(0, 3).map((item, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 1, py: 0.75, borderTop: '1px solid #eee' }}>
            <Avatar src={item.imageUrl} variant="rounded" sx={{ width: 40, height: 40 }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="caption" noWrap>{item.title}</Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>{formatCurrency(item.price, 'USD', locale)}</Typography>
                {item.soldQuantity > 0 && (
                  <Typography variant="caption" color="text.secondary">{item.soldQuantity} {ta('sold')}</Typography>
                )}
              </Box>
            </Box>
          </Box>
        ))}
      </Paper>

      {/* Financial Breakdown */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="overline" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
          {ta('financialAnalysis')}
        </Typography>

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75, mt: 1 }}>
          {[
            [ta('productCost'), formatCurrency(financials.costUsd, 'USD', locale)],
            [ta('shipping'), formatCurrency(financials.shippingUsd, 'USD', locale)],
            [ta('ebayCommission'), `${formatCurrency(financials.ebayFeeUsd, 'USD', locale)} (${financials.ebayFeePercent}%)`],
            [ta('paymentProcessing'), formatCurrency(financials.paymentFeeUsd, 'USD', locale)],
            [ta('international'), formatCurrency(financials.internationalFeeUsd, 'USD', locale)],
          ].map(([label, val]) => (
            <React.Fragment key={label}>
              <Typography variant="caption" color="text.secondary">{label}</Typography>
              <Typography variant="caption" sx={{ textAlign: 'right' }}>{val}</Typography>
            </React.Fragment>
          ))}
        </Box>

        <Divider sx={{ my: 1 }} />

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{ta('totalCost')}</Typography>
          <Typography variant="body2" sx={{ fontWeight: 600, textAlign: 'right' }}>
            {formatCurrency(financials.totalCostUsd, 'USD', locale)}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{ta('sellingPrice')}</Typography>
          <Typography variant="body2" sx={{ fontWeight: 600, textAlign: 'right', color: '#1565c0' }}>
            {formatCurrency(financials.suggestedPriceUsd)}
          </Typography>
        </Box>

        <Divider sx={{ my: 1 }} />

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, textAlign: 'center' }}>
          <Box>
            <Typography variant="caption" color="text.secondary">{ta('profit')}</Typography>
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
            <Typography variant="caption" color="text.secondary">{ta('margin')}</Typography>
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
