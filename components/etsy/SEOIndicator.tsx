import React from 'react';
import { Tooltip, Box, Typography, LinearProgress } from '@mui/material';

interface SEOIndicatorProps {
  tags: string[];
  title: string;
  description: string;
  compact?: boolean; // true = just colored dot, false = full breakdown
}

export default function SEOIndicator({ tags, title, description, compact = false }: SEOIndicatorProps) {
  const tagCount = tags?.length || 0;
  const titleLength = title?.length || 0;
  const descLength = description?.length || 0;

  // Score calculation
  const tagScore = Math.min(tagCount / 13, 1) * 40; // 40 points max
  const titleScore = titleLength >= 100 && titleLength <= 140 ? 30 : titleLength >= 80 ? 20 : titleLength >= 40 ? 15 : titleLength > 0 ? 5 : 0; // 30 points max
  const descScore = descLength >= 300 ? 30 : descLength >= 100 ? 20 : descLength > 0 ? 10 : 0; // 30 points max
  const totalScore = Math.round(tagScore + titleScore + descScore);

  const color = totalScore >= 80 ? '#22c55e' : totalScore >= 50 ? '#eab308' : '#ef4444';
  const label = totalScore >= 80 ? 'İyi' : totalScore >= 50 ? 'Orta' : 'Zayıf';

  if (compact) {
    return (
      <Tooltip title={`SEO Skoru: ${totalScore}/100 — Etiket: ${tagCount}/13, Başlık: ${titleLength} kar., Açıklama: ${descLength} kar.`}>
        <Box
          sx={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            backgroundColor: color,
            display: 'inline-block',
            cursor: 'pointer',
          }}
        />
      </Tooltip>
    );
  }

  return (
    <Box sx={{ p: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="body2" fontWeight={600}>SEO Skoru</Typography>
        <Typography variant="body2" sx={{ color, fontWeight: 700 }}>{totalScore}/100 — {label}</Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={totalScore}
        sx={{
          mb: 2,
          height: 6,
          borderRadius: 3,
          backgroundColor: '#e5e7eb',
          '& .MuiLinearProgress-bar': { backgroundColor: color, borderRadius: 3 },
        }}
      />

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">Etiketler</Typography>
          <Typography variant="caption" sx={{ color: tagCount >= 10 ? '#22c55e' : tagCount >= 5 ? '#eab308' : '#ef4444', fontWeight: 600 }}>
            {tagCount}/13
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">Başlık uzunluğu</Typography>
          <Typography variant="caption" sx={{ color: titleLength >= 100 && titleLength <= 140 ? '#22c55e' : titleLength >= 80 ? '#eab308' : '#ef4444', fontWeight: 600 }}>
            {titleLength}/140
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">Açıklama uzunluğu</Typography>
          <Typography variant="caption" sx={{ color: descLength >= 300 ? '#22c55e' : descLength >= 100 ? '#eab308' : '#ef4444', fontWeight: 600 }}>
            {descLength} karakter
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
