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
  InputLabel,
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
  Add as AddIcon,
  Sync as SyncIcon,
  Inventory2 as Inventory2Icon,
  CheckCircle as CheckCircleIcon,
  EditNote as EditNoteIcon,
  RemoveShoppingCart as RemoveShoppingCartIcon,
  Circle as CircleIcon,
  Storefront as StorefrontIcon,
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';
import { useRouter } from 'next/router';
import { useConnections } from '@/lib/hooks/useConnections';
import { RequireConnection } from '@/components/ui/ConnectEmptyState';
import ErrorState from '@/components/ui/ErrorState';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { notify } from '@/lib/notify';
import AppLayout from '@/components/AppLayout';
import withAuth from '@/components/withAuth';
import { useAuth } from '@/lib/auth-context';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/lib/i18n/useLocale';

import { Tabs, Tab } from '@mui/material';
import SEOIndicator from '@/components/ebay/SEOIndicator';
import ListingEditorDrawer from '@/components/ebay/ListingEditorDrawer';
import ListingCreatorDialog, { type EbayListingPrefill } from '@/components/ebay/ListingCreatorDialog';
import FindReplaceDialog from '@/components/ebay/FindReplaceDialog';
import BulkOperationsBar from '@/components/ebay/BulkOperationsBar';
// MarketResearch removed — now lives at /app/ebay-research
import ListingTemplates from '@/components/ebay/ListingTemplates';
import ScheduledUpdateDialog from '@/components/ebay/ScheduledUpdateDialog';
import SmartPricing from '@/components/ebay/SmartPricing';
import DuplicateDetector from '@/components/ebay/DuplicateDetector';
import BackupManager from '@/components/ebay/BackupManager';
import { stageEbayDraft, syncEbayDraft } from '@/lib/ebay/draftClient';
import {
  readListingPrefill,
  listingPrefillSourceLabel,
  type ListingPrefillPayload,
} from '@/components/ebay/research/listingPrefill';

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
  isLegacy?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eBay returns the USED_ prefixed grades; the bare ones are kept only so older
// cached rows still render a label.
const CONDITION_LABELS: Record<string, string> = {
  NEW: 'New',
  LIKE_NEW: 'Like New',
  NEW_OTHER: 'New (Other)',
  USED_EXCELLENT: 'Used — Excellent',
  USED_VERY_GOOD: 'Used — Very Good',
  USED_GOOD: 'Used — Good',
  USED_ACCEPTABLE: 'Used — Acceptable',
  FOR_PARTS_OR_NOT_WORKING: 'For Parts',
  VERY_GOOD: 'Very Good',
  GOOD: 'Good',
  ACCEPTABLE: 'Acceptable',
};

