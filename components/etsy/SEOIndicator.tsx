import React, { useMemo } from 'react';
import { Tooltip, Box, Typography, LinearProgress, Chip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { useTranslations } from 'next-intl';

interface TrackedKeyword {
  keyword: string;
  rank: number | null;
  totalResults: number;
  checkedAt: string | null;
}

interface SEOIndicatorProps {
  tags: string[];
  title: string;
  description: string;
  materials?: string[];
  taxonomyId?: number;
  weight?: number | '';
  trackedKeywords?: TrackedKeyword[];
  compact?: boolean;
}

// Common English stop words to exclude from keyword density
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'as', 'be', 'are', 'was',
  'were', 'been', 'this', 'that', 'these', 'those', 'i', 'you', 'he',
  'she', 'we', 'they', 'my', 'your', 'his', 'her', 'our', 'their',
  'will', 'can', 'has', 'have', 'had', 'do', 'does', 'did', 'not',
  'so', 'if', 'no', 'up', 'out', 'all', 'just', 'also', 'than',
  'very', 'too', 'each', 'every', 'any', 'some', 'into', 'over',
]);

function StatusIcon({ status }: { status: 'good' | 'warning' | 'bad' }) {
  if (status === 'good') return <CheckCircleIcon sx={{ fontSize: 16, color: '#22c55e' }} />;
  if (status === 'warning') return <WarningAmberIcon sx={{ fontSize: 16, color: '#eab308' }} />;
  return <ErrorOutlineIcon sx={{ fontSize: 16, color: '#ef4444' }} />;
}

function CheckRow({ status, label, value }: { status: 'good' | 'warning' | 'bad'; label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
      <StatusIcon status={status} />
      <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>{label}</Typography>
      <Typography variant="caption" sx={{ color: status === 'good' ? '#22c55e' : status === 'warning' ? '#eab308' : '#ef4444', fontWeight: 600 }}>
        {value}
      </Typography>
    </Box>
  );
}

