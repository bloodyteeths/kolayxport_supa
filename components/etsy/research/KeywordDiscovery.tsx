import React, { useState } from 'react';
import {
  Box, Typography, TextField, Button, Paper, Chip,
  InputAdornment, CircularProgress, LinearProgress,
  Switch, FormControlLabel,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel,
  Tooltip, IconButton, useMediaQuery, Collapse, Skeleton,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Search, Compass, Globe, Target, Zap, ArrowRight, Copy, TrendingUp, Lightbulb } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

import { useEtsyResearchStore } from '@/lib/stores/useEtsyResearchStore';
import type { AutocompleteSuggestion } from './shared/types';
import { sortArray } from './shared/utils';
import {
  GRADIENTS, glassCard, useTableSort,
  StatCard, SourceBadge, PremiumEmptyState,
} from './shared/ui';

interface KeywordDiscoveryProps {
  onNavigateToSearch: (keyword: string) => void;
}

export default function KeywordDiscovery({ onNavigateToSearch }: KeywordDiscoveryProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const t = useTranslations('etsyResearch');
  const [expandedKwIdx, setExpandedKwIdx] = useState<number | null>(null);
  const {
    kwExplorerQuery, setKwExplorerQuery,
    kwSuggestions, kwExplorerLoading,
    kwAlphabetSoup, setKwAlphabetSoup,
    query, searchKeywords,
    discoveryData, discoveryLoading,
  } = useEtsyResearchStore();

  const { sorted: sortedKwSuggestions, sortKey: kwSortKey, sortDir: kwSortDir, handleSort } =
    useTableSort<AutocompleteSuggestion>(kwSuggestions, 'score', 'desc');

  return (
    <Box>
      <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Box sx={{
            width: 36, height: 36, borderRadius: '10px', display: 'flex',
            alignItems: 'center', justifyContent: 'center', background: GRADIENTS.info,
          }}>
            <Compass size={18} color="#fff" />
          </Box>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{t('kd_title')}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t('kd_subtitle')}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <TextField
            value={kwExplorerQuery} onChange={e => setKwExplorerQuery(e.target.value)}
            size="small" sx={{ flex: 2, minWidth: isMobile ? 0 : 200, ...(isMobile && { width: '100%' }) }}
            placeholder={query || 'personalized gift, baby blanket...'}
            onKeyDown={e => e.key === 'Enter' && searchKeywords()}
            InputProps={{
              startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment>,
            }}
          />
          <FormControlLabel
            control={<Switch checked={kwAlphabetSoup} onChange={e => setKwAlphabetSoup(e.target.checked)} size="small" />}
            label={<Typography variant="caption">{t('kd_azExpand')}</Typography>}
          />
          <Button variant="contained" onClick={searchKeywords}
            disabled={kwExplorerLoading}
            startIcon={kwExplorerLoading ? <CircularProgress size={16} /> : <Zap size={16} />}
            sx={{ background: GRADIENTS.info, borderRadius: '10px', ...(isMobile && { width: '100%' }) }}
          >
            {t('kd_discover')}
          </Button>
        </Box>
      </Paper>

      {kwExplorerLoading && <LinearProgress sx={{ mb: 2, borderRadius: 4, height: 4 }} />}

      {kwSuggestions.length > 0 && (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, 1fr)', gap: 1.5, mb: 2 }}>
            <StatCard label={t('kd_totalSuggestions')} value={String(kwSuggestions.length)} color="#2196F3"
              icon={<Compass size={18} />} />
            <StatCard label={t('kd_multiSource')} value={String(kwSuggestions.filter(s => s.sourceCount > 1).length)}
              color="#4caf50" icon={<Globe size={18} />} />
            <StatCard label={t('kd_highestScore')} value={String(kwSuggestions[0]?.score || 0)}
              color="#ff9800" icon={<Target size={18} />} />
          </Box>

          {isMobile ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {sortedKwSuggestions.slice(0, 50).map((s, i) => {
                const isExpanded = expandedKwIdx === i;
                return (
                  <Paper key={s.keyword} sx={{
                    ...glassCard, p: 1.5, cursor: 'pointer',
                    borderLeft: i < 3 ? '3px solid #667eea' : 'none',
                  }} onClick={() => setExpandedKwIdx(isExpanded ? null : i)}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{s.keyword}</Typography>
                        <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                          {s.sources.map(src => <SourceBadge key={src} source={src} />)}
                        </Box>
                      </Box>
                      <Chip label={s.score} size="small" sx={{
                        fontWeight: 700, ml: 1,
                        bgcolor: s.score >= 60 ? '#e8f5e9' : s.score >= 30 ? '#fff3e0' : '#fafafa',
                        color: s.score >= 60 ? '#2e7d32' : s.score >= 30 ? '#e65100' : '#999',
                      }} />
                    </Box>
                    <Collapse in={isExpanded}>
                      <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', gap: 1 }}>
                        <Button size="small" variant="outlined" fullWidth onClick={(e) => { e.stopPropagation(); onNavigateToSearch(s.keyword); }}
                          startIcon={<ArrowRight size={12} />} sx={{ borderRadius: '8px', fontSize: '0.7rem' }}>{t('kd_research')}</Button>
                        <Button size="small" variant="outlined" fullWidth onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(s.keyword); toast.success(t('kd_copied', { keyword: s.keyword })); }}
                          startIcon={<Copy size={12} />} sx={{ borderRadius: '8px', fontSize: '0.7rem' }}>{t('kd_copy')}</Button>
                      </Box>
                    </Collapse>
                  </Paper>
                );
              })}
            </Box>
          ) : (
          <Paper sx={{ ...glassCard, overflow: 'hidden' }}>
            <TableContainer sx={{ maxHeight: 500 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow sx={{ '& .MuiTableCell-head': { bgcolor: '#fafbfe', fontWeight: 700 } }}>
                    <TableCell>#</TableCell>
                    <TableCell>{t('kd_keyword')}</TableCell>
                    <TableCell align="center">
                      <TableSortLabel active={kwSortKey === 'sourceCount'} direction={kwSortKey === 'sourceCount' ? kwSortDir : 'desc'} onClick={() => handleSort('sourceCount')}>
                        {t('kd_sources')}
                      </TableSortLabel>
                    </TableCell>
                    <TableCell align="center">
                      <TableSortLabel active={kwSortKey === 'score'} direction={kwSortKey === 'score' ? kwSortDir : 'desc'} onClick={() => handleSort('score')}>
                        {t('kd_score')}
                      </TableSortLabel>
                    </TableCell>
                    <TableCell align="center">{t('kd_action')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedKwSuggestions.slice(0, 50).map((s, i) => (
                    <TableRow key={s.keyword} hover sx={{
                      '&:hover': { bgcolor: 'rgba(102,126,234,0.04)' },
                      borderLeft: i < 3 ? '3px solid #667eea' : 'none',
                    }}>
                      <TableCell>
                        <Typography variant="caption" sx={{ fontWeight: 700, color: i < 3 ? '#667eea' : '#999' }}>
                          {i + 1}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{s.keyword}</Typography>
                      </TableCell>
                      <TableCell align="center">
                        {s.sources.map(src => <SourceBadge key={src} source={src} />)}
                      </TableCell>
                      <TableCell align="center">
                        <Chip label={s.score} size="small" sx={{
                          fontWeight: 700,
                          bgcolor: s.score >= 60 ? '#e8f5e9' : s.score >= 30 ? '#fff3e0' : '#fafafa',
                          color: s.score >= 60 ? '#2e7d32' : s.score >= 30 ? '#e65100' : '#999',
                        }} />
                      </TableCell>
                      <TableCell align="center">
                        <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                          <Tooltip title={t('kd_sendToSearch')}>
                            <IconButton size="small" onClick={() => onNavigateToSearch(s.keyword)}>
                              <ArrowRight size={14} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={t('kd_copy')}>
                            <IconButton size="small" onClick={() => {
                              navigator.clipboard.writeText(s.keyword);
                              toast.success(t('kd_copied', { keyword: s.keyword }));
                            }}>
                              <Copy size={14} />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
          )}
        </>
      )}

      {!kwExplorerLoading && kwSuggestions.length === 0 && (
        <>
          {/* Discovery suggestions */}
          {discoveryLoading && (
            <Box sx={{ mb: 2 }}>
              <Skeleton variant="text" width={180} height={28} sx={{ mb: 1 }} />
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {[1, 2, 3, 4, 5, 6].map(i => (
                  <Skeleton key={i} variant="rounded" width={100} height={32} sx={{ borderRadius: '16px' }} />
                ))}
              </Box>
            </Box>
          )}

          {discoveryData?.hotKeywords?.length > 0 && (
            <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                <TrendingUp size={16} color="#667eea" /> {t('kd_suggestedKeywords')}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                {t('kd_clickToFill')}
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap' }}>
                {discoveryData.hotKeywords.map((kw: any) => (
                  <Chip key={kw.keyword} label={`${kw.keyword} (${kw.count})`} size="small" variant="outlined"
                    onClick={() => { setKwExplorerQuery(kw.keyword); }}
                    sx={{
                      cursor: 'pointer', borderRadius: '10px', fontWeight: 600, fontSize: '0.78rem',
                      '&:hover': { bgcolor: 'rgba(102,126,234,0.08)', borderColor: '#667eea' },
                    }}
                  />
                ))}
              </Box>
            </Paper>
          )}

          {discoveryData?.seasonalTips?.length > 0 && (
            <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Lightbulb size={16} color="#ff9800" /> {t('kd_seasonalTips')}
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.8 }}>
                {discoveryData.seasonalTips.map((tip: string, i: number) => (
                  <Typography key={i} variant="body2" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <Box component="span" sx={{ color: '#ff9800', fontWeight: 700, mt: '2px' }}>•</Box>
                    {tip}
                  </Typography>
                ))}
              </Box>
            </Paper>
          )}

          {!discoveryLoading && !discoveryData && (
            <PremiumEmptyState
              icon={<Compass size={48} />}
              title={t('kd_emptyTitle')}
              desc={t('kd_emptyDesc')}
              steps={[t('kd_step1'), t('kd_step2'), t('kd_step3')]}
            />
          )}
        </>
      )}
    </Box>
  );
}
