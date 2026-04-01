import React, { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  Tooltip,
  Button,
  Card,
  CardContent,
  Collapse,
  Alert,
  Paper,
  LinearProgress,
} from '@mui/material';
import {
  ContentCopy as ContentCopyIcon,
  Edit as EditIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Visibility as VisibilityIcon,
  CompareArrows as CompareArrowsIcon,
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DuplicateGroup {
  id: number;
  listings: any[];
  similarity: number;
}

interface DuplicateDetectorProps {
  listings: any[];
  onSelect: (sku: string) => void;
}

// ---------------------------------------------------------------------------
// Similarity functions
// ---------------------------------------------------------------------------

function getWordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Levenshtein distance for short titles
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = [i];
    for (let j = 1; j <= n; j++) {
      dp[i][j] = i === 0 ? j : 0;
    }
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }

  return dp[m][n];
}

function combinedSimilarity(titleA: string, titleB: string): number {
  const wordsA = getWordSet(titleA);
  const wordsB = getWordSet(titleB);

  const jaccard = jaccardSimilarity(wordsA, wordsB);

  // For shorter titles, also use normalized Levenshtein
  const maxLen = Math.max(titleA.length, titleB.length);
  let levenshteinSim = 0;
  if (maxLen <= 100) {
    const dist = levenshteinDistance(titleA.toLowerCase(), titleB.toLowerCase());
    levenshteinSim = 1 - dist / maxLen;
  }

  // Weighted average: Jaccard is primary, Levenshtein supplements
  return jaccard * 0.7 + levenshteinSim * 0.3;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const SIMILARITY_THRESHOLD = 0.55;

export default function DuplicateDetector({ listings, onSelect }: DuplicateDetectorProps) {
  const t = useTranslations('ebayListings.duplicateDetector');
  const [expandedGroup, setExpandedGroup] = useState<number | null>(null);
  const [compareMode, setCompareMode] = useState<{ groupId: number; indices: [number, number] } | null>(null);

  // Find duplicate groups
  const duplicateGroups = useMemo<DuplicateGroup[]>(() => {
    if (listings.length < 2) return [];

    const items = listings.map((l: any) => ({
      listing: l,
      title: l.title || l.sku || '',
    }));

    // Union-Find to group duplicates
    const parent = new Map<string, string>();
    const find = (id: string): string => {
      if (!parent.has(id)) parent.set(id, id);
      if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!));
      return parent.get(id)!;
    };
    const union = (a: string, b: string) => {
      const pa = find(a);
      const pb = find(b);
      if (pa !== pb) parent.set(pa, pb);
    };

    const pairSimilarities = new Map<string, number>();

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const sim = combinedSimilarity(items[i].title, items[j].title);
        if (sim >= SIMILARITY_THRESHOLD) {
          const skuA = items[i].listing.sku;
          const skuB = items[j].listing.sku;
          union(skuA, skuB);
          pairSimilarities.set(`${skuA}-${skuB}`, sim);
        }
      }
    }

    // Collect groups
    const groups = new Map<string, any[]>();
    for (const item of items) {
      const root = find(item.listing.sku);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(item.listing);
    }

    // Only keep groups with 2+ members
    const result: DuplicateGroup[] = [];
    let groupId = 0;
    for (const [, members] of groups) {
      if (members.length < 2) continue;

      // Average similarity across the group
      let totalSim = 0;
      let pairCount = 0;
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const key1 = `${members[i].sku}-${members[j].sku}`;
          const key2 = `${members[j].sku}-${members[i].sku}`;
          const sim = pairSimilarities.get(key1) ?? pairSimilarities.get(key2) ?? 0;
          if (sim > 0) {
            totalSim += sim;
            pairCount++;
          }
        }
      }

      result.push({
        id: groupId++,
        listings: members.sort((a: any, b: any) => (b.quantity || 0) - (a.quantity || 0)),
        similarity: pairCount > 0 ? totalSim / pairCount : SIMILARITY_THRESHOLD,
      });
    }

    return result.sort((a, b) => b.similarity - a.similarity);
  }, [listings]);

  const handleToggleGroup = (groupId: number) => {
    setExpandedGroup((prev) => (prev === groupId ? null : groupId));
    setCompareMode(null);
  };

  const handleCompare = (groupId: number, idx1: number, idx2: number) => {
    setCompareMode({ groupId, indices: [idx1, idx2] });
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <ContentCopyIcon sx={{ color: 'warning.main' }} />
        <Typography variant="subtitle1" fontWeight={600}>
          {t('title')}
        </Typography>
        {duplicateGroups.length > 0 && (
          <Chip label={t('groupCount', { count: duplicateGroups.length })} size="small" color="warning" sx={{ ml: 1 }} />
        )}
      </Box>

      {listings.length < 2 ? (
        <Alert severity="info">
          {t('minTwoListings')}
        </Alert>
      ) : duplicateGroups.length === 0 ? (
        <Box sx={{ py: 3, textAlign: 'center' }}>
          <Typography variant="h6" color="success.main" gutterBottom>
            {t('noDuplicatesFound')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('analyzedNoDuplicates', { count: listings.length })}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {t('analyzedFoundGroups', { count: listings.length, groups: duplicateGroups.length, threshold: Math.round(SIMILARITY_THRESHOLD * 100) })}
          </Typography>

          {duplicateGroups.map((group) => (
            <Card key={group.id} variant="outlined">
              {/* Group header */}
              <Box
                sx={{
                  px: 2,
                  py: 1,
                  bgcolor: 'action.hover',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                }}
                onClick={() => handleToggleGroup(group.id)}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="subtitle2">{t('possibleDuplicates')}</Typography>
                  <Chip label={t('listingCount', { count: group.listings.length })} size="small" variant="outlined" />
                  <Chip
                    label={t('similarity', { percent: Math.round(group.similarity * 100) })}
                    size="small"
                    color={group.similarity >= 0.8 ? 'error' : 'warning'}
                  />
                </Box>
                <IconButton size="small">
                  {expandedGroup === group.id ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                </IconButton>
              </Box>

              {/* Expanded listing table */}
              <Collapse in={expandedGroup === group.id}>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ width: 40 }}>#</TableCell>
                        <TableCell>{t('titleCol')}</TableCell>
                        <TableCell sx={{ width: 80 }}>{t('skuCol')}</TableCell>
                        <TableCell sx={{ width: 80 }}>{t('priceCol')}</TableCell>
                        <TableCell sx={{ width: 60 }}>{t('stockCol')}</TableCell>
                        <TableCell sx={{ width: 90 }}>{t('statusCol')}</TableCell>
                        <TableCell sx={{ width: 80 }} />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {group.listings.map((listing: any, idx: number) => (
                        <TableRow
                          key={listing.sku}
                          sx={idx === 0 ? { bgcolor: 'success.50' } : undefined}
                        >
                          <TableCell>
                            {idx === 0 ? (
                              <Chip label={t('best')} size="small" color="success" />
                            ) : (
                              idx + 1
                            )}
                          </TableCell>
                          <TableCell
                            sx={{
                              maxWidth: 300,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <Tooltip title={listing.title || listing.sku} arrow>
                              <Typography variant="body2">{listing.title || listing.sku}</Typography>
                            </Tooltip>
                          </TableCell>
                          <TableCell>
                            <Typography variant="caption" fontFamily="monospace">
                              {listing.sku?.substring(0, 12)}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            {listing.price != null ? `$${listing.price.toFixed(2)}` : '-'}
                          </TableCell>
                          <TableCell>{listing.quantity ?? '-'}</TableCell>
                          <TableCell>
                            <Chip
                              label={listing.status || listing.listingStatus || t('unknown')}
                              size="small"
                              color={
                                (listing.status || listing.listingStatus) === 'ACTIVE'
                                  ? 'success'
                                  : (listing.status || listing.listingStatus) === 'INACTIVE' ||
                                      (listing.status || listing.listingStatus) === 'ENDED'
                                    ? 'error'
                                    : 'default'
                              }
                              variant="outlined"
                              sx={{ fontSize: '0.65rem' }}
                            />
                          </TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', gap: 0.5 }}>
                              <Tooltip title={t('selectListing')}>
                                <IconButton
                                  size="small"
                                  onClick={() => onSelect(listing.sku)}
                                >
                                  <VisibilityIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              {idx > 0 && (
                                <Tooltip title={t('compareWithFirst')}>
                                  <IconButton
                                    size="small"
                                    onClick={() => handleCompare(group.id, 0, idx)}
                                  >
                                    <CompareArrowsIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              )}
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>

                {/* Side-by-side comparison */}
                {compareMode && compareMode.groupId === group.id && (
                  <Box sx={{ p: 2, bgcolor: 'grey.50' }}>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                      {t('comparison')}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 2 }}>
                      {compareMode.indices.map((idx) => {
                        const listing = group.listings[idx];
                        return (
                          <Card key={listing.sku} variant="outlined" sx={{ flex: 1 }}>
                            <CardContent>
                              <Chip
                                label={idx === 0 ? t('best') : `#${idx + 1}`}
                                size="small"
                                color={idx === 0 ? 'success' : 'default'}
                                sx={{ mb: 1 }}
                              />
                              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                                {listing.title || listing.sku}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                SKU: {listing.sku}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                {t('price')}: {listing.price != null ? `$${listing.price.toFixed(2)}` : '-'}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                {t('stock')}: {listing.quantity ?? '-'}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                {t('conditionLabel')}: {listing.condition || '-'}
                              </Typography>
                              {listing.categoryName && (
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                  {t('category')}: {listing.categoryName}
                                </Typography>
                              )}
                              {listing.description && (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  sx={{
                                    display: 'block',
                                    mt: 0.5,
                                    maxHeight: 60,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                  }}
                                >
                                  {listing.description.substring(0, 150)}
                                  {listing.description.length > 150 ? '...' : ''}
                                </Typography>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })}
                    </Box>
                    <Button
                      size="small"
                      onClick={() => setCompareMode(null)}
                      sx={{ mt: 1 }}
                    >
                      {t('closeComparison')}
                    </Button>
                  </Box>
                )}
              </Collapse>
            </Card>
          ))}
        </Box>
      )}
    </Box>
  );
}
