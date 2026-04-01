import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import {
  Box, Typography, TextField, Button, Paper, Chip, Autocomplete,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  CircularProgress, Alert, Tooltip, IconButton, useMediaQuery, useTheme,
} from '@mui/material';
import {
  Search, Crown, ArrowRight, Plus, X, BarChart3, ShieldCheck,
} from 'lucide-react';
import { toast } from 'react-hot-toast';

interface NicheComparisonProps {
  userId: string;
  onNavigate?: (tool: string, data?: any) => void;
}

interface NicheData {
  query: string;
  totalResults: number;
  avgPrice: number;
  medianPrice: number;
  demandScore: number;
  competitionScore: number;
  opportunityScore: number;
  uniqueSellers: number;
  freeShippingPct: number;
  sellerConcentration: number;
  demandLabel?: string;
  competitionLabel?: string;
  opportunityLabel?: string;
  [key: string]: any;
}

interface SavedNiche {
  id: string;
  query: string;
  marketplace?: string;
  totalResults?: number;
  avgPrice?: number;
  demandScore?: number;
  competitionScore?: number;
  opportunityScore?: number;
  uniqueSellers?: number;
  freeShippingPct?: number;
  medianPrice?: number;
  sellerConcentration?: number;
  demandLabel?: string;
  competitionLabel?: string;
  opportunityLabel?: string;
  [key: string]: any;
}

interface SlotState {
  keyword: string;
  selectedNiche: SavedNiche | null;
  data: NicheData | null;
  loading: boolean;
}

const MAX_SLOTS = 3;

async function apiCall(action: string, userId: string, params: Record<string, any> = {}) {
  const query = new URLSearchParams({
    action, user_id: userId, ...Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null).map(([k, v]) => [k, String(v)])
    ),
  });
  const res = await fetch(`/api/clawd/ebay-research?${query.toString()}`);
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `API hatasi: ${res.status}`);
  }
  return res.json();
}

