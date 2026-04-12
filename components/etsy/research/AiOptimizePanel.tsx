import React, { useState } from 'react';
import {
  Box, Typography, Fab, SwipeableDrawer, Tabs, Tab, TextField,
  Button, CircularProgress, Chip, useMediaQuery, IconButton,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Sparkles, X, Copy, Wand2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

import { useEtsyResearchStore } from '@/lib/stores/useEtsyResearchStore';
import { GRADIENTS, glassCard, BeforeAfter, pillTabsSx } from './shared/ui';

export default function AiOptimizePanel() {
  const t = useTranslations('etsyResearch');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const aiOptimizeOpen = useEtsyResearchStore(s => s.aiOptimizeOpen);
  const aiOptimizeTab = useEtsyResearchStore(s => s.aiOptimizeTab);
  const optimizedTitle = useEtsyResearchStore(s => s.optimizedTitle);
  const optimizedTags = useEtsyResearchStore(s => s.optimizedTags);
  const optimizedDescription = useEtsyResearchStore(s => s.optimizedDescription);
  const optimizeLoading = useEtsyResearchStore(s => s.optimizeLoading);
  const setAiOptimizeOpen = useEtsyResearchStore(s => s.setAiOptimizeOpen);
  const setAiOptimizeTab = useEtsyResearchStore(s => s.setAiOptimizeTab);
  const optimizeField = useEtsyResearchStore(s => s.optimizeField);
  const clearOptimized = useEtsyResearchStore(s => s.clearOptimized);

  // Local input state
  const [titleInput, setTitleInput] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [descTitleInput, setDescTitleInput] = useState('');
  const [descTagsInput, setDescTagsInput] = useState('');
  const [materialsInput, setMaterialsInput] = useState('');

  const handleOptimizeTitle = () => {
    if (!titleInput.trim()) return;
    const tags = tagsInput.split(',').map(s => s.trim()).filter(Boolean);
    optimizeField('title', { title: titleInput, tags: tags.length > 0 ? tags : undefined });
  };

  const handleOptimizeTags = () => {
    if (!titleInput.trim()) return;
    const tags = tagsInput.split(',').map(s => s.trim()).filter(Boolean);
    optimizeField('tags', { title: titleInput, tags: tags.length > 0 ? tags : undefined });
  };

  const handleOptimizeDescription = () => {
    if (!descTitleInput.trim()) return;
    const tags = descTagsInput.split(',').map(s => s.trim()).filter(Boolean);
    const materials = materialsInput.split(',').map(s => s.trim()).filter(Boolean);
    optimizeField('description', {
      title: descTitleInput,
      tags: tags.length > 0 ? tags : undefined,
      materials: materials.length > 0 ? materials : undefined,
    });
  };

  return (
    <>
      {/* FAB */}
      <Fab
        onClick={() => setAiOptimizeOpen(true)}
        sx={{
          position: 'fixed',
          bottom: isMobile ? 16 : 24,
          right: isMobile ? 16 : 24,
          background: GRADIENTS.purple,
          color: '#fff',
          zIndex: 1200,
          width: isMobile ? 52 : 56,
          height: isMobile ? 52 : 56,
          boxShadow: '0 4px 20px rgba(123,31,162,0.4)',
          '&:hover': { boxShadow: '0 6px 28px rgba(123,31,162,0.5)' },
        }}
      >
        <Sparkles size={24} />
      </Fab>

      {/* Drawer */}
      <SwipeableDrawer
        anchor="right"
        open={aiOptimizeOpen}
        onClose={() => setAiOptimizeOpen(false)}
        onOpen={() => setAiOptimizeOpen(true)}
        PaperProps={{
          sx: {
            width: isMobile ? '100%' : 420,
            maxWidth: '100vw',
            p: 2.5,
          },
        }}
      >
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 36, height: 36, borderRadius: '10px', background: GRADIENTS.purple, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Sparkles size={18} color="#fff" />
            </Box>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{t('ai_panelTitle')}</Typography>
              <Typography variant="caption" color="text.secondary">{t('ai_panelSubtitle')}</Typography>
            </Box>
          </Box>
          <IconButton onClick={() => setAiOptimizeOpen(false)} size="small">
            <X size={20} />
          </IconButton>
        </Box>

        {/* Tabs */}
        <Tabs value={aiOptimizeTab} onChange={(_, v) => setAiOptimizeTab(v)} sx={pillTabsSx}>
          <Tab label={t('ai_titleTab')} />
          <Tab label={t('ai_tagsTab')} />
          <Tab label={t('ai_descTab')} />
        </Tabs>

        {/* Tab 0: Title Optimizer */}
        {aiOptimizeTab === 0 && (
          <Box>
            <TextField
              label={t('ai_currentTitle')}
              value={titleInput}
              onChange={e => setTitleInput(e.target.value)}
              fullWidth multiline minRows={2} maxRows={4}
              size="small" sx={{ mb: 1.5 }}
              placeholder="Personalized Baby Blanket Custom Name..."
            />
            <TextField
              label={t('ai_currentTags')}
              value={tagsInput}
              onChange={e => setTagsInput(e.target.value)}
              fullWidth size="small" sx={{ mb: 1.5 }}
              placeholder="baby blanket, personalized gift, newborn..."
              helperText={t('ai_tagsCommaHelp')}
            />
            <Button
              variant="contained" fullWidth
              onClick={handleOptimizeTitle}
              disabled={optimizeLoading || !titleInput.trim()}
              startIcon={optimizeLoading ? <CircularProgress size={16} /> : <Wand2 size={16} />}
              sx={{ background: GRADIENTS.purple, borderRadius: '12px', py: 1, fontWeight: 700, mb: 2 }}
            >
              {t('ai_optimizeTitle')}
            </Button>

            {optimizedTitle && (
              <Box>
                <BeforeAfter before={titleInput} after={optimizedTitle} label={t('ai_titleResult')} />
                <Button size="small" sx={{ mt: 1 }} startIcon={<Copy size={14} />}
                  onClick={() => { navigator.clipboard.writeText(optimizedTitle); toast.success(t('ai_copied')); }}>
                  {t('ai_copyResult')}
                </Button>
              </Box>
            )}
          </Box>
        )}

        {/* Tab 1: Tag Generator */}
        {aiOptimizeTab === 1 && (
          <Box>
            <TextField
              label={t('ai_listingTitle')}
              value={titleInput}
              onChange={e => setTitleInput(e.target.value)}
              fullWidth size="small" sx={{ mb: 1.5 }}
              placeholder="Personalized Baby Blanket..."
            />
            <TextField
              label={t('ai_currentTags')}
              value={tagsInput}
              onChange={e => setTagsInput(e.target.value)}
              fullWidth multiline minRows={2} maxRows={4}
              size="small" sx={{ mb: 1.5 }}
              placeholder="baby blanket, personalized gift..."
              helperText={t('ai_tagsCommaHelp')}
            />
            <Button
              variant="contained" fullWidth
              onClick={handleOptimizeTags}
              disabled={optimizeLoading || !titleInput.trim()}
              startIcon={optimizeLoading ? <CircularProgress size={16} /> : <Wand2 size={16} />}
              sx={{ background: GRADIENTS.purple, borderRadius: '12px', py: 1, fontWeight: 700, mb: 2 }}
            >
              {t('ai_generateTags')}
            </Button>

            {optimizedTags && (
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('ai_suggestedTags')} ({optimizedTags.length})</Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1.5 }}>
                  {optimizedTags.map((tag, i) => (
                    <Chip key={i} label={tag} size="small" color="primary" variant="outlined"
                      onClick={() => { navigator.clipboard.writeText(tag); toast.success(t('ai_copied')); }}
                      sx={{ cursor: 'pointer', borderRadius: '8px' }} />
                  ))}
                </Box>
                <Button size="small" startIcon={<Copy size={14} />}
                  onClick={() => { navigator.clipboard.writeText(optimizedTags.join(', ')); toast.success(t('ai_copied')); }}>
                  {t('ai_copyAll')}
                </Button>
              </Box>
            )}
          </Box>
        )}

        {/* Tab 2: Description Writer */}
        {aiOptimizeTab === 2 && (
          <Box>
            <TextField
              label={t('ai_listingTitle')}
              value={descTitleInput}
              onChange={e => setDescTitleInput(e.target.value)}
              fullWidth size="small" sx={{ mb: 1.5 }}
              placeholder="Personalized Baby Blanket..."
            />
            <TextField
              label={t('ai_tagsForDesc')}
              value={descTagsInput}
              onChange={e => setDescTagsInput(e.target.value)}
              fullWidth size="small" sx={{ mb: 1.5 }}
              placeholder="baby blanket, personalized gift..."
            />
            <TextField
              label={t('ai_materials')}
              value={materialsInput}
              onChange={e => setMaterialsInput(e.target.value)}
              fullWidth size="small" sx={{ mb: 1.5 }}
              placeholder="organic cotton, bamboo..."
              helperText={t('ai_materialsHelp')}
            />
            <Button
              variant="contained" fullWidth
              onClick={handleOptimizeDescription}
              disabled={optimizeLoading || !descTitleInput.trim()}
              startIcon={optimizeLoading ? <CircularProgress size={16} /> : <Wand2 size={16} />}
              sx={{ background: GRADIENTS.purple, borderRadius: '12px', py: 1, fontWeight: 700, mb: 2 }}
            >
              {t('ai_generateDesc')}
            </Button>

            {optimizedDescription && (
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('ai_generatedDesc')}</Typography>
                <Box sx={{
                  p: 2, borderRadius: '12px',
                  bgcolor: 'rgba(76,175,80,0.04)', border: '1px solid rgba(76,175,80,0.2)',
                  maxHeight: 300, overflowY: 'auto',
                  whiteSpace: 'pre-wrap', fontSize: '0.85rem', lineHeight: 1.6,
                }}>
                  {optimizedDescription}
                </Box>
                <Button size="small" sx={{ mt: 1 }} startIcon={<Copy size={14} />}
                  onClick={() => { navigator.clipboard.writeText(optimizedDescription); toast.success(t('ai_copied')); }}>
                  {t('ai_copyResult')}
                </Button>
              </Box>
            )}
          </Box>
        )}

        {/* Clear all button */}
        {(optimizedTitle || optimizedTags || optimizedDescription) && (
          <Button size="small" variant="text" color="error" sx={{ mt: 2 }}
            onClick={() => { clearOptimized(); toast.success(t('ai_cleared')); }}>
            {t('ai_clearAll')}
          </Button>
        )}
      </SwipeableDrawer>
    </>
  );
}
