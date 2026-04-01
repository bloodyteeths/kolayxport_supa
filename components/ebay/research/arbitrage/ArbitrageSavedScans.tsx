import React from 'react';
import { Box, Paper, Typography, IconButton, Chip, Tooltip } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useArbitrageStore } from './useArbitrageStore';
import { formatCurrency, formatPercent } from './arbitrageConstants';

export default function ArbitrageSavedScans() {
  const { savedScans, deleteScan } = useArbitrageStore();

  if (savedScans.length === 0) {
    return (
      <Paper sx={{ p: 3, textAlign: 'center' }} variant="outlined">
        <Typography color="text.secondary" variant="body2">
          Henüz kaydedilmiş tarama yok.
        </Typography>
        <Typography color="text.secondary" variant="caption">
          Tarama sonuçlarını kaydederek geçmişinizi takip edebilirsiniz.
        </Typography>
      </Paper>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
        Tarama Geçmişi ({savedScans.length})
      </Typography>
      {savedScans.map(scan => (
        <Paper key={scan.id} variant="outlined" sx={{ p: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {scan.label}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {new Date(scan.date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                {' | '}{scan.categories.length} kategori
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ textAlign: 'right' }}>
                <Chip
                  label={`${scan.profitableCount} kârlı`}
                  size="small"
                  color="success"
                  variant="outlined"
                  sx={{ fontSize: '0.65rem', height: 20 }}
                />
                <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.25 }}>
                  En iyi: {formatCurrency(scan.bestProfit)} | {formatPercent(scan.bestRoi)}
                </Typography>
              </Box>
              <Tooltip title="Sil">
                <IconButton size="small" onClick={() => deleteScan(scan.id)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>
        </Paper>
      ))}
    </Box>
  );
}
