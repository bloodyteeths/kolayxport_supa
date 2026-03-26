import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Tooltip,
  TextField,
  Select,
  MenuItem,
  FormControl,
  IconButton,
  Typography,
  Paper,
  Chip,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Collapse,
  Badge,
  Menu,
  ListItemText,
  ListItemIcon,
  ListSubheader,
  Divider,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  DataGrid,
  GridColDef,
  GridPaginationModel,
  GridRenderCellParams,
  GridRowSelectionModel,
  GridRowId,
} from '@mui/x-data-grid';
import {
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  UploadFile as UploadFileIcon,
  ErrorOutline as ErrorOutlineIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  MoreVert as MoreVertIcon,
  FindReplace as FindReplaceIcon,
  ContentCopy as ContentCopyIcon,
  AttachMoney as AttachMoneyIcon,
  ViewList as ViewListIcon,
  Download as DownloadIcon,
  Backup as BackupIcon,
  Schedule as ScheduleIcon,
  Close as CloseIcon,
  Build as BuildIcon,
  AutoFixHigh as AutoFixHighIcon,
  Psychology as PsychologyIcon,
} from '@mui/icons-material';
import { toast, Toaster } from 'react-hot-toast';
import AppLayout from '@/components/AppLayout';
import withAuth from '@/components/withAuth';
import { useAuth } from '@/lib/auth-context';

import { Tabs, Tab } from '@mui/material';
import SEOIndicator from '@/components/ebay/SEOIndicator';
import ListingEditorDrawer from '@/components/ebay/ListingEditorDrawer';
import ListingCreatorDialog from '@/components/ebay/ListingCreatorDialog';
import FindReplaceDialog from '@/components/ebay/FindReplaceDialog';
import BulkOperationsBar from '@/components/ebay/BulkOperationsBar';
// MarketResearch removed — now lives at /app/ebay-research
import ListingTemplates from '@/components/ebay/ListingTemplates';
import ScheduledUpdateDialog from '@/components/ebay/ScheduledUpdateDialog';
import SmartPricing from '@/components/ebay/SmartPricing';
import DuplicateDetector from '@/components/ebay/DuplicateDetector';
import BackupManager from '@/components/ebay/BackupManager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EbayListingRow {
  id: string;
  sku: string;
  offerId?: string;
  listingId?: string;
  title: string;
  description: string;
  price: { value: string; currency: string };
  quantity: number;
  status: string;
  condition: string;
  categoryId: string;
  categoryName?: string;
  imageUrl?: string;
  imageCount: number;
  aspects: Record<string, string[]>;
  format: string;
  marketplaceId: string;
  listingUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONDITION_LABELS: Record<string, string> = {
  NEW: 'Yeni',
  LIKE_NEW: 'Yeni Gibi',
  VERY_GOOD: 'Cok Iyi',
  GOOD: 'Iyi',
  ACCEPTABLE: 'Kabul Edilebilir',
};

function formatPrice(price: EbayListingRow['price']): string {
  if (!price) return '\u2014';
  const symbols: Record<string, string> = { USD: '$', GBP: '\u00a3', EUR: '\u20ac', TRY: '\u20ba' };
  const val = parseFloat(price.value || '0');
  return `${symbols[price.currency] || price.currency + ' '}${val.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Health Score
// ---------------------------------------------------------------------------

interface HealthBreakdown {
  title: { score: number; color: string; label: string };
  description: { score: number; color: string; label: string };
  images: { score: number; color: string; label: string };
  aspects: { score: number; color: string; label: string };
  overall: number;
  color: string;
}

function calculateHealth(listing: EbayListingRow): HealthBreakdown {
  // Title: 80+ chars = green(25), 60-79 = yellow(15), <60 = red(5)
  const titleLen = listing.title?.length || 0;
  const titleScore = titleLen >= 80 ? 25 : titleLen >= 60 ? 15 : 5;
  const titleColor = titleLen >= 80 ? '#4caf50' : titleLen >= 60 ? '#ff9800' : '#f44336';
  const titleLabel = `${titleLen} karakter baslik`;

  // Description: 500+ chars = green(25), 200-499 = yellow(15), <200 = red(5)
  const descLen = listing.description?.length || 0;
  const descScore = descLen >= 500 ? 25 : descLen >= 200 ? 15 : 5;
  const descColor = descLen >= 500 ? '#4caf50' : descLen >= 200 ? '#ff9800' : '#f44336';
  const descLabel = `${descLen} karakter aciklama`;

  // Images: 12+ = green(25), 5-11 = yellow(15), <5 = red(5)
  const imgCount = listing.imageCount || 0;
  const imagesScore = imgCount >= 12 ? 25 : imgCount >= 5 ? 15 : 5;
  const imagesColor = imgCount >= 12 ? '#4caf50' : imgCount >= 5 ? '#ff9800' : '#f44336';
  const imagesLabel = `${imgCount} gorsel`;

  // Aspects (Item Specifics): 5+ = green(25), 3-4 = yellow(15), <3 = red(5)
  const aspectCount = Object.keys(listing.aspects || {}).length;
  const aspectsScore = aspectCount >= 5 ? 25 : aspectCount >= 3 ? 15 : 5;
  const aspectsColor = aspectCount >= 5 ? '#4caf50' : aspectCount >= 3 ? '#ff9800' : '#f44336';
  const aspectsLabel = `${aspectCount} item specific`;

  const overall = titleScore + descScore + imagesScore + aspectsScore;
  const color = overall >= 80 ? '#4caf50' : overall >= 60 ? '#ff9800' : '#f44336';

  return {
    title: { score: titleScore, color: titleColor, label: titleLabel },
    description: { score: descScore, color: descColor, label: descLabel },
    images: { score: imagesScore, color: imagesColor, label: imagesLabel },
    aspects: { score: aspectsScore, color: aspectsColor, label: aspectsLabel },
    overall,
    color,
  };
}

// ---------------------------------------------------------------------------
// Mobile Card Component
// ---------------------------------------------------------------------------

function MobileListingCard({
  listing,
  onEdit,
  onDelete,
}: {
  listing: EbayListingRow;
  onEdit: (sku: string) => void;
  onDelete: (listing: EbayListingRow) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const health = calculateHealth(listing);
  const isPublished = listing.status === 'PUBLISHED';

  return (
    <Paper sx={{ mb: 1.5, overflow: 'hidden', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
      <Box
        sx={{
          display: 'flex',
          gap: 1.5,
          p: 1.5,
          cursor: 'pointer',
          alignItems: 'center',
          overflow: 'hidden',
          maxWidth: '100%',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Thumbnail */}
        {listing.imageUrl ? (
          <Box
            component="img"
            src={listing.imageUrl}
            alt=""
            sx={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }}
          />
        ) : (
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: 1,
              backgroundColor: '#e0e0e0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Typography variant="caption" color="text.disabled">N/A</Typography>
          </Box>
        )}

        {/* Main info */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            variant="body2"
            sx={{
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {listing.title}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5 }}>
            <Typography variant="body2" fontWeight={600}>
              {formatPrice(listing.price)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Stok: {listing.quantity}
            </Typography>
            <Chip
              label={isPublished ? 'Yayinda' : 'Taslak'}
              size="small"
              color={isPublished ? 'success' : 'warning'}
              variant="outlined"
              sx={{ height: 20, fontSize: 11 }}
            />
          </Box>
        </Box>

        {/* Expand icon */}
        <IconButton size="small" sx={{ flexShrink: 0 }}>
          {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        </IconButton>
      </Box>

      <Collapse in={expanded}>
        <Box sx={{ px: 1.5, pb: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
            <Box sx={{ flex: '1 1 45%' }}>
              <Typography variant="caption" color="text.secondary">SKU</Typography>
              <Typography variant="body2">{listing.sku || '\u2014'}</Typography>
            </Box>
            <Box sx={{ flex: '1 1 45%' }}>
              <Typography variant="caption" color="text.secondary">Durum</Typography>
              <Typography variant="body2">
                {CONDITION_LABELS[listing.condition] || listing.condition}
              </Typography>
            </Box>
            <Box sx={{ flex: '1 1 45%' }}>
              <Typography variant="caption" color="text.secondary">Gorseller</Typography>
              <Typography variant="body2">{listing.imageCount}/24</Typography>
            </Box>
            <Box sx={{ flex: '1 1 45%' }}>
              <Typography variant="caption" color="text.secondary">Saglik Skoru</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box
                  sx={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    border: `2px solid ${health.color}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 700, fontSize: 10, color: health.color }}>
                    {health.overall}
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">/ 100</Typography>
              </Box>
            </Box>
          </Box>

          {/* Health breakdown */}
          <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {[health.title, health.description, health.images, health.aspects].map((item, i) => (
              <Chip
                key={i}
                label={item.label}
                size="small"
                sx={{
                  height: 20,
                  fontSize: 10,
                  bgcolor: `${item.color}15`,
                  color: item.color,
                  borderColor: item.color,
                }}
                variant="outlined"
              />
            ))}
          </Box>

          {/* Actions */}
          <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<EditIcon />}
              onClick={(e) => { e.stopPropagation(); onEdit(listing.sku); }}
              sx={{ flex: 1 }}
            >
              Duzenle
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={(e) => { e.stopPropagation(); onDelete(listing); }}
              sx={{ flex: 1 }}
            >
              Sil
            </Button>
          </Box>

          {listing.listingUrl && (
            <Button
              size="small"
              variant="text"
              href={listing.listingUrl}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ mt: 0.5, fontSize: 11 }}
            >
              eBay&apos;de Gor
            </Button>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

