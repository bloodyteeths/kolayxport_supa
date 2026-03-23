import React, { useMemo, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  Tooltip,
  LinearProgress,
} from '@mui/material';
import {
  ContentCopy as ContentCopyIcon,
  Edit as EditIcon,
  MergeType as MergeTypeIcon,
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ListingData {
  listing_id: number;
  title: string;
  description: string;
  tags: string[];
  price: { amount: number; divisor: number; currency_code: string } | null;
  quantity: number;
  views: number;
  num_favorers: number;
  state: string;
}

interface DuplicateGroup {
  id: number;
  listings: ListingData[];
  similarity: number;
}

interface DuplicateDetectorProps {
  open: boolean;
  onClose: () => void;
  listings: ListingData[];
  shopId: string;
  onEdit: (listingId: number) => void;
  onCompleted: () => void;
}

// ---------------------------------------------------------------------------
// Jaccard Similarity
// ---------------------------------------------------------------------------

function getWordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\sğüşöçıİĞÜŞÖÇ]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 1)
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

function formatPrice(price: ListingData['price']): string {
  if (!price) return '—';
  const value = price.amount / price.divisor;
  const symbol =
    price.currency_code === 'USD'
      ? '$'
      : price.currency_code === 'EUR'
        ? '€'
        : price.currency_code === 'GBP'
          ? '£'
          : price.currency_code === 'TRY'
            ? '₺'
            : price.currency_code + ' ';
  return `${symbol}${value.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const SIMILARITY_THRESHOLD = 0.6;

export default function DuplicateDetector({
  open,
  onClose,
  listings,
  shopId,
  onEdit,
  onCompleted,
}: DuplicateDetectorProps) {
  const [merging, setMerging] = useState(false);

  // Find duplicate groups
  const duplicateGroups = useMemo<DuplicateGroup[]>(() => {
    if (!open || listings.length < 2) return [];

    const wordSets = listings.map((l) => ({
      listing: l,
      words: getWordSet(l.title),
    }));

    // Union-Find to group duplicates
    const parent = new Map<number, number>();
    const find = (id: number): number => {
      if (!parent.has(id)) parent.set(id, id);
      if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!));
      return parent.get(id)!;
    };
    const union = (a: number, b: number) => {
      const pa = find(a);
      const pb = find(b);
      if (pa !== pb) parent.set(pa, pb);
    };

    const pairSimilarities = new Map<string, number>();

    for (let i = 0; i < wordSets.length; i++) {
      for (let j = i + 1; j < wordSets.length; j++) {
        const sim = jaccardSimilarity(wordSets[i].words, wordSets[j].words);
        if (sim >= SIMILARITY_THRESHOLD) {
          union(wordSets[i].listing.listing_id, wordSets[j].listing.listing_id);
          const key = `${wordSets[i].listing.listing_id}-${wordSets[j].listing.listing_id}`;
          pairSimilarities.set(key, sim);
        }
      }
    }

    // Collect groups
    const groups = new Map<number, ListingData[]>();
    for (const ws of wordSets) {
      const root = find(ws.listing.listing_id);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(ws.listing);
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
          const key1 = `${members[i].listing_id}-${members[j].listing_id}`;
          const key2 = `${members[j].listing_id}-${members[i].listing_id}`;
          const sim = pairSimilarities.get(key1) ?? pairSimilarities.get(key2) ?? 0;
          if (sim > 0) {
            totalSim += sim;
            pairCount++;
          }
        }
      }

      result.push({
        id: groupId++,
        listings: members.sort((a, b) => b.views - a.views), // Best performer first
        similarity: pairCount > 0 ? totalSim / pairCount : SIMILARITY_THRESHOLD,
      });
    }

    return result.sort((a, b) => b.similarity - a.similarity);
  }, [open, listings]);

  // Merge: keep the first listing (best performer), deactivate the rest
  const handleMerge = async (group: DuplicateGroup) => {
    const toDeactivate = group.listings.slice(1); // Keep the first (highest views)
    if (toDeactivate.length === 0) return;

    setMerging(true);
    let succeeded = 0;
    let failed = 0;

    for (const listing of toDeactivate) {
      try {
        const res = await fetch(
          `/api/clawd/etsy?action=update_listing&listing_id=${listing.listing_id}&shop_id=${shopId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: 'inactive' }),
          }
        );
        if (res.ok) succeeded++;
        else failed++;
      } catch {
        failed++;
      }
      // Rate limit
      await new Promise((r) => setTimeout(r, 150));
    }

    setMerging(false);

    if (failed === 0) {
      toast.success(
        `Birleştirme tamamlandı: ${succeeded} listing deaktif edildi, en iyi listing korundu`
      );
    } else {
      toast.error(`Birleştirme: ${succeeded} başarılı, ${failed} başarısız`);
    }

    onCompleted();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <ContentCopyIcon sx={{ color: 'warning.main' }} />
        Tekrar Tespit
        {duplicateGroups.length > 0 && (
          <Chip
            label={`${duplicateGroups.length} grup`}
            size="small"
            color="warning"
            sx={{ ml: 1 }}
          />
        )}
      </DialogTitle>
      <DialogContent>
        {merging && (
          <Box sx={{ mb: 2 }}>
            <LinearProgress />
            <Typography variant="caption" color="text.secondary">
              Birleştirme işlemi devam ediyor...
            </Typography>
          </Box>
        )}

        {listings.length < 2 ? (
          <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
            Karşılaştırma için en az 2 listing gerekli.
          </Typography>
        ) : duplicateGroups.length === 0 ? (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Typography variant="h6" color="success.main" gutterBottom>
              Tekrar bulunamadı
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {listings.length} listing analiz edildi, benzer başlık bulunamadı.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Typography variant="body2" color="text.secondary">
              {listings.length} listing analiz edildi. {duplicateGroups.length} olası tekrar grubu
              bulundu (benzerlik eşiği: %{Math.round(SIMILARITY_THRESHOLD * 100)}).
            </Typography>

            {duplicateGroups.map((group) => (
              <Box
                key={group.id}
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  overflow: 'hidden',
                }}
              >
                <Box
                  sx={{
                    px: 2,
                    py: 1,
                    bgcolor: 'action.hover',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="subtitle2">Olası Tekrarlar</Typography>
                    <Chip
                      label={`${group.listings.length} listing`}
                      size="small"
                      variant="outlined"
                    />
                    <Chip
                      label={`Benzerlik: %${Math.round(group.similarity * 100)}`}
                      size="small"
                      color={group.similarity >= 0.8 ? 'error' : 'warning'}
                    />
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Tooltip title="Birleştir: En iyi listing korunur, diğerleri deaktif edilir">
                      <Button
                        size="small"
                        variant="contained"
                        color="warning"
                        startIcon={<MergeTypeIcon />}
                        disabled={merging}
                        onClick={() => handleMerge(group)}
                      >
                        Birleştir
                      </Button>
                    </Tooltip>
                  </Box>
                </Box>

                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ width: 40 }}>#</TableCell>
                        <TableCell>Başlık</TableCell>
                        <TableCell sx={{ width: 90 }}>Fiyat</TableCell>
                        <TableCell sx={{ width: 80 }}>Görüntü</TableCell>
                        <TableCell sx={{ width: 80 }}>Favori</TableCell>
                        <TableCell sx={{ width: 80 }}>Durum</TableCell>
                        <TableCell sx={{ width: 50 }} />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {group.listings.map((listing, idx) => (
                        <TableRow
                          key={listing.listing_id}
                          sx={idx === 0 ? { bgcolor: 'success.50' } : undefined}
                        >
                          <TableCell>
                            {idx === 0 ? (
                              <Chip label="En iyi" size="small" color="success" />
                            ) : (
                              idx + 1
                            )}
                          </TableCell>
                          <TableCell
                            sx={{
                              maxWidth: 400,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <Tooltip title={listing.title} arrow>
                              <Typography variant="body2">{listing.title}</Typography>
                            </Tooltip>
                          </TableCell>
                          <TableCell>{formatPrice(listing.price)}</TableCell>
                          <TableCell>{listing.views.toLocaleString()}</TableCell>
                          <TableCell>{listing.num_favorers.toLocaleString()}</TableCell>
                          <TableCell>
                            <Chip
                              label={listing.state}
                              size="small"
                              color={
                                listing.state === 'active'
                                  ? 'success'
                                  : listing.state === 'inactive'
                                    ? 'error'
                                    : 'default'
                              }
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell>
                            <Tooltip title="Farklılaştır">
                              <IconButton
                                size="small"
                                onClick={() => {
                                  onEdit(listing.listing_id);
                                  onClose();
                                }}
                              >
                                <EditIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={merging}>
          Kapat
        </Button>
      </DialogActions>
    </Dialog>
  );
}
