import React, { useState } from 'react';
import {
  Box, Typography, Fab, SwipeableDrawer, Tabs, Tab, TextField,
  Button, CircularProgress, Chip, useMediaQuery, IconButton, Autocomplete,
  Checkbox, FormControlLabel,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Sparkles, X, Copy, Wand2, FilePlus2, Save } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { useRouter } from 'next/router';

import { useEtsyResearchStore, useComputedPrices } from '@/lib/stores/useEtsyResearchStore';
import { stageEtsyDraft } from '@/lib/etsy/draftClient';
import { notify } from '@/lib/notify';
import { coerceAiString, coerceAiStringArray, normalizeTags, normalizeTitle, checkTitle, TITLE_MAX } from '@/lib/etsy/seoRules';
import { GRADIENTS, glassCard, BeforeAfter, pillTabsSx } from './shared/ui';
import { prefillHref, writeListingPrefill, dominantCurrency } from './shared/listingPrefill';

interface OwnListingOption {
  listing_id: string;
  title: string;
  tags: string[];
  description: string;
}

interface AiOptimizePanelProps {
  /** Selected shop; enables "Save to listing as draft". */
  shopId?: string;
  /** The user's own listings (pick one to optimize / stage onto). */
  userListings?: any[];
}

export default function AiOptimizePanel({ shopId, userListings }: AiOptimizePanelProps = {}) {
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
  const [selectedListing, setSelectedListing] = useState<OwnListingOption | null>(null);
  const [applyLoading, setApplyLoading] = useState(false);
  // Which results get staged. Description is opt-in so a generated text never
  // silently replaces the seller's full description.
  const [stageFields, setStageFields] = useState({ title: true, tags: true, description: false });
  const router = useRouter();
  const items = useEtsyResearchStore(s => s.items);
  const { priceStats } = useComputedPrices();

  const listingOptions: OwnListingOption[] = React.useMemo(() => (userListings || [])
    .filter((l: any) => l && l.listing_id != null && typeof l.title === 'string')
    .map((l: any) => ({
      listing_id: String(l.listing_id),
      title: l.title,
      tags: Array.isArray(l.tags) ? l.tags.filter((x: unknown): x is string => typeof x === 'string') : [],
      description: typeof l.description === 'string' ? l.description : '',
    })), [userListings]);

  // Validated AI output (the store keeps whatever the API returned).
  const safeTitle = coerceAiString(optimizedTitle);
  const safeTags = coerceAiStringArray(optimizedTags);
  const safeDescription = coerceAiString(optimizedDescription);
  const hasResult = Boolean(safeTitle || safeTags.length || safeDescription);

  const handlePickListing = (opt: OwnListingOption | null) => {
    setSelectedListing(opt);
    // Results generated for another listing must never be staged onto this one.
    clearOptimized();
    setStageFields({ title: true, tags: true, description: false });
    if (!opt) return;
    setTitleInput(opt.title);
    setTagsInput(opt.tags.join(', '));
    setDescTitleInput(opt.title);
    setDescTagsInput(opt.tags.join(', '));
  };

  // Stage the AI results onto the selected own listing (draft only).
  const selectedCount =
    (safeTitle && stageFields.title ? 1 : 0) +
    (safeTags.length && stageFields.tags ? 1 : 0) +
    (safeDescription && stageFields.description ? 1 : 0);

  const handleApplyAsDraft = async () => {
    if (!shopId || !selectedListing || selectedCount === 0) return;
    const fields: Record<string, unknown> = {};
    if (safeTitle && stageFields.title) {
      const title = normalizeTitle(safeTitle).slice(0, TITLE_MAX).trim();
      const hard = checkTitle(title).issues.filter((i) => i === 'empty' || i === 'too_long' || i === 'bad_first_char' || i === 'disallowed_separator');
      if (hard.length > 0) { toast.error(t('lg_titleInvalid')); return; }
      fields.title = title;
    }
    if (safeTags.length && stageFields.tags) {
      // The tag generator runs in "add" mode (suggestions complement the
      // current tags), so keep the current tags first and fill up to 13.
      const current = tagsInput.split(',').map(x => x.trim()).filter(Boolean);
      const tags = normalizeTags([...current, ...safeTags]).tags;
      if (tags.length) fields.tags = tags;
    }
    if (safeDescription && stageFields.description) fields.description = safeDescription;
    if (Object.keys(fields).length === 0) return;
    setApplyLoading(true);
    try {
      await stageEtsyDraft({ shopId, listingId: selectedListing.listing_id, fields });
      const toastId = `ai-panel-draft-${selectedListing.listing_id}`;
      toast.success(
        <span>
          {t('ai_savedAsDraft')}{' '}
          <NextLink href="/app/etsy-listings" onClick={() => toast.dismiss(toastId)} style={{ fontWeight: 700, color: 'inherit', textDecoration: 'underline' }}>
            {t('ai_openListings')}
          </NextLink>
        </span>,
        { id: toastId, duration: 8000 },
      );
    } catch (err) {
      notify.error(err, t('ai_applyFailed'));
    } finally {
      setApplyLoading(false);
    }
  };

  // Open the Etsy creator prefilled with the AI results (or the inputs).
  const handleUseInNewListing = () => {
    const s = useEtsyResearchStore.getState();
    const inputTags = tagsInput.split(',').map(x => x.trim()).filter(Boolean);
    const currency = dominantCurrency(items);
    const ok = writeListingPrefill({
      target: 'etsy',
      source: 'etsy-research',
      title: safeTitle || titleInput.trim() || descTitleInput.trim(),
      description: safeDescription || undefined,
      tags: normalizeTags(safeTags.length ? safeTags : inputTags).tags,
      price: currency && priceStats ? priceStats.median : undefined,
      currency,
      research: items.length > 0 ? {
        query: s.query,
        topTags: s.serverTagFreq.slice(0, 20),
        topKeywords: s.serverKeywords.slice(0, 15),
        priceStats: priceStats && currency ? { min: priceStats.min, avg: priceStats.avg, median: priceStats.median, max: priceStats.max } : null,
      } : undefined,
    });
    if (!ok) { toast.error(t('ur_prefillFailed')); return; }
    setAiOptimizeOpen(false);
    router.push(prefillHref('etsy'));
  };

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
      // Improve the picked listing's real description (shipping,
      // personalization, care) instead of writing generic copy.
      description: selectedListing?.description || undefined,
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

        {/* Pick one of your listings to optimize (optional) */}
        {listingOptions.length > 0 && (
          <Autocomplete
            options={listingOptions}
            value={selectedListing}
            onChange={(_, v) => handlePickListing(v)}
            getOptionLabel={(o) => o.title}
            isOptionEqualToValue={(a, b) => a.listing_id === b.listing_id}
            renderOption={(props, o) => {
              const { key: _key, ...rest } = props as any;
              return (
                <li {...rest} key={o.listing_id}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" noWrap>{o.title}</Typography>
                    <Typography variant="caption" color="text.secondary">#{o.listing_id}</Typography>
                  </Box>
                </li>
              );
            }}
            size="small"
            sx={{ mb: 1.5 }}
            slotProps={{ popper: { sx: { zIndex: 1500 } } }}
            renderInput={(params) => (
              <TextField {...params} label={t('ai_pickListing')} helperText={t('ai_pickListingHelp')} />
            )}
          />
        )}

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

            {safeTags.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('ai_suggestedTags')} ({safeTags.length})</Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1.5 }}>
                  {safeTags.map((tag, i) => (
                    <Chip key={i} label={tag} size="small" color="primary" variant="outlined"
                      onClick={() => { navigator.clipboard.writeText(tag); toast.success(t('ai_copied')); }}
                      sx={{ cursor: 'pointer', borderRadius: '8px' }} />
                  ))}
                </Box>
                <Button size="small" startIcon={<Copy size={14} />}
                  onClick={() => { navigator.clipboard.writeText(safeTags.join(', ')); toast.success(t('ai_copied')); }}>
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

        {/* Use results: stage onto own listing / start a new listing */}
        {(hasResult || titleInput.trim()) && (
          <Box sx={{ ...glassCard, p: 1.5, mt: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
            {selectedListing && shopId && hasResult && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
                {([
                  { key: 'title', on: Boolean(safeTitle), label: t('ai_titleTab') },
                  { key: 'tags', on: safeTags.length > 0, label: t('ai_tagsTab') },
                  { key: 'description', on: Boolean(safeDescription), label: t('ai_descTab') },
                ] as const).filter((f) => f.on).map((f) => (
                  <FormControlLabel key={f.key} sx={{ mr: 1, minHeight: 44 }}
                    control={<Checkbox checked={stageFields[f.key]} onChange={(e) => setStageFields((s) => ({ ...s, [f.key]: e.target.checked }))} />}
                    label={<Typography variant="body2">{f.label}</Typography>} />
                ))}
                {safeDescription && (
                  <Typography variant="caption" color="text.secondary" sx={{ flex: '1 1 100%' }}>
                    {t('lg_descOptIn')}
                  </Typography>
                )}
              </Box>
            )}
            {selectedListing && shopId && (
              <Button variant="contained" fullWidth
                onClick={handleApplyAsDraft}
                disabled={selectedCount === 0 || applyLoading}
                startIcon={applyLoading ? <CircularProgress size={14} /> : <Save size={16} />}
                sx={{ minHeight: 44, borderRadius: '12px', textTransform: 'none', fontWeight: 700, background: hasResult ? GRADIENTS.purple : undefined }}>
                {t('ai_applyAsDraft')}
              </Button>
            )}
            <Button variant="outlined" fullWidth
              onClick={handleUseInNewListing}
              startIcon={<FilePlus2 size={16} />}
              sx={{ minHeight: 44, borderRadius: '12px', textTransform: 'none', fontWeight: 600 }}>
              {t('ai_useInNewListing')}
            </Button>
            <Typography variant="caption" color="text.secondary">
              {selectedListing ? t('ai_applyExplain') : t('ai_newListingExplain')}
            </Typography>
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