function EbayListingsPage() {
  const { user } = useAuth();
  const userId = (user as any)?.id;

  // --- State ---
  const [listings, setListings] = useState<EbayListingRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [selectedIds, setSelectedIds] = useState<GridRowSelectionModel>({
    type: 'include' as const,
    ids: new Set<GridRowId>(),
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [healthFilter, setHealthFilter] = useState<string>('');
  const [conditionFilter, setConditionFilter] = useState<string>('all');

  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({
    page: 0,
    pageSize: 25,
  });

  // Metadata
  const [fulfillmentPolicies, setFulfillmentPolicies] = useState<any[]>([]);
  const [returnPolicies, setReturnPolicies] = useState<any[]>([]);
  const [paymentPolicies, setPaymentPolicies] = useState<any[]>([]);

  // Dialogs
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSku, setEditorSku] = useState('');
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<EbayListingRow | null>(null);
  const [smartPricingOpen, setSmartPricingOpen] = useState(false);
  const [duplicateDetectorOpen, setDuplicateDetectorOpen] = useState(false);
  const [backupManagerOpen, setBackupManagerOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [scheduledOpen, setScheduledOpen] = useState(false);

  // CSV Import state
  const [csvImportDialogOpen, setCsvImportDialogOpen] = useState(false);
  const [csvImportRows, setCsvImportRows] = useState<Record<string, string>[]>([]);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvImportProgress, setCsvImportProgress] = useState(0);

  // AI state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResults, setAiResults] = useState<any>(null);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiDialogMode, setAiDialogMode] = useState<'titles' | 'analyze'>('titles');
  const [appliedTitles, setAppliedTitles] = useState<Map<string, string>>(new Map()); // id -> original title

  // Mobile detection
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  // Scheduled updates count (placeholder - would come from API)
  const [scheduledCount, setScheduledCount] = useState(0);

  // Mobile "More" menu anchor
  const [moreMenuAnchor, setMoreMenuAnchor] = useState<null | HTMLElement>(null);

  // --- Fetch listings ---
  const fetchListings = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      // Fetch both Inventory API offers AND legacy listings in parallel
      const [inventoryRes, legacyRes] = await Promise.all([
        fetch(`/api/clawd/ebay?action=listings&user_id=${userId}&marketplace_id=EBAY_US`).catch((e) => {
          console.error('Inventory fetch failed:', e);
          return null;
        }),
        fetch(`/api/clawd/ebay?action=my_legacy_listings&user_id=${userId}&marketplace_id=EBAY_US`).catch((e) => {
          console.error('Legacy listings fetch failed:', e);
          return null;
        }),
      ]);

      // Debug: log response statuses
      console.log('Inventory response:', inventoryRes?.status, inventoryRes?.ok);
      console.log('Legacy response:', legacyRes?.status, legacyRes?.ok);

      const rows: EbayListingRow[] = [];
      const seenIds = new Set<string>();

      // Process Inventory API offers
      if (inventoryRes?.ok) {
        const data = await inventoryRes.json();
        for (const l of data.offers || []) {
          const id = l.offerId || l.sku || String(l.listingId);
          if (seenIds.has(id)) continue;
          seenIds.add(id);
          rows.push({
            id,
            sku: l.sku || '',
            offerId: l.offerId,
            listingId: l.listingId,
            title: l.title || l.sku || '',
            description: l.description || '',
            price: l.price || { value: '0', currency: 'USD' },
            quantity: l.quantity ?? 0,
            status: l.status || 'UNPUBLISHED',
            condition: l.condition || 'NEW',
            categoryId: l.categoryId || '',
            categoryName: l.categoryName,
            imageUrl: l.imageUrl,
            imageCount: l.imageCount ?? 0,
            aspects: l.aspects || {},
            format: l.format || 'FIXED_PRICE',
            marketplaceId: l.marketplaceId || 'EBAY_US',
            listingUrl: l.listingUrl,
            createdAt: l.createdAt,
            updatedAt: l.updatedAt,
          });
        }
      }

      // Process legacy listings (from Analytics + Orders + Browse API)
      if (legacyRes?.ok) {
        const legacyData = await legacyRes.json();
        for (const l of legacyData.listings || []) {
          const id = l.legacyItemId || l.itemId;
          if (!id || seenIds.has(id)) continue;
          seenIds.add(id);

          // Convert localizedAspects to aspects map
          const aspects: Record<string, string[]> = {};
          for (const a of l.localizedAspects || []) {
            if (a.name && a.value) {
              aspects[a.name] = [a.value];
            }
          }

          rows.push({
            id,
            sku: l.legacyItemId || '',
            offerId: undefined,
            listingId: l.legacyItemId,
            title: l.title || '',
            description: l.description || l.shortDescription || '',
            price: l.price || { value: '0', currency: 'USD' },
            quantity: (l.estimatedRemainingQuantity ?? 0) + (l.estimatedSoldQuantity ?? 0),
            status: l.itemWebUrl ? 'PUBLISHED' : 'ENDED',
            condition: l.condition || 'NEW',
            categoryId: l.categoryId || '',
            categoryName: l.categoryPath?.split('|').pop()?.trim(),
            imageUrl: l.image?.imageUrl,
            imageCount: (l.additionalImages?.length || 0) + (l.image ? 1 : 0),
            aspects,
            format: l.buyingOptions?.includes('AUCTION') ? 'AUCTION' : 'FIXED_PRICE',
            marketplaceId: l.listingMarketplaceId || 'EBAY_US',
            listingUrl: l.itemWebUrl || (l.legacyItemId ? `https://www.ebay.com/itm/${l.legacyItemId}` : undefined),
            createdAt: l.itemCreationDate,
          });
        }
      }

      if (rows.length === 0 && !inventoryRes?.ok && !legacyRes?.ok) {
        const errData = inventoryRes ? await inventoryRes.json().catch(() => ({})) : {};
        throw new Error(errData.error || 'Listeleme yuklenemedi');
      }

      setListings(rows);
    } catch (err: any) {
      console.error('Failed to fetch eBay listings:', err);
      toast.error(`Listelemeler yuklenemedi: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // --- AI Apply / Undo handlers ---
  const handleApplyAITitle = async (listingId: string, newTitle: string, originalTitle: string) => {
    try {
      const listing = listings.find(l => l.id === listingId);
      if (!listing) return;

      const res = await fetch(`/api/clawd/ebay?action=update_listing&user_id=${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: listing.sku, offerId: listing.offerId, title: newTitle }),
      });
      if (!res.ok) throw new Error('Güncelleme başarısız');

      setAppliedTitles(prev => new Map(prev).set(listingId, originalTitle));
      toast.success('Başlık güncellendi');
      fetchListings();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleUndoAITitle = async (listingId: string) => {
    const originalTitle = appliedTitles.get(listingId);
    if (!originalTitle) return;

    const listing = listings.find(l => l.id === listingId);
    if (!listing) return;

    try {
      const res = await fetch(`/api/clawd/ebay?action=update_listing&user_id=${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: listing.sku, offerId: listing.offerId, title: originalTitle }),
      });
      if (!res.ok) throw new Error('Geri alma başarısız');

      setAppliedTitles(prev => { const m = new Map(prev); m.delete(listingId); return m; });
      toast.success('Başlık geri alındı');
      fetchListings();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // --- Fetch policies ---
  const fetchPolicies = useCallback(async () => {
    if (!userId) return;
    try {
      const [fulfillmentRes, returnRes, paymentRes] = await Promise.all([
        fetch(`/api/clawd/ebay?action=fulfillment_policies&user_id=${userId}`),
        fetch(`/api/clawd/ebay?action=return_policies&user_id=${userId}`),
        fetch(`/api/clawd/ebay?action=payment_policies&user_id=${userId}`),
      ]);

      if (fulfillmentRes.ok) {
        const d = await fulfillmentRes.json();
        setFulfillmentPolicies(d.fulfillmentPolicies || d.results || []);
      }
      if (returnRes.ok) {
        const d = await returnRes.json();
        setReturnPolicies(d.returnPolicies || d.results || []);
      }
      if (paymentRes.ok) {
        const d = await paymentRes.json();
        setPaymentPolicies(d.paymentPolicies || d.results || []);
      }
    } catch (err) {
      console.error('Failed to fetch eBay policies:', err);
    }
  }, [userId]);

  useEffect(() => {
    if (userId) {
      fetchListings();
      fetchPolicies();
    }
  }, [userId, fetchListings, fetchPolicies]);

  // --- Client-side filtering ---
  const filteredListings = useMemo(() => {
    return listings.filter((l) => {
      if (searchTerm && !l.title.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (statusFilter !== 'all' && l.status !== statusFilter) return false;
      if (conditionFilter !== 'all' && l.condition !== conditionFilter) return false;
      if (healthFilter) {
        const h = calculateHealth(l);
        switch (healthFilter) {
          case 'issues': return h.overall < 70;
          case 'missing_images': return l.imageCount < 5;
          case 'short_title': return (l.title?.length || 0) < 60;
          case 'no_description': return (l.description?.length || 0) < 200;
          case 'few_aspects': return Object.keys(l.aspects || {}).length < 3;
          case 'no_stock': return l.quantity === 0;
          default: break;
        }
      }
      return true;
    });
  }, [listings, searchTerm, statusFilter, conditionFilter, healthFilter]);

  // --- Statistics ---
  const totalCount = listings.length;
  const publishedCount = useMemo(
    () => listings.filter((l) => l.status === 'PUBLISHED').length,
    [listings]
  );
  const unpublishedCount = useMemo(
    () => listings.filter((l) => l.status !== 'PUBLISHED').length,
    [listings]
  );
  const outOfStock = useMemo(
    () => listings.filter((l) => l.quantity === 0).length,
    [listings]
  );
  const needsAttention = useMemo(
    () => listings.filter((l) => calculateHealth(l).overall < 70).length,
    [listings]
  );

  // --- Delete listing ---
  const handleDeleteListing = useCallback(
    async (row: EbayListingRow) => {
      try {
        const res = await fetch(
          `/api/clawd/ebay?action=delete_listing&user_id=${userId}&sku=${encodeURIComponent(row.sku)}`,
          { method: 'DELETE' }
        );
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }
        toast.success('Listeleme silindi');
        setDeleteConfirm(null);
        fetchListings();
      } catch (err: any) {
        toast.error(`Silinemedi: ${err.message}`);
      }
    },
    [userId, fetchListings]
  );

  // --- CSV Export ---
  const handleExportCSV = () => {
    if (filteredListings.length === 0) {
      toast.error('Disa aktarilacak listeleme yok');
      return;
    }
    const rows = filteredListings.map((l) => ({
      sku: l.sku,
      title: l.title,
      description: l.description.substring(0, 200),
      price: parseFloat(l.price?.value || '0').toFixed(2),
      currency: l.price?.currency || '',
      quantity: l.quantity,
      condition: l.condition,
      status: l.status,
      listing_url: l.listingUrl || '',
    }));
    const headers = Object.keys(rows[0] || {}).join(',');
    const csv = [
      headers,
      ...rows.map((r) =>
        Object.values(r)
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(',')
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ebay-listings-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- CSV Import ---
  const parseCSV = (text: string): Record<string, string>[] => {
    const lines = text.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length < 2) return [];

    const parseCSVLine = (line: string): string[] => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"' && line[i + 1] === '"') {
            current += '"';
            i++;
          } else if (ch === '"') {
            inQuotes = false;
          } else {
            current += ch;
          }
        } else {
          if (ch === '"') {
            inQuotes = true;
          } else if (ch === ',') {
            result.push(current);
            current = '';
          } else {
            current += ch;
          }
        }
      }
      result.push(current);
      return result;
    };

    const headers = parseCSVLine(lines[0]);
    const rows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h.trim()] = (values[idx] || '').trim();
      });
      rows.push(row);
    }
    return rows;
  };

  const handleCSVFileSelect = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        const rows = parseCSV(text);
        if (rows.length === 0) {
          toast.error('CSV dosyasi bos veya gecersiz format');
          return;
        }
        const validRows = rows.filter((r) => r.sku && r.sku.trim() !== '');
        if (validRows.length === 0) {
          toast.error('CSV dosyasinda sku sutunu bulunamadi');
          return;
        }
        setCsvImportRows(validRows);
        setCsvImportDialogOpen(true);
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleCSVImportConfirm = async () => {
    setCsvImporting(true);
    setCsvImportProgress(0);

    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < csvImportRows.length; i++) {
      const row = csvImportRows[i];
      const sku = row.sku?.trim();
      if (!sku) {
        failed++;
        setCsvImportProgress(((i + 1) / csvImportRows.length) * 100);
        continue;
      }

      try {
        // Step 1: Create inventory item
        const itemBody: Record<string, any> = {
          product: {
            title: row.title || sku,
            description: row.description || '',
          },
          condition: row.condition || 'NEW',
          availability: {
            shipToLocationAvailability: {
              quantity: parseInt(row.quantity, 10) || 0,
            },
          },
        };

        const itemRes = await fetch(
          `/api/clawd/ebay?action=create_inventory_item&sku=${encodeURIComponent(sku)}&user_id=${userId}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(itemBody),
          }
        );

        if (!itemRes.ok) {
          failed++;
          setCsvImportProgress(((i + 1) / csvImportRows.length) * 100);
          continue;
        }

        // Step 2: Create offer
        if (row.price) {
          const offerBody: Record<string, any> = {
            sku,
            marketplaceId: 'EBAY_US',
            format: 'FIXED_PRICE',
            pricingSummary: {
              price: {
                value: parseFloat(row.price).toFixed(2),
                currency: 'USD',
              },
            },
          };

          await fetch(
            `/api/clawd/ebay?action=create_offer&user_id=${userId}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(offerBody),
            }
          );
        }

        succeeded++;
      } catch {
        failed++;
      }

      setCsvImportProgress(((i + 1) / csvImportRows.length) * 100);

      if (i < csvImportRows.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }

    setCsvImporting(false);
    setCsvImportProgress(0);
    setCsvImportDialogOpen(false);
    setCsvImportRows([]);

    if (failed === 0) {
      toast.success(`CSV import tamamlandi: ${succeeded} listeleme olusturuldu`);
    } else {
      toast.error(`CSV import: ${succeeded} basarili, ${failed} basarisiz`);
    }

    fetchListings();
  };

  // --- Fetch market research for AI context ---
  const fetchMarketResearch = async (query: string): Promise<Record<string, unknown> | null> => {
    try {
      const params = new URLSearchParams({ action: 'niche_analyze', q: query, marketplace_id: 'EBAY_US' });
      if (userId) params.set('user_id', userId);
      const res = await fetch(`/api/clawd/ebay-research?${params}`, { credentials: 'same-origin' });
      if (!res.ok) return null;
      const data = await res.json();
      return {
        avgPrice: data.avgPrice,
        medianPrice: data.medianPrice,
        priceRange: data.priceSpread,
        totalResults: data.totalResults,
        demandScore: data.demandScore,
        competitionScore: data.competitionScore,
        topSellers: data.topSellers,
        topProducts: data.topProducts,
        freeShippingPct: data.freeShippingPct,
        conditionBreakdown: data.conditionBreakdown,
      };
    } catch {
      return null;
    }
  };

  // --- AI handlers ---
  const handleAIBulkOptimize = async () => {
    if (filteredListings.length === 0) {
      toast.error('Optimize edilecek listeleme yok');
      return;
    }
    setAiDialogMode('titles');
    setAiDialogOpen(true);
    setAiLoading(true);
    try {
      const batch = filteredListings.slice(0, 10).map(l => ({
        id: l.id,
        title: l.title,
        categoryName: l.categoryName || '',
      }));
      // Fetch market research using first listing's category or title
      const searchQuery = batch[0]?.categoryName || batch[0]?.title?.split(' ').slice(0, 3).join(' ') || '';
      const marketResearch = searchQuery ? await fetchMarketResearch(searchQuery) : null;
      const res = await fetch('/api/clawd/ebay-ai?action=bulk_optimize_titles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listings: batch, ...(marketResearch ? { marketResearch } : {}) }),
      });
      if (!res.ok) throw new Error('AI servisi yanit vermedi');
      const data = await res.json();
      setAiResults(data.results || []);
    } catch (err: any) {
      toast.error(`AI hatasi: ${err.message}`);
      setAiDialogOpen(false);
    } finally {
      setAiLoading(false);
    }
  };

  const handleAIAnalyze = async () => {
    if (filteredListings.length === 0) {
      toast.error('Analiz edilecek listeleme yok');
      return;
    }
    setAiDialogMode('analyze');
    setAiDialogOpen(true);
    setAiLoading(true);
    try {
      const l = filteredListings[0];
      // Fetch market research for competitive analysis
      const searchQuery = l.categoryName || l.title?.split(' ').slice(0, 3).join(' ') || '';
      const marketResearch = searchQuery ? await fetchMarketResearch(searchQuery) : null;
      const res = await fetch('/api/clawd/ebay-ai?action=analyze_listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: l.title,
          description: l.description,
          price: parseFloat(l.price?.value || '0'),
          imageCount: l.imageCount,
          aspects: l.aspects,
          categoryName: l.categoryName,
          ...(marketResearch ? { marketResearch } : {}),
        }),
      });
      if (!res.ok) throw new Error('AI servisi yanit vermedi');
      const data = await res.json();
      setAiResults(data);
    } catch (err: any) {
      toast.error(`AI hatasi: ${err.message}`);
      setAiDialogOpen(false);
    } finally {
      setAiLoading(false);
    }
  };

  // --- Open editor ---
  const handleOpenEditor = (sku: string) => {
    setEditorSku(sku);
    setEditorOpen(true);
  };

  // --- DataGrid Columns ---
  const columns: GridColDef[] = useMemo(
    () => [
      {
        field: 'image',
        headerName: '',
        width: 60,
        sortable: false,
        filterable: false,
        renderCell: (params: GridRenderCellParams<EbayListingRow>) => {
          return params.row.imageUrl ? (
            <Box
              component="img"
              src={params.row.imageUrl}
              alt=""
              sx={{ width: 45, height: 45, objectFit: 'cover', borderRadius: 1 }}
            />
          ) : (
            <Box
              sx={{
                width: 45,
                height: 45,
                borderRadius: 1,
                backgroundColor: '#e0e0e0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Typography variant="caption" color="text.disabled">
                N/A
              </Typography>
            </Box>
          );
        },
      },
      {
        field: 'title',
        headerName: 'Baslik',
        flex: 1,
        minWidth: 250,
        renderCell: (params: GridRenderCellParams<EbayListingRow>) => (
          <Tooltip title={params.row.title} arrow>
            <Typography
              variant="body2"
              sx={{
                cursor: 'pointer',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                '&:hover': { color: 'primary.main', textDecoration: 'underline' },
              }}
              onClick={() => handleOpenEditor(params.row.sku)}
            >
              {params.row.title}
            </Typography>
          </Tooltip>
        ),
      },
      {
        field: 'sku',
        headerName: 'SKU',
        width: 120,
      },
      {
        field: 'price',
        headerName: 'Fiyat',
        width: 100,
        renderCell: (params: GridRenderCellParams<EbayListingRow>) => (
          <Typography variant="body2">{formatPrice(params.row.price)}</Typography>
        ),
        sortComparator: (v1: any, v2: any, p1: any, p2: any) => {
          const a = p1.api.getRow(p1.id)?.price;
          const b = p2.api.getRow(p2.id)?.price;
          const av = parseFloat(a?.value || '0');
          const bv = parseFloat(b?.value || '0');
          return av - bv;
        },
      },
      {
        field: 'quantity',
        headerName: 'Stok',
        width: 80,
        renderCell: (params: GridRenderCellParams<EbayListingRow>) => {
          const qty = params.row.quantity;
          const color = qty === 0 ? 'error' : qty < 5 ? 'warning' : 'success';
          return (
            <Typography
              variant="body2"
              sx={{
                color: `${color}.main`,
                fontWeight: 600,
              }}
            >
              {qty}
            </Typography>
          );
        },
      },
      {
        field: 'condition',
        headerName: 'Durum',
        width: 100,
        renderCell: (params: GridRenderCellParams<EbayListingRow>) => (
          <Chip
            label={CONDITION_LABELS[params.row.condition] || params.row.condition}
            size="small"
          />
        ),
      },
      {
        field: 'seo',
        headerName: 'SEO',
        width: 50,
        sortable: false,
        filterable: false,
        renderCell: (params: GridRenderCellParams<EbayListingRow>) => (
          <SEOIndicator
            title={params.row.title || ''}
            description={params.row.description || ''}
            aspects={params.row.aspects || {}}
            imageCount={params.row.imageCount}
            compact
          />
        ),
      },
      {
        field: 'health',
        headerName: 'Saglik',
        width: 70,
        sortable: true,
        filterable: false,
        renderCell: (params: GridRenderCellParams<EbayListingRow>) => {
          const h = calculateHealth(params.row);
          return (
            <Tooltip
              arrow
              title={
                <Box sx={{ fontSize: 12 }}>
                  <Box sx={{ fontWeight: 700, mb: 0.5 }}>Saglik Skoru: {h.overall}/100</Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: h.title.color }} />
                    {h.title.label}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: h.description.color }} />
                    {h.description.label}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: h.images.color }} />
                    {h.images.label}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: h.aspects.color }} />
                    {h.aspects.label}
                  </Box>
                </Box>
              }
            >
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  border: `3px solid ${h.color}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <Typography variant="caption" sx={{ fontWeight: 700, fontSize: 11, color: h.color }}>
                  {h.overall}
                </Typography>
              </Box>
            </Tooltip>
          );
        },
        sortComparator: (v1: any, v2: any, p1: any, p2: any) => {
          const a = calculateHealth(p1.api.getRow(p1.id) as EbayListingRow);
          const b = calculateHealth(p2.api.getRow(p2.id) as EbayListingRow);
          return a.overall - b.overall;
        },
      },
      {
        field: 'imageCount',
        headerName: 'Gorsel',
        width: 70,
        renderCell: (params: GridRenderCellParams<EbayListingRow>) =>
          `${params.row.imageCount}/24`,
      },
      {
        field: 'status',
        headerName: 'Yayin',
        width: 100,
        renderCell: (params: GridRenderCellParams<EbayListingRow>) => {
          const isPublished = params.row.status === 'PUBLISHED';
          return (
            <Chip
              label={isPublished ? 'Yayinda' : 'Taslak'}
              size="small"
              color={isPublished ? 'success' : 'warning'}
              variant="outlined"
            />
          );
        },
      },
      {
        field: 'actions',
        headerName: '',
        width: 100,
        sortable: false,
        filterable: false,
        renderCell: (params: GridRenderCellParams<EbayListingRow>) => (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <IconButton
              size="small"
              onClick={() => handleOpenEditor(params.row.sku)}
            >
              <EditIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              color="error"
              onClick={() => setDeleteConfirm(params.row)}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        ),
      },
    ],
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // --- Column visibility for mobile ---
  const [columnVisibilityModel, setColumnVisibilityModel] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const handleResize = () => {
      const isSmall = window.innerWidth < 768;
      setColumnVisibilityModel(
        isSmall
          ? {
              sku: false,
              condition: false,
              seo: false,
              health: false,
              imageCount: false,
            }
          : {}
      );
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- Paginated listings for mobile ---
  const paginatedMobileListings = useMemo(() => {
    const start = paginationModel.page * paginationModel.pageSize;
    return filteredListings.slice(start, start + paginationModel.pageSize);
  }, [filteredListings, paginationModel]);

  return (
    <Box sx={{ p: { xs: 1, sm: 2, md: 3 }, maxWidth: 1600, mx: 'auto', width: '100%', overflow: 'hidden', boxSizing: 'border-box' }}>
      <Toaster position="top-right" />

      {/* Statistics Bar */}
      <Box sx={{ display: 'flex', gap: { xs: 1, sm: 2 }, mb: 2, flexWrap: 'wrap', overflow: 'hidden', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
        <Paper sx={{ p: 1.5, flex: 1, minWidth: { xs: '45%', sm: 120 } }}>
          <Typography variant="caption" color="text.secondary">
            Toplam Listeleme
          </Typography>
          <Typography variant="h6" fontWeight={700}>
            {totalCount}
          </Typography>
        </Paper>
        <Paper sx={{ p: 1.5, flex: 1, minWidth: { xs: '45%', sm: 120 } }}>
          <Typography variant="caption" color="text.secondary">
            Yayinda
          </Typography>
          <Typography variant="h6" fontWeight={700} color="success.main">
            {publishedCount}
          </Typography>
        </Paper>
        <Paper sx={{ p: 1.5, flex: 1, minWidth: { xs: '45%', sm: 120 } }}>
          <Typography variant="caption" color="text.secondary">
            Taslak
          </Typography>
          <Typography variant="h6" fontWeight={700} color="warning.main">
            {unpublishedCount}
          </Typography>
        </Paper>
        <Paper sx={{ p: 1.5, flex: 1, minWidth: { xs: '45%', sm: 120 } }}>
          <Typography variant="caption" color="text.secondary">
            Stok Biten
          </Typography>
          <Typography variant="h6" fontWeight={700} color="error">
            {outOfStock}
          </Typography>
        </Paper>
        <Paper sx={{ p: 1.5, flex: 1, minWidth: { xs: '45%', sm: 120 }, borderLeft: '3px solid #ff9800' }}>
          <Typography variant="caption" color="text.secondary">
            Sorunlu
          </Typography>
          <Typography variant="h6" fontWeight={700} sx={{ color: '#ff9800' }}>
            {needsAttention}
          </Typography>
        </Paper>
      </Box>

      {/* Listings */}
      <>

      {/* Toolbar Row 1: Search & Filters */}
      <Paper sx={{ p: 1.5, mb: 1, overflow: 'hidden', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', width: '100%', maxWidth: '100%' }}>
          {/* Search */}
          <TextField
            size="small"
            placeholder="Listeleme ara..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            sx={{ minWidth: { xs: '100%', sm: 200 }, flex: 1 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />

          {/* Status filter */}
          <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 120 } }}>
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <MenuItem value="all">Tumu</MenuItem>
              <MenuItem value="PUBLISHED">Yayinda</MenuItem>
              <MenuItem value="UNPUBLISHED">Taslak</MenuItem>
            </Select>
          </FormControl>

          {/* Condition filter */}
          <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 120 } }}>
            <Select
              value={conditionFilter}
              onChange={(e) => setConditionFilter(e.target.value)}
            >
              <MenuItem value="all">Tum Durumlar</MenuItem>
              <MenuItem value="NEW">Yeni</MenuItem>
              <MenuItem value="LIKE_NEW">Yeni Gibi</MenuItem>
              <MenuItem value="VERY_GOOD">Cok Iyi</MenuItem>
              <MenuItem value="GOOD">Iyi</MenuItem>
              <MenuItem value="ACCEPTABLE">Kabul Edilebilir</MenuItem>
            </Select>
          </FormControl>

          {/* Health filter */}
          <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 130 } }}>
            <Select
              value={healthFilter}
              onChange={(e) => setHealthFilter(e.target.value)}
              displayEmpty
            >
              <MenuItem value="">Tum Saglik</MenuItem>
              <MenuItem value="issues">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <ErrorOutlineIcon sx={{ fontSize: 16, color: '#ff9800' }} />
                  Sorunlu (&lt;70)
                </Box>
              </MenuItem>
              <MenuItem value="missing_images">Gorsel Eksik (&lt;5)</MenuItem>
              <MenuItem value="short_title">Kisa Baslik (&lt;60)</MenuItem>
              <MenuItem value="no_description">Aciklama Yok (&lt;200)</MenuItem>
              <MenuItem value="few_aspects">Az Item Specific (&lt;3)</MenuItem>
              <MenuItem value="no_stock">Stok Yok</MenuItem>
            </Select>
          </FormControl>

          <IconButton size="small" onClick={fetchListings} disabled={loading} sx={{ minWidth: 44, minHeight: 44 }}>
            <RefreshIcon />
          </IconButton>
        </Box>
      </Paper>

      {/* Toolbar Row 2: Actions */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2, alignItems: 'center', overflow: 'hidden', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
        {/* Primary action */}
        <Button variant="contained" size="small" color="success" onClick={() => setCreatorOpen(true)} sx={{ whiteSpace: 'nowrap', minWidth: 'auto', flexShrink: 0 }}>
          + Yeni Listeleme
        </Button>

        {/* CSV Download — always visible */}
        <Button variant="outlined" size="small" startIcon={<DownloadIcon />} onClick={handleExportCSV} sx={{ whiteSpace: 'nowrap', minWidth: 'auto', flexShrink: 0 }}>
          CSV İndir
        </Button>

        {/* Tools dropdown — shared by mobile & desktop */}
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          <Button
            variant="outlined"
            size="small"
            onClick={(e) => setMoreMenuAnchor(e.currentTarget)}
            startIcon={<BuildIcon />}
            endIcon={<ExpandMoreIcon />}
            sx={{ whiteSpace: 'nowrap', minWidth: 'auto', flexShrink: 0 }}
          >
            Araçlar
          </Button>
        </Box>

        <Menu
          anchorEl={moreMenuAnchor}
          open={Boolean(moreMenuAnchor)}
          onClose={() => setMoreMenuAnchor(null)}
          slotProps={{ paper: { sx: { minWidth: 320 } } }}
        >
          <ListSubheader sx={{ lineHeight: '32px', fontSize: 12, fontWeight: 700, color: 'primary.main' }}>
            🤖 AI Asistan
          </ListSubheader>
          <MenuItem onClick={() => { setMoreMenuAnchor(null); handleAIBulkOptimize(); }}>
            <ListItemIcon><AutoFixHighIcon fontSize="small" /></ListItemIcon>
            <ListItemText
              primary="Başlıkları Optimize Et"
              secondary="AI ile tüm başlıklarını eBay SEO'ya uygun hale getir"
            />
          </MenuItem>
          <MenuItem onClick={() => { setMoreMenuAnchor(null); handleAIAnalyze(); }}>
            <ListItemIcon><PsychologyIcon fontSize="small" /></ListItemIcon>
            <ListItemText
              primary="Listeleri Analiz Et"
              secondary="AI en çok satış getirecek iyileştirmeleri önersin"
            />
          </MenuItem>
          <Divider />
          <ListSubheader sx={{ lineHeight: '32px', fontWeight: 700 }}>Düzenleme Araçları</ListSubheader>
          <MenuItem onClick={() => { setMoreMenuAnchor(null); setFindReplaceOpen(true); }}>
            <ListItemIcon><FindReplaceIcon fontSize="small" /></ListItemIcon>
            <ListItemText
              primary="Bul & Değiştir"
              secondary="Birden fazla listede aynı anda değişiklik yap"
            />
          </MenuItem>
          <MenuItem onClick={() => { setMoreMenuAnchor(null); setDuplicateDetectorOpen(true); }}>
            <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>
            <ListItemText
              primary="Tekrar Tespit"
              secondary="Benzer veya kopya listeleri bul"
            />
          </MenuItem>

          <ListSubheader sx={{ lineHeight: '32px', fontWeight: 700 }}>Fiyat & Şablon</ListSubheader>
          <MenuItem onClick={() => { setMoreMenuAnchor(null); setSmartPricingOpen(true); }}>
            <ListItemIcon><AttachMoneyIcon fontSize="small" /></ListItemIcon>
            <ListItemText
              primary="Akıllı Fiyatlandırma"
              secondary="Rakiplere göre fiyatını otomatik ayarla"
            />
          </MenuItem>
          <MenuItem onClick={() => { setMoreMenuAnchor(null); setTemplatesOpen(true); }}>
            <ListItemIcon><ViewListIcon fontSize="small" /></ListItemIcon>
            <ListItemText
              primary="Şablonlar"
              secondary="Hazır şablonlardan hızlıca liste oluştur"
            />
          </MenuItem>

          <ListSubheader sx={{ lineHeight: '32px', fontWeight: 700 }}>Veri</ListSubheader>
          <MenuItem onClick={() => { setMoreMenuAnchor(null); handleCSVFileSelect(); }}>
            <ListItemIcon><UploadFileIcon fontSize="small" /></ListItemIcon>
            <ListItemText
              primary="CSV İçeri Aktar"
              secondary="Excel/CSV dosyasından toplu liste yükle"
            />
          </MenuItem>

          <ListSubheader sx={{ lineHeight: '32px', fontWeight: 700 }}>Güvenlik</ListSubheader>
          <MenuItem onClick={() => { setMoreMenuAnchor(null); setBackupManagerOpen(true); }}>
            <ListItemIcon><BackupIcon fontSize="small" /></ListItemIcon>
            <ListItemText
              primary="Yedek Yönetimi"
              secondary="Yaptığın değişiklikleri geri al"
            />
          </MenuItem>
          <MenuItem onClick={() => { setMoreMenuAnchor(null); setScheduledOpen(true); }}>
            <ListItemIcon>
              <Badge badgeContent={scheduledCount} color="primary" sx={{ '& .MuiBadge-badge': { fontSize: 10 } }}>
                <ScheduleIcon fontSize="small" />
              </Badge>
            </ListItemIcon>
            <ListItemText
              primary={`Zamanlı Görevler${scheduledCount > 0 ? ` (${scheduledCount})` : ''}`}
              secondary="İleri tarihli otomatik güncellemeler"
            />
          </MenuItem>
        </Menu>
      </Box>

      {/* Mobile Card Layout */}
      {isMobile ? (
        <Box sx={{ overflow: 'hidden', width: '100%', maxWidth: '100%' }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : paginatedMobileListings.length === 0 ? (
            <Paper sx={{ p: 3, textAlign: 'center' }}>
              <Typography color="text.secondary">Listeleme bulunamadi</Typography>
            </Paper>
          ) : (
            <>
              {paginatedMobileListings.map((listing) => (
                <MobileListingCard
                  key={listing.id}
                  listing={listing}
                  onEdit={handleOpenEditor}
                  onDelete={setDeleteConfirm}
                />
              ))}

              {/* Mobile Pagination */}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2, px: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {filteredListings.length} listeleme, Sayfa {paginationModel.page + 1}/
                  {Math.max(1, Math.ceil(filteredListings.length / paginationModel.pageSize))}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={paginationModel.page === 0}
                    onClick={() => setPaginationModel(prev => ({ ...prev, page: prev.page - 1 }))}
                  >
                    Onceki
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={(paginationModel.page + 1) * paginationModel.pageSize >= filteredListings.length}
                    onClick={() => setPaginationModel(prev => ({ ...prev, page: prev.page + 1 }))}
                  >
                    Sonraki
                  </Button>
                </Box>
              </Box>
            </>
          )}
        </Box>
      ) : (
        /* Desktop DataGrid */
        <Paper sx={{ width: '100%' }}>
          <DataGrid
            rows={filteredListings}
            columns={columns}
            loading={loading}
            checkboxSelection
            disableRowSelectionOnClick
            rowHeight={60}
            rowSelectionModel={selectedIds}
            onRowSelectionModelChange={(newSelection) => setSelectedIds(newSelection)}
            paginationModel={paginationModel}
            onPaginationModelChange={setPaginationModel}
            pageSizeOptions={[25, 50, 100]}
            columnVisibilityModel={columnVisibilityModel}
            onColumnVisibilityModelChange={(model) => setColumnVisibilityModel(model)}
            getRowId={(row) => row.id}
            autoHeight
            sx={{
              border: 'none',
              '& .MuiDataGrid-cell': {
                display: 'flex',
                alignItems: 'center',
              },
              '& .MuiDataGrid-row:hover': {
                backgroundColor: 'action.hover',
              },
            }}
            slots={{
              noRowsOverlay: () => (
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    py: 4,
                  }}
                >
                  <Typography color="text.secondary">
                    Listeleme bulunamadi
                  </Typography>
                </Box>
              ),
              loadingOverlay: () => (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                  }}
                >
                  <CircularProgress />
                </Box>
              ),
            }}
          />
        </Paper>
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirm !== null && (
        <Box
          sx={{
            position: 'fixed',
            inset: 0,
            zIndex: 1300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'rgba(0,0,0,0.5)',
          }}
          onClick={() => setDeleteConfirm(null)}
        >
          <Paper
            sx={{ p: 3, maxWidth: 400, mx: 2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <Typography variant="h6" gutterBottom>
              Listeleme Sil
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              <strong>{deleteConfirm.title}</strong>
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Bu listelemeyi silmek istediginize emin misiniz? Bu islem geri alinamaz.
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
              <Button size="small" onClick={() => setDeleteConfirm(null)}>
                Iptal
              </Button>
              <Button
                size="small"
                variant="contained"
                color="error"
                onClick={() => handleDeleteListing(deleteConfirm)}
              >
                Sil
              </Button>
            </Box>
          </Paper>
        </Box>
      )}

      </>

      {/* Listing Editor Drawer */}
      <ListingEditorDrawer
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        sku={editorSku}
        userId={userId}
        fulfillmentPolicies={fulfillmentPolicies}
        returnPolicies={returnPolicies}
        paymentPolicies={paymentPolicies}
        onSaved={() => { setEditorOpen(false); fetchListings(); }}
      />

      {/* Listing Creator Dialog */}
      <ListingCreatorDialog
        open={creatorOpen}
        onClose={() => setCreatorOpen(false)}
        userId={userId}
        fulfillmentPolicies={fulfillmentPolicies}
        returnPolicies={returnPolicies}
        paymentPolicies={paymentPolicies}
        onCreated={() => { setCreatorOpen(false); fetchListings(); }}
      />

      {/* Find & Replace Dialog */}
      <FindReplaceDialog
        open={findReplaceOpen}
        onClose={() => setFindReplaceOpen(false)}
        listings={filteredListings}
        userId={userId}
        onCompleted={() => { setFindReplaceOpen(false); fetchListings(); }}
      />

      {/* Smart Pricing Dialog */}
      <Dialog
        open={smartPricingOpen}
        onClose={() => setSmartPricingOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Smart Fiyatlandirma
          <IconButton size="small" onClick={() => setSmartPricingOpen(false)}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <SmartPricing
            listings={filteredListings.map((l) => ({
              sku: l.sku,
              offerId: l.offerId,
              title: l.title,
              price: l.price,
              quantity: l.quantity,
            }))}
            userId={userId}
            onPriceUpdate={() => { setSmartPricingOpen(false); fetchListings(); }}
          />
        </DialogContent>
      </Dialog>

      {/* Duplicate Detector Dialog */}
      <Dialog
        open={duplicateDetectorOpen}
        onClose={() => setDuplicateDetectorOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Tekrar Tespit
          <IconButton size="small" onClick={() => setDuplicateDetectorOpen(false)}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <DuplicateDetector
            listings={filteredListings.map((l) => ({
              sku: l.sku,
              offerId: l.offerId,
              title: l.title,
              description: l.description,
              price: l.price,
              quantity: l.quantity,
              status: l.status,
              condition: l.condition,
            }))}
            onSelect={(sku) => handleOpenEditor(sku)}
          />
        </DialogContent>
      </Dialog>

      {/* Backup Manager Dialog */}
      <Dialog
        open={backupManagerOpen}
        onClose={() => setBackupManagerOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Yedek Yonetimi
          <IconButton size="small" onClick={() => setBackupManagerOpen(false)}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <BackupManager
            listings={filteredListings}
            userId={userId}
          />
        </DialogContent>
      </Dialog>

      {/* Listing Templates Dialog */}
      <Dialog
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Sablonlar
          <IconButton size="small" onClick={() => setTemplatesOpen(false)}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <ListingTemplates
            listings={filteredListings.map(l => ({
              ...l,
              price: parseFloat(l.price?.value || '0'),
            }))}
            onApply={() => {
              setTemplatesOpen(false);
              fetchListings();
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Scheduled Updates Dialog */}
      <ScheduledUpdateDialog
        open={scheduledOpen}
        onClose={() => setScheduledOpen(false)}
        userId={userId}
        listings={filteredListings}
        onExecuted={() => {
          setScheduledOpen(false);
          fetchListings();
        }}
      />

      {/* CSV Import Preview Dialog */}
      <Dialog
        open={csvImportDialogOpen}
        onClose={() => {
          if (!csvImporting) {
            setCsvImportDialogOpen(false);
            setCsvImportRows([]);
          }
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>CSV Import Onizleme</DialogTitle>
        <DialogContent>
          {csvImporting ? (
            <Box sx={{ py: 3 }}>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Import devam ediyor...
              </Typography>
              <LinearProgress variant="determinate" value={csvImportProgress} />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                %{Math.round(csvImportProgress)} tamamlandi
              </Typography>
            </Box>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {csvImportRows.length} listeleme olusturulacak. Gerekli sutunlar: sku, title, description, price, quantity, condition
              </Typography>
              <TableContainer sx={{ maxHeight: 400 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>SKU</TableCell>
                      <TableCell>Baslik</TableCell>
                      <TableCell>Fiyat</TableCell>
                      <TableCell>Stok</TableCell>
                      <TableCell>Durum</TableCell>
                      <TableCell>Aciklama</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {csvImportRows.slice(0, 50).map((row, i) => (
                      <TableRow key={i}>
                        <TableCell>{row.sku || '\u2014'}</TableCell>
                        <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.title || '\u2014'}
                        </TableCell>
                        <TableCell>{row.price || '\u2014'}</TableCell>
                        <TableCell>{row.quantity || '\u2014'}</TableCell>
                        <TableCell>{row.condition || '\u2014'}</TableCell>
                        <TableCell sx={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.description ? row.description.substring(0, 50) + '...' : '\u2014'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              {csvImportRows.length > 50 && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  ... ve {csvImportRows.length - 50} satir daha
                </Typography>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCsvImportDialogOpen(false); setCsvImportRows([]); }} disabled={csvImporting}>
            Iptal
          </Button>
          <Button variant="contained" onClick={handleCSVImportConfirm} disabled={csvImporting || csvImportRows.length === 0}>
            {csvImporting ? 'Import ediliyor...' : `${csvImportRows.length} Listeleme Olustur`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* AI Results Dialog */}
      <Dialog open={aiDialogOpen} onClose={() => setAiDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {aiDialogMode === 'titles' ? <AutoFixHighIcon color="primary" /> : <PsychologyIcon color="primary" />}
            {aiDialogMode === 'titles' ? 'AI Başlık Optimizasyonu' : 'AI Liste Analizi'}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {aiDialogMode === 'titles' && !aiLoading && Array.isArray(aiResults) && aiResults.length > 0 && (
              appliedTitles.size > 0 ? (
                <Button
                  size="small"
                  variant="outlined"
                  color="warning"
                  onClick={async () => {
                    const ids = Array.from(appliedTitles.keys());
                    for (const id of ids) {
                      await handleUndoAITitle(id);
                    }
                  }}
                >
                  Tümünü Geri Al
                </Button>
              ) : (
                <Button
                  size="small"
                  variant="contained"
                  onClick={async () => {
                    for (const r of aiResults) {
                      if (!appliedTitles.has(r.id)) {
                        await handleApplyAITitle(r.id, r.optimized, r.original);
                      }
                    }
                  }}
                >
                  Tümünü Uygula
                </Button>
              )
            )}
            <IconButton size="small" onClick={() => setAiDialogOpen(false)}>
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          {aiLoading ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 4, gap: 2 }}>
              <CircularProgress />
              <Typography color="text.secondary">AI analiz ediyor...</Typography>
            </Box>
          ) : aiDialogMode === 'titles' && Array.isArray(aiResults) ? (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                AI, başlıklarınızı eBay SEO kurallarına göre optimize etti:
              </Typography>
              {aiResults.map((r: any, i: number) => {
                // Build visual diff: highlight words that changed
                const origWords = (r.original || '').split(' ');
                const optWords = (r.optimized || '').split(' ');
                const origSet = new Set(origWords.map((w: string) => w.toLowerCase()));
                const optSet = new Set(optWords.map((w: string) => w.toLowerCase()));

                return (
                  <Paper key={i} sx={{ p: 2, mb: 1.5, borderLeft: appliedTitles.has(r.id) ? '3px solid #4caf50' : undefined }} variant="outlined">
                    <Typography variant="caption" color="text.secondary">Mevcut:</Typography>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                      {origWords.map((w: string, wi: number) => (
                        <span key={wi} style={{ color: optSet.has(w.toLowerCase()) ? undefined : '#f44336', textDecoration: optSet.has(w.toLowerCase()) ? undefined : 'line-through' }}>
                          {wi > 0 ? ' ' : ''}{w}
                        </span>
                      ))}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">AI Önerisi:</Typography>
                    <Typography variant="body2" sx={{ mb: 1, fontWeight: 600 }}>
                      {optWords.map((w: string, wi: number) => (
                        <span key={wi} style={{ color: origSet.has(w.toLowerCase()) ? undefined : '#4caf50', fontWeight: origSet.has(w.toLowerCase()) ? undefined : 700 }}>
                          {wi > 0 ? ' ' : ''}{w}
                        </span>
                      ))}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                      {appliedTitles.has(r.id) ? (
                        <Button size="small" variant="outlined" color="warning" onClick={() => handleUndoAITitle(r.id)}>
                          Geri Al
                        </Button>
                      ) : (
                        <Button size="small" variant="contained" color="primary" onClick={() => handleApplyAITitle(r.id, r.optimized, r.original)}>
                          Uygula
                        </Button>
                      )}
                      <Button size="small" variant="outlined" onClick={() => { navigator.clipboard.writeText(r.optimized); toast.success('Kopyalandı'); }}>
                        Kopyala
                      </Button>
                    </Box>
                  </Paper>
                );
              })}
            </Box>
          ) : aiDialogMode === 'analyze' && aiResults ? (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                <Box sx={{
                  width: 64, height: 64, borderRadius: '50%',
                  border: `4px solid ${(aiResults.score || 0) >= 80 ? '#4caf50' : (aiResults.score || 0) >= 60 ? '#ff9800' : '#f44336'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Typography variant="h5" fontWeight={700} sx={{ color: (aiResults.score || 0) >= 80 ? '#4caf50' : (aiResults.score || 0) >= 60 ? '#ff9800' : '#f44336' }}>
                    {aiResults.score || 0}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="h6" fontWeight={700}>AI Puanı: {aiResults.score}/100</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {filteredListings[0]?.title?.substring(0, 60)}...
                  </Typography>
                </Box>
              </Box>

              {aiResults.issues?.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Sorunlar:</Typography>
                  {aiResults.issues.map((issue: any, i: number) => (
                    <Paper key={i} sx={{ p: 1.5, mb: 1, borderLeft: `3px solid ${issue.severity === 'critical' ? '#f44336' : issue.severity === 'warning' ? '#ff9800' : '#2196f3'}` }} variant="outlined">
                      <Typography variant="body2" fontWeight={600}>{issue.message}</Typography>
                      <Typography variant="body2" color="text.secondary">{issue.fix}</Typography>
                    </Paper>
                  ))}
                </Box>
              )}

              {aiResults.tips?.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>İpuçları:</Typography>
                  {aiResults.tips.map((tip: string, i: number) => (
                    <Typography key={i} variant="body2" sx={{ mb: 0.5 }}>
                      • {tip}
                    </Typography>
                  ))}
                </Box>
              )}
            </Box>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Bulk Operations Bar */}
      {Array.from((selectedIds as any).ids || []).length > 0 && (
        <BulkOperationsBar
          selectedCount={Array.from((selectedIds as any).ids || []).length}
          selectedListings={listings.filter(l =>
            Array.from((selectedIds as any).ids || []).includes(l.sku)
          )}
          userId={userId}
          fulfillmentPolicies={fulfillmentPolicies}
          returnPolicies={returnPolicies}
          onCompleted={() => {
            setSelectedIds({ type: 'include' as const, ids: new Set() });
            fetchListings();
          }}
        />
      )}
    </Box>
  );
}

// --- Layout wrapper (follows Etsy listings pattern) ---
function EbayListingsPageWithLayout(props: any): JSX.Element {
  return (
    <AppLayout title="eBay Listings — KolayXport">
      <EbayListingsPage {...props} />
    </AppLayout>
  );
}

export default withAuth(EbayListingsPageWithLayout);
