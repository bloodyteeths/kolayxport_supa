import React from 'react';
import dynamic from 'next/dynamic';
import { Box, Paper, Typography, useMediaQuery, useTheme } from '@mui/material';
import { useTranslations } from 'next-intl';
import type { ArbitrageResult } from '../../../../lib/arbitrage/types';
import { getVerdictConfig } from './arbitrageConstants';

const Chart = dynamic(() => import('react-apexcharts'), { ssr: false });

interface Props {
  results: ArbitrageResult[];
  exchangeRate: number;
}

export default function ArbitrageCharts({ results, exchangeRate }: Props) {
  const ta = useTranslations('ebay.research.arbitrage');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  if (results.length === 0) {
    return (
      <Paper sx={{ p: 3, textAlign: 'center' }} variant="outlined">
        <Typography color="text.secondary">{ta('noChartData')}</Typography>
      </Paper>
    );
  }

  // 1. Profit Distribution Histogram
  const profitRanges = [
    { label: '< $0', min: -Infinity, max: 0, color: '#c62828' },
    { label: '$0-5', min: 0, max: 5, color: '#e65100' },
    { label: '$5-10', min: 5, max: 10, color: '#1565c0' },
    { label: '$10-20', min: 10, max: 20, color: '#2e7d32' },
    { label: '$20+', min: 20, max: Infinity, color: '#1b5e20' },
  ];

  const histogramData = profitRanges.map(range => ({
    x: range.label,
    y: results.filter(r => r.financials.profitUsd >= range.min && r.financials.profitUsd < range.max).length,
  }));

  const histogramOptions: any = {
    chart: { type: 'bar', toolbar: { show: false }, fontFamily: 'inherit' },
    plotOptions: { bar: { borderRadius: 4, columnWidth: '60%', distributed: true } },
    colors: profitRanges.map(r => r.color),
    xaxis: { categories: profitRanges.map(r => r.label) },
    yaxis: { title: { text: ta('productCount') } },
    legend: { show: false },
    dataLabels: { enabled: true },
    tooltip: { y: { formatter: (val: number) => `${val} ${ta('productUnit')}` } },
  };

  // 2. Category Performance (group by Trendyol category)
  const catMap = new Map<string, { profits: number[]; rois: number[]; count: number }>();
  results.forEach(r => {
    const cat = r.trendyol.categoryName || ta('unknown');
    if (!catMap.has(cat)) catMap.set(cat, { profits: [], rois: [], count: 0 });
    const entry = catMap.get(cat)!;
    entry.profits.push(r.financials.profitUsd);
    entry.rois.push(r.financials.roiPercent);
    entry.count++;
  });

  const bubbleData = Array.from(catMap.entries()).map(([cat, data]) => ({
    x: data.rois.reduce((s, v) => s + v, 0) / data.rois.length,
    y: data.profits.reduce((s, v) => s + v, 0) / data.profits.length,
    z: data.count * 5,
    name: cat,
  }));

  const bubbleOptions: any = {
    chart: { type: 'bubble', toolbar: { show: false }, fontFamily: 'inherit' },
    xaxis: { title: { text: ta('avgRoi') }, labels: { formatter: (v: number) => `${v.toFixed(0)}%` } },
    yaxis: { title: { text: ta('avgProfit') }, labels: { formatter: (v: number) => `$${v.toFixed(1)}` } },
    tooltip: {
      custom: ({ seriesIndex, dataPointIndex, w }: any) => {
        const point = w.config.series[0].data[dataPointIndex];
        return `<div style="padding:8px"><b>${point.name}</b><br/>ROI: ${point.x.toFixed(1)}%<br/>${ta('profit')}: $${point.y.toFixed(2)}<br/>${Math.round(point.z / 5)} ${ta('productUnit')}</div>`;
      },
    },
    colors: ['#1565c0'],
    fill: { opacity: 0.6 },
    dataLabels: { enabled: false },
  };

  // 3. Price Comparison Scatter
  const scatterData = results.map(r => ({
    x: r.trendyol.priceTry * exchangeRate,
    y: r.ebay.medianPrice,
  }));

  const verdictColors = results.map(r => getVerdictConfig(r.verdict).color);

  const scatterOptions: any = {
    chart: { type: 'scatter', toolbar: { show: false }, fontFamily: 'inherit', zoom: { enabled: true } },
    xaxis: { title: { text: ta('trendyolPriceUsd') }, labels: { formatter: (v: number) => `$${v.toFixed(0)}` } },
    yaxis: { title: { text: ta('ebayMedianPriceUsd') }, labels: { formatter: (v: number) => `$${v.toFixed(0)}` } },
    colors: ['#1565c0'],
    markers: { size: 6, opacity: 0.7 },
    annotations: {
      yaxis: [{
        y: 0,
        borderColor: '#999',
        strokeDashArray: 0,
      }],
    },
    tooltip: {
      custom: ({ seriesIndex, dataPointIndex }: any) => {
        const r = results[dataPointIndex];
        if (!r) return '';
        return `<div style="padding:8px"><b>${r.trendyol.name.substring(0, 40)}</b><br/>Trendyol: $${(r.trendyol.priceTry * exchangeRate).toFixed(2)}<br/>eBay: $${r.ebay.medianPrice.toFixed(2)}<br/>${ta('profit')}: $${r.financials.profitUsd.toFixed(2)}</div>`;
      },
    },
    dataLabels: { enabled: false },
  };

  const chartHeight = isMobile ? 250 : 300;

  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
      gap: 2,
    }}>
      {/* Profit Distribution */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>{ta('profitDistribution')}</Typography>
        <Chart
          options={histogramOptions}
          series={[{ data: histogramData.map(d => d.y) }]}
          type="bar"
          height={chartHeight}
        />
      </Paper>

      {/* Category Performance */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>{ta('categoryPerformance')}</Typography>
        <Chart
          options={bubbleOptions}
          series={[{ name: ta('categories'), data: bubbleData }]}
          type="bubble"
          height={chartHeight}
        />
      </Paper>

      {/* Price Comparison Scatter */}
      <Paper variant="outlined" sx={{ p: 2, gridColumn: isMobile ? '1' : '1 / -1' }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
          {ta('priceComparison')}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
          {ta('priceComparisonHint')}
        </Typography>
        <Chart
          options={scatterOptions}
          series={[{ name: ta('products'), data: scatterData }]}
          type="scatter"
          height={chartHeight}
        />
      </Paper>
    </Box>
  );
}