function scoreColor(score: number): string {
  if (score >= 70) return '#10b981';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

function ScoreBadge({ score, label }: { score: number; label?: string }) {
  return (
    <Tooltip title={label || ''}>
      <Chip
        label={score}
        size="small"
        sx={{
          fontWeight: 700,
          fontSize: '0.85rem',
          color: '#fff',
          bgcolor: scoreColor(score),
          minWidth: 44,
          boxShadow: `0 0 6px ${scoreColor(score)}40`,
        }}
      />
    </Tooltip>
  );
}

type MetricKey = 'totalResults' | 'avgPrice' | 'medianPrice' | 'demandScore' | 'competitionScore' | 'opportunityScore' | 'uniqueSellers' | 'freeShippingPct' | 'sellerConcentration';

interface MetricDef {
  key: MetricKey;
  label: string;
  format: (v: number) => string;
  higherIsBetter: boolean;
  isScore: boolean;
}

const METRICS: MetricDef[] = [
  { key: 'totalResults', label: 'Toplam Sonuc', format: v => v.toLocaleString(), higherIsBetter: true, isScore: false },
  { key: 'avgPrice', label: 'Ort. Fiyat', format: v => `$${v.toFixed(2)}`, higherIsBetter: true, isScore: false },
  { key: 'medianPrice', label: 'Medyan Fiyat', format: v => `$${v.toFixed(2)}`, higherIsBetter: true, isScore: false },
  { key: 'demandScore', label: 'Talep Skoru', format: v => String(v), higherIsBetter: true, isScore: true },
  { key: 'competitionScore', label: 'Rekabet Skoru', format: v => String(v), higherIsBetter: false, isScore: true },
  { key: 'opportunityScore', label: 'opportunityScore', format: v => String(v), higherIsBetter: true, isScore: true },
  { key: 'uniqueSellers', label: 'Benzersiz Satici', format: v => v.toLocaleString(), higherIsBetter: false, isScore: false },
  { key: 'freeShippingPct', label: 'Ucretsiz Kargo %', format: v => `%${v.toFixed(1)}`, higherIsBetter: true, isScore: false },
  { key: 'sellerConcentration', label: 'Satici Yogunlugu', format: v => `%${v.toFixed(1)}`, higherIsBetter: false, isScore: false },
];

function getWinnerIndex(values: (number | undefined)[], higherIsBetter: boolean): number {
  let bestIdx = -1;
  let bestVal: number | undefined;
  values.forEach((v, i) => {
    if (v === undefined) return;
    if (bestVal === undefined || (higherIsBetter ? v > bestVal : v < bestVal)) {
      bestVal = v;
      bestIdx = i;
    }
  });
  return bestIdx;
}

function savedNicheToData(n: SavedNiche): NicheData {
  return {
    query: n.query,
    totalResults: n.totalResults ?? 0,
    avgPrice: n.avgPrice ?? 0,
    medianPrice: n.medianPrice ?? 0,
    demandScore: n.demandScore ?? 0,
    competitionScore: n.competitionScore ?? 0,
    opportunityScore: n.opportunityScore ?? 0,
    uniqueSellers: n.uniqueSellers ?? 0,
    freeShippingPct: n.freeShippingPct ?? 0,
    sellerConcentration: n.sellerConcentration ?? 0,
    demandLabel: n.demandLabel,
    competitionLabel: n.competitionLabel,
    opportunityLabel: n.opportunityLabel,
  };
}

export default function NicheComparison({ userId, onNavigate }: NicheComparisonProps) {
  const t = useTranslations('ebay.nicheComparison');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [savedNiches, setSavedNiches] = useState<SavedNiche[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [slots, setSlots] = useState<SlotState[]>([
    { keyword: '', selectedNiche: null, data: null, loading: false },
    { keyword: '', selectedNiche: null, data: null, loading: false },
  ]);

  // Fetch saved niches on mount
  useEffect(() => {
    setLoadingSaved(true);
    apiCall('saved_niches', userId)
      .then(res => {
        const niches = Array.isArray(res?.niches) ? res.niches : [];
        setSavedNiches(niches);
      })
      .catch(() => {
        toast.error('Kaydedilmis nisler yuklenemedi');
      })
      .finally(() => setLoadingSaved(false));
  }, [userId]);

  const updateSlot = useCallback((index: number, updates: Partial<SlotState>) => {
    setSlots(prev => prev.map((s, i) => i === index ? { ...s, ...updates } : s));
  }, []);

  const addSlot = useCallback(() => {
    setSlots(prev => {
      if (prev.length >= MAX_SLOTS) return prev;
      return [...prev, { keyword: '', selectedNiche: null, data: null, loading: false }];
    });
  }, []);

  const removeSlot = useCallback((index: number) => {
    setSlots(prev => {
      if (prev.length <= 2) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleSelectNiche = useCallback((index: number, niche: SavedNiche | null) => {
    if (!niche) {
      updateSlot(index, { selectedNiche: null, data: null, keyword: '' });
      return;
    }
    // If saved niche has scores, use them directly
    if (niche.opportunityScore !== undefined && niche.opportunityScore !== null) {
      updateSlot(index, {
        selectedNiche: niche,
        keyword: niche.query,
        data: savedNicheToData(niche),
      });
    } else {
      // Need to analyze
      updateSlot(index, { selectedNiche: niche, keyword: niche.query });
      analyzeNiche(index, niche.query);
    }
  }, []);

  const analyzeNiche = useCallback(async (index: number, keyword?: string) => {
    setSlots(prev => {
      const slot = prev[index];
      const q = (keyword || slot.keyword).trim();
      if (!q) {
        toast.error('Anahtar kelime girin');
        return prev;
      }
      return prev.map((s, i) => i === index ? { ...s, loading: true, keyword: keyword || s.keyword } : s);
    });

    // Read the keyword after state update
    const q = (keyword || slots[index].keyword).trim();
    if (!q) return;

    try {
      const data = await apiCall('niche_analyze', userId, { q });
      updateSlot(index, { data, loading: false });
    } catch (err: any) {
      updateSlot(index, { loading: false });
      toast.error(`Analiz hatasi: ${err.message}`);
    }
  }, [userId, slots, updateSlot]);

  const loadedSlots = useMemo(() =>
    slots.filter(s => s.data !== null),
  [slots]);

  const canCompare = loadedSlots.length >= 2;

  // Find best niche by opportunityScore
  const bestNicheIndex = useMemo(() => {
    if (!canCompare) return -1;
    let bestIdx = -1;
    let bestScore = -1;
    slots.forEach((s, i) => {
      if (s.data && s.data.opportunityScore > bestScore) {
        bestScore = s.data.opportunityScore;
        bestIdx = i;
      }
    });
    return bestIdx;
  }, [slots, canCompare]);

  const bestNiche = bestNicheIndex >= 0 ? slots[bestNicheIndex] : null;

  const anyLoading = slots.some(s => s.loading);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Header */}
      <Paper variant="outlined" sx={{
        p: 2.5,
        background: 'linear-gradient(135deg, #f8faff 0%, #f0edff 100%)',
        border: '1px solid rgba(99,102,241,0.08)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        borderRadius: 3,
      }}>
        <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1, color: '#1e1b4b', fontWeight: 700 }}>
          <BarChart3 size={20} color="#6366f1" /> Nis Karsilastirma
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {slots.map((slot, index) => (
            <Paper
              key={index}
              variant="outlined"
              sx={{
                p: 2,
                bgcolor: slot.data ? '#f8faff' : '#fff',
                border: '1px solid rgba(99,102,241,0.08)',
                boxShadow: '0 2px 16px rgba(0,0,0,0.06)',
                borderRadius: 3,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#1e1b4b' }}>
                  Nis {index + 1}
                </Typography>
                {slot.data && (
                  <ScoreBadge score={slot.data.opportunityScore} label={t('opportunityScore')} />
                )}
                {slots.length > 2 && (
                  <IconButton size="small" onClick={() => removeSlot(index)} sx={{ ml: 'auto' }}>
                    <X size={16} />
                  </IconButton>
                )}
              </Box>

              <Box sx={{
                display: 'flex',
                gap: 1,
                flexDirection: isMobile ? 'column' : 'row',
                alignItems: isMobile ? 'stretch' : 'flex-start',
              }}>
                <Autocomplete
                  size="small"
                  sx={{ flex: 1, minWidth: 200 }}
                  options={savedNiches}
                  getOptionLabel={(opt) => typeof opt === 'string' ? opt : opt.query}
                  loading={loadingSaved}
                  value={slot.selectedNiche}
                  onChange={(_, val) => handleSelectNiche(index, typeof val === 'string' ? null : val)}
                  freeSolo
                  inputValue={slot.keyword}
                  onInputChange={(_, val, reason) => {
                    if (reason !== 'reset') {
                      updateSlot(index, { keyword: val });
                    }
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      placeholder={t('placeholder')}
                      helperText={t('helperText')}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && slot.keyword.trim()) {
                          e.preventDefault();
                          analyzeNiche(index);
                        }
                      }}
                    />
                  )}
                  renderOption={(props, option) => (
                    <li {...props} key={option.id}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                        <Typography variant="body2" sx={{ flex: 1 }}>{option.query}</Typography>
                        {option.opportunityScore !== undefined && (
                          <Chip
                            label={option.opportunityScore}
                            size="small"
                            sx={{
                              fontWeight: 700,
                              color: '#fff',
                              bgcolor: scoreColor(option.opportunityScore),
                              minWidth: 36,
                              height: 22,
                            }}
                          />
                        )}
                      </Box>
                    </li>
                  )}
                />
                <Button
                  variant="contained"
                  size="small"
                  onClick={() => analyzeNiche(index)}
                  disabled={slot.loading || !slot.keyword.trim()}
                  startIcon={slot.loading ? <CircularProgress size={16} color="inherit" /> : <Search size={16} />}
                  sx={{
                    minWidth: 110, whiteSpace: 'nowrap',
                    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                    boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
                    borderRadius: 2, textTransform: 'none', fontWeight: 600,
                    '&:hover': { background: 'linear-gradient(135deg, #5558e6 0%, #7c4feb 100%)' },
                  }}
                >
                  {slot.loading ? 'Analiz...' : 'Analiz Et'}
                </Button>
              </Box>
            </Paper>
          ))}
        </Box>

        {slots.length < MAX_SLOTS && (
          <Button
            size="small"
            startIcon={<Plus size={16} />}
            onClick={addSlot}
            sx={{ mt: 1.5, color: '#6366f1', textTransform: 'none', fontWeight: 600, '&:hover': { bgcolor: 'rgba(99,102,241,0.08)' } }}
          >
            Nis Ekle
          </Button>
        )}
      </Paper>

      {/* Comparison Table */}
      {canCompare && !anyLoading && (
        <>
          {/* Desktop Table */}
          {!isMobile && (
            <Paper variant="outlined" sx={{
              boxShadow: '0 2px 16px rgba(0,0,0,0.06)',
              borderRadius: 3,
              border: '1px solid rgba(99,102,241,0.08)',
              overflow: 'hidden',
            }}>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)' }}>
                      <TableCell sx={{ fontWeight: 700, minWidth: 150, color: '#1e1b4b' }}>Metrik</TableCell>
                      {slots.map((slot, i) => slot.data && (
                        <TableCell key={i} sx={{ fontWeight: 700, textAlign: 'center', color: '#1e1b4b' }}>
                          {slot.data.query}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {METRICS.map(metric => {
                      const values = slots.map(s => s.data ? (s.data as any)[metric.key] as number : undefined);
                      const winnerIdx = getWinnerIndex(values, metric.higherIsBetter);

                      const metricIdx = METRICS.indexOf(metric);
                      return (
                        <TableRow key={metric.key} sx={{ bgcolor: metricIdx % 2 === 0 ? '#f8faff' : '#fff' }}>
                          <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap', color: '#1e1b4b' }}>
                            {metric.label}
                          </TableCell>
                          {slots.map((slot, i) => {
                            if (!slot.data) return null;
                            const val = (slot.data as any)[metric.key] as number;
                            const isWinner = i === winnerIdx;
                            const labelKey = metric.key.replace('Score', 'Label');
                            const tooltipLabel = (slot.data as any)[labelKey] as string | undefined;

                            return (
                              <TableCell
                                key={i}
                                sx={{
                                  textAlign: 'center',
                                  bgcolor: isWinner ? 'rgba(16,185,129,0.08)' : undefined,
                                  fontWeight: isWinner ? 700 : 400,
                                  boxShadow: isWinner ? 'inset 0 0 0 1px rgba(16,185,129,0.2)' : undefined,
                                }}
                              >
                                {metric.isScore ? (
                                  <ScoreBadge score={val} label={tooltipLabel} />
                                ) : (
                                  metric.format(val ?? 0)
                                )}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}

          {/* Mobile Cards */}
          {isMobile && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {METRICS.map(metric => {
                const values = slots.map(s => s.data ? (s.data as any)[metric.key] as number : undefined);
                const winnerIdx = getWinnerIndex(values, metric.higherIsBetter);

                return (
                  <Paper key={metric.key} variant="outlined" sx={{
                    p: 1.5,
                    bgcolor: '#fff',
                    border: '1px solid rgba(99,102,241,0.08)',
                    boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
                    borderRadius: 2.5,
                  }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#1e1b4b', mb: 0.5, display: 'block' }}>
                      {metric.label}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      {slots.map((slot, i) => {
                        if (!slot.data) return null;
                        const val = (slot.data as any)[metric.key] as number;
                        const isWinner = i === winnerIdx;
                        const labelKey = metric.key.replace('Score', 'Label');
                        const tooltipLabel = (slot.data as any)[labelKey] as string | undefined;

                        return (
                          <Box
                            key={i}
                            sx={{
                              flex: 1,
                              textAlign: 'center',
                              p: 1,
                              borderRadius: 2,
                              bgcolor: isWinner ? 'rgba(16,185,129,0.08)' : '#f8faff',
                              boxShadow: isWinner ? '0 0 0 2px rgba(16,185,129,0.3)' : 'none',
                            }}
                          >
                            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mb: 0.5 }}>
                              {slot.data.query}
                            </Typography>
                            {metric.isScore ? (
                              <ScoreBadge score={val} label={tooltipLabel} />
                            ) : (
                              <Typography variant="body2" sx={{ fontWeight: isWinner ? 700 : 400 }}>
                                {metric.format(val ?? 0)}
                              </Typography>
                            )}
                          </Box>
                        );
                      })}
                    </Box>
                  </Paper>
                );
              })}
            </Box>
          )}

          {/* Verdict */}
          {bestNiche?.data && (
            <Paper variant="outlined" sx={{
              p: 2.5,
              background: 'linear-gradient(135deg, #f0fdf4 0%, #f8faff 100%)',
              border: '1px solid rgba(16,185,129,0.15)',
              boxShadow: '0 2px 16px rgba(16,185,129,0.1)',
              borderRadius: 3,
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                <Crown size={22} color="#f59e0b" />
                <Typography variant="h6" sx={{ fontWeight: 700, color: '#1e1b4b' }}>
                  En Iyi Nis: {bestNiche.data.query}
                </Typography>
                <ScoreBadge score={bestNiche.data.opportunityScore} label={t('opportunityScore')} />
              </Box>
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
                {bestNiche.data.opportunityLabel || t('verdictFallback', {
                  query: bestNiche.data.query,
                  demandLevel: bestNiche.data.demandScore >= 50 ? t('highDemand') : t('medDemand'),
                  demandScore: bestNiche.data.demandScore,
                  competitionLevel: bestNiche.data.competitionScore < 50 ? t('lowCompetition') : t('medCompetition'),
                  competitionScore: bestNiche.data.competitionScore,
                  avgPrice: bestNiche.data.avgPrice.toFixed(2),
                })}
              </Typography>

              {/* Cross-tool buttons for each niche */}
              {onNavigate && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {slots.filter(s => s.data).map((slot, i) => (
                    <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 100 }}>
                        {slot.data!.query}:
                      </Typography>
                      <Button
                        size="small"
                        variant="outlined"
                        endIcon={<ArrowRight size={14} />}
                        onClick={() => onNavigate('product_database', { keyword: slot.data!.query })}
                        sx={{ color: '#6366f1', borderColor: 'rgba(99,102,241,0.3)', textTransform: 'none', fontWeight: 600, '&:hover': { bgcolor: '#6366f1', color: '#fff', borderColor: '#6366f1' } }}
                      >
                        Urunleri Gor
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        endIcon={<ShieldCheck size={14} />}
                        onClick={() => onNavigate('seo_analyzer', { keyword: slot.data!.query })}
                        sx={{ color: '#8b5cf6', borderColor: 'rgba(139,92,246,0.3)', textTransform: 'none', fontWeight: 600, '&:hover': { bgcolor: '#8b5cf6', color: '#fff', borderColor: '#8b5cf6' } }}
                      >
                        SEO Kontrol
                      </Button>
                    </Box>
                  ))}
                </Box>
              )}
            </Paper>
          )}
        </>
      )}

      {/* Tips — show when less than 2 niches have data */}
      {!canCompare && !anyLoading && (
        <Paper sx={{ p: 2, bgcolor: '#f8faff', borderRadius: 3, border: '1px solid rgba(99,102,241,0.08)' }}>
          <Typography variant="subtitle2" fontWeight={700} gutterBottom>{t('howToUseTitle')}</Typography>
          <Typography variant="body2" color="text.secondary" component="div">
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              <li>{t('tip1')}</li>
              <li>{t('tip2')}</li>
              <li>{t('tip3')}</li>
              <li>{t('tip4')}</li>
            </ul>
          </Typography>
        </Paper>
      )}
    </Box>
  );
}
