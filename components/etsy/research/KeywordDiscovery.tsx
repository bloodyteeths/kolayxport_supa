import React, { useState } from 'react';
import {
  Box, Typography, TextField, Button, Paper, Chip,
  InputAdornment, CircularProgress, LinearProgress,
  Switch, FormControlLabel,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel,
  Tooltip, IconButton, useMediaQuery, Collapse,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Search, Compass, Globe, Target, Zap, ArrowRight, Copy } from 'lucide-react';
import { toast } from 'react-hot-toast';

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
  const [expandedKwIdx, setExpandedKwIdx] = useState<number | null>(null);
  const {
    kwExplorerQuery, setKwExplorerQuery,
    kwSuggestions, kwExplorerLoading,
    kwAlphabetSoup, setKwAlphabetSoup,
    query, searchKeywords,
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
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Anahtar Kelime Kesif</Typography>
            <Typography variant="caption" color="text.secondary">
              Google + Amazon + Etsy verileriyle anahtar kelime onerisi
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
            label={<Typography variant="caption">A-Z Genislet</Typography>}
          />
          <Button variant="contained" onClick={searchKeywords}
            disabled={kwExplorerLoading}
            startIcon={kwExplorerLoading ? <CircularProgress size={16} /> : <Zap size={16} />}
            sx={{ background: GRADIENTS.info, borderRadius: '10px', ...(isMobile && { width: '100%' }) }}
          >
            Kesfet
          </Button>
        </Box>
      </Paper>

      {kwExplorerLoading && <LinearProgress sx={{ mb: 2, borderRadius: 4, height: 4 }} />}

      {kwSuggestions.length > 0 && (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, 1fr)', gap: 1.5, mb: 2 }}>
            <StatCard label="Toplam Oneri" value={String(kwSuggestions.length)} color="#2196F3"
              icon={<Compass size={18} />} />
            <StatCard label="Coklu Kaynak" value={String(kwSuggestions.filter(s => s.sourceCount > 1).length)}
              color="#4caf50" icon={<Globe size={18} />} />
            <StatCard label="En Yuksek Skor" value={String(kwSuggestions[0]?.score || 0)}
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
                          startIcon={<ArrowRight size={12} />} sx={{ borderRadius: '8px', fontSize: '0.7rem' }}>Arastir</Button>
                        <Button size="small" variant="outlined" fullWidth onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(s.keyword); toast.success(`"${s.keyword}" kopyalandi`); }}
                          startIcon={<Copy size={12} />} sx={{ borderRadius: '8px', fontSize: '0.7rem' }}>Kopyala</Button>
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
                    <TableCell>Anahtar Kelime</TableCell>
                    <TableCell align="center">
                      <TableSortLabel active={kwSortKey === 'sourceCount'} direction={kwSortKey === 'sourceCount' ? kwSortDir : 'desc'} onClick={() => handleSort('sourceCount')}>
                        Kaynaklar
                      </TableSortLabel>
                    </TableCell>
                    <TableCell align="center">
                      <TableSortLabel active={kwSortKey === 'score'} direction={kwSortKey === 'score' ? kwSortDir : 'desc'} onClick={() => handleSort('score')}>
                        Skor
                      </TableSortLabel>
                    </TableCell>
                    <TableCell align="center">Aksiyon</TableCell>
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
                          <Tooltip title="Ana aramaya gonder">
                            <IconButton size="small" onClick={() => onNavigateToSearch(s.keyword)}>
                              <ArrowRight size={14} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Kopyala">
                            <IconButton size="small" onClick={() => {
                              navigator.clipboard.writeText(s.keyword);
                              toast.success(`"${s.keyword}" kopyalandi`);
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
        <PremiumEmptyState
          icon={<Compass size={48} />}
          title="Anahtar Kelime Kesfet"
          desc="Hangi kelimeleri kullanmalisiniz? Google ve Amazon'dan oneriler alin."
          steps={['Yukariya satmak istediginiz urunu yazin (or. "baby blanket")', '"A-Z Genislet" ile uzun kuyruk kelimeler bulun', 'Yuksek skorlu kelimeleri baslik ve taglarina ekleyin']}
        />
      )}
    </Box>
  );
}
