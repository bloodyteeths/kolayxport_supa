import React from 'react';
import {
  Box, Typography, TextField, InputAdornment, Button, Card, CardContent,
  Chip, Grid, FormControlLabel, Switch, CircularProgress, LinearProgress,
} from '@mui/material';
import { Search, Sparkles, Download, Key } from 'lucide-react';
import { useAmazonResearchStore } from '@/lib/stores/useAmazonResearchStore';
import { useTranslations } from 'next-intl';

export default function KeywordIntelligence() {
  const t = useTranslations('amazonResearch');
  const {
    kwQuery, setKwQuery, kwSuggestions, kwLoading, kwAlphabetSoup, setKwAlphabetSoup,
    searchKeywords, fetchRelatedKeywords, kwRelated, kwRelatedLoading,
    fetchKeywordClusters, kwClusters, kwClustersLoading,
  } = useAmazonResearchStore();

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') searchKeywords();
  };

  const exportCsv = () => {
    const csv = kwSuggestions.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `amazon-keywords-${kwQuery}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box>
      {/* Search */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <TextField
          fullWidth
          size="small"
          placeholder={t('kwSearchPlaceholder')}
          value={kwQuery}
          onChange={(e) => setKwQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          InputProps={{
            startAdornment: <InputAdornment position="start"><Key size={16} /></InputAdornment>,
          }}
        />
        <FormControlLabel
          control={<Switch checked={kwAlphabetSoup} onChange={(e) => setKwAlphabetSoup(e.target.checked)} size="small" />}
          label={<Typography variant="caption">A-Z</Typography>}
        />
        <Button
          variant="contained"
          onClick={searchKeywords}
          disabled={kwLoading || !kwQuery.trim()}
          sx={{ background: 'linear-gradient(135deg, #FF9900 0%, #FF6600 100%)' }}
        >
          {kwLoading ? <CircularProgress size={18} color="inherit" /> : t('search')}
        </Button>
      </Box>

      {kwLoading && <LinearProgress color="warning" sx={{ mb: 2 }} />}

      {/* Results */}
      {kwSuggestions.length > 0 && (
        <Card variant="outlined" sx={{ mb: 2 }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="subtitle2" fontWeight={700}>
                {t('keywords')} ({kwSuggestions.length})
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button size="small" startIcon={<Download size={14} />} onClick={exportCsv}>CSV</Button>
                <Button
                  size="small"
                  startIcon={<Search size={14} />}
                  onClick={fetchRelatedKeywords}
                  disabled={kwRelatedLoading}
                >
                  {t('relatedKw')}
                </Button>
                <Button
                  size="small"
                  startIcon={<Sparkles size={14} />}
                  onClick={fetchKeywordClusters}
                  disabled={kwClustersLoading}
                  color="warning"
                >
                  {t('aiClusters')}
                </Button>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxHeight: 300, overflow: 'auto' }}>
              {kwSuggestions.map((kw) => (
                <Chip
                  key={kw}
                  label={kw}
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    setKwQuery(kw);
                    navigator.clipboard.writeText(kw);
                  }}
                  sx={{ cursor: 'pointer' }}
                />
              ))}
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Related keywords */}
      {kwRelated && (
        <Card variant="outlined" sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
              {t('relatedKeywords')} ({kwRelated.keywords.length})
            </Typography>

            {kwRelated.topWords.length > 0 && (
              <Box sx={{ mb: 1 }}>
                <Typography variant="caption" fontWeight={600}>{t('topWords')}</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                  {kwRelated.topWords.slice(0, 20).map((w) => (
                    <Chip
                      key={w.word}
                      label={`${w.word} (${w.count})`}
                      size="small"
                      color="warning"
                      variant="outlined"
                    />
                  ))}
                </Box>
              </Box>
            )}

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxHeight: 200, overflow: 'auto' }}>
              {kwRelated.keywords.map((kw) => (
                <Chip key={kw} label={kw} size="small" variant="outlined" />
              ))}
            </Box>
          </CardContent>
        </Card>
      )}

      {/* AI Clusters */}
      {kwClusters && (
        <Card variant="outlined" sx={{ mb: 2, border: '1px solid #FF9900' }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Sparkles size={16} color="#FF9900" />
              <Typography variant="subtitle2" fontWeight={700}>{t('keywordClusters')}</Typography>
            </Box>

            {kwClusters.primaryKeyword && (
              <Typography variant="body2" sx={{ mb: 1 }}>
                {t('primaryKeyword')}: <strong>{kwClusters.primaryKeyword}</strong>
              </Typography>
            )}

            <Grid container spacing={1}>
              {(kwClusters.clusters || []).map((cluster: any, i: number) => (
                <Grid item xs={12} sm={6} key={i}>
                  <Box sx={{ p: 1, border: '1px solid #eee', borderRadius: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                      <Typography variant="caption" fontWeight={700}>{cluster.name}</Typography>
                      <Chip label={cluster.intent} size="small" sx={{ height: 18, fontSize: '0.6rem' }} />
                      <Chip label={cluster.priority} size="small" color={cluster.priority === 'high' ? 'error' : cluster.priority === 'medium' ? 'warning' : 'default'} sx={{ height: 18, fontSize: '0.6rem' }} />
                    </Box>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.3 }}>
                      {(cluster.keywords || []).slice(0, 8).map((kw: string) => (
                        <Chip key={kw} label={kw} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
                      ))}
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      {cluster.strategy}
                    </Typography>
                  </Box>
                </Grid>
              ))}
            </Grid>

            {kwClusters.longTailGems?.length > 0 && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="caption" fontWeight={600}>{t('longTailGems')}</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                  {kwClusters.longTailGems.map((kw: string) => (
                    <Chip key={kw} label={kw} size="small" color="success" variant="outlined" />
                  ))}
                </Box>
              </Box>
            )}
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!kwSuggestions.length && !kwLoading && (
        <Box sx={{ textAlign: 'center', py: 6, color: '#999' }}>
          <Key size={40} strokeWidth={1} />
          <Typography sx={{ mt: 1 }}>{t('kwEmptyState')}</Typography>
        </Box>
      )}
    </Box>
  );
}
