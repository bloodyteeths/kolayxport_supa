import React, { useState, useMemo, useCallback } from 'react';
import { Box, Typography, Paper } from '@mui/material';
import type { SortDir } from './types';

export const GRADIENTS = {
  primary: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  success: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
  warning: 'linear-gradient(135deg, #F2994A 0%, #F2C94C 100%)',
  danger: 'linear-gradient(135deg, #eb3349 0%, #f45c43 100%)',
  info: 'linear-gradient(135deg, #2196F3 0%, #21CBF3 100%)',
  purple: 'linear-gradient(135deg, #7B1FA2 0%, #E040FB 100%)',
  dark: 'linear-gradient(135deg, #434343 0%, #000000 100%)',
};

export const glassCard = {
  background: 'rgba(255,255,255,0.85)',
  backdropFilter: 'blur(20px)',
  border: '1px solid rgba(255,255,255,0.3)',
  borderRadius: '16px',
  boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
  transition: 'transform 0.2s, box-shadow 0.2s',
  '&:hover': {
    transform: 'translateY(-2px)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
  },
};

export const pillTabsSx = {
  mb: 2,
  '& .MuiTabs-indicator': { display: 'none' },
  '& .MuiTabs-flexContainer': { gap: '6px' },
  '& .MuiTab-root': {
    minHeight: 36, borderRadius: '20px', textTransform: 'none',
    fontSize: '0.875rem', fontWeight: 500, px: 1.5, py: 0.5,
    border: '1px solid #e0e0e0', color: '#666',
    transition: 'all 0.2s',
    '&.Mui-selected': {
      background: GRADIENTS.primary, color: '#fff',
      border: '1px solid transparent', fontWeight: 600,
      boxShadow: '0 2px 8px rgba(102,126,234,0.3)',
    },
  },
};

