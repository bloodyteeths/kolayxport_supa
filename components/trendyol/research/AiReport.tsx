import React from 'react';
import {
  Box, Typography, Paper, Button, CircularProgress, Alert,
} from '@mui/material';
import { Sparkles, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useTrendyolResearchStore } from '@/lib/stores/useTrendyolResearchStore';

const TRENDYOL_ORANGE = '#F27A1A';

function simpleMarkdownToHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[-•]\s+(.*)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br/>');
}

export default function AiReport() {
  const t = useTranslations('trendyolResearch');

  const products = useTrendyolResearchStore((s) => s.products);
  const selectedLabel = useTrendyolResearchStore((s) => s.selectedLabel);
  const aiReport = useTrendyolResearchStore((s) => s.aiReport);
  const aiReportLoading = useTrendyolResearchStore((s) => s.aiReportLoading);
  const generateAiReport = useTrendyolResearchStore((s) => s.generateAiReport);

  const productCount = products.length;

  if (productCount === 0) {
    return (
      <Box sx={{ py: 6, textAlign: 'center' }}>
        <Typography color="text.secondary">{t('noProductsForReport')}</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {productCount > 0 && productCount < 10 && (
        <Alert severity="warning" sx={{ borderRadius: 2 }}>
          {t('loadMoreForBetterAnalysis')}
        </Alert>
      )}

      {aiReportLoading && (
        <Paper
          sx={{
            p: 4,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            borderRadius: 3,
          }}
        >
          <CircularProgress sx={{ color: TRENDYOL_ORANGE }} />
          <Typography color="text.secondary">{t('analyzingMarket')}</Typography>
        </Paper>
      )}

      {!aiReport && !aiReportLoading && (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Button
            variant="contained"
            size="large"
            startIcon={<Sparkles size={20} />}
            onClick={() => generateAiReport(selectedLabel)}
            sx={{
              bgcolor: TRENDYOL_ORANGE,
              '&:hover': { bgcolor: '#e06a10' },
              borderRadius: 2,
              px: 4,
              py: 1.5,
              textTransform: 'none',
              fontWeight: 600,
            }}
          >
            {t('generateAiReport')}
          </Button>
        </Box>
      )}

      {aiReport && !aiReportLoading && (
        <>
          <Paper
            sx={{
              p: 3,
              borderRadius: 3,
              border: `1px solid ${TRENDYOL_ORANGE}22`,
            }}
          >
            <Typography
              variant="h6"
              sx={{ fontWeight: 700, mb: 2, color: TRENDYOL_ORANGE }}
            >
              {t('aiMarketReport')}
            </Typography>
            <Box
              sx={{
                '& p': { my: 1, lineHeight: 1.7 },
                '& ul': { pl: 3, my: 1 },
                '& li': { mb: 0.5, lineHeight: 1.6 },
                '& strong': { color: 'text.primary' },
                color: 'text.secondary',
                fontSize: '0.95rem',
              }}
              dangerouslySetInnerHTML={{
                __html: `<p>${simpleMarkdownToHtml(aiReport)}</p>`,
              }}
            />
          </Paper>

          <Box sx={{ textAlign: 'center' }}>
            <Button
              variant="outlined"
              startIcon={<RefreshCw size={18} />}
              onClick={() => generateAiReport(selectedLabel)}
              sx={{
                borderColor: TRENDYOL_ORANGE,
                color: TRENDYOL_ORANGE,
                '&:hover': { borderColor: '#e06a10', bgcolor: `${TRENDYOL_ORANGE}08` },
                borderRadius: 2,
                textTransform: 'none',
                fontWeight: 600,
              }}
            >
              {t('regenerateReport')}
            </Button>
          </Box>
        </>
      )}
    </Box>
  );
}
