import React from 'react';
import { Tooltip, Box, Typography, LinearProgress } from '@mui/material';

interface SEOIndicatorProps {
  title: string;
  description: string;
  aspects: Record<string, string[]>;
  imageCount: number;
  compact?: boolean;
}

export default function SEOIndicator({ title, description, aspects, imageCount, compact = false }: SEOIndicatorProps) {
  const titleLength = title?.length || 0;
  const descLength = description?.length || 0;
  const aspectCount = Object.keys(aspects || {}).length;

  // Score calculation (100 points total)
  const titleScore = titleLength >= 80 ? 30 : titleLength >= 40 ? 20 : titleLength > 0 ? 10 : 0;
  const descScore = descLength >= 500 ? 25 : descLength >= 200 ? 15 : descLength > 0 ? 5 : 0;
  const aspectScore = aspectCount >= 10 ? 25 : aspectCount >= 5 ? 15 : aspectCount > 0 ? 5 : 0;
  const imageScore = imageCount >= 5 ? 20 : imageCount >= 3 ? 12 : imageCount >= 1 ? 5 : 0;
  const totalScore = titleScore + descScore + aspectScore + imageScore;

  const color = totalScore >= 80 ? '#22c55e' : totalScore >= 50 ? '#eab308' : '#ef4444';
  const label = totalScore >= 80 ? 'İyi' : totalScore >= 50 ? 'Orta' : 'Zayıf';

  if (compact) {
    return (
      <Tooltip title={`SEO Skoru: ${totalScore}/100 — Başlık: ${titleLength} kar., Açıklama: ${descLength} kar., Özellik: ${aspectCount}, Görsel: ${imageCount}`}>
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
          <Typography variant="caption" color="text.secondary">Başlık uzunluğu</Typography>
          <Typography variant="caption" sx={{ color: titleLength >= 80 ? '#22c55e' : titleLength >= 40 ? '#eab308' : '#ef4444', fontWeight: 600 }}>
            {titleLength}/80
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">Açıklama uzunluğu</Typography>
          <Typography variant="caption" sx={{ color: descLength >= 500 ? '#22c55e' : descLength >= 200 ? '#eab308' : '#ef4444', fontWeight: 600 }}>
            {descLength} karakter
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">Ürün özellikleri</Typography>
          <Typography variant="caption" sx={{ color: aspectCount >= 10 ? '#22c55e' : aspectCount >= 5 ? '#eab308' : '#ef4444', fontWeight: 600 }}>
            {aspectCount} özellik
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">Görsel sayısı</Typography>
          <Typography variant="caption" sx={{ color: imageCount >= 5 ? '#22c55e' : imageCount >= 3 ? '#eab308' : '#ef4444', fontWeight: 600 }}>
            {imageCount}/24
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