export default function SEOIndicator({
  tags, title, description, materials, taxonomyId, weight, trackedKeywords, compact = false,
}: SEOIndicatorProps) {
  const t = useTranslations('etsy.seo');
  const tagCount = tags?.length || 0;
  const titleLength = title?.length || 0;
  const descLength = description?.length || 0;
  const titleWords = title?.trim().split(/\s+/).filter(Boolean) || [];
  const titleWordCount = titleWords.length;

  // --- Score calculation (enhanced) ---
  const tagScore = Math.min(tagCount / 13, 1) * 25;
  const titleLenScore = titleLength >= 100 && titleLength <= 140 ? 20 : titleLength >= 80 ? 15 : titleLength >= 40 ? 10 : titleLength > 0 ? 3 : 0;
  const titleWordScore = titleWordCount >= 8 && titleWordCount <= 14 ? 10 : titleWordCount >= 5 ? 7 : titleWordCount > 0 ? 3 : 0;
  const descScore = descLength >= 300 ? 15 : descLength >= 100 ? 10 : descLength > 0 ? 5 : 0;

  // Tag-title overlap score
  const titleWordsLower = useMemo(() => new Set(title?.toLowerCase().split(/[\s,|·•—–\-/]+/).filter(w => w.length > 2)), [title]);
  const tagsWithOverlap = useMemo(() => {
    return (tags || []).map(tag => {
      const tagWords = tag.toLowerCase().split(/\s+/);
      const overlapping = tagWords.some(w => w.length > 2 && titleWordsLower.has(w));
      return { tag, overlapping };
    });
  }, [tags, titleWordsLower]);
  const overlapCount = tagsWithOverlap.filter(t => t.overlapping).length;
  const overlapScore = tagCount > 0 ? Math.min(overlapCount / Math.min(tagCount, 5), 1) * 10 : 0;

  // Duplicate/similar tags
  const duplicateTags = useMemo(() => {
    const seen = new Map<string, string>();
    const dupes: Array<[string, string]> = [];
    for (const tag of tags || []) {
      const normalized = tag.toLowerCase().replace(/\s+/g, ' ').trim();
      const sorted = normalized.split(' ').sort().join(' ');
      if (seen.has(sorted)) {
        dupes.push([seen.get(sorted)!, tag]);
      } else {
        seen.set(sorted, tag);
      }
    }
    return dupes;
  }, [tags]);
  const noDupeScore = duplicateTags.length === 0 ? 5 : 0;

  // Missing attributes
  const hasMaterials = (materials?.length || 0) > 0;
  const hasCategory = !!taxonomyId;
  const hasWeight = !!weight;
  const attrCount = [hasMaterials, hasCategory, hasWeight].filter(Boolean).length;
  const attrScore = attrCount >= 3 ? 15 : attrCount >= 2 ? 10 : attrCount >= 1 ? 5 : 0;

  const totalScore = Math.round(Math.min(tagScore + titleLenScore + titleWordScore + descScore + overlapScore + noDupeScore + attrScore, 100));
  const color = totalScore >= 80 ? '#22c55e' : totalScore >= 50 ? '#eab308' : '#ef4444';
  const label = totalScore >= 80 ? t('good') : totalScore >= 50 ? t('medium') : t('weak');

  // --- Keyword density ---
  const keywordDensity = useMemo(() => {
    const allText = `${title || ''} ${(tags || []).join(' ')} ${description || ''}`.toLowerCase();
    const words = allText.split(/[\s,.|·•—–\-/!?()[\]{}'"]+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
    const freq = new Map<string, number>();
    for (const w of words) {
      freq.set(w, (freq.get(w) || 0) + 1);
    }
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word, count]) => ({ word, count }));
  }, [title, tags, description]);

  // --- Search volume from tracked keywords ---
  const searchVolumes = useMemo(() => {
    if (!trackedKeywords?.length) return [];
    return trackedKeywords
      .filter(kw => kw.checkedAt && kw.totalResults > 0)
      .sort((a, b) => b.totalResults - a.totalResults)
      .slice(0, 5);
  }, [trackedKeywords]);

  // --- Compact mode ---
  if (compact) {
    return (
      <Tooltip title={t('tooltip', { score: totalScore, tags: tagCount, titleLen: titleLength, descLen: descLength })}>
        <Box
          sx={{
            width: 12, height: 12, borderRadius: '50%',
            backgroundColor: color, display: 'inline-block', cursor: 'pointer',
          }}
        />
      </Tooltip>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Overall Score */}
      <Box sx={{ p: 1.5, bgcolor: '#f8f9fa', borderRadius: '10px', border: '1px solid #eee' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="body2" fontWeight={700}>{t('seoScore')}</Typography>
          <Typography variant="body2" sx={{ color, fontWeight: 800 }}>{totalScore}/100 — {label}</Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={totalScore}
          sx={{
            mb: 1.5, height: 8, borderRadius: 4, backgroundColor: '#e5e7eb',
            '& .MuiLinearProgress-bar': { backgroundColor: color, borderRadius: 4 },
          }}
        />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          <CheckRow
            status={tagCount >= 10 ? 'good' : tagCount >= 5 ? 'warning' : 'bad'}
            label={t('tagsLabel')}
            value={`${tagCount}/13`}
          />
          <CheckRow
            status={titleLength >= 100 && titleLength <= 140 ? 'good' : titleLength >= 80 ? 'warning' : 'bad'}
            label={t('titleLength')}
            value={`${titleLength}/140`}
          />
          <CheckRow
            status={titleWordCount >= 8 && titleWordCount <= 14 ? 'good' : titleWordCount >= 5 ? 'warning' : 'bad'}
            label={t('titleWordCount')}
            value={`${titleWordCount} ${t('words')}`}
          />
          <CheckRow
            status={descLength >= 300 ? 'good' : descLength >= 100 ? 'warning' : 'bad'}
            label={t('descriptionLength')}
            value={t('characters', { count: descLength })}
          />
        </Box>
      </Box>

      {/* Tag-Title Overlap */}
      <Box sx={{ p: 1.5, bgcolor: '#f8f9fa', borderRadius: '10px', border: '1px solid #eee' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="body2" fontWeight={700}>{t('tagTitleOverlap')}</Typography>
          <Typography variant="caption" sx={{
            color: overlapCount >= 3 ? '#22c55e' : overlapCount >= 1 ? '#eab308' : '#ef4444',
            fontWeight: 600,
          }}>
            {overlapCount}/{tagCount} {t('tagsInTitle')}
          </Typography>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          {t('tagTitleOverlapHint')}
        </Typography>
        {tagCount > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {tagsWithOverlap.map(({ tag, overlapping }) => (
              <Chip
                key={tag}
                label={tag}
                size="small"
                sx={{
                  fontSize: '0.75rem', height: 24,
                  bgcolor: overlapping ? '#dcfce7' : '#fef3c7',
                  color: overlapping ? '#166534' : '#92400e',
                  border: overlapping ? '1px solid #86efac' : '1px solid #fde68a',
                }}
              />
            ))}
          </Box>
        )}
      </Box>

      {/* Duplicate Tags */}
      {duplicateTags.length > 0 && (
        <Box sx={{ p: 1.5, bgcolor: '#fef2f2', borderRadius: '10px', border: '1px solid #fecaca' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <WarningAmberIcon sx={{ fontSize: 16, color: '#ef4444' }} />
            <Typography variant="body2" fontWeight={700} color="#ef4444">{t('duplicateTags')}</Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            {t('duplicateTagsHint')}
          </Typography>
          {duplicateTags.map(([a, b]) => (
            <Typography key={`${a}-${b}`} variant="caption" sx={{ display: 'block', color: '#dc2626' }}>
              "{a}" ≈ "{b}"
            </Typography>
          ))}
        </Box>
      )}

      {/* Missing Attributes */}
      <Box sx={{ p: 1.5, bgcolor: '#f8f9fa', borderRadius: '10px', border: '1px solid #eee' }}>
        <Typography variant="body2" fontWeight={700} sx={{ mb: 0.75 }}>{t('listingCompleteness')}</Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          <CheckRow
            status={hasCategory ? 'good' : 'bad'}
            label={t('category')}
            value={hasCategory ? t('set') : t('missing')}
          />
          <CheckRow
            status={hasMaterials ? 'good' : 'warning'}
            label={t('materialsLabel')}
            value={hasMaterials ? `${materials!.length} ${t('set').toLowerCase()}` : t('missing')}
          />
          <CheckRow
            status={hasWeight ? 'good' : 'warning'}
            label={t('weightLabel')}
            value={hasWeight ? t('set') : t('missing')}
          />
        </Box>
      </Box>

      {/* Keyword Density */}
      {keywordDensity.length > 0 && (
        <Box sx={{ p: 1.5, bgcolor: '#f8f9fa', borderRadius: '10px', border: '1px solid #eee' }}>
          <Typography variant="body2" fontWeight={700} sx={{ mb: 1 }}>{t('keywordDensity')}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            {t('keywordDensityHint')}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {keywordDensity.map(({ word, count }, i) => (
              <Chip
                key={word}
                label={`${word} (${count})`}
                size="small"
                sx={{
                  fontSize: '0.75rem', height: 24,
                  bgcolor: i < 3 ? '#dbeafe' : '#f3f4f6',
                  color: i < 3 ? '#1e40af' : '#374151',
                  fontWeight: i < 3 ? 600 : 400,
                }}
              />
            ))}
          </Box>
        </Box>
      )}

      {/* Search Volume / Demand */}
      {searchVolumes.length > 0 && (
        <Box sx={{ p: 1.5, bgcolor: '#f8f9fa', borderRadius: '10px', border: '1px solid #eee' }}>
          <Typography variant="body2" fontWeight={700} sx={{ mb: 1 }}>{t('searchDemand')}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            {t('searchDemandHint')}
          </Typography>
          {searchVolumes.map((kw) => {
            const maxResults = searchVolumes[0]?.totalResults || 1;
            const pct = Math.round((kw.totalResults / maxResults) * 100);
            return (
              <Box key={kw.keyword} sx={{ mb: 0.75 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                  <Typography variant="caption" sx={{ fontWeight: 500 }}>{kw.keyword}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {kw.totalResults.toLocaleString()} {t('results')}
                    {kw.rank != null && (
                      <span style={{ color: kw.rank <= 10 ? '#22c55e' : kw.rank <= 48 ? '#eab308' : '#ef4444', fontWeight: 700, marginLeft: 6 }}>
                        #{kw.rank}
                      </span>
                    )}
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={pct}
                  sx={{
                    height: 4, borderRadius: 2, backgroundColor: '#e5e7eb',
                    '& .MuiLinearProgress-bar': { backgroundColor: '#6366f1', borderRadius: 2 },
                  }}
                />
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
