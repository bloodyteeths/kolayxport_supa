import React from 'react';
import {
  Box, Typography, Paper, Chip, Alert, Divider, Button,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel,
  IconButton, useMediaQuery, Skeleton,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { CheckCircle, Hash, Tag, Heart, Copy, TrendingUp } from 'lucide-react';
import { toast } from 'react-hot-toast';

import {
  useEtsyResearchStore,
  useComputedKeywords,
  useComputedTags,
} from '@/lib/stores/useEtsyResearchStore';
import {
  GradientBar, PremiumEmptyState, glassCard, useTableSort,
} from './shared/ui';

interface KeywordIntelligenceProps {
  userListings?: any[];
}

export default function KeywordIntelligence({ userListings }: KeywordIntelligenceProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const items = useEtsyResearchStore(s => s.items);
  const loading = useEtsyResearchStore(s => s.loading);
  const kwShowMissing = useEtsyResearchStore(s => s.kwShowMissing);
  const setKwShowMissing = useEtsyResearchStore(s => s.setKwShowMissing);
  const myTitle = useEtsyResearchStore(s => s.myTitle);
  const discoveryData = useEtsyResearchStore(s => s.discoveryData);
  const discoveryLoading = useEtsyResearchStore(s => s.discoveryLoading);
  const setQuery = useEtsyResearchStore(s => s.setQuery);
  const searchMarket = useEtsyResearchStore(s => s.searchMarket);

  const { enrichedKeywords, bigrams, trigrams } = useComputedKeywords();
  const { enrichedTags, tagGaps, myTagsSet, tagCombos } = useComputedTags(userListings);

  const { sorted: sortedTagCombos, sortKey: tagComboSortKey, sortDir: tagComboSortDir, handleSort: handleTagComboSort } =
    useTableSort(tagCombos, 'count', 'desc');

  const hasData = items.length > 0;

  return (
    <Box>
      {enrichedTags.length > 0 ? (
        <>
          {tagGaps.length > 0 && myTagsSet.size > 0 && (
            <Alert severity="warning" sx={{ mb: 2, borderRadius: '12px',
              background: 'linear-gradient(135deg, rgba(242,153,74,0.08) 0%, rgba(242,201,76,0.08) 100%)',
              border: '1px solid rgba(242,153,74,0.2)',
            }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {tagGaps.length} Eksik Tag Tespit Edildi!
              </Typography>
              <Typography variant="body2">
                Rakiplerin kullandigi ama sizde olmayan tagler:
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
                {tagGaps.slice(0, 10).map(t => (
                  <Chip key={t.tag} label={`${t.tag} (%${t.pct})`} size="small" color="warning"
                    onClick={() => { navigator.clipboard.writeText(t.tag); toast.success(`"${t.tag}" kopyalandi`); }}
                    sx={{ cursor: 'pointer', borderRadius: '8px' }}
                  />
                ))}
              </Box>
            </Alert>
          )}

          <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
              En Cok Kullanilan Tagler ({enrichedTags.length} benzersiz)
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2.5 }}>
              {enrichedTags.slice(0, 40).map(t => (
                <Chip key={t.tag}
                  label={`${t.tag} (%${t.pct})`} size="small"
                  color={t.inMyTags ? 'success' : t.pct >= 30 ? 'error' : t.pct >= 15 ? 'warning' : 'default'}
                  variant={t.inMyTags ? 'filled' : 'outlined'}
                  onClick={() => { navigator.clipboard.writeText(t.tag); toast.success(`"${t.tag}" kopyalandi`); }}
                  sx={{ cursor: 'pointer', borderRadius: '8px' }}
                />
              ))}
            </Box>

            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Tag Yogunlugu</Typography>
            {enrichedTags.slice(0, 20).map(t => (
              <Box key={t.tag} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Typography variant="body2" sx={{ minWidth: isMobile ? 90 : 140, fontSize: isMobile ? '0.75rem' : undefined, fontWeight: t.inMyTags ? 700 : 400 }}>
                  {t.inMyTags && <CheckCircle size={12} color="#4caf50" style={{ marginRight: 4, verticalAlign: 'middle' }} />}
                  {t.tag}
                </Typography>
                <Box sx={{ flex: 1 }}><GradientBar value={t.pct} max={100} /></Box>
                <Typography variant="caption" sx={{ minWidth: 35, fontWeight: 600 }}>{t.pct}%</Typography>
              </Box>
            ))}
          </Paper>

          {/* Tag Effectiveness Scores */}
          <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
              Tag Etkinlik Skorları
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Frekans x Etkileşim: Hangi tagler gerçekten dönüşüm sağlıyor?
            </Typography>
            {enrichedTags.slice(0, 25).map(t => {
              const tagItems = items.filter(item => (item.tags || []).some((tag: string) => tag.toLowerCase() === t.tag));
              const avgFav = tagItems.length > 0 ? tagItems.reduce((s, i) => s + i.num_favorers, 0) / tagItems.length : 0;
              const avgViews = tagItems.length > 0 ? tagItems.reduce((s, i) => s + i.views, 0) / tagItems.length : 0;
              const engRate = avgViews > 0 ? (avgFav / avgViews) * 100 : 0;
              const freqScore = Math.min(30, t.pct * 0.3);
              const engScore = Math.min(30, engRate * 6);
              const compScore = Math.min(20, (1 - Math.min(tagItems.length / Math.max(items.length, 1), 1)) * 20);
              const effectiveness = Math.round(freqScore + engScore + compScore);
              const effectColor = effectiveness > 50 ? '#4caf50' : effectiveness > 30 ? '#ff9800' : '#f44336';
              return (
                <Box key={t.tag} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography variant="body2" sx={{ minWidth: isMobile ? 80 : 140, fontWeight: t.inMyTags ? 700 : 400, fontSize: isMobile ? '0.7rem' : '0.8rem' }}>
                    {t.inMyTags && <CheckCircle size={10} color="#4caf50" style={{ marginRight: 4, verticalAlign: 'middle' }} />}
                    {t.tag}
                  </Typography>
                  <Box sx={{ flex: 1, bgcolor: '#f0f0f0', borderRadius: 3, height: 8, overflow: 'hidden' }}>
                    <Box sx={{ width: `${Math.min(effectiveness, 100)}%`, height: 8, borderRadius: 3, bgcolor: effectColor, transition: 'width 0.5s' }} />
                  </Box>
                  <Chip label={effectiveness} size="small" sx={{
                    minWidth: 36, fontWeight: 700, borderRadius: '6px',
                    bgcolor: effectiveness > 50 ? '#e8f5e9' : effectiveness > 30 ? '#fff3e0' : '#ffebee',
                    color: effectColor,
                  }} />
                  <Typography variant="caption" sx={{ minWidth: 65, color: 'text.secondary' }}>
                    Fav:{Math.round(avgFav)}
                  </Typography>
                </Box>
              );
            })}
          </Paper>

          {tagCombos.length > 0 && (
            isMobile ? (
              <Paper sx={{ ...glassCard, p: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                  Populer Tag Kombinasyonlari
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                  Birlikte en cok kullanilan tag ciftleri
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {sortedTagCombos.slice(0, 20).map(c => (
                    <Box key={c.pair} sx={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      p: 1, borderRadius: '8px', bgcolor: 'rgba(102,126,234,0.03)',
                    }}
                      onClick={() => { navigator.clipboard.writeText(c.pair.replace(' + ', ', ')); toast.success('Kopyalandi'); }}
                    >
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem' }}>{c.pair}</Typography>
                        <Box sx={{ display: 'flex', gap: 1, mt: 0.3 }}>
                          <Typography variant="caption" color="text.secondary">Kullanim: {c.count}</Typography>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
                            <Heart size={10} color="#e91e63" />
                            <Typography variant="caption">{c.avgFav}</Typography>
                          </Box>
                        </Box>
                      </Box>
                      <IconButton size="small"><Copy size={14} /></IconButton>
                    </Box>
                  ))}
                </Box>
              </Paper>
            ) : (
            <Paper sx={{ ...glassCard, overflow: 'hidden' }}>
              <Box sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Populer Tag Kombinasyonlari
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Birlikte en cok kullanilan tag ciftleri ve ortalama favori sayilari
                </Typography>
              </Box>
              <TableContainer sx={{ maxHeight: 400 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow sx={{ '& .MuiTableCell-head': { bgcolor: '#fafbfe', fontWeight: 700 } }}>
                      <TableCell>Tag Cifti</TableCell>
                      <TableCell align="center">
                        <TableSortLabel active={tagComboSortKey === 'count'} direction={tagComboSortKey === 'count' ? tagComboSortDir : 'desc'} onClick={() => handleTagComboSort('count')}>
                          Kullanim
                        </TableSortLabel>
                      </TableCell>
                      <TableCell align="center">
                        <TableSortLabel active={tagComboSortKey === 'avgFav'} direction={tagComboSortKey === 'avgFav' ? tagComboSortDir : 'desc'} onClick={() => handleTagComboSort('avgFav')}>
                          Ort. Favori
                        </TableSortLabel>
                      </TableCell>
                      <TableCell align="center">Kopyala</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sortedTagCombos.map(c => (
                      <TableRow key={c.pair} hover sx={{ '&:hover': { bgcolor: 'rgba(102,126,234,0.04)' } }}>
                        <TableCell><Typography variant="body2" sx={{ fontWeight: 600 }}>{c.pair}</Typography></TableCell>
                        <TableCell align="center">{c.count}</TableCell>
                        <TableCell align="center">
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                            <Heart size={12} color="#e91e63" /> {c.avgFav}
                          </Box>
                        </TableCell>
                        <TableCell align="center">
                          <IconButton size="small" onClick={() => {
                            navigator.clipboard.writeText(c.pair.replace(' + ', ', '));
                            toast.success('Kopyalandi');
                          }}><Copy size={14} /></IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
            )
          )}
        </>
      ) : !loading && (
        hasData
          ? <Alert severity="info" sx={{ borderRadius: '12px' }}>Aramanizda tag verisi bulunamadi. Farkli bir anahtar kelime deneyin.</Alert>
          : (
            <>
              {/* Discovery hot keywords with frequency bars */}
              {discoveryLoading && (
                <Box sx={{ mb: 2 }}>
                  <Skeleton variant="text" width={200} height={28} sx={{ mb: 1 }} />
                  {[1, 2, 3, 4, 5].map(i => (
                    <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Skeleton variant="text" width={100} height={20} />
                      <Skeleton variant="rounded" sx={{ flex: 1 }} height={12} />
                    </Box>
                  ))}
                </Box>
              )}

              {discoveryData?.hotKeywords?.length > 0 ? (
                <Paper sx={{ ...glassCard, p: 2.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <TrendingUp size={16} color="#667eea" /> Hot Keywords — Click to Research
                  </Typography>
                  {(() => {
                    const maxCount = Math.max(...discoveryData.hotKeywords.map((kw: any) => kw.count), 1);
                    return discoveryData.hotKeywords.map((kw: any) => (
                      <Box key={kw.keyword} sx={{
                        display: 'flex', alignItems: 'center', gap: 1, mb: 0.8, cursor: 'pointer',
                        p: 0.5, borderRadius: '8px', '&:hover': { bgcolor: 'rgba(102,126,234,0.06)' },
                      }} onClick={() => { setQuery(kw.keyword); setTimeout(() => searchMarket(), 50); }}>
                        <Typography variant="body2" sx={{ minWidth: isMobile ? 100 : 150, fontWeight: 600, fontSize: '0.85rem' }}>
                          {kw.keyword}
                        </Typography>
                        <Box sx={{ flex: 1, bgcolor: '#f0f0f0', borderRadius: 3, height: 10, overflow: 'hidden' }}>
                          <Box sx={{
                            width: `${(kw.count / maxCount) * 100}%`, height: 10, borderRadius: 3,
                            background: 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)',
                            transition: 'width 0.5s',
                          }} />
                        </Box>
                        <Typography variant="caption" sx={{ minWidth: 30, fontWeight: 700, textAlign: 'right' }}>{kw.count}</Typography>
                      </Box>
                    ));
                  })()}
                </Paper>
              ) : !discoveryLoading && (
                <PremiumEmptyState icon={<Hash size={48} />} title="Kelime & Tag Analizi"
                  desc="Rakiplerin kullandigi taglari ve anahtar kelimeleri kesfedin."
                  steps={['Once bir anahtar kelime aramasi yapin', 'Rakiplerin en cok kullandigi taglar ve kelimeler listelenir', 'Eksiklerinizi gorun — tiklayarak kopyalayin']}
                />
              )}
            </>
          )
      )}

      {/* --- Keywords (merged from tab 4) --- */}
      {hasData && (
        <Box sx={{ mt: 3 }}>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Tag size={18} color="#667eea" /> Anahtar Kelimeler
          </Typography>
          <Alert severity="info" sx={{ mb: 2, borderRadius: '12px' }}>
            Rakiplerin basliklarindan cikarilan en populer anahtar kelimeler. Tiklayin ve kopyalayin.
          </Alert>

          {myTitle && (
            <Box sx={{ mb: 1.5 }}>
              <Button size="small" variant={kwShowMissing ? 'contained' : 'outlined'}
                onClick={() => setKwShowMissing(!kwShowMissing)} sx={{ mr: 1, borderRadius: '8px' }}>
                {kwShowMissing ? 'Tum Kelimeler' : 'Basligimda Olmayanlar'}
              </Button>
            </Box>
          )}

          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Tek Kelimeler</Typography>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2 }}>
            {(kwShowMissing ? enrichedKeywords.filter(k => !k.inMyTitle) : enrichedKeywords).map(kw => (
              <Chip key={kw.keyword}
                label={`${kw.keyword} (${kw.pct}%)`} size="small"
                color={kw.pct >= 40 ? 'error' : kw.pct >= 20 ? 'warning' : 'default'}
                variant={kw.inMyTitle ? 'filled' : 'outlined'}
                onClick={() => { navigator.clipboard.writeText(kw.keyword); toast.success(`"${kw.keyword}" kopyalandi`); }}
                sx={{ cursor: 'pointer', borderRadius: '8px' }}
              />
            ))}
          </Box>

          {bigrams.length > 0 && (
            <>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>2 Kelimelik Ifadeler</Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2 }}>
                {bigrams.slice(0, 25).map(b => (
                  <Chip key={b.phrase} label={`${b.phrase} (${b.count})`} size="small"
                    color={b.percentage >= 30 ? 'primary' : 'default'} variant="outlined"
                    onClick={() => { navigator.clipboard.writeText(b.phrase); toast.success(`"${b.phrase}" kopyalandi`); }}
                    sx={{ cursor: 'pointer', borderRadius: '8px' }}
                  />
                ))}
              </Box>
            </>
          )}

          {trigrams.length > 0 && (
            <>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Uzun Kuyruk (3+ kelime)</Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2 }}>
                {trigrams.slice(0, 20).map(t => (
                  <Chip key={t.phrase} label={`${t.phrase} (${t.count})`} size="small"
                    color="secondary" variant="outlined"
                    onClick={() => { navigator.clipboard.writeText(t.phrase); toast.success(`"${t.phrase}" kopyalandi`); }}
                    sx={{ cursor: 'pointer', borderRadius: '8px' }}
                  />
                ))}
              </Box>
            </>
          )}

          {/* Keyword density */}
          <Paper sx={{ ...glassCard, p: isMobile ? 1.5 : 2.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Anahtar Kelime Yogunlugu</Typography>
            {enrichedKeywords.slice(0, 15).map(kw => (
              <Box key={kw.keyword} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Typography variant="body2" sx={{ minWidth: isMobile ? 70 : 100, fontSize: isMobile ? '0.75rem' : undefined, fontWeight: kw.inMyTitle ? 700 : 400 }}>
                  {kw.keyword}
                </Typography>
                <Box sx={{ flex: 1 }}>
                  <GradientBar value={kw.pct} max={100} />
                </Box>
                <Typography variant="caption" sx={{ minWidth: 35, fontWeight: 600 }}>{kw.pct}%</Typography>
              </Box>
            ))}
          </Paper>
        </Box>
      )}
    </Box>
  );
}
