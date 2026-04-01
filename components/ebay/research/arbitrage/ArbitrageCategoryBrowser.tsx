import React, { useState, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  InputAdornment, Box, Typography, Checkbox, Chip, Accordion, AccordionSummary,
  AccordionDetails, Badge, useMediaQuery, useTheme,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useTranslations } from 'next-intl';
import { TRENDYOL_CATEGORIES } from '../../../../lib/integrations/trendyolSearch';
import { CATEGORY_GROUPS } from './arbitrageConstants';
import { useArbitrageStore } from './useArbitrageStore';

interface Props {
  open: boolean;
  onClose: () => void;
  onScan: (categories: string[]) => void;
}

export default function ArbitrageCategoryBrowser({ open, onClose, onScan }: Props) {
  const ta = useTranslations('ebay.research.arbitrage');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { selectedCategories, setSelectedCategories, toggleCategory } = useArbitrageStore();
  const [search, setSearch] = useState('');

  const categoriesByGroup = useMemo(() => {
    const groups = new Map<string, typeof TRENDYOL_CATEGORIES>();
    for (const cat of TRENDYOL_CATEGORIES) {
      const group = (cat as any).group || 'Other';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(cat);
    }
    return groups;
  }, []);

  const filteredGroups = useMemo(() => {
    if (!search) return categoriesByGroup;
    const q = search.toLowerCase();
    const filtered = new Map<string, typeof TRENDYOL_CATEGORIES>();
    for (const [group, cats] of categoriesByGroup) {
      const matching = cats.filter(c =>
        c.label.toLowerCase().includes(q) ||
        c.labelTr.toLowerCase().includes(q) ||
        c.ebaySearch.toLowerCase().includes(q) ||
        group.toLowerCase().includes(q)
      );
      if (matching.length > 0) filtered.set(group, matching);
    }
    return filtered;
  }, [search, categoriesByGroup]);

  const selectGroup = (group: string) => {
    const groupCats = categoriesByGroup.get(group) || [];
    const groupSlugs = groupCats.map(c => c.slug);
    const allSelected = groupSlugs.every(s => selectedCategories.includes(s));

    if (allSelected) {
      setSelectedCategories(selectedCategories.filter(s => !groupSlugs.includes(s)));
    } else {
      const newSelected = [...new Set([...selectedCategories, ...groupSlugs])];
      setSelectedCategories(newSelected);
    }
  };

  const selectAll = () => {
    setSelectedCategories(TRENDYOL_CATEGORIES.map(c => c.slug));
  };

  const clearAll = () => {
    setSelectedCategories([]);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={isMobile}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { maxHeight: isMobile ? '100%' : '80vh' } }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6" sx={{ fontSize: '1rem' }}>
            {ta('selectCategory')}
          </Typography>
          <Badge badgeContent={selectedCategories.length} color="primary">
            <Chip label={ta('selected')} size="small" variant="outlined" />
          </Badge>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ pt: 1 }}>
        {/* Search */}
        <TextField
          size="small"
          fullWidth
          placeholder={ta('searchCategories')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ mb: 1.5 }}
          InputProps={{
            startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
          }}
        />

        {/* Quick actions */}
        <Box sx={{ display: 'flex', gap: 0.75, mb: 1.5, flexWrap: 'wrap' }}>
          <Chip label={ta('selectAll')} size="small" variant="outlined" onClick={selectAll} />
          <Chip label={ta('clear')} size="small" variant="outlined" onClick={clearAll} />
          {CATEGORY_GROUPS.map(g => {
            const groupCats = categoriesByGroup.get(g.key) || [];
            const groupCount = groupCats.filter(c => selectedCategories.includes(c.slug)).length;
            return (
              <Chip
                key={g.key}
                label={`${g.icon} ${ta(g.label)} (${groupCount}/${groupCats.length})`}
                size="small"
                variant={groupCount === groupCats.length ? 'filled' : 'outlined'}
                onClick={() => selectGroup(g.key)}
                color={groupCount > 0 ? 'primary' : 'default'}
                sx={{ fontSize: '0.7rem' }}
              />
            );
          })}
        </Box>

        {/* Category list by group */}
        {Array.from(filteredGroups.entries()).map(([group, cats]) => {
          const groupInfo = CATEGORY_GROUPS.find(g => g.key === group);
          const selectedInGroup = cats.filter(c => selectedCategories.includes(c.slug)).length;

          return (
            <Accordion key={group} defaultExpanded={selectedInGroup > 0} disableGutters variant="outlined" sx={{ mb: 0.5, '&:before': { display: 'none' } }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 0.5 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {groupInfo?.icon} {group}
                  </Typography>
                  <Chip label={`${selectedInGroup}/${cats.length}`} size="small" sx={{ height: 20, fontSize: '0.65rem' }} />
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ pt: 0, pb: 1 }}>
                {cats.map(cat => (
                  <Box
                    key={cat.slug}
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.25, cursor: 'pointer', '&:hover': { bgcolor: '#f5f5f5' }, borderRadius: 1 }}
                    onClick={() => toggleCategory(cat.slug)}
                  >
                    <Checkbox
                      size="small"
                      checked={selectedCategories.includes(cat.slug)}
                      sx={{ p: 0.25 }}
                    />
                    <Typography variant="body2" sx={{ flex: 1, fontSize: '0.8rem' }}>
                      {cat.labelTr}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                      {cat.label}
                    </Typography>
                  </Box>
                ))}
              </AccordionDetails>
            </Accordion>
          );
        })}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button variant="text" onClick={onClose}>{ta('cancel')}</Button>
        <Button
          variant="contained"
          disabled={selectedCategories.length === 0}
          onClick={() => { onScan(selectedCategories); onClose(); }}
          sx={{ fontWeight: 700 }}
        >
          {ta('scanCategories', { count: selectedCategories.length })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