function formatPrice(price: EbayListingRow['price']): string {
  if (!price) return '\u2014';
  const symbols: Record<string, string> = { USD: '$', GBP: '\u00a3', EUR: '\u20ac', TRY: '\u20ba' };
  const val = parseFloat(price.value || '0');
  return `${symbols[price.currency] || price.currency + ' '}${val.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Cross-listing (Etsy -> eBay). Read-only: loads the source listing from the
// existing Etsy read endpoints; nothing is created on eBay until the user
// presses create/publish in the creator.
// ---------------------------------------------------------------------------

/** Cuts at a word boundary so the eBay title (80 max) doesn't end mid-word. */
function clampTitle(title: string, max = 80): string {
  const clean = title.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,|\-–—]+$/, '');
}

/** Etsy's API returns titles/descriptions with HTML entities (&#39;, &quot;, &amp;). */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Etsy descriptions are plain text; eBay renders the description as HTML, so
 * line breaks would collapse. Escape and keep the paragraph structure.
 */
function plainTextToHtml(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${para.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

/**
 * Maps a validated research hand-off (?prefill=session) onto the creator's
 * prefill. The key is stable per source+title so reopening the same research
 * resumes that autosaved session instead of piling up new ones.
 */
function researchPayloadToEbayPrefill(p: ListingPrefillPayload): EbayListingPrefill | null {
  const title = p.title ? clampTitle(p.title) : '';
  const keywords = [...(p.keywords || []), ...(p.tags || [])];
  if (!title && keywords.length === 0 && !p.description) return null;
  // A bare numeric category ID adds nothing to the AI seed.
  const hint = p.categoryHint && !/^\d+$/.test(p.categoryHint) ? p.categoryHint : '';
  const seedParts = [p.title || '', keywords.join(' '), hint].filter(Boolean);
  let hash = 5381;
  const keySource = `${p.source}|${p.title || ''}|${keywords.slice(0, 5).join(',')}`;
  for (let i = 0; i < keySource.length; i++) hash = ((hash << 5) + hash + keySource.charCodeAt(i)) | 0;
  return {
    key: `research:${p.source}:${(hash >>> 0).toString(36)}`,
    sourceLabel: listingPrefillSourceLabel(p.source),
    title,
    aiSeed: seedParts.join(' — ').slice(0, 200),
    description: p.description ? plainTextToHtml(p.description) : '',
    price: typeof p.price === 'number' ? p.price.toFixed(2) : undefined,
    currency: p.currency,
    images: p.imageUrls,
  };
}

/**
 * Live, read-only check that no eBay inventory item already uses this SKU —
 * create_inventory_item with an existing SKU would overwrite that item. The DB
 * cache can be empty (first visit) or stale, so it is only a fast reject.
 * Returns false unless every inventory item was actually checked.
 */
async function ebaySkuIsFree(sku: string, userId: string): Promise<boolean> {
  const LIMIT = 200;
  const MAX_PAGES = 10;
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * LIMIT;
    const res = await fetch(
      `/api/clawd/ebay?action=inventory_items&user_id=${encodeURIComponent(userId)}&limit=${LIMIT}&offset=${offset}`,
      { credentials: 'same-origin' }
    );
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    const items: any[] = Array.isArray(data?.inventoryItems) ? data.inventoryItems : [];
    if (items.some((it) => typeof it?.sku === 'string' && it.sku.trim().toLowerCase() === sku.toLowerCase())) return false;
    const total = Number(data?.total);
    if (!Number.isFinite(total)) return false;
    if (offset + items.length >= total) return true;
    if (items.length === 0) return false;
  }
  // Too many items to check exhaustively — don't risk it.
  return false;
}

async function loadEtsyListingForCrosslist(
  etsyListingId: string,
  /** null when the eBay listings couldn't be read — then no SKU is carried over. */
  existingEbaySkus: Set<string> | null,
  userId: string
): Promise<EbayListingPrefill | null> {
  const shopsRes = await fetch('/api/integrations/etsy/shops', { credentials: 'same-origin' });
  if (!shopsRes.ok) throw Object.assign(new Error(`HTTP ${shopsRes.status}`), { status: shopsRes.status });
  const shopsData = await shopsRes.json().catch(() => ({}));
  const shopIds: string[] = (Array.isArray(shopsData?.shops) ? shopsData.shops : [])
    .map((s: any) => (s?.shopId != null ? String(s.shopId) : ''))
    .filter(Boolean);

  // The listing id alone doesn't say which shop owns it. Any shop's token can
  // read an active listing, so the first readable one is only used for the
  // public fields; the owner comes from the listing's own shop_id.
  for (const shopId of shopIds) {
    const qs = `shop_id=${encodeURIComponent(shopId)}&listing_id=${encodeURIComponent(etsyListingId)}`;
    const res = await fetch(`/api/clawd/etsy?action=listing&${qs}`, { credentials: 'same-origin' });
    if (!res.ok) continue;
    const l = await res.json().catch(() => null);
    if (!l || typeof l !== 'object' || !l.listing_id) continue;

    // SKU lives on the inventory; only carry it over for a single-product listing
    // and never when that SKU already exists on eBay (it would overwrite that item).
    let sku = '';
    if (existingEbaySkus) try {
      // Inventory only reads with the owning shop's token: try the owner first,
      // then the rest, so a multi-shop seller doesn't silently lose the SKU.
      const owner = l.shop_id != null ? String(l.shop_id) : '';
      const order = Array.from(new Set([owner, shopId, ...shopIds].filter((id) => id && shopIds.includes(id))));
      let candidate = '';
      for (const invShopId of order) {
        const invQs = `shop_id=${encodeURIComponent(invShopId)}&listing_id=${encodeURIComponent(etsyListingId)}`;
        const invRes = await fetch(`/api/clawd/etsy?action=get_listing_inventory&${invQs}`, { credentials: 'same-origin' });
        if (!invRes.ok) continue;
        const inv = await invRes.json().catch(() => null);
        const products = Array.isArray(inv?.products) ? inv.products : [];
        candidate = products.length === 1 && typeof products[0]?.sku === 'string' ? products[0].sku.trim() : '';
        break;
      }
      if (
        candidate &&
        candidate.length <= 50 &&
        !existingEbaySkus.has(candidate) &&
        (await ebaySkuIsFree(candidate, userId))
      ) {
        sku = candidate;
      }
    } catch {
      // SKU is optional — the creator generates one.
    }

    const images: string[] = (Array.isArray(l.images) ? l.images : [])
      .slice()
      .sort((a: any, b: any) => (Number(a?.rank) || 0) - (Number(b?.rank) || 0))
      .map((img: any) => img?.url_fullxfull || img?.url_570xN)
      .filter((u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u));

    const amount = Number(l.price?.amount);
    const divisor = Number(l.price?.divisor) || 100;
    const price = Number.isFinite(amount) && amount > 0 ? (amount / divisor).toFixed(2) : '';

    const materials: string[] = (Array.isArray(l.materials) ? l.materials : [])
      .filter((m: unknown): m is string => typeof m === 'string' && m.trim().length > 0)
      .slice(0, 5);

    const sourceTitle = typeof l.title === 'string' ? decodeEntities(l.title) : '';
    return {
      key: `etsy:${etsyListingId}`,
      sourceLabel: 'Etsy',
      title: clampTitle(sourceTitle),
      aiSeed: sourceTitle.slice(0, 200),
      description: typeof l.description === 'string' ? plainTextToHtml(decodeEntities(l.description)) : '',
      price,
      currency: typeof l.price?.currency_code === 'string' ? l.price.currency_code : undefined,
      quantity: typeof l.quantity === 'number' ? l.quantity : undefined,
      sku: sku || undefined,
      images: images.slice(0, 24),
      aspects: materials.length > 0 ? { Material: materials } : undefined,
    };
  }
  return null;
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
  const titleLabel = `${titleLen} chars title`;

  // Description: 500+ chars = green(25), 200-499 = yellow(15), <200 = red(5)
  const descLen = listing.description?.length || 0;
  const descScore = descLen >= 500 ? 25 : descLen >= 200 ? 15 : 5;
  const descColor = descLen >= 500 ? '#4caf50' : descLen >= 200 ? '#ff9800' : '#f44336';
  const descLabel = `${descLen} chars description`;

  // Images: 12+ = green(25), 5-11 = yellow(15), <5 = red(5)
  const imgCount = listing.imageCount || 0;
  const imagesScore = imgCount >= 12 ? 25 : imgCount >= 5 ? 15 : 5;
  const imagesColor = imgCount >= 12 ? '#4caf50' : imgCount >= 5 ? '#ff9800' : '#f44336';
  const imagesLabel = `${imgCount} images`;

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
  onListOnEtsy,
}: {
  listing: EbayListingRow;
  onEdit: (sku: string) => void;
  onDelete: (listing: EbayListingRow) => void;
  /** Only passed when Etsy is connected. */
  onListOnEtsy?: (listing: EbayListingRow) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const health = calculateHealth(listing);
  const isPublished = listing.status === 'PUBLISHED';
  const t = useTranslations('ebayListings');

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
              {t('stock')}: {listing.quantity}
            </Typography>
            <Chip
              label={isPublished ? t('published') : t('draft')}
              size="small"
              color={isPublished ? 'success' : 'warning'}
              variant="outlined"
              sx={{ height: 26, fontSize: 11 }}
            />
          </Box>
        </Box>

        {/* Expand icon */}
        <IconButton size="small" sx={{ flexShrink: 0, width: 44, height: 44 }}>
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
              <Typography variant="caption" color="text.secondary">{t('condition')}</Typography>
              <Typography variant="body2">
                {CONDITION_LABELS[listing.condition] || listing.condition}
              </Typography>
            </Box>
            <Box sx={{ flex: '1 1 45%' }}>
              <Typography variant="caption" color="text.secondary">{t('images')}</Typography>
              <Typography variant="body2">{listing.imageCount}/24</Typography>
            </Box>
            <Box sx={{ flex: '1 1 45%' }}>
              <Typography variant="caption" color="text.secondary">{t('healthScore')}</Typography>
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
                  <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.8rem', color: health.color }}>
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
                  height: 26,
                  fontSize: '0.8rem',
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
              variant="contained"
              startIcon={<EditIcon sx={{ fontSize: '16px !important' }} />}
              onClick={(e) => { e.stopPropagation(); onEdit(listing.sku); }}
              sx={{
                flex: 1, minHeight: 44, borderRadius: '10px', textTransform: 'none', fontWeight: 600, fontSize: '0.8rem',
                background: 'linear-gradient(135deg, #3b82f6, #2563eb)', boxShadow: '0 2px 8px rgba(37,99,235,0.25)',
                '&:hover': { background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' },
              }}
            >
              {t('edit')}
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={<DeleteIcon sx={{ fontSize: '16px !important' }} />}
              onClick={(e) => { e.stopPropagation(); onDelete(listing); }}
              sx={{
                flex: 1, minHeight: 44, borderRadius: '10px', textTransform: 'none', fontWeight: 600, fontSize: '0.8rem',
                background: 'linear-gradient(135deg, #ef4444, #dc2626)', boxShadow: '0 2px 8px rgba(220,38,38,0.25)',
                '&:hover': { background: 'linear-gradient(135deg, #dc2626, #b91c1c)' },
              }}
            >
              {t('deleteBtn')}
            </Button>
          </Box>

          {onListOnEtsy && (
            <Button
              fullWidth
              size="small"
              variant="outlined"
              startIcon={<StorefrontIcon sx={{ fontSize: '16px !important' }} />}
              onClick={(e) => { e.stopPropagation(); onListOnEtsy(listing); }}
              sx={{ mt: 1, minHeight: 44, borderRadius: '10px', textTransform: 'none', fontWeight: 600, fontSize: '0.8rem' }}
            >
              {t('listOnEtsy')}
            </Button>
          )}

          {listing.listingUrl && (
            <Button
              size="small"
              variant="text"
              href={listing.listingUrl}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ mt: 0.5, fontSize: 11, minHeight: 44 }}
            >
              {t('viewOnEbay')}
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

// ---------------------------------------------------------------------------
// Left filter sidebar (desktop only) — mirrors the Etsy listings page
// ---------------------------------------------------------------------------

function LeftSidebar({
  statusFilter,
  onStatusChange,
  counts,
  conditionFilter,
  onConditionChange,
  healthFilter,
  onHealthChange,
  categoryCounts,
  categoryFilter,
  onCategoryChange,
}: {
  statusFilter: string;
  onStatusChange: (s: string) => void;
  counts: { all: number; published: number; draft: number };
  conditionFilter: string;
  onConditionChange: (c: string) => void;
  healthFilter: string;
  onHealthChange: (h: string) => void;
  categoryCounts: [string, number][];
  categoryFilter: string;
  onCategoryChange: (c: string) => void;
}) {
  const t = useTranslations('ebayListings');
  const [categoriesExpanded, setCategoriesExpanded] = useState(true);

  const rowSx = (selected: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    px: 1,
    py: 0.5,
    borderRadius: 1,
    cursor: 'pointer',
    bgcolor: selected ? 'primary.50' : 'transparent',
    color: selected ? 'primary.main' : 'text.primary',
    fontWeight: selected ? 700 : 400,
    fontSize: '0.82rem',
    transition: 'all 0.15s ease',
    '&:hover': { bgcolor: selected ? 'primary.50' : 'action.hover' },
  });

  const labelSx = {
    fontSize: 11,
    mb: 0.5,
    display: 'block',
  };

  const statuses: { key: string; label: string; count: number; dot: string }[] = [
    { key: 'all', label: t('filterAll'), count: counts.all, dot: '#64748b' },
    { key: 'PUBLISHED', label: t('published'), count: counts.published, dot: '#4caf50' },
    { key: 'UNPUBLISHED', label: t('draft'), count: counts.draft, dot: '#ff9800' },
  ];

  return (
    <Box
      sx={{
        width: 220,
        minWidth: 220,
        flexShrink: 0,
        position: 'sticky',
        top: 80,
        alignSelf: 'flex-start',
        maxHeight: 'calc(100vh - 100px)',
        overflowY: 'auto',
        pr: 1.5,
        '&::-webkit-scrollbar': { width: 4 },
        '&::-webkit-scrollbar-thumb': { bgcolor: '#d0d0d0', borderRadius: 2 },
      }}
    >
      {/* Status */}
      <Paper sx={{ p: 1.5, mb: 1.5, borderRadius: 2 }}>
        <Typography variant="caption" fontWeight={700} color="text.secondary" sx={labelSx}>
          eBay
        </Typography>
        {statuses.map((s) => (
          <Box key={s.key} onClick={() => onStatusChange(s.key)} sx={rowSx(statusFilter === s.key)}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <CircleIcon sx={{ fontSize: 8, color: s.dot }} />
              <span>{s.label}</span>
            </Box>
            <Typography
              variant="caption"
              sx={{ color: statusFilter === s.key ? 'primary.main' : 'text.secondary', fontWeight: 'inherit' }}
            >
              {s.count}
            </Typography>
          </Box>
        ))}
      </Paper>

      {/* Health */}
      <Paper sx={{ p: 1.5, mb: 1.5, borderRadius: 2 }}>
        <Typography variant="caption" fontWeight={700} color="text.secondary" sx={labelSx}>
          {t('healthScore')}
        </Typography>
        <FormControl size="small" fullWidth>
          <Select
            value={healthFilter}
            onChange={(e) => onHealthChange(e.target.value)}
            displayEmpty
            sx={{ fontSize: '0.82rem', '& .MuiSelect-select': { py: 0.75 } }}
          >
            <MenuItem value="">{t('allHealth')}</MenuItem>
            <MenuItem value="issues">{t('healthIssues')}</MenuItem>
            <MenuItem value="missing_images">{t('healthMissingImages')}</MenuItem>
            <MenuItem value="short_title">{t('healthShortTitle')}</MenuItem>
            <MenuItem value="no_description">{t('healthNoDescription')}</MenuItem>
            <MenuItem value="few_aspects">{t('healthFewAspects')}</MenuItem>
            <MenuItem value="no_stock">{t('healthNoStock')}</MenuItem>
          </Select>
        </FormControl>
      </Paper>

      {/* Condition */}
      <Paper sx={{ p: 1.5, mb: 1.5, borderRadius: 2 }}>
        <Typography variant="caption" fontWeight={700} color="text.secondary" sx={labelSx}>
          {t('conditionCol')}
        </Typography>
        <FormControl size="small" fullWidth>
          <Select
            value={conditionFilter}
            onChange={(e) => onConditionChange(e.target.value)}
            sx={{ fontSize: '0.82rem', '& .MuiSelect-select': { py: 0.75 } }}
          >
            <MenuItem value="all">{t('allConditions')}</MenuItem>
            <MenuItem value="NEW">{t('condNew')}</MenuItem>
            <MenuItem value="LIKE_NEW">{t('condLikeNew')}</MenuItem>
            <MenuItem value="USED_EXCELLENT">{t('condUsedExcellent')}</MenuItem>
            <MenuItem value="USED_VERY_GOOD">{t('condVeryGood')}</MenuItem>
            <MenuItem value="USED_GOOD">{t('condGood')}</MenuItem>
            <MenuItem value="USED_ACCEPTABLE">{t('condAcceptable')}</MenuItem>
          </Select>
        </FormControl>
      </Paper>

      {/* Categories */}
      {categoryCounts.length > 0 && (
        <Paper sx={{ p: 1.5, mb: 1.5, borderRadius: 2 }}>
          <Box
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', mb: 0.5 }}
            onClick={() => setCategoriesExpanded((v) => !v)}
          >
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ ...labelSx, mb: 0 }}>
              {t('categoryLabel')}
            </Typography>
            {categoriesExpanded
              ? <ExpandLessIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              : <ExpandMoreIcon sx={{ fontSize: 16, color: 'text.secondary' }} />}
          </Box>
          <Collapse in={categoriesExpanded}>
            <Box onClick={() => onCategoryChange('')} sx={rowSx(!categoryFilter)}>
              <span>{t('allCategories')}</span>
            </Box>
            {categoryCounts.map(([name, count]) => (
              <Box
                key={name}
                onClick={() => onCategoryChange(name)}
                sx={{ ...rowSx(categoryFilter === name), overflow: 'hidden' }}
              >
                <Typography
                  noWrap
                  sx={{ fontSize: 'inherit', fontWeight: 'inherit', color: 'inherit', flex: 1, minWidth: 0 }}
                >
                  {name}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color: categoryFilter === name ? 'primary.main' : 'text.secondary',
                    fontWeight: 'inherit',
                    ml: 0.5,
                    flexShrink: 0,
                  }}
                >
                  {count}
                </Typography>
              </Box>
            ))}
          </Collapse>
        </Paper>
      )}
    </Box>
  );
}

function EbayListingsPage() {
  const { user } = useAuth();
  const userId = (user as any)?.id;
  const t = useTranslations('ebayListings');
  const router = useRouter();
  const { has } = useConnections();
  /** Only offer cross-listing once Etsy is definitely connected. */
  const canListOnEtsy = has('etsy') === true;
  const confirm = useConfirm();

  // --- State ---
  const [listings, setListings] = useState<EbayListingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  /** Set when the cached-listings fetch fails, so an empty grid isn't mistaken for "no listings". */
  const [loadError, setLoadError] = useState<unknown>(null);
  /** First cached-listings read finished (ok or not) — cross-list waits for it to check SKUs. */
  const [listingsReady, setListingsReady] = useState(false);
  /** Current row count for callbacks that must not read state through an updater. */
  const listingsCountRef = React.useRef(0);
  listingsCountRef.current = listings.length;

  const [selectedIds, setSelectedIds] = useState<GridRowSelectionModel>({
    type: 'include' as const,
    ids: new Set<GridRowId>(),
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [healthFilter, setHealthFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  /** Row density, mirroring the Etsy page's Compact/Detailed toggle. */
  const [density, setDensity] = useState<'compact' | 'standard' | 'comfortable'>('standard');
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
  const [creatorPrefill, setCreatorPrefill] = useState<EbayListingPrefill | null>(null);
  const [crosslistLoading, setCrosslistLoading] = useState(false);
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

  // --- Fetch listings from DB cache (instant) ---
  const fetchListings = useCallback(async (): Promise<boolean> => {
    if (!userId) return false;
    setLoading(true);
    try {
      const res = await fetch(`/api/clawd/ebay?action=cached_listings&user_id=${userId}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const rows: EbayListingRow[] = (data.listings || []).map((l: any) => ({
        id: l.offerId || l.sku || l.listingId || l.id,
        sku: l.sku || '',
        offerId: l.offerId || undefined,
        listingId: l.listingId || undefined,
        title: l.title || l.sku || '',
        description: l.description || '',
        price: { value: l.priceValue || '0', currency: l.priceCurrency || 'USD' },
        quantity: l.quantity ?? 0,
        status: l.status || 'DRAFT',
        condition: l.condition || 'NEW',
        categoryId: l.categoryId || '',
        categoryName: l.categoryName,
        imageUrl: l.imageUrl,
        imageCount: l.imageCount ?? 0,
        aspects: l.aspects || {},
        format: l.format || 'FIXED_PRICE',
        marketplaceId: l.marketplaceId || 'EBAY_US',
        listingUrl: l.listingUrl,
        isLegacy: l.isLegacy || false,
        createdAt: l.ebayCreatedAt,
      }));
      setListings(rows);
      listingsCountRef.current = rows.length; // callers read it before the next render
      setLastSyncAt(data.lastSyncAt || null);
      setLoadError(null);
      return true;
    } catch (err: any) {
      console.error('Failed to fetch eBay listings:', err);
      setLoadError(err);
      // With rows already on screen, keep them and just say the refresh failed.
      if (listingsCountRef.current > 0) notify.error(err, 'ebayListings.loadFailed');
      return false;
    } finally {
      setLoading(false);
      setListingsReady(true);
    }
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Sync from eBay (fetches all listings from API → saves to DB) ---
  const syncFromEbay = useCallback(async () => {
    if (!userId) return;
    setSyncing(true);
    toast(t('syncInProgress'));
    try {
      const res = await fetch(`/api/clawd/ebay?action=sync_listings&user_id=${userId}&marketplace_id=EBAY_US`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      toast.success(t('syncComplete', { count: data.synced }));
      await fetchListings();
    } catch (err: any) {
      notify.error(err, 'ebayListings.syncFailed');
    } finally {
      setSyncing(false);
    }
  }, [userId, fetchListings]);

  // --- AI Apply / Undo handlers (via draft system) ---
  const handleApplyAITitle = async (listingId: string, newTitle: string, originalTitle: string) => {
    try {
      const listing = listings.find(l => l.id === listingId);
      if (!listing) return;

      const draft = await stageEbayDraft({
        sku: listing.sku,
        offerId: listing.offerId,
        inventoryFields: { product: { title: newTitle.slice(0, 80) } },
      });
      await syncEbayDraft(draft.id);

      setAppliedTitles(prev => new Map(prev).set(listingId, originalTitle));
      toast.success(t('titleUpdated'));
      fetchListings();
    } catch (err: any) {
      notify.error(err, 'ebayListings.updateFailed');
    }
  };

  const handleUndoAITitle = async (listingId: string) => {
    const originalTitle = appliedTitles.get(listingId);
    if (!originalTitle) return;

    const listing = listings.find(l => l.id === listingId);
    if (!listing) return;

    try {
      const draft = await stageEbayDraft({
        sku: listing.sku,
        offerId: listing.offerId,
        inventoryFields: { product: { title: originalTitle } },
      });
      await syncEbayDraft(draft.id);

      setAppliedTitles(prev => { const m = new Map(prev); m.delete(listingId); return m; });
      toast.success(t('titleReverted'));
      fetchListings();
    } catch (err: any) {
      notify.error(err, 'ebayListings.revertFailed');
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

  /** Read the cache; on first visit (empty cache, read succeeded) pull from eBay. */
  const syncingRef = React.useRef(false);
  syncingRef.current = syncing;
  const loadListingsWithAutoSync = useCallback(async () => {
    const ok = await fetchListings();
    // Not when the read failed — an empty grid then doesn't mean "no listings".
    if (ok && listingsCountRef.current === 0 && !syncingRef.current) syncFromEbay();
  }, [fetchListings, syncFromEbay]);

  useEffect(() => {
    if (userId) {
      loadListingsWithAutoSync();
      fetchPolicies();
    }
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Cross-listing ---
  /** eBay -> Etsy: the Etsy page reads ?crosslist=ebay:<sku|itemId> and opens its creator. */
  const handleListOnEtsy = useCallback(
    (row: EbayListingRow) => {
      const ref = row.sku || row.listingId || row.id;
      if (!ref) return;
      router.push(`/app/etsy-listings?crosslist=ebay:${encodeURIComponent(ref)}`);
    },
    [router]
  );

  /** Etsy -> eBay: handle ?crosslist=etsy:<listingId> once, then drop the param. */
  const crosslistHandled = React.useRef<string | null>(null);
  const crosslistParam = typeof router.query.crosslist === 'string' ? router.query.crosslist : '';
  useEffect(() => {
    if (!router.isReady || !crosslistParam || !userId || !listingsReady) return;
    if (crosslistHandled.current === crosslistParam) return;
    crosslistHandled.current = crosslistParam;

    // Remove the param first so a refresh/back doesn't re-open the creator.
    const { crosslist: _drop, ...rest } = router.query;
    router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });

    const match = /^etsy:(\d{1,20})$/.exec(crosslistParam);
    if (!match) return;
    const etsyListingId = match[1];

    setCrosslistLoading(true);
    const existingSkus = loadError ? null : new Set(listings.map((l) => l.sku).filter(Boolean));
    loadEtsyListingForCrosslist(etsyListingId, existingSkus, userId)
      .then(async (prefill) => {
        if (!prefill) {
          notify.error(null, 'ebayListings.crosslistLoadFailed');
          return;
        }
        // The seller may have opened "New listing" before the load finished;
        // don't replace what they typed without asking.
        if (creatorOpenRef.current) {
          const replace = await confirm({
            title: t('crosslistReplaceTitle'),
            description: t('crosslistReplaceDesc'),
            confirmLabel: t('crosslistReplaceConfirm'),
          });
          if (!replace) return;
        }
        setCreatorPrefill(prefill);
        setCreatorOpen(true);
      })
      .catch((err) => notify.error(err, 'ebayListings.crosslistLoadFailed'))
      .finally(() => setCrosslistLoading(false));
  }, [router.isReady, crosslistParam, userId, listingsReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const creatorOpenRef = React.useRef(false);
  creatorOpenRef.current = creatorOpen;

  /**
   * Research -> eBay: ?prefill=session reads 'kx:listingPrefill' from
   * sessionStorage (only when target is 'ebay'), drops the param and opens the
   * creator prefilled. Nothing is published until the seller presses publish.
   */
  const prefillHandled = React.useRef(false);
  const prefillParam = typeof router.query.prefill === 'string' ? router.query.prefill : '';
  useEffect(() => {
    if (!router.isReady || prefillParam !== 'session' || !userId) return;
    if (prefillHandled.current) return;
    prefillHandled.current = true;

    const { prefill: _dropPrefill, ...rest } = router.query;
    router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });

    const payload = readListingPrefill('ebay');
    const prefill = payload ? researchPayloadToEbayPrefill(payload) : null;
    if (!prefill) {
      // Storage blocked, entry gone (e.g. refresh) or nothing valid survived: tell the seller instead of failing silently.
      toast.error(t('prefillMissing'), { id: 'ebay-prefill-missing' });
      return;
    }

    const open = async () => {
      if (creatorOpenRef.current) {
        const replace = await confirm({
          title: t('crosslistReplaceTitle'),
          description: t('crosslistReplaceDesc'),
          confirmLabel: t('crosslistReplaceConfirm'),
        });
        if (!replace) return;
      }
      setCreatorPrefill(prefill);
      setCreatorOpen(true);
    };
    void open();
  }, [router.isReady, prefillParam, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeCreator = useCallback(() => {
    setCreatorOpen(false);
    setCreatorPrefill(null);
  }, []);

  // --- Client-side filtering ---
  const filteredListings = useMemo(() => {
    return listings.filter((l) => {
      if (searchTerm && !l.title.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (statusFilter === 'PUBLISHED' && l.status !== 'PUBLISHED') return false;
      if (statusFilter === 'UNPUBLISHED' && l.status === 'PUBLISHED') return false;
      if (conditionFilter !== 'all' && l.condition !== conditionFilter) return false;
      if (categoryFilter && (l.categoryName || '') !== categoryFilter) return false;
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
  }, [listings, searchTerm, statusFilter, conditionFilter, healthFilter, categoryFilter]);

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

  /** eBay has no shop sections, so the sidebar groups by leaf category instead. */
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of listings) {
      const name = l.categoryName;
      if (!name) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [listings]);

  // --- Delete listing (via draft system) ---
  const handleDeleteListing = useCallback(
    async (row: EbayListingRow) => {
      try {
        if (row.offerId || row.sku) {
          const draft = await stageEbayDraft({
            sku: row.sku,
            offerId: row.offerId,
            queuedActions: [{ type: 'delete' }],
          });
          await syncEbayDraft(draft.id);
        }
        toast.success(t('listingDeleted'));
        setDeleteConfirm(null);
        setListings(prev => prev.filter(l => l.id !== row.id));
      } catch (err: any) {
        notify.error(err, 'ebayListings.deleteFailed');
      }
    },
    [userId]
  );

  // --- CSV Export ---
  const handleExportCSV = () => {
    if (filteredListings.length === 0) {
      toast.error(t('noListingsToExport'));
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
          toast.error(t('csvEmptyOrInvalid'));
          return;
        }
        const validRows = rows.filter((r) => r.sku && r.sku.trim() !== '');
        if (validRows.length === 0) {
          toast.error(t('csvNoSkuColumn'));
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
      toast.success(t('csvImportSuccess', { count: succeeded }));
    } else {
      toast.error(t('csvImportPartial', { succeeded, failed }));
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
      toast.error(t('noListingsToOptimize'));
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
      if (!res.ok) throw new Error(t('aiNoResponse'));
      const data = await res.json();
      setAiResults(data.results || []);
    } catch (err: any) {
      toast.error(`${t('aiError')}: ${err.message}`);
      setAiDialogOpen(false);
    } finally {
      setAiLoading(false);
    }
  };

  const handleAIAnalyze = async () => {
    if (filteredListings.length === 0) {
      toast.error(t('noListingsToAnalyze'));
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
      if (!res.ok) throw new Error(t('aiNoResponse'));
      const data = await res.json();
      setAiResults(data);
    } catch (err: any) {
      toast.error(`${t('aiError')}: ${err.message}`);
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
        width: 52,
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
        headerName: t('titleCol'),
        flex: 1,
        minWidth: 180,
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
        width: 110,
      },
      {
        field: 'price',
        headerName: t('priceCol'),
        width: 88,
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
        headerName: t('stockCol'),
        width: 66,
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
        headerName: t('conditionCol'),
        width: 88,
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
        headerName: t('healthCol'),
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
                  <Box sx={{ fontWeight: 700, mb: 0.5 }}>{t('healthScore')}: {h.overall}/100</Box>
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
        headerName: t('imageCol'),
        width: 62,
        renderCell: (params: GridRenderCellParams<EbayListingRow>) =>
          `${params.row.imageCount}/24`,
      },
      {
        field: 'status',
        headerName: t('statusCol'),
        width: 106,
        renderCell: (params: GridRenderCellParams<EbayListingRow>) => {
          const isPublished = params.row.status === 'PUBLISHED';
          return (
            <Chip
              label={isPublished ? t('published') : t('draft')}
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
        width: canListOnEtsy ? 120 : 84,
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
            {canListOnEtsy && (
              <Tooltip title={t('listOnEtsy')} arrow>
                <IconButton
                  size="small"
                  aria-label={t('listOnEtsy')}
                  onClick={() => handleListOnEtsy(params.row)}
                >
                  <StorefrontIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
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
    [canListOnEtsy, handleListOnEtsy] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // --- Column visibility for mobile ---
  const [columnVisibilityModel, setColumnVisibilityModel] = useState<Record<string, boolean>>({});

  /** Columns each view hides. "all" hides nothing. */
  const VIEW_HIDDEN_COLUMNS: Record<string, string[]> = {
    compact: ['sku', 'condition', 'seo', 'imageCount', 'health'],
    standard: ['sku', 'seo'],
    all: [],
  };

  const effectiveColumnVisibility = useMemo(() => {
    const hidden = VIEW_HIDDEN_COLUMNS[density] || [];
    const model: Record<string, boolean> = { ...columnVisibilityModel };
    for (const field of ['sku', 'condition', 'seo', 'imageCount', 'health']) {
      model[field] = !hidden.includes(field);
    }
    return model;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [density, columnVisibilityModel]);

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
  // Stat cards double as filter shortcuts — clicking one narrows the table.
  const filtersActive =
    statusFilter !== 'all' || conditionFilter !== 'all' || healthFilter !== '' || searchTerm !== '';

  const clearFilters = useCallback(() => {
    setStatusFilter('all');
    setConditionFilter('all');
    setHealthFilter('');
    setSearchTerm('');
  }, []);


  const paginatedMobileListings = useMemo(() => {
    const start = paginationModel.page * paginationModel.pageSize;
    return filteredListings.slice(start, start + paginationModel.pageSize);
  }, [filteredListings, paginationModel]);

  return (
    <Box sx={{ p: { xs: 0.5, sm: 1, md: 1.5 }, maxWidth: 1600, mx: 'auto', width: '100%', overflow: 'hidden', boxSizing: 'border-box' }}>

      {/* ---------------------------------------------------------------
          Page header — identity, sync state and the primary action in one row
         --------------------------------------------------------------- */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 1.5,
          mb: 2.5,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 220 }}>
          <Typography variant="h4" fontWeight={700} sx={{ letterSpacing: '-0.02em' }}>
            {t('pageTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('pageSubtitle', { count: totalCount })}
            {lastSyncAt
              ? ` · ${t('lastSync')}: ${new Date(lastSyncAt).toLocaleString()}`
              : ` · ${t('neverSynced')}`}
          </Typography>
        </Box>

        <Button
          variant="outlined"
          onClick={syncFromEbay}
          disabled={syncing || loading}
          startIcon={syncing ? <CircularProgress size={16} /> : <SyncIcon />}
          sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
        >
          {syncing ? t('syncing') : t('syncFromEbay')}
        </Button>

        <Button
          variant="outlined"
          startIcon={<DownloadIcon />}
          onClick={handleExportCSV}
          sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
        >
          {t('csvDownload')}
        </Button>

        <Button
          variant="outlined"
          onClick={(e) => setMoreMenuAnchor(e.currentTarget)}
          startIcon={<BuildIcon />}
          endIcon={<ExpandMoreIcon />}
          sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
        >
          {t('tools')}
        </Button>

        <Button
          variant="contained"
          color="success"
          onClick={() => setCreatorOpen(true)}
          disabled={crosslistLoading}
          startIcon={<AddIcon />}
          sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
        >
          {t('newListing')}
        </Button>
      </Box>

      {/* ---------------------------------------------------------------
      {/* ---------------------------------------------------------------
          Sidebar + content, mirroring the Etsy listings layout
         --------------------------------------------------------------- */}
      <Box sx={{ display: 'flex', gap: 0 }}>
        {!isMobile && (
          <LeftSidebar
            statusFilter={statusFilter}
            onStatusChange={setStatusFilter}
            counts={{ all: totalCount, published: publishedCount, draft: unpublishedCount }}
            conditionFilter={conditionFilter}
            onConditionChange={setConditionFilter}
            healthFilter={healthFilter}
            onHealthChange={setHealthFilter}
            categoryCounts={categoryCounts}
            categoryFilter={categoryFilter}
            onCategoryChange={setCategoryFilter}
          />
        )}

        <Box sx={{ flex: 1, minWidth: 0 }}>
          {/* Compact stats strip — the problem counts are clickable filters */}
          <Paper
            elevation={0}
            sx={{
              px: 1.5, py: 0.75, mb: 1,
              border: '1px solid', borderColor: 'divider',
              display: 'flex', alignItems: 'center', gap: { xs: 1.5, sm: 2 },
              flexWrap: 'wrap', minHeight: 36,
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.82rem' }}>
              {filtersActive
                ? t('listingsCountFiltered', { count: filteredListings.length, total: totalCount })
                : t('listingsCountLabel', { count: totalCount })}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.85rem' }}>
              ·&nbsp;&nbsp;{t('publishedCountLabel', { count: publishedCount })}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.85rem' }}>
              ·&nbsp;&nbsp;{t('draftCountLabel', { count: unpublishedCount })}
            </Typography>
            {outOfStock > 0 && (
              <Typography
                variant="body2"
                onClick={() => setHealthFilter('no_stock')}
                sx={{
                  fontSize: '0.85rem', color: 'error.main', fontWeight: 600, cursor: 'pointer',
                  '&:hover': { textDecoration: 'underline' },
                }}
              >
                ·&nbsp;&nbsp;{t('outOfStockCountLabel', { count: outOfStock })}
              </Typography>
            )}
            {needsAttention > 0 && (
              <Typography
                variant="body2"
                onClick={() => setHealthFilter('issues')}
                sx={{
                  fontSize: '0.85rem', color: 'warning.main', fontWeight: 600, cursor: 'pointer',
                  '&:hover': { textDecoration: 'underline' },
                }}
              >
                ·&nbsp;&nbsp;{t('needsAttentionCountLabel', { count: needsAttention })}
              </Typography>
            )}
          </Paper>

          {/* Toolbar */}
          <Paper
            elevation={0}
            sx={{ px: 1.5, py: 1, mb: 1, border: '1px solid', borderColor: 'divider' }}
          >
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography
                variant="subtitle1"
                fontWeight={700}
                sx={{ display: { xs: 'none', sm: 'block' }, whiteSpace: 'nowrap' }}
              >
                {statusFilter === 'PUBLISHED'
                  ? t('published')
                  : statusFilter === 'UNPUBLISHED'
                    ? t('draft')
                    : t('filterAll')}
              </Typography>

              <TextField
                size="small"
                placeholder={t('searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                sx={{ minWidth: { xs: '100%', sm: 220 }, flex: 1 }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                }}
              />

              {/* Mobile keeps the filters inline — there's no sidebar there */}
              {isMobile && (
                <>
                  <FormControl size="small" sx={{ minWidth: 110 }}>
                    <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                      <MenuItem value="all">{t('filterAll')}</MenuItem>
                      <MenuItem value="PUBLISHED">{t('published')}</MenuItem>
                      <MenuItem value="UNPUBLISHED">{t('draft')}</MenuItem>
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={{ minWidth: 120 }}>
                    <Select
                      value={healthFilter}
                      onChange={(e) => setHealthFilter(e.target.value)}
                      displayEmpty
                    >
                      <MenuItem value="">{t('allHealth')}</MenuItem>
                      <MenuItem value="issues">{t('healthIssues')}</MenuItem>
                      <MenuItem value="missing_images">{t('healthMissingImages')}</MenuItem>
                      <MenuItem value="short_title">{t('healthShortTitle')}</MenuItem>
                      <MenuItem value="no_description">{t('healthNoDescription')}</MenuItem>
                      <MenuItem value="few_aspects">{t('healthFewAspects')}</MenuItem>
                      <MenuItem value="no_stock">{t('healthNoStock')}</MenuItem>
                    </Select>
                  </FormControl>
                </>
              )}

              {filtersActive && (
                <Chip
                  label={t('clearFilters')}
                  onDelete={clearFilters}
                  onClick={clearFilters}
                  size="small"
                  variant="outlined"
                />
              )}

              <Box sx={{ flex: { xs: '0 0 100%', sm: '0 0 auto' }, ml: { sm: 'auto' } }} />

              {/* Row density */}
              {!isMobile && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">{t('viewLabel')}</Typography>
                  {(['compact', 'standard', 'comfortable'] as const).map((d) => (
                    <Chip
                      key={d}
                      size="small"
                      label={t(d === 'compact' ? 'viewCompact' : d === 'standard' ? 'viewStandard' : 'viewComfortable')}
                      onClick={() => setDensity(d)}
                      color={density === d ? 'primary' : 'default'}
                      variant={density === d ? 'filled' : 'outlined'}
                      sx={{ height: 24, fontSize: '0.72rem' }}
                    />
                  ))}
                </Box>
              )}
            </Box>
          </Paper>

      <Menu
        anchorEl={moreMenuAnchor}
        open={Boolean(moreMenuAnchor)}
        onClose={() => setMoreMenuAnchor(null)}
        slotProps={{ paper: { sx: { minWidth: 320 } } }}
      >
        <ListSubheader sx={{ lineHeight: '32px', fontSize: 12, fontWeight: 700, color: 'primary.main' }}>
          {t('aiAssistant')}
        </ListSubheader>
        <MenuItem onClick={() => { setMoreMenuAnchor(null); handleAIBulkOptimize(); }}>
          <ListItemIcon><AutoFixHighIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t('optimizeTitles')} secondary={t('optimizeTitlesDesc')} />
        </MenuItem>
        <MenuItem onClick={() => { setMoreMenuAnchor(null); handleAIAnalyze(); }}>
          <ListItemIcon><PsychologyIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t('analyzeListing')} secondary={t('aiAnalysisDesc')} />
        </MenuItem>
        <Divider />
        <ListSubheader sx={{ lineHeight: '32px', fontWeight: 700 }}>{t('editingTools')}</ListSubheader>
        <MenuItem onClick={() => { setMoreMenuAnchor(null); setFindReplaceOpen(true); }}>
          <ListItemIcon><FindReplaceIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t('findReplace')} secondary={t('findReplaceDesc')} />
        </MenuItem>
        <MenuItem onClick={() => { setMoreMenuAnchor(null); setDuplicateDetectorOpen(true); }}>
          <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t('duplicateDetection')} secondary={t('duplicateDetectionDesc')} />
        </MenuItem>

        <ListSubheader sx={{ lineHeight: '32px', fontWeight: 700 }}>{t('priceTemplates')}</ListSubheader>
        <MenuItem onClick={() => { setMoreMenuAnchor(null); setSmartPricingOpen(true); }}>
          <ListItemIcon><AttachMoneyIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t('smartPricing')} secondary={t('smartPricingDesc')} />
        </MenuItem>
        <MenuItem onClick={() => { setMoreMenuAnchor(null); setTemplatesOpen(true); }}>
          <ListItemIcon><ViewListIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t('templates')} secondary={t('templatesDesc')} />
        </MenuItem>

        <ListSubheader sx={{ lineHeight: '32px', fontWeight: 700 }}>{t('data')}</ListSubheader>
        <MenuItem onClick={() => { setMoreMenuAnchor(null); handleCSVFileSelect(); }}>
          <ListItemIcon><UploadFileIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t('csvImport')} secondary={t('csvImportDesc')} />
        </MenuItem>

        <ListSubheader sx={{ lineHeight: '32px', fontWeight: 700 }}>{t('security')}</ListSubheader>
        <MenuItem onClick={() => { setMoreMenuAnchor(null); setBackupManagerOpen(true); }}>
          <ListItemIcon><BackupIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t('backupManager')} secondary={t('backupManagerDesc')} />
        </MenuItem>
        <MenuItem onClick={() => { setMoreMenuAnchor(null); setScheduledOpen(true); }}>
          <ListItemIcon>
            <Badge badgeContent={scheduledCount} color="primary" sx={{ '& .MuiBadge-badge': { fontSize: '0.8rem' } }}>
              <ScheduleIcon fontSize="small" />
            </Badge>
          </ListItemIcon>
          <ListItemText
            primary={`${t('scheduledTasks')}${scheduledCount > 0 ? ` (${scheduledCount})` : ''}`}
            secondary={t('scheduledUpdatesDesc')}
          />
        </MenuItem>
      </Menu>

      {crosslistLoading && (
        <Paper
          elevation={0}
          sx={{ px: 1.5, py: 1, mb: 1, border: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}
        >
          <CircularProgress size={16} />
          <Typography variant="body2" color="text.secondary">{t('crosslistLoading')}</Typography>
        </Paper>
      )}

      {/* Failed read with nothing cached on screen: say so instead of an empty grid */}
      {loadError && listings.length === 0 ? (
        <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
          <ErrorState title={t('loadFailed')} error={loadError} onRetry={loadListingsWithAutoSync} retrying={loading} />
        </Paper>
      ) : isMobile ? (
        <Box sx={{ overflow: 'hidden', width: '100%', maxWidth: '100%' }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : paginatedMobileListings.length === 0 ? (
            <Paper sx={{ p: 3, textAlign: 'center' }}>
              <Typography color="text.secondary">{t('noListingsFound')}</Typography>
            </Paper>
          ) : (
            <>
              {paginatedMobileListings.map((listing) => (
                <MobileListingCard
                  key={listing.id}
                  listing={listing}
                  onEdit={handleOpenEditor}
                  onDelete={setDeleteConfirm}
                  onListOnEtsy={canListOnEtsy ? handleListOnEtsy : undefined}
                />
              ))}

              {/* Mobile Pagination */}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2, px: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {filteredListings.length} {t('listingsCount')}, {t('page')} {paginationModel.page + 1}/
                  {Math.max(1, Math.ceil(filteredListings.length / paginationModel.pageSize))}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={paginationModel.page === 0}
                    onClick={() => setPaginationModel(prev => ({ ...prev, page: prev.page - 1 }))}
                  >
                    {t('previous')}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={(paginationModel.page + 1) * paginationModel.pageSize >= filteredListings.length}
                    onClick={() => setPaginationModel(prev => ({ ...prev, page: prev.page + 1 }))}
                  >
                    {t('nextPage')}
                  </Button>
                </Box>
              </Box>
            </>
          )}
        </Box>
      ) : (
        /* Desktop DataGrid */
        <Paper elevation={0} sx={{ width: '100%', border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
          <DataGrid
            rows={filteredListings}
            columns={columns}
            loading={loading}
            checkboxSelection
            disableRowSelectionOnClick
            density={density === 'compact' ? 'compact' : 'standard'}
            rowSelectionModel={selectedIds}
            onRowSelectionModelChange={(newSelection) => setSelectedIds(newSelection)}
            paginationModel={paginationModel}
            onPaginationModelChange={setPaginationModel}
            pageSizeOptions={[25, 50, 100]}
            columnVisibilityModel={effectiveColumnVisibility}
            onColumnVisibilityModelChange={(model) => setColumnVisibilityModel(model)}
            getRowId={(row) => row.id}
            autoHeight
            sx={{
              border: 'none',
              '& .MuiDataGrid-columnHeaders': {
                backgroundColor: 'grey.50',
                borderBottom: '1px solid',
                borderColor: 'divider',
              },
              '& .MuiDataGrid-columnHeaderTitle': {
                fontWeight: 700,
                fontSize: '0.8rem',
                letterSpacing: '0.02em',
                color: 'text.secondary',
              },
              '& .MuiDataGrid-cell': {
                display: 'flex',
                alignItems: 'center',
                borderColor: 'divider',
              },
              '& .MuiDataGrid-row': {
                transition: 'background-color .12s',
              },
              '& .MuiDataGrid-row:hover': {
                backgroundColor: 'action.hover',
              },
              '& .MuiDataGrid-footerContainer': {
                borderTop: '1px solid',
                borderColor: 'divider',
              },
              '& .MuiDataGrid-columnSeparator': { display: 'none' },
              '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within': { outline: 'none' },
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
                    gap: 1.5,
                    py: 6,
                  }}
                >
                  <Inventory2Icon sx={{ fontSize: 40, color: 'text.disabled' }} />
                  <Typography color="text.secondary">{t('noListingsFound')}</Typography>
                  {filtersActive ? (
                    <Button size="small" variant="outlined" onClick={clearFilters} sx={{ textTransform: 'none' }}>
                      {t('clearFilters')}
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      variant="contained"
                      color="success"
                      startIcon={<AddIcon />}
                      onClick={() => setCreatorOpen(true)}
                      disabled={crosslistLoading}
                      sx={{ textTransform: 'none' }}
                    >
                      {t('newListing')}
                    </Button>
                  )}
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
        </Box>
      </Box>

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
              {t('deleteListingTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              <strong>{deleteConfirm.title}</strong>
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('deleteListingConfirm')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
              <Button size="small" onClick={() => setDeleteConfirm(null)}>
                {t('cancelBtn')}
              </Button>
              <Button
                size="small"
                variant="contained"
                color="error"
                onClick={() => handleDeleteListing(deleteConfirm)}
              >
                {t('deleteBtn')}
              </Button>
            </Box>
          </Paper>
        </Box>
      )}


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
        onClose={closeCreator}
        userId={userId}
        fulfillmentPolicies={fulfillmentPolicies}
        returnPolicies={returnPolicies}
        paymentPolicies={paymentPolicies}
        prefill={creatorPrefill}
        onCreated={() => { closeCreator(); syncFromEbay(); }}
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
          {t('smartPricingTitle')}
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
          {t('duplicateDetection')}
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
          {t('backupManagement')}
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
          {t('templatesTitle')}
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
        <DialogTitle>{t('csvImportPreview')}</DialogTitle>
        <DialogContent>
          {csvImporting ? (
            <Box sx={{ py: 3 }}>
              <Typography variant="body2" sx={{ mb: 1 }}>
                {t('importInProgress')}
              </Typography>
              <LinearProgress variant="determinate" value={csvImportProgress} />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                {Math.round(csvImportProgress)}% {t('completed')}
              </Typography>
            </Box>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('csvImportWillCreate', { count: csvImportRows.length })}
              </Typography>
              <TableContainer sx={{ maxHeight: 400 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>SKU</TableCell>
                      <TableCell>{t('titleCol')}</TableCell>
                      <TableCell>{t('priceCol')}</TableCell>
                      <TableCell>{t('stockCol')}</TableCell>
                      <TableCell>{t('conditionCol')}</TableCell>
                      <TableCell>{t('descriptionCol')}</TableCell>
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
                  {t('andMoreRows', { count: csvImportRows.length - 50 })}
                </Typography>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCsvImportDialogOpen(false); setCsvImportRows([]); }} disabled={csvImporting}>
            {t('cancelBtn')}
          </Button>
          <Button variant="contained" onClick={handleCSVImportConfirm} disabled={csvImporting || csvImportRows.length === 0}>
            {csvImporting ? t('importingProgress') : t('createListings', { count: csvImportRows.length })}
          </Button>
        </DialogActions>
      </Dialog>

      {/* AI Results Dialog */}
      <Dialog open={aiDialogOpen} onClose={() => setAiDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {aiDialogMode === 'titles' ? <AutoFixHighIcon color="primary" /> : <PsychologyIcon color="primary" />}
            {aiDialogMode === 'titles' ? t('aiTitleOptimization') : t('aiListAnalysis')}
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
                  {t('listingOptimizer.undoAll')}
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
                  {t('listingOptimizer.applyAll')}
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
              <Typography color="text.secondary">{t('aiAnalyzing')}</Typography>
            </Box>
          ) : aiDialogMode === 'titles' && Array.isArray(aiResults) ? (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('aiOptimizedTitles')}
              </Typography>
              {aiResults.map((r: any, i: number) => {
                // Build visual diff: highlight words that changed
                const origWords = (r.original || '').split(' ');
                const optWords = (r.optimized || '').split(' ');
                const origSet = new Set(origWords.map((w: string) => w.toLowerCase()));
                const optSet = new Set(optWords.map((w: string) => w.toLowerCase()));

                return (
                  <Paper key={i} sx={{ p: 2, mb: 1.5, borderLeft: appliedTitles.has(r.id) ? '3px solid #4caf50' : undefined }} variant="outlined">
                    <Typography variant="caption" color="text.secondary">{t('current')}:</Typography>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                      {origWords.map((w: string, wi: number) => (
                        <span key={wi} style={{ color: optSet.has(w.toLowerCase()) ? undefined : '#f44336', textDecoration: optSet.has(w.toLowerCase()) ? undefined : 'line-through' }}>
                          {wi > 0 ? ' ' : ''}{w}
                        </span>
                      ))}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">{t('aiSuggestion')}:</Typography>
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
                          {t('undo')}
                        </Button>
                      ) : (
                        <Button size="small" variant="contained" color="primary" onClick={() => handleApplyAITitle(r.id, r.optimized, r.original)}>
                          {t('apply')}
                        </Button>
                      )}
                      <Button size="small" variant="outlined" onClick={() => { navigator.clipboard.writeText(r.optimized); toast.success(t('copied')); }}>
                        {t('copy')}
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
                  <Typography variant="h6" fontWeight={700}>{t('aiScore')}: {aiResults.score}/100</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {filteredListings[0]?.title?.substring(0, 60)}...
                  </Typography>
                </Box>
              </Box>

              {aiResults.issues?.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('issues')}:</Typography>
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
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('tips')}:</Typography>
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
            Array.from((selectedIds as any).ids || []).includes(l.id)
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
      <RequireConnection provider="ebay">
        <EbayListingsPage {...props} />
      </RequireConnection>
    </AppLayout>
  );
}

export default withAuth(EbayListingsPageWithLayout);