export function useTableSort<T>(items: T[], defaultKey: string = '', defaultDir: SortDir = 'desc') {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const handleSort = useCallback((key: string) => {
    if (sortKey === key) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }, [sortKey]);

  const sorted = useMemo(() => {
    if (!sortKey) return items;
    return [...items].sort((a: any, b: any) => {
      let va = a[sortKey] ?? 0;
      let vb = b[sortKey] ?? 0;
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [items, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, handleSort };
}

export function ScoreRing({ score, size = 120, label, color }: { score: number; size?: number; label: string; color?: string }) {
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const ringColor = color || (score >= 70 ? '#11998e' : score >= 40 ? '#F2994A' : '#eb3349');

  return (
    <Box sx={{ position: 'relative', width: size, height: size, mx: 'auto' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f0f0f0" strokeWidth="8" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ringColor}
          strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s ease-out' }}
        />
      </svg>
      <Box sx={{
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        textAlign: 'center',
      }}>
        <Typography sx={{ fontSize: size * 0.25, fontWeight: 800, color: ringColor, lineHeight: 1 }}>
          {score}
        </Typography>
        <Typography sx={{ fontSize: size * 0.1, color: 'text.secondary', mt: 0.3 }}>
          {label}
        </Typography>
      </Box>
    </Box>
  );
}

export function StatCard({ label, value, color, icon, gradient }: {
  label: string; value: string; color: string; icon?: React.ReactNode; gradient?: string;
}) {
  return (
    <Paper sx={{
      ...glassCard, p: 2, flex: 1, minWidth: 110, textAlign: 'center',
      ...(gradient ? { background: gradient, color: '#fff', border: 'none',
        '& .MuiTypography-root': { color: '#fff' },
      } : {}),
    }}>
      {icon && <Box sx={{ mb: 0.5, opacity: 0.8 }}>{icon}</Box>}
      <Typography variant="caption" sx={{ opacity: 0.7, fontWeight: 500 }}>{label}</Typography>
      <Typography variant="h5" sx={{ color: gradient ? '#fff' : color, fontWeight: 800 }}>{value}</Typography>
    </Paper>
  );
}

export function GradientBar({ value, max, height = 10 }: { value: number; max: number; height?: number }) {
  const pctVal = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <Box sx={{ width: '100%', bgcolor: '#f0f0f0', borderRadius: height / 2, height, overflow: 'hidden' }}>
      <Box sx={{
        width: `${pctVal}%`, height, borderRadius: height / 2,
        background: GRADIENTS.primary,
        transition: 'width 0.5s ease-out',
      }} />
    </Box>
  );
}

export function SourceBadge({ source }: { source: string }) {
  const colors: Record<string, string> = {
    google: '#4285F4', amazon: '#FF9900', etsy: '#F1641E',
  };
  return (
    <Box component="span" sx={{
      display: 'inline-block', px: 0.8, py: 0.1, borderRadius: 1,
      fontSize: '0.82rem', fontWeight: 600, color: '#fff', mr: 0.3,
      bgcolor: colors[source] || '#999',
    }}>
      {source === 'google' ? 'G' : source === 'amazon' ? 'A' : 'E'}
    </Box>
  );
}

export function Sparkline({ data, width = 80, height = 24, color = '#667eea' }: {
  data: number[]; width?: number; height?: number; color?: string;
}) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TrendChart({ data, height = 200, color = '#667eea' }: {
  data: { date: string; value: number }[]; height?: number; color?: string;
}) {
  if (data.length < 2) return null;
  const max = Math.max(...data.map(d => d.value), 1);
  const width = '100%';
  const svgW = 600;
  const padding = { top: 10, right: 10, bottom: 30, left: 40 };
  const chartW = svgW - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const points = data.map((d, i) => ({
    x: padding.left + (i / (data.length - 1)) * chartW,
    y: padding.top + chartH - (d.value / max) * chartH,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x},${padding.top + chartH} L${points[0].x},${padding.top + chartH} Z`;

  return (
    <svg viewBox={`0 0 ${svgW} ${height}`} style={{ width, height: 'auto' }} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0, 25, 50, 75, 100].map(pv => {
        const y = padding.top + chartH - (pv / 100) * chartH;
        return (
          <g key={pv}>
            <line x1={padding.left} y1={y} x2={svgW - padding.right} y2={y} stroke="#f0f0f0" strokeWidth="1" />
            <text x={padding.left - 5} y={y + 4} textAnchor="end" fill="#999" fontSize="10">{Math.round(pv / 100 * max)}</text>
          </g>
        );
      })}
      <path d={areaPath} fill="url(#areaGrad)" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => {
        const isPeak = data[i].value === max;
        return isPeak ? (
          <circle key={i} cx={p.x} cy={p.y} r="4" fill={color} stroke="#fff" strokeWidth="2" />
        ) : null;
      })}
      {data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 6)) === 0).map((d, i) => {
        const idx = data.indexOf(d);
        return (
          <text key={i} x={points[idx].x} y={height - 5} textAnchor="middle" fill="#999" fontSize="9">
            {d.date}
          </text>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Keyword Card — compact card for keyword scorecard grid
// ---------------------------------------------------------------------------
export function KeywordCard({ keyword, score, frequency, maxFreq, trendData, inMyTags, onClick }: {
  keyword: string; score: number; frequency: number; maxFreq: number;
  trendData?: number[]; inMyTags?: boolean; onClick?: () => void;
}) {
  const scoreColor = score >= 70 ? '#11998e' : score >= 40 ? '#F2994A' : '#eb3349';
  return (
    <Paper
      onClick={onClick}
      sx={{
        p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5,
        borderRadius: '12px', cursor: onClick ? 'pointer' : 'default',
        border: inMyTags ? '2px solid #11998e' : '1px solid #f0f0f0',
        bgcolor: inMyTags ? 'rgba(17,153,142,0.04)' : '#fff',
        transition: 'all 0.15s',
        '&:hover': onClick ? { boxShadow: '0 4px 16px rgba(0,0,0,0.08)', transform: 'translateY(-1px)' } : {},
      }}
    >
      <ScoreRing score={score} size={40} label="" color={scoreColor} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {keyword}
          {inMyTags && <Box component="span" sx={{ ml: 0.5, fontSize: '0.7rem', color: '#11998e' }}>✓</Box>}
        </Typography>
        <GradientBar value={frequency} max={maxFreq} height={6} />
      </Box>
      {trendData && trendData.length > 1 && (
        <Sparkline data={trendData} width={50} height={20} />
      )}
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Demand vs Competition dual gauge
// ---------------------------------------------------------------------------
export function DemandCompetitionGauge({ demand, competition, size = 80 }: {
  demand: number; competition: number; size?: number;
}) {
  const demandColor = demand >= 70 ? '#11998e' : demand >= 40 ? '#F2994A' : '#eb3349';
  const compColor = competition >= 70 ? '#eb3349' : competition >= 40 ? '#F2994A' : '#11998e';
  const r = (size - 8) / 2;
  const c = Math.PI * r; // half circle

  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
      {/* Demand */}
      <Box sx={{ textAlign: 'center' }}>
        <Box sx={{ position: 'relative', width: size, height: size / 2 + 10 }}>
          <svg width={size} height={size / 2 + 10}>
            <path d={`M 4 ${size / 2 + 4} A ${r} ${r} 0 0 1 ${size - 4} ${size / 2 + 4}`}
              fill="none" stroke="#f0f0f0" strokeWidth="6" strokeLinecap="round" />
            <path d={`M 4 ${size / 2 + 4} A ${r} ${r} 0 0 1 ${size - 4} ${size / 2 + 4}`}
              fill="none" stroke={demandColor} strokeWidth="6" strokeLinecap="round"
              strokeDasharray={c} strokeDashoffset={c - (demand / 100) * c}
              style={{ transition: 'stroke-dashoffset 0.8s ease-out' }} />
          </svg>
          <Typography sx={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', fontSize: size * 0.22, fontWeight: 800, color: demandColor }}>
            {demand}
          </Typography>
        </Box>
        <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: '0.7rem' }}>Demand</Typography>
      </Box>
      {/* Competition */}
      <Box sx={{ textAlign: 'center' }}>
        <Box sx={{ position: 'relative', width: size, height: size / 2 + 10 }}>
          <svg width={size} height={size / 2 + 10}>
            <path d={`M 4 ${size / 2 + 4} A ${r} ${r} 0 0 1 ${size - 4} ${size / 2 + 4}`}
              fill="none" stroke="#f0f0f0" strokeWidth="6" strokeLinecap="round" />
            <path d={`M 4 ${size / 2 + 4} A ${r} ${r} 0 0 1 ${size - 4} ${size / 2 + 4}`}
              fill="none" stroke={compColor} strokeWidth="6" strokeLinecap="round"
              strokeDasharray={c} strokeDashoffset={c - (competition / 100) * c}
              style={{ transition: 'stroke-dashoffset 0.8s ease-out' }} />
          </svg>
          <Typography sx={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', fontSize: size * 0.22, fontWeight: 800, color: compColor }}>
            {competition}
          </Typography>
        </Box>
        <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: '0.7rem' }}>Competition</Typography>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Sticky score bar — compact horizontal bar with key metrics
// ---------------------------------------------------------------------------
export function StickyScoreBar({ metrics }: {
  metrics: { label: string; value: string; color: string }[];
}) {
  return (
    <Paper sx={{
      position: 'sticky', top: 0, zIndex: 10,
      display: 'flex', alignItems: 'center', gap: { xs: 1.5, sm: 2.5 }, flexWrap: 'wrap',
      px: 2, py: 1, borderRadius: '12px',
      background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(10px)',
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.06)',
    }}>
      {metrics.map((m) => (
        <Box key={m.label} sx={{ textAlign: 'center', minWidth: 60 }}>
          <Typography sx={{ fontSize: '0.65rem', color: 'text.secondary', fontWeight: 500, lineHeight: 1 }}>{m.label}</Typography>
          <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: m.color, lineHeight: 1.3 }}>{m.value}</Typography>
        </Box>
      ))}
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Before/After diff view for AI optimization
// ---------------------------------------------------------------------------
export function BeforeAfter({ before, after, label }: {
  before: string; after: string; label: string;
}) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="caption" sx={{ fontWeight: 700, mb: 0.5, display: 'block', color: 'text.secondary' }}>{label}</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
        <Paper sx={{ p: 1.5, borderRadius: '10px', bgcolor: '#fef2f2', border: '1px solid #fecaca' }}>
          <Typography variant="caption" sx={{ fontWeight: 600, color: '#b91c1c', display: 'block', mb: 0.5 }}>Before</Typography>
          <Typography sx={{ fontSize: '0.82rem', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{before}</Typography>
        </Paper>
        <Paper sx={{ p: 1.5, borderRadius: '10px', bgcolor: '#f0fdf4', border: '1px solid #bbf7d0' }}>
          <Typography variant="caption" sx={{ fontWeight: 600, color: '#15803d', display: 'block', mb: 0.5 }}>After</Typography>
          <Typography sx={{ fontSize: '0.82rem', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{after}</Typography>
        </Paper>
      </Box>
    </Box>
  );
}

export function PremiumEmptyState({ icon, title, desc, steps }: {
  icon: React.ReactNode; title: string; desc: string; steps?: string[];
}) {
  return (
    <Paper sx={{
      ...glassCard, p: 4, textAlign: 'center', my: 2,
      background: 'linear-gradient(135deg, rgba(102,126,234,0.03) 0%, rgba(118,75,162,0.03) 100%)',
    }}>
      <Box sx={{ mb: 2, opacity: 0.6 }}>{icon}</Box>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>{title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: steps ? 2 : 0 }}>
        {desc}
      </Typography>
      {steps && steps.length > 0 && (
        <Box sx={{ display: 'inline-flex', flexDirection: 'column', gap: 1, textAlign: 'left', mt: 1 }}>
          {steps.map((step, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{
                width: 24, height: 24, borderRadius: '50%', display: 'flex',
                alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                background: GRADIENTS.primary, color: '#fff', fontSize: '0.85rem', fontWeight: 700,
              }}>
                {i + 1}
              </Box>
              <Typography variant="body2" color="text.secondary">{step}</Typography>
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  );
}
