import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Collapse,
  Tooltip,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
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
  useMediaQuery,
  useTheme,
  Menu,
  ListItemIcon,
  ListItemText,
  SwipeableDrawer,
  Badge,
  Checkbox,
  Divider,
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
  FavoriteBorder as FavoriteBorderIcon,
  RemoveCircleOutline as RemoveCircleOutlineIcon,
  ContentCopy as ContentCopyIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Visibility as VisibilityIcon,
  Add as AddIcon,
  MoreVert as MoreVertIcon,
  FindReplace as FindReplaceIcon,
  ContentPasteSearch as ContentPasteSearchIcon,
  PriceChange as PriceChangeIcon,
  FileDownload as FileDownloadIcon,
  FileUpload as FileUploadIcon,
  Inventory as InventoryIcon,
  FilterList as FilterListIcon,
  Close as CloseIcon,
  Circle as CircleIcon,
  Store as StoreIcon,
  Sync as SyncIcon,
} from '@mui/icons-material';
import { toast, Toaster } from 'react-hot-toast';
import AppLayout from '@/components/AppLayout';
import withAuth from '@/components/withAuth';
import { useAuth } from '@/lib/auth-context';
import { useTranslations } from 'next-intl';

import SEOIndicator from '@/components/etsy/SEOIndicator';
import ListingEditorDrawer from '@/components/etsy/ListingEditorDrawer';
import ListingCreatorDialog from '@/components/etsy/ListingCreatorDialog';
import FindReplaceDialog from '@/components/etsy/FindReplaceDialog';
import BulkOperationsBar from '@/components/etsy/BulkOperationsBar';
import BulkEditor from '@/components/etsy/BulkEditor';
import SmartPricing from '@/components/etsy/SmartPricing';
import DuplicateDetector from '@/components/etsy/DuplicateDetector';
import BackupManager from '@/components/etsy/BackupManager';
import { fetchEtsyDrafts, stageEtsyDraft, syncEtsyDrafts } from '@/lib/etsy/draftClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EtsyListingRow {
  id: number;
  listing_id: number;
  title: string;
  description: string;
  tags: string[];
  materials: string[];
  price: { amount: number; divisor: number; currency_code: string } | null;
  views: number;
  num_favorers: number;
  quantity: number;
  state: string;
  url: string;
  taxonomy_id: number | null;
  shop_section_id: number | null;
  who_made: string;
  when_made: string;
  is_supply: boolean;
  processing_min?: number;
  processing_max?: number;
  shipping_profile_id?: number;
  return_policy_id?: number;
  item_weight?: number;
  item_weight_unit?: string;
  item_length?: number;
  item_width?: number;
  item_height?: number;
  item_dimensions_unit?: string;
  is_personalizable?: boolean;
  created_timestamp: number;
  updated_timestamp: number;
  thumbnail: {
    listing_image_id: number;
    url_75x75: string;
    url_170x135: string;
    url_570xN: string;
  } | null;
  image_count: number;
  has_video: boolean;
}

interface ShopInfo {
  shopId: string;
  shopName: string;
  isActive: boolean;
}

interface ShopSection {
  shop_section_id: number;
  title: string;
}

interface ShippingProfile {
  shipping_profile_id: number;
  title: string;
}

interface ReturnPolicy {
  return_policy_id: number;
  description?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ts: number): string {
  if (!ts) return '\u2014';
  try {
    const d = new Date(ts * 1000);
    if (isNaN(d.getTime())) return '\u2014';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear().toString().slice(-2)}`;
  } catch {
    return '\u2014';
  }
}

function formatPrice(price: EtsyListingRow['price']): string {
  if (!price) return '\u2014';
  const value = price.amount / price.divisor;
  const symbol =
    price.currency_code === 'USD'
      ? '$'
      : price.currency_code === 'EUR'
        ? '\u20ac'
        : price.currency_code === 'GBP'
          ? '\u00a3'
          : price.currency_code === 'TRY'
            ? '\u20ba'
            : price.currency_code + ' ';
  return `${symbol}${value.toFixed(2)}`;
}

const STATE_COLORS: Record<string, 'success' | 'default' | 'error' | 'warning'> = {
  active: 'success',
  draft: 'default',
  inactive: 'error',
  expired: 'warning',
};

const STATE_LABELS: Record<string, string> = {
  active: 'Active',
  draft: 'Draft',
  inactive: 'Inactive',
  expired: 'Expired',
};

// ---------------------------------------------------------------------------
// Health Score + Letter Grade
// ---------------------------------------------------------------------------

interface HealthBreakdown {
  tags: { score: number; color: string; label: string };
  images: { score: number; color: string; label: string };
  title: { score: number; color: string; label: string };
  description: { score: number; color: string; label: string };
  overall: number;
  color: string;
  grade: string;
}

function scoreToGrade(score: number): string {
  if (score >= 95) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 85) return 'A-';
  if (score >= 80) return 'B+';
  if (score >= 75) return 'B';
  if (score >= 70) return 'B-';
  if (score >= 65) return 'C+';
  if (score >= 60) return 'C';
  if (score >= 55) return 'C-';
  if (score >= 50) return 'D+';
  if (score >= 45) return 'D';
  if (score >= 40) return 'D-';
  return 'F';
}

function gradeColor(grade: string): string {
  if (grade.startsWith('A')) return '#4caf50';
  if (grade.startsWith('B')) return '#8bc34a';
  if (grade.startsWith('C')) return '#ff9800';
  if (grade.startsWith('D')) return '#ff5722';
  return '#f44336';
}

function calculateHealth(listing: EtsyListingRow): HealthBreakdown {
  // Tags: 0-13 → 0-25 (proportional)
  const tagCount = listing.tags?.length || 0;
  const tagsScore = Math.round(Math.min(tagCount / 13, 1) * 25);
  const tagsColor = tagsScore >= 20 ? '#4caf50' : tagsScore >= 12 ? '#ff9800' : '#f44336';
  const tagsLabel = `${tagCount}/13`;

  // Images: 0-10 → 0-25 (proportional)
  const imgCount = listing.image_count || 0;
  const imagesScore = Math.round(Math.min(imgCount / 10, 1) * 25);
  const imagesColor = imagesScore >= 20 ? '#4caf50' : imagesScore >= 12 ? '#ff9800' : '#f44336';
  const imagesLabel = `${imgCount}`;

  // Title: 0-140 → 0-25 (proportional, target 140 chars)
  const titleLen = listing.title?.length || 0;
  const titleScore = Math.round(Math.min(titleLen / 140, 1) * 25);
  const titleColor = titleScore >= 20 ? '#4caf50' : titleScore >= 12 ? '#ff9800' : '#f44336';
  const titleLabel = `${titleLen}`;

  // Description: 0-500 → 0-25 (proportional, target 500 chars)
  const descLen = listing.description?.length || 0;
  const descScore = Math.round(Math.min(descLen / 500, 1) * 25);
  const descColor = descScore >= 20 ? '#4caf50' : descScore >= 12 ? '#ff9800' : '#f44336';
  const descLabel = `${descLen}`;

  const overall = tagsScore + imagesScore + titleScore + descScore;
  const color = overall >= 75 ? '#4caf50' : overall >= 50 ? '#ff9800' : '#f44336';
  const grade = scoreToGrade(overall);

  return {
    tags: { score: tagsScore, color: tagsColor, label: tagsLabel },
    images: { score: imagesScore, color: imagesColor, label: imagesLabel },
    title: { score: titleScore, color: titleColor, label: titleLabel },
    description: { score: descScore, color: descColor, label: descLabel },
    overall,
    color,
    grade,
  };
}

/** Compute Etsy expiration: created + 4 months */
function getExpiresDate(createdTs: number): string {
  if (!createdTs) return '\u2014';
  try {
    const d = new Date(createdTs * 1000);
    d.setMonth(d.getMonth() + 4);
    if (isNaN(d.getTime())) return '\u2014';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear().toString().slice(-2)}`;
  } catch {
    return '\u2014';
  }
}

// ---------------------------------------------------------------------------
// Mobile Card Component
// ---------------------------------------------------------------------------

function MobileEtsyListingCard({
  listing,
  onEdit,
  onCopy,
  onDelete,
  onRenew,
  onDeactivate,
  selected,
  onToggleSelect,
  sectionName,
}: {
  listing: EtsyListingRow;
  onEdit: (listingId: number) => void;
  onCopy: (listingId: number) => void;
  onDelete: (listingId: number) => void;
  onRenew: (listingId: number) => void;
  onDeactivate: (listingId: number) => void;
  selected?: boolean;
  onToggleSelect?: (listingId: number) => void;
  sectionName?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const health = calculateHealth(listing);
  const t = useTranslations('etsyListings');

  return (
    <Paper sx={{ mb: 1, overflow: 'hidden', borderRadius: 2, maxWidth: '100%', width: '100%', border: selected ? '2px solid' : '1px solid', borderColor: selected ? 'primary.main' : 'divider' }}>
      {/* Always-visible header: checkbox + thumbnail + title + price row */}
      <Box
        sx={{
          display: 'flex',
          gap: 1,
          p: 1.5,
          cursor: 'pointer',
          alignItems: 'center',
          minHeight: 44,
          overflow: 'hidden',
          maxWidth: '100%',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Checkbox for bulk select */}
        {onToggleSelect && (
          <Checkbox
            checked={!!selected}
            onChange={(e) => { e.stopPropagation(); onToggleSelect(listing.listing_id); }}
            onClick={(e) => e.stopPropagation()}
            size="small"
            sx={{ p: 0.5, flexShrink: 0 }}
          />
        )}

        {/* Thumbnail */}
        {listing.thumbnail ? (
          <Box
            component="img"
            src={listing.thumbnail.url_170x135}
            alt=""
            sx={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }}
          />
        ) : (
          <Box
            sx={{
              width: 52,
              height: 52,
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
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              lineHeight: 1.3,
              wordBreak: 'break-word',
              maxWidth: '100%',
              fontSize: '0.82rem',
            }}
          >
            {listing.title}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', mt: 0.25, flexWrap: 'wrap' }}>
            <Typography variant="body2" fontWeight={600} fontSize="0.82rem">
              {formatPrice(listing.price)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('stockLabel')}: {listing.quantity}
            </Typography>
            <Chip
              label={listing.state === 'active' ? t('stateActive') : listing.state === 'draft' ? t('stateDraft') : listing.state === 'inactive' ? t('stateInactive') : listing.state === 'expired' ? t('stateExpired') : listing.state}
              size="small"
              color={STATE_COLORS[listing.state] || 'default'}
              variant="outlined"
              sx={{ height: 24, '& .MuiChip-label': { px: 0.75 } }}
            />
            {/* Score badge */}
            <Chip
              label={health.overall}
              size="small"
              sx={{
                height: 20,
                fontSize: 10,
                fontWeight: 700,
                bgcolor: `${health.color}15`,
                color: health.color,
                border: `1px solid ${health.color}`,
                '& .MuiChip-label': { px: 0.5 },
              }}
            />
          </Box>
        </Box>

        {/* Expand icon */}
        <IconButton size="small" sx={{ flexShrink: 0, minWidth: 40, minHeight: 40 }}>
          {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Box>

      {/* Expandable details */}
      <Collapse in={expanded}>
        <Box sx={{ px: 1.5, pb: 1.5, borderTop: '1px solid', borderColor: 'divider', overflow: 'hidden', maxWidth: '100%' }}>
          {/* Tags */}
          {listing.tags && listing.tags.length > 0 && (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                {t('tagsCount', { count: listing.tags.length })}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {listing.tags.map((tag, i) => (
                  <Chip key={i} label={tag} size="small" sx={{ height: 22, fontSize: 11 }} />
                ))}
              </Box>
            </Box>
          )}

          {/* Stats row */}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
            <Box sx={{ flex: '1 1 45%' }}>
              <Typography variant="caption" color="text.secondary">{t('viewsLabel')}</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <VisibilityIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                <Typography variant="body2">{listing.views.toLocaleString()}</Typography>
              </Box>
            </Box>
            <Box sx={{ flex: '1 1 45%' }}>
              <Typography variant="caption" color="text.secondary">{t('favoritesLabel')}</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <FavoriteBorderIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                <Typography variant="body2">{listing.num_favorers.toLocaleString()}</Typography>
              </Box>
            </Box>
            <Box sx={{ flex: '1 1 45%' }}>
              <Typography variant="caption" color="text.secondary">{t('imagesLabel')}</Typography>
              <Typography variant="body2">{listing.has_video ? t('imagesWithVideo', { count: listing.image_count }) : t('imagesCount', { count: listing.image_count })}</Typography>
            </Box>
            <Box sx={{ flex: '1 1 45%' }}>
              <Typography variant="caption" color="text.secondary">{t('lastUpdate')}</Typography>
              <Typography variant="body2">{formatTimestamp(listing.updated_timestamp)}</Typography>
            </Box>
            {sectionName && (
              <Box sx={{ flex: '1 1 45%' }}>
                <Typography variant="caption" color="text.secondary">{t('sectionLabel')}</Typography>
                <Typography variant="body2">{sectionName}</Typography>
              </Box>
            )}
          </Box>

          {/* Health breakdown chips */}
          <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {([
              { ...health.tags, label: t('tagsCount', { count: health.tags.label }) },
              { ...health.images, label: t('imagesCount', { count: health.images.label }) },
              { ...health.title, label: t('titleChars', { count: health.title.label }) },
              { ...health.description, label: t('descChars', { count: health.description.label }) },
            ]).map((item, i) => (
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
              variant="contained"
              startIcon={<EditIcon sx={{ fontSize: '16px !important' }} />}
              onClick={(e) => { e.stopPropagation(); onEdit(listing.listing_id); }}
              sx={{
                flex: 1, minHeight: 42, borderRadius: '10px', textTransform: 'none', fontWeight: 600, fontSize: '0.8rem',
                background: 'linear-gradient(135deg, #3b82f6, #2563eb)', boxShadow: '0 2px 8px rgba(37,99,235,0.25)',
                '&:hover': { background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' },
              }}
            >
              {t('edit')}
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={<ContentCopyIcon sx={{ fontSize: '16px !important' }} />}
              onClick={(e) => { e.stopPropagation(); onCopy(listing.listing_id); }}
              sx={{
                flex: 1, minHeight: 42, borderRadius: '10px', textTransform: 'none', fontWeight: 600, fontSize: '0.8rem',
                background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', boxShadow: '0 2px 8px rgba(124,58,237,0.25)',
                '&:hover': { background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' },
              }}
            >
              {t('copy')}
            </Button>
            {(listing.state === 'active' || listing.state === 'expired' || listing.state === 'inactive') && (
              <Button
                size="small"
                variant="contained"
                startIcon={<RefreshIcon sx={{ fontSize: '16px !important' }} />}
                onClick={(e) => { e.stopPropagation(); onRenew(listing.listing_id); }}
                sx={{
                  flex: 1, minHeight: 42, borderRadius: '10px', textTransform: 'none', fontWeight: 600, fontSize: '0.8rem',
                  background: 'linear-gradient(135deg, #22c55e, #16a34a)', boxShadow: '0 2px 8px rgba(22,163,74,0.25)',
                  '&:hover': { background: 'linear-gradient(135deg, #16a34a, #15803d)' },
                }}
              >
                {t('renew')}
              </Button>
            )}
            {listing.state === 'active' && (
              <Button
                size="small"
                variant="contained"
                startIcon={<RemoveCircleOutlineIcon sx={{ fontSize: '16px !important' }} />}
                onClick={(e) => { e.stopPropagation(); onDeactivate(listing.listing_id); }}
                sx={{
                  flex: 1, minHeight: 42, borderRadius: '10px', textTransform: 'none', fontWeight: 600, fontSize: '0.8rem',
                  background: 'linear-gradient(135deg, #f59e0b, #d97706)', boxShadow: '0 2px 8px rgba(217,119,6,0.25)',
                  '&:hover': { background: 'linear-gradient(135deg, #d97706, #b45309)' },
                }}
              >
                {t('deactivate')}
              </Button>
            )}
            <Button
              size="small"
              variant="contained"
              startIcon={<DeleteIcon sx={{ fontSize: '16px !important' }} />}
              onClick={(e) => { e.stopPropagation(); onDelete(listing.listing_id); }}
              sx={{
                flex: 1, minHeight: 42, borderRadius: '10px', textTransform: 'none', fontWeight: 600, fontSize: '0.8rem',
                background: 'linear-gradient(135deg, #ef4444, #dc2626)', boxShadow: '0 2px 8px rgba(220,38,38,0.25)',
                '&:hover': { background: 'linear-gradient(135deg, #dc2626, #b91c1c)' },
              }}
            >
              {t('delete')}
            </Button>
          </Box>

          {listing.url && (
            <Button
              size="small"
              variant="text"
              href={listing.url}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ mt: 0.5, fontSize: 11 }}
            >
              {t('viewOnEtsy')}
            </Button>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Left Sidebar Component (desktop only)
// ---------------------------------------------------------------------------

function LeftSidebar({
  shops,
  selectedShopId,
  onSelectShop,
  statusFilter,
  onStatusChange,
  statusCounts,
  shopSections,
  sectionCounts,
  sectionFilter,
  onSectionChange,
  healthFilter,
  onHealthChange,
  excludeTerm,
  onExcludeTermChange,
}: {
  shops: ShopInfo[];
  selectedShopId: string;
  onSelectShop: (id: string) => void;
  statusFilter: string;
  onStatusChange: (s: 'active' | 'draft' | 'inactive' | 'expired') => void;
  statusCounts: Record<string, number>;
  shopSections: ShopSection[];
  sectionCounts: Record<number, number>;
  sectionFilter: string;
  onSectionChange: (id: string) => void;
  healthFilter: string;
  onHealthChange: (f: string) => void;
  excludeTerm: string;
  onExcludeTermChange: (t: string) => void;
}) {
  const [sectionsExpanded, setSectionsExpanded] = useState(true);
  const t = useTranslations('etsyListings');

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
      {/* Shop Selector */}
      {shops.length > 1 && (
        <Paper sx={{ p: 1.5, mb: 1.5, borderRadius: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
            <StoreIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10 }}>
              {t('shopLabel')}
            </Typography>
          </Box>
          {shops.map((s) => (
            <Box
              key={s.shopId}
              onClick={() => onSelectShop(s.shopId)}
              sx={{
                px: 1,
                py: 0.5,
                borderRadius: 1,
                cursor: 'pointer',
                bgcolor: selectedShopId === s.shopId ? 'primary.50' : 'transparent',
                color: selectedShopId === s.shopId ? 'primary.main' : 'text.primary',
                fontWeight: selectedShopId === s.shopId ? 700 : 400,
                fontSize: '0.82rem',
                '&:hover': { bgcolor: selectedShopId === s.shopId ? 'primary.50' : 'action.hover' },
              }}
            >
              {s.shopName}
            </Box>
          ))}
        </Paper>
      )}

      {/* Etsy - Status Filters */}
      <Paper sx={{ p: 1.5, mb: 1.5, borderRadius: 2 }}>
        <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, mb: 0.5, display: 'block' }}>
          Etsy
        </Typography>
        {(['active', 'draft', 'inactive', 'expired'] as const).map((state) => {
          const count = statusCounts[state] || 0;
          const isSelected = statusFilter === state;
          return (
            <Box
              key={state}
              onClick={() => onStatusChange(state)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                px: 1,
                py: 0.5,
                borderRadius: 1,
                cursor: 'pointer',
                bgcolor: isSelected ? 'primary.50' : 'transparent',
                color: isSelected ? 'primary.main' : 'text.primary',
                fontWeight: isSelected ? 700 : 400,
                fontSize: '0.82rem',
                '&:hover': { bgcolor: isSelected ? 'primary.50' : 'action.hover' },
                transition: 'all 0.15s ease',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <CircleIcon sx={{
                  fontSize: 8,
                  color: state === 'active' ? '#4caf50' : state === 'draft' ? '#9e9e9e' : state === 'inactive' ? '#f44336' : '#ff9800',
                }} />
                <span>{state === 'active' ? t('stateActive') : state === 'draft' ? t('stateDraft') : state === 'inactive' ? t('stateInactive') : t('stateExpired')}</span>
              </Box>
              <Typography variant="caption" sx={{ color: isSelected ? 'primary.main' : 'text.secondary', fontWeight: isSelected ? 700 : 400 }}>
                {count}
              </Typography>
            </Box>
          );
        })}
      </Paper>

      {/* Score Filter */}
      <Paper sx={{ p: 1.5, mb: 1.5, borderRadius: 2 }}>
        <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10, mb: 1, display: 'block' }}>
          {t('listingScore')}
        </Typography>
        <FormControl size="small" fullWidth>
          <Select
            value={healthFilter}
            onChange={(e) => onHealthChange(e.target.value)}
            displayEmpty
            sx={{ fontSize: '0.82rem', '& .MuiSelect-select': { py: 0.75 } }}
          >
            <MenuItem value="">{t('healthAll')}</MenuItem>
            <MenuItem value="issues">{t('healthIssues')}</MenuItem>
            <MenuItem value="missing_images">{t('healthMissingImages')}</MenuItem>
            <MenuItem value="missing_tags">{t('healthMissingTags')}</MenuItem>
            <MenuItem value="short_title">{t('healthShortTitle')}</MenuItem>
            <MenuItem value="no_description">{t('healthNoDescription')}</MenuItem>
            <MenuItem value="no_video">{t('healthNoVideo')}</MenuItem>
            <MenuItem value="no_stock">{t('healthNoStock')}</MenuItem>
          </Select>
        </FormControl>
      </Paper>

      {/* Section Filter */}
      {shopSections.length > 0 && (
        <Paper sx={{ p: 1.5, mb: 1.5, borderRadius: 2 }}>
          <Box
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', mb: 0.5 }}
            onClick={() => setSectionsExpanded(!sectionsExpanded)}
          >
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10 }}>
              {t('sectionLabel')}
            </Typography>
            {sectionsExpanded ? <ExpandLessIcon sx={{ fontSize: 16, color: 'text.secondary' }} /> : <ExpandMoreIcon sx={{ fontSize: 16, color: 'text.secondary' }} />}
          </Box>
          <Collapse in={sectionsExpanded}>
            {/* All sections */}
            <Box
              onClick={() => onSectionChange('')}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                px: 1,
                py: 0.4,
                borderRadius: 1,
                cursor: 'pointer',
                bgcolor: !sectionFilter ? 'primary.50' : 'transparent',
                color: !sectionFilter ? 'primary.main' : 'text.primary',
                fontWeight: !sectionFilter ? 700 : 400,
                fontSize: '0.8rem',
                '&:hover': { bgcolor: !sectionFilter ? 'primary.50' : 'action.hover' },
              }}
            >
              <span>{t('allSections')}</span>
            </Box>
            {shopSections.map((sec) => {
              const count = sectionCounts[sec.shop_section_id] || 0;
              const isSelected = sectionFilter === String(sec.shop_section_id);
              return (
                <Box
                  key={sec.shop_section_id}
                  onClick={() => onSectionChange(String(sec.shop_section_id))}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    px: 1,
                    py: 0.4,
                    borderRadius: 1,
                    cursor: 'pointer',
                    bgcolor: isSelected ? 'primary.50' : 'transparent',
                    color: isSelected ? 'primary.main' : 'text.primary',
                    fontWeight: isSelected ? 700 : 400,
                    fontSize: '0.8rem',
                    '&:hover': { bgcolor: isSelected ? 'primary.50' : 'action.hover' },
                    overflow: 'hidden',
                  }}
                >
                  <Typography noWrap sx={{ fontSize: 'inherit', fontWeight: 'inherit', color: 'inherit', flex: 1, minWidth: 0 }}>
                    {sec.title}
                  </Typography>
                  <Typography variant="caption" sx={{ color: isSelected ? 'primary.main' : 'text.secondary', fontWeight: isSelected ? 700 : 400, ml: 0.5, flexShrink: 0 }}>
                    {count}
                  </Typography>
                </Box>
              );
            })}
          </Collapse>
        </Paper>
      )}

      {/* Exclude term */}
      <Paper sx={{ p: 1.5, mb: 1.5, borderRadius: 2 }}>
        <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10, mb: 1, display: 'block' }}>
          {t('excludeLabel')}
        </Typography>
        <TextField
          size="small"
          fullWidth
          placeholder={t('excludePlaceholder')}
          value={excludeTerm}
          onChange={(e) => onExcludeTermChange(e.target.value)}
          sx={{ '& .MuiInputBase-input': { fontSize: '0.82rem', py: 0.75 } }}
          InputProps={{
            startAdornment: <InputAdornment position="start"><RemoveCircleOutlineIcon sx={{ fontSize: 16, color: 'error.main' }} /></InputAdornment>,
          }}
        />
      </Paper>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

function EtsyListingsPage() {
  const { user } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const t = useTranslations('etsyListings');

  // --- State ---
  const [listings, setListings] = useState<EtsyListingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  // In-memory cache: avoid re-fetching when switching back to same shop+status
  const listingsCacheRef = useRef<Record<string, { listings: EtsyListingRow[]; total: number; ts: number }>>({});

  // We cache status counts per shop to show in sidebar without re-fetching
  const statusCountsCacheRef = useRef<Record<string, Record<string, number>>>({});
  const [statusCountsVersion, setStatusCountsVersion] = useState(0);

  const [selectedIds, setSelectedIds] = useState<GridRowSelectionModel>({ type: 'include' as const, ids: new Set<GridRowId>() });
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'draft' | 'inactive' | 'expired'>('active');
  const [sectionFilter, setSectionFilter] = useState<string>('');
  const [healthFilter, setHealthFilter] = useState<string>('');
  const [excludeTerm, setExcludeTerm] = useState('');

  const [drawerListingId, setDrawerListingId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerRefreshKey, setDrawerRefreshKey] = useState(0);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [smartPricingOpen, setSmartPricingOpen] = useState(false);
  const [duplicateDetectorOpen, setDuplicateDetectorOpen] = useState(false);
  const [backupManagerOpen, setBackupManagerOpen] = useState(false);
  const [bulkEditorOpen, setBulkEditorOpen] = useState(false);

  const [shops, setShops] = useState<ShopInfo[]>([]);
  const [selectedShopId, setSelectedShopId] = useState<string>('');
  const selectedShopIdRef = useRef<string>('');
  selectedShopIdRef.current = selectedShopId;
  const [shopSections, setShopSections] = useState<ShopSection[]>([]);
  const [shippingProfiles, setShippingProfiles] = useState<ShippingProfile[]>([]);
  const [returnPolicies, setReturnPolicies] = useState<ReturnPolicy[]>([]);

  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({
    page: 0,
    pageSize: 25,
  });

  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [pendingDraftsByListing, setPendingDraftsByListing] = useState<Record<string, any>>({});

  // Mobile card pagination
  const [mobileVisibleCount, setMobileVisibleCount] = useState(25);

  // Toolbar menus
  const [toolsMenuAnchor, setToolsMenuAnchor] = useState<null | HTMLElement>(null);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  // Mobile selection state (for mobile cards)
  const mobileSelectedIds = useMemo(() => {
    if ('ids' in selectedIds) return selectedIds.ids;
    return new Set<GridRowId>();
  }, [selectedIds]);

  const handleMobileToggleSelect = useCallback((listingId: number) => {
    setSelectedIds((prev) => {
      const ids = new Set('ids' in prev ? prev.ids : []);
      if (ids.has(listingId)) {
        ids.delete(listingId);
      } else {
        ids.add(listingId);
      }
      return { type: 'include' as const, ids };
    });
  }, []);

  // CSV Import state
  const [csvImportDialogOpen, setCsvImportDialogOpen] = useState(false);
  const [csvImportRows, setCsvImportRows] = useState<Record<string, string>[]>([]);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvImportProgress, setCsvImportProgress] = useState(0);

  // --- Fetch shops via API ---
  useEffect(() => {
    if (!(user as any)?.id) return;
    (async () => {
      try {
        const res = await fetch('/api/integrations/etsy/shops');
        if (!res.ok) {
          console.error('Failed to fetch Etsy shops:', res.status);
          return;
        }
        const data = await res.json();
        const shopList: ShopInfo[] = (data.shops || []).map((s: any) => ({
          shopId: s.shopId,
          shopName: s.shopName || s.shopId,
          isActive: s.isActive,
        }));
        setShops(shopList);
        if (shopList.length > 0 && !selectedShopId) {
          setSelectedShopId(shopList[0].shopId);
        }
      } catch (err) {
        console.error('Failed to fetch Etsy shops:', err);
      }
    })();
  }, [(user as any)?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Fetch listings ---
  const mapListing = (l: any): EtsyListingRow => {
    const thumb = l.thumbnail || (l.images?.[0] ? {
      listing_image_id: l.images[0].listing_image_id,
      url_75x75: l.images[0].url_75x75,
      url_170x135: l.images[0].url_170x135,
      url_570xN: l.images[0].url_570xN,
    } : null);
    return {
      id: l.listing_id,
      listing_id: l.listing_id,
      title: l.title || '',
      description: l.description || '',
      tags: l.tags || [],
      materials: l.materials || [],
      price: l.price || null,
      views: l.views || 0,
      num_favorers: l.num_favorers || 0,
      quantity: l.quantity || 0,
      state: l.state || 'draft',
      url: l.url || '',
      taxonomy_id: l.taxonomy_id || null,
      shop_section_id: l.shop_section_id || null,
      who_made: l.who_made || '',
      when_made: l.when_made || '',
      is_supply: l.is_supply || false,
      processing_min: l.processing_min,
      processing_max: l.processing_max,
      shipping_profile_id: l.shipping_profile_id,
      return_policy_id: l.return_policy_id,
      item_weight: l.item_weight,
      item_weight_unit: l.item_weight_unit,
      item_length: l.item_length,
      item_width: l.item_width,
      item_height: l.item_height,
      item_dimensions_unit: l.item_dimensions_unit,
      is_personalizable: l.is_personalizable,
      created_timestamp: l.created_timestamp || 0,
      updated_timestamp: l.updated_timestamp || 0,
      thumbnail: thumb,
      image_count: l.image_count || (l.images ? l.images.length : 0),
      has_video: l.has_video || false,
    };
  };

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [bulkSyncingDrafts, setBulkSyncingDrafts] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  // Load listings from Etsy API (with in-memory cache)
  const fetchListings = useCallback(async () => {
    if (!selectedShopId) return;

    // Check in-memory cache (5 min TTL)
    const cacheKey = `${selectedShopId}:${statusFilter}`;
    const cached = listingsCacheRef.current[cacheKey];
    if (cached && Date.now() - cached.ts < 300_000) {
      setListings(cached.listings);
      setTotalCount(cached.total);
      return;
    }

    setLoading(true);
    try {
      const state = statusFilter || 'active';
      const LIMIT = 100;
      let allRows: EtsyListingRow[] = [];
      let totalFromApi = 0;
      let offset = 0;

      // Fetch first page
      const apiRes = await fetch(
        `/api/clawd/etsy?action=listings_with_images&shop_id=${selectedShopId}&state=${state}&limit=${LIMIT}&offset=0`
      );
      if (!apiRes.ok) throw new Error(`HTTP ${apiRes.status}`);
      const apiData = await apiRes.json();
      allRows = (apiData.listings || []).map(mapListing);
      totalFromApi = apiData.count || allRows.length;

      // Show first page immediately while fetching rest
      setListings(allRows);
      setTotalCount(totalFromApi);

      // Fetch remaining pages if more exist
      if (totalFromApi > LIMIT) {
        offset = LIMIT;
        while (offset < totalFromApi) {
          const nextRes = await fetch(
            `/api/clawd/etsy?action=listings_with_images&shop_id=${selectedShopId}&state=${state}&limit=${LIMIT}&offset=${offset}`
          );
          if (!nextRes.ok) break;
          const nextData = await nextRes.json();
          const nextRows = (nextData.listings || []).map(mapListing);
          if (nextRows.length === 0) break;
          allRows = [...allRows, ...nextRows];
          setListings(allRows);
          offset += LIMIT;
        }
      }

      setTotalCount(allRows.length);
      listingsCacheRef.current[cacheKey] = { listings: allRows, total: allRows.length, ts: Date.now() };

      // Update current state count immediately
      const existingCounts = statusCountsCacheRef.current[selectedShopId] || {};
      existingCounts[state] = allRows.length;
      statusCountsCacheRef.current[selectedShopId] = existingCounts;
    } catch (err: any) {
      console.error('Failed to fetch listings:', err);
      toast.error(t('loadFailed', { error: err.message }));
    }
    setLoading(false);
  }, [selectedShopId, statusFilter]);

  // Fetch sidebar counts for other states (non-blocking, after listings load)
  const fetchStatusCounts = useCallback(async () => {
    if (!selectedShopId) return;
    if (statusCountsCacheRef.current[selectedShopId]?._fetched) return;

    const allStates = ['active', 'draft', 'inactive', 'expired'] as const;
    const countPromises = allStates.map(async (s) => {
      // Reuse already-known count from listings fetch
      const known = statusCountsCacheRef.current[selectedShopId]?.[s];
      if (known !== undefined) return { state: s, count: known };
      try {
        const r = await fetch(
          `/api/clawd/etsy?action=listing_count&shop_id=${selectedShopId}&state=${s}`
        );
        if (r.ok) {
          const d = await r.json();
          return { state: s, count: d.count || 0 };
        }
      } catch {}
      return { state: s, count: 0 };
    });
    const results = await Promise.all(countPromises);
    const counts: Record<string, number> = { _fetched: 1 };
    for (const c of results) counts[c.state] = c.count;
    statusCountsCacheRef.current[selectedShopId] = counts;
    setStatusCountsVersion(v => v + 1);
  }, [selectedShopId]);

  // Sync listings from Etsy API → DB (manual, like Vela)
  const syncListings = useCallback(async () => {
    if (!selectedShopId || syncing) return;
    setSyncing(true);
    const toastId = toast.loading(t('syncInProgress'));
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=sync_listings&shop_id=${selectedShopId}`,
        { method: 'POST' }
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setLastSyncAt(data.lastSyncAt);
      toast.success(t('syncSuccess', { count: data.synced }), { id: toastId });

      // Clear in-memory cache and refetch from DB inline (no circular call)
      Object.keys(listingsCacheRef.current).forEach(key => {
        if (key.startsWith(selectedShopId)) delete listingsCacheRef.current[key];
      });
      statusCountsCacheRef.current[selectedShopId] = {};

      // Inline DB refetch
      const refetchRes = await fetch(
        `/api/clawd/etsy?action=cached_listings&shop_id=${selectedShopId}&state=${statusFilter}`
      );
      if (refetchRes.ok) {
        const refetchData = await refetchRes.json();
        const rows: EtsyListingRow[] = (refetchData.listings || []).map(mapListing);
        setListings(rows);
        setTotalCount(refetchData.count || rows.length);
        if (refetchData.stateCounts) {
          statusCountsCacheRef.current[selectedShopId] = refetchData.stateCounts;
        }
        const cacheKey = `${selectedShopId}:${statusFilter}`;
        listingsCacheRef.current[cacheKey] = { listings: rows, total: refetchData.count || rows.length, ts: Date.now() };
      }
    } catch (err: any) {
      console.error('Sync failed:', err);
      toast.error(t('syncFailed', { error: err.message }), { id: toastId });
    }
    setSyncing(false);
  }, [selectedShopId, syncing, statusFilter]);

  // --- Fetch shop metadata (sections, shipping profiles, return policies) ---
  const fetchShopMeta = useCallback(async () => {
    if (!selectedShopId) return;
    try {
      const [sectionsRes, shippingRes, returnRes] = await Promise.all([
        fetch(`/api/clawd/etsy?action=get_shop_sections&shop_id=${selectedShopId}`),
        fetch(`/api/clawd/etsy?action=get_shipping_profiles&shop_id=${selectedShopId}`),
        fetch(`/api/clawd/etsy?action=get_return_policies&shop_id=${selectedShopId}`),
      ]);

      if (sectionsRes.ok) {
        const d = await sectionsRes.json();
        setShopSections(d.shop_sections || d.results || []);
      }
      if (shippingRes.ok) {
        const d = await shippingRes.json();
        setShippingProfiles(d.shipping_profiles || d.results || []);
      }
      if (returnRes.ok) {
        const d = await returnRes.json();
        setReturnPolicies(d.return_policies || d.results || []);
      }
    } catch (err) {
      console.error('Failed to fetch shop metadata:', err);
    }
  }, [selectedShopId]);

  const fetchPendingDrafts = useCallback(async () => {
    if (!selectedShopId) {
      setPendingDraftsByListing({});
      return;
    }
    try {
      const drafts = await fetchEtsyDrafts(selectedShopId);
      const next: Record<string, any> = {};
      for (const draft of drafts) {
        next[String(draft.etsyListingId)] = draft;
      }
      setPendingDraftsByListing(next);
    } catch (err) {
      console.error('Failed to fetch Etsy drafts:', err);
    }
  }, [selectedShopId]);

  useEffect(() => {
    if (selectedShopId) {
      fetchListings().then(() => fetchStatusCounts());
      fetchShopMeta();
      fetchPendingDrafts();
    }
  }, [selectedShopId, statusFilter, fetchListings, fetchShopMeta, fetchStatusCounts, fetchPendingDrafts]);

  // NOTE: Auto-sync removed — sync is manual only (Sync button)

  // Reset pagination to page 0 when filters change
  useEffect(() => {
    setPaginationModel((prev) => (prev.page !== 0 ? { ...prev, page: 0 } : prev));
    setMobileVisibleCount(25);
  }, [searchTerm, sectionFilter, excludeTerm, healthFilter]);

  // Pre-compute health scores to avoid recalculating per filter toggle
  const healthMap = useMemo(() => {
    const map = new Map<number, ReturnType<typeof calculateHealth>>();
    listings.forEach((l) => map.set(l.listing_id, calculateHealth(l)));
    return map;
  }, [listings]);

  // --- Status counts for sidebar ---
  const statusCounts = useMemo(() => {
    // Use cached counts from API responses, fall back to current listing count for current filter
    const cached = statusCountsCacheRef.current[selectedShopId] || {};
    return {
      active: cached.active ?? (statusFilter === 'active' ? totalCount : 0),
      draft: cached.draft ?? (statusFilter === 'draft' ? totalCount : 0),
      inactive: cached.inactive ?? (statusFilter === 'inactive' ? totalCount : 0),
      expired: cached.expired ?? (statusFilter === 'expired' ? totalCount : 0),
    };
  }, [selectedShopId, totalCount, statusFilter, statusCountsVersion]);

  // --- Section counts from current listings ---
  const sectionCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    listings.forEach((l) => {
      if (l.shop_section_id) {
        counts[l.shop_section_id] = (counts[l.shop_section_id] || 0) + 1;
      }
    });
    return counts;
  }, [listings]);

  // Section name lookup
  const sectionNameMap = useMemo(() => {
    const map: Record<number, string> = {};
    shopSections.forEach((s) => { map[s.shop_section_id] = s.title; });
    return map;
  }, [shopSections]);

  // --- Client-side filtering ---
  const filteredListings = useMemo(() => {
    let result = listings;
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter((l) => l.title.toLowerCase().includes(term));
    }
    if (sectionFilter) {
      const secId = Number(sectionFilter);
      result = result.filter((l) => l.shop_section_id === secId);
    }
    if (excludeTerm.trim()) {
      const exc = excludeTerm.toLowerCase();
      result = result.filter((l) => {
        const title = (l.title || '').toLowerCase();
        const desc = (l.description || '').toLowerCase();
        const tags = (l.tags || []).join(' ').toLowerCase();
        return !title.includes(exc) && !desc.includes(exc) && !tags.includes(exc);
      });
    }
    if (healthFilter) {
      result = result.filter((l) => {
        const h = healthMap.get(l.listing_id) || calculateHealth(l);
        switch (healthFilter) {
          case 'issues': return h.overall < 70;
          case 'missing_images': return l.image_count < 10;
          case 'missing_tags': return (l.tags?.length || 0) < 13;
          case 'short_title': return (l.title?.length || 0) < 100;
          case 'no_description': return (l.description?.length || 0) < 200;
          case 'no_video': return !l.has_video;
          case 'no_stock': return l.quantity === 0;
          default: return true;
        }
      });
    }
    return result;
  }, [listings, searchTerm, sectionFilter, excludeTerm, healthFilter, healthMap]);

  // --- Quick stats ---
  const quickStats = useMemo(() => {
    const totalViews = listings.reduce((s, l) => s + (l.views || 0), 0);
    const totalFavs = listings.reduce((s, l) => s + (l.num_favorers || 0), 0);
    const outOfStock = listings.filter(l => l.quantity === 0).length;
    const withIssues = listings.filter(l => {
      const h = healthMap.get(l.listing_id) || calculateHealth(l);
      return h.overall < 70;
    }).length;
    return { totalViews, totalFavs, outOfStock, withIssues };
  }, [listings, healthMap]);

  // --- Delete listing ---
  const handleDeleteListing = useCallback(
    async (listingId: number) => {
      try {
        await stageEtsyDraft({ shopId: selectedShopId, listingId, queuedActions: [{ type: 'delete' }] });
        await fetchPendingDrafts();
        toast.success('Delete queued in draft. Sync to Etsy to apply.');
        setDeleteConfirmId(null);
      } catch (err: any) {
        toast.error(t('deleteFailed', { error: err.message }));
      }
    },
    [selectedShopId, fetchPendingDrafts]
  );

  // --- Renew listing ---
  const handleRenewListing = useCallback(
    async (listingId: number) => {
      try {
        await stageEtsyDraft({ shopId: selectedShopId, listingId, queuedActions: [{ type: 'renew' }] });
        await fetchPendingDrafts();
        toast.success('Renew queued in draft. Sync to Etsy to apply.');
      } catch (err: any) {
        toast.error(t('renewFailed') + ': ' + err.message);
      }
    },
    [selectedShopId, fetchPendingDrafts]
  );

  // --- Deactivate listing ---
  const handleDeactivateListing = useCallback(
    async (listingId: number) => {
      try {
        await stageEtsyDraft({ shopId: selectedShopId, listingId, queuedActions: [{ type: 'deactivate' }] });
        await fetchPendingDrafts();
        toast.success('Deactivate queued in draft. Sync to Etsy to apply.');
      } catch (err: any) {
        toast.error(t('deactivateFailed') + ': ' + err.message);
      }
    },
    [selectedShopId, fetchPendingDrafts]
  );

  // --- CSV Export ---
  const handleExportCSV = () => {
    if (filteredListings.length === 0) {
      toast.error(t('noListingsToExport'));
      return;
    }
    const rows = filteredListings.map((l) => ({
      listing_id: l.listing_id,
      title: l.title,
      description: (l.description || '').substring(0, 200),
      tags: l.tags.join('|'),
      price: l.price ? (l.price.amount / l.price.divisor).toFixed(2) : '',
      quantity: l.quantity,
      views: l.views,
      favorites: l.num_favorers,
      state: l.state,
      url: l.url,
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
    a.download = `etsy-listings-${new Date().toISOString().split('T')[0]}.csv`;
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
        const validRows = rows.filter((r) => r.listing_id && r.listing_id.trim() !== '');
        if (validRows.length === 0) {
          toast.error(t('csvNoListingIdColumn'));
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
      const listingId = parseInt(row.listing_id, 10);
      if (isNaN(listingId)) {
        failed++;
        continue;
      }

      const body: Record<string, any> = {};
      if (row.title !== undefined && row.title !== '') body.title = row.title;
      if (row.description !== undefined && row.description !== '') body.description = row.description;
      if (row.tags !== undefined && row.tags !== '') body.tags = row.tags.split('|').map((t: string) => t.trim()).filter(Boolean);
      if (row.materials !== undefined && row.materials !== '') body.materials = row.materials.split('|').map((m: string) => m.trim()).filter(Boolean);
      if (row.price !== undefined && row.price !== '') { const p = parseFloat(row.price); if (!isNaN(p)) body.price = p; }
      if (row.quantity !== undefined && row.quantity !== '') { const q = parseInt(row.quantity, 10); if (!isNaN(q)) body.quantity = q; }
      if (row.state !== undefined && row.state !== '') body.state = row.state;

      if (Object.keys(body).length === 0) {
        failed++;
        setCsvImportProgress(((i + 1) / csvImportRows.length) * 100);
        continue;
      }

      try {
        await stageEtsyDraft({ shopId: selectedShopId, listingId, fields: body });
        succeeded++;
      } catch {
        failed++;
      }

      setCsvImportProgress(((i + 1) / csvImportRows.length) * 100);

      if (i < csvImportRows.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    setCsvImporting(false);
    setCsvImportProgress(0);
    setCsvImportDialogOpen(false);
    setCsvImportRows([]);

    if (failed === 0) {
      toast.success(t('csvImportComplete', { count: succeeded }));
    } else {
      toast.error(t('csvImportPartial', { succeeded, failed }));
    }

    fetchPendingDrafts();
  };

  // --- Inline edit handler (double-click title/price in DataGrid) ---
  const handleProcessRowUpdate = useCallback(
    async (newRow: EtsyListingRow, oldRow: EtsyListingRow) => {
      const body: Record<string, any> = {};
      if (newRow.title !== oldRow.title) body.title = newRow.title;
      if (newRow.price !== oldRow.price) {
        const newPrice = parseFloat((newRow as any).price);
        if (!isNaN(newPrice)) body.price = newPrice;
      }
      if (Object.keys(body).length === 0) return oldRow;

      try {
        await stageEtsyDraft({ shopId: selectedShopId, listingId: newRow.listing_id, fields: body });
        await fetchPendingDrafts();
        toast.success('Draft saved. Sync to Etsy to apply.');
        return oldRow;
      } catch (err: any) {
        toast.error(t('updateFailed', { error: err.message }));
        return oldRow;
      }
    },
    [selectedShopId, fetchPendingDrafts]
  );

  // --- Open editor drawer ---
  const handleOpenEditor = (listingId: number) => {
    setDrawerListingId(String(listingId));
    setDrawerOpen(true);
  };

  // --- Copy listing -> create draft on Etsy, then open Editor Drawer ---
  const handleCopyListing = async (listingId: number) => {
    const shopId = selectedShopIdRef.current;
    if (!shopId) return;
    const toastId = toast.loading(t('copyCreating'));
    try {
      await stageEtsyDraft({ shopId, listingId, queuedActions: [{ type: 'copy' }] });
      await fetchPendingDrafts();
      toast.success('Copy queued in draft. Sync to Etsy to apply.', { id: toastId });
    } catch (err: any) {
      toast.error(err.message || t('copyFailed'), { id: toastId });
    }
  };

  // --- Selected listing objects for bulk operations ---
  const selectedListings = useMemo(() => {
    const idSet = 'ids' in selectedIds ? selectedIds.ids : new Set<GridRowId>();
    return filteredListings
      .filter((l) => idSet.has(l.id))
      .map((l) => ({
        listing_id: l.listing_id,
        title: l.title,
        description: l.description,
        price: l.price,
        tags: l.tags,
        materials: l.materials,
        state: l.state,
        shop_section_id: l.shop_section_id,
        thumbnail: l.thumbnail,
        quantity: l.quantity,
        who_made: l.who_made,
        when_made: l.when_made,
        is_supply: l.is_supply,
        processing_min: l.processing_min,
        processing_max: l.processing_max,
        shipping_profile_id: l.shipping_profile_id,
        return_policy_id: l.return_policy_id,
        item_weight: l.item_weight,
        item_weight_unit: l.item_weight_unit,
        item_length: l.item_length,
        item_width: l.item_width,
        item_height: l.item_height,
        item_dimensions_unit: l.item_dimensions_unit,
        is_personalizable: l.is_personalizable,
        taxonomy_id: l.taxonomy_id,
        has_video: l.has_video,
      }));
  }, [selectedIds, filteredListings]);

  const selectedCount = useMemo(() => ('ids' in selectedIds ? selectedIds.ids.size : 0), [selectedIds]);
  const selectedDraftIds = useMemo(
    () =>
      selectedListings
        .map((listing) => pendingDraftsByListing[String(listing.listing_id)]?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    [selectedListings, pendingDraftsByListing]
  );

  const handleSyncSelectedDrafts = useCallback(async () => {
    if (selectedDraftIds.length === 0 || bulkSyncingDrafts) return;

    const confirmed = window.confirm(
      `Sync ${selectedDraftIds.length} selected draft${selectedDraftIds.length === 1 ? '' : 's'} to Etsy? This will write the saved draft changes to Etsy.`
    );
    if (!confirmed) return;

    setBulkSyncingDrafts(true);
    const toastId = toast.loading(`Syncing ${selectedDraftIds.length} draft${selectedDraftIds.length === 1 ? '' : 's'} to Etsy...`);
    try {
      const result = await syncEtsyDrafts(selectedDraftIds);
      const success = result.success ?? 0;
      const failed = result.failed ?? 0;
      const conflicts = result.conflicts ?? 0;

      if (failed > 0 || conflicts > 0) {
        toast.error(`Synced ${success}. ${failed} failed, ${conflicts} blocked by conflict.`, { id: toastId });
      } else {
        toast.success(`Synced ${success} draft${success === 1 ? '' : 's'} to Etsy.`, { id: toastId });
      }

      await Promise.all([fetchPendingDrafts(), fetchListings()]);
    } catch (err: any) {
      toast.error(err.message || 'Could not sync selected drafts to Etsy', { id: toastId });
    } finally {
      setBulkSyncingDrafts(false);
    }
  }, [selectedDraftIds, bulkSyncingDrafts, fetchPendingDrafts, fetchListings]);

  // --- DataGrid Columns (Vela-style: image, title+hover actions, stock, price, expires, section, score) ---
  const columns: GridColDef[] = useMemo(
    () => [
      {
        field: 'thumbnail',
        headerName: '',
        width: 68,
        sortable: false,
        filterable: false,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => {
          const thumb = params.row.thumbnail;
          return thumb ? (
            <Box
              component="img"
              src={thumb.url_170x135}
              alt=""
              loading="lazy"
              sx={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 1 }}
            />
          ) : (
            <Box
              sx={{
                width: 52,
                height: 52,
                borderRadius: 1,
                backgroundColor: '#f5f5f5',
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
        minWidth: 280,
        editable: true,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => {
          const pendingDraft = pendingDraftsByListing[String(params.row.listing_id)];
          const draftedTitle = pendingDraft?.fieldPatch?.title;
          return (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                width: '100%',
                position: 'relative',
                '& .row-actions': {
                  opacity: 0,
                  transition: 'opacity 0.15s ease',
                  position: 'absolute',
                  right: 0,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  display: 'flex',
                  gap: 0.25,
                  bgcolor: 'background.paper',
                  borderRadius: 1,
                  boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
                  px: 0.5,
                  py: 0.25,
                },
                '&:hover .row-actions': {
                  opacity: 1,
                },
              }}
            >
              <Tooltip title={draftedTitle ? `${params.row.title} → ${draftedTitle}` : params.row.title} arrow>
                <Typography
                  variant="body2"
                  sx={{
                    cursor: 'pointer',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    pr: pendingDraft ? 16 : 8,
                    fontStyle: draftedTitle ? 'italic' : 'normal',
                    '&:hover': { color: 'primary.main', textDecoration: 'underline' },
                  }}
                  onClick={() => handleOpenEditor(params.row.listing_id)}
                >
                  {draftedTitle || params.row.title}
                </Typography>
              </Tooltip>
              {pendingDraft && (() => {
                const isFailed = pendingDraft.status === 'failed';
                const isConflict = pendingDraft.status === 'conflict';
                const friendly = (raw: string | null | undefined): string => {
                  if (!raw) return '';
                  if (/who_made|when_made|is_supply/i.test(raw)) {
                    return "Etsy zorunlu üçlüsü (kim/ne zaman yapıldı, malzeme mi) eksik. Yeniden senkronizasyon dener — çoğu yeni denemede otomatik çözülür.";
                  }
                  if (/shop section not found/i.test(raw)) {
                    return "Seçili Etsy bölümü artık yok. Düzenleyiciden başka bir bölüm seç ve tekrar dene.";
                  }
                  if (/Invalid access token|not a Bearer token/i.test(raw)) {
                    return "Etsy bağlantın geçersiz. Ayarlar → Etsy'den yeniden bağlan.";
                  }
                  if (/shipping_profile/i.test(raw)) {
                    return "Seçili kargo profili artık yok. Düzenleyiciden başka bir profil seç.";
                  }
                  return raw.replace(/^Etsy API error:\s*\d+\s*-\s*/, '').slice(0, 280);
                };
                const tip = isFailed
                  ? `Sync başarısız: ${friendly(pendingDraft.lastSyncError)}\n\nTıkla → düzenleyiciden Tekrar Sync ya da Taslağı Sil.`
                  : isConflict
                    ? "Etsy üzerinde bu listing değişmiş. Düzenleyiciden incele ve gerekiyorsa yeniden Sync."
                    : "Local taslak. Sync to Etsy'ye basana kadar Etsy'de bir şey değişmez.";
                return (
                  <Tooltip title={tip} arrow placement="top">
                    <Chip
                      size="small"
                      color={isConflict ? 'warning' : isFailed ? 'error' : 'primary'}
                      variant="outlined"
                      label={isFailed ? 'Sync başarısız' : isConflict ? 'Etsy değişti' : pendingDraft.status === 'draft' ? 'Pending' : pendingDraft.status}
                      onClick={() => handleOpenEditor(params.row.listing_id)}
                      sx={{
                        ml: 1,
                        height: 20,
                        fontSize: 11,
                        cursor: 'pointer',
                        // Keep the chip above the absolutely-positioned hover
                        // action buttons so its tooltip stays reachable.
                        position: 'relative',
                        zIndex: 2,
                      }}
                    />
                  </Tooltip>
                );
              })()}
              {/*
                When a draft is in failed/conflict state, suppress the on-hover
                quick-action buttons so they don't cover the status chip — the
                chip itself opens the editor on click, which is the path the
                user actually needs.
              */}
              <Box
                className="row-actions"
                sx={pendingDraft && (pendingDraft.status === 'failed' || pendingDraft.status === 'conflict')
                  ? { display: 'none !important' }
                  : undefined}
              >
                <Tooltip title={t('edit')} arrow>
                  <IconButton size="small" onClick={() => handleOpenEditor(params.row.listing_id)} sx={{ p: 0.5 }}>
                    <EditIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('copy')} arrow>
                  <IconButton size="small" onClick={() => handleCopyListing(params.row.listing_id)} sx={{ p: 0.5 }}>
                    <ContentCopyIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
                {(params.row.state === 'active' || params.row.state === 'expired' || params.row.state === 'inactive') && (
                  <Tooltip title={t('renew')} arrow>
                    <IconButton size="small" color="success" onClick={() => handleRenewListing(params.row.listing_id)} sx={{ p: 0.5 }}>
                      <RefreshIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                )}
                {params.row.state === 'active' && (
                  <Tooltip title={t('deactivate')} arrow>
                    <IconButton size="small" color="warning" onClick={() => handleDeactivateListing(params.row.listing_id)} sx={{ p: 0.5 }}>
                      <RemoveCircleOutlineIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                )}
                <Tooltip title={t('delete')} arrow>
                  <IconButton size="small" color="error" onClick={() => setDeleteConfirmId(params.row.listing_id)} sx={{ p: 0.5 }}>
                    <DeleteIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
          );
        },
      },
      {
        field: 'quantity',
        headerName: t('stockCol'),
        width: 80,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => {
          const qty = params.row.quantity;
          return (
            <Typography variant="body2" sx={{ color: qty === 0 ? 'error.main' : qty < 5 ? 'warning.main' : 'text.primary', fontWeight: qty === 0 ? 700 : 400 }}>
              {qty}
            </Typography>
          );
        },
      },
      {
        field: 'price',
        headerName: t('priceCol'),
        width: 110,
        editable: true,
        valueGetter: (value: any, row: EtsyListingRow) => {
          return row.price ? (row.price.amount / row.price.divisor).toFixed(2) : '0.00';
        },
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="body2" sx={{ cursor: 'text', fontWeight: 500 }}>{formatPrice(params.row.price)}</Typography>
            {params.row.num_favorers > 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, opacity: 0.6 }}>
                <FavoriteBorderIcon sx={{ fontSize: 12 }} />
                <Typography variant="caption" sx={{ fontSize: 11 }}>{params.row.num_favorers}</Typography>
              </Box>
            )}
          </Box>
        ),
        sortComparator: (v1: any, v2: any, p1: any, p2: any) => {
          const a = p1.api.getRow(p1.id)?.price;
          const b = p2.api.getRow(p2.id)?.price;
          const av = a ? a.amount / a.divisor : 0;
          const bv = b ? b.amount / b.divisor : 0;
          return av - bv;
        },
      },
      {
        field: 'expires',
        headerName: t('expiresCol'),
        width: 95,
        sortable: true,
        filterable: false,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => (
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.82rem' }}>
            {getExpiresDate(params.row.created_timestamp)}
          </Typography>
        ),
        sortComparator: (v1: any, v2: any, p1: any, p2: any) => {
          const a = p1.api.getRow(p1.id)?.created_timestamp || 0;
          const b = p2.api.getRow(p2.id)?.created_timestamp || 0;
          return a - b;
        },
      },
      {
        field: 'section',
        headerName: t('sectionCol'),
        width: 130,
        sortable: true,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => {
          const name = params.row.shop_section_id ? sectionNameMap[params.row.shop_section_id] || '' : '';
          return (
            <Typography variant="body2" color="text.secondary" noWrap sx={{ fontSize: '0.82rem' }}>
              {name || '\u2014'}
            </Typography>
          );
        },
        sortComparator: (v1: any, v2: any, p1: any, p2: any) => {
          const a = p1.api.getRow(p1.id)?.shop_section_id;
          const b = p2.api.getRow(p2.id)?.shop_section_id;
          const aName = a ? sectionNameMap[a] || '' : '';
          const bName = b ? sectionNameMap[b] || '' : '';
          return aName.localeCompare(bName);
        },
      },
      {
        field: 'skor',
        headerName: t('scoreCol'),
        width: 70,
        sortable: true,
        filterable: false,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => {
          const h = calculateHealth(params.row);
          const gc = h.color;
          return (
            <Tooltip
              arrow
              title={
                <Box sx={{ fontSize: 12 }}>
                  <Box sx={{ fontWeight: 700, mb: 0.5 }}>{t('scoreLabel', { score: h.overall })}</Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: h.tags.color }} />
                    {t('tagsCount', { count: h.tags.label })}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: h.images.color }} />
                    {t('imagesCount', { count: h.images.label })}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: h.title.color }} />
                    {t('titleChars', { count: h.title.label })}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: h.description.color }} />
                    {t('descChars', { count: h.description.label })}
                  </Box>
                </Box>
              }
            >
              <Chip
                label={h.overall}
                size="small"
                sx={{
                  fontWeight: 700,
                  fontSize: 12,
                  height: 26,
                  minWidth: 38,
                  bgcolor: `${gc}15`,
                  color: gc,
                  border: `1.5px solid ${gc}`,
                  cursor: 'default',
                }}
              />
            </Tooltip>
          );
        },
        sortComparator: (v1: any, v2: any, p1: any, p2: any) => {
          const a = calculateHealth(p1.api.getRow(p1.id) as EtsyListingRow);
          const b = calculateHealth(p2.api.getRow(p2.id) as EtsyListingRow);
          return a.overall - b.overall;
        },
      },
    ],
    [pendingDraftsByListing, sectionNameMap, t] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // --- Column visibility for mobile ---
  const [columnVisibilityModel, setColumnVisibilityModel] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      if (w < 768) {
        setColumnVisibilityModel({ expires: false, section: false, skor: false });
      } else if (w < 1440) {
        setColumnVisibilityModel({ expires: false });
      } else {
        setColumnVisibilityModel({});
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Active filter count for badge
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (sectionFilter) count++;
    if (healthFilter) count++;
    if (excludeTerm.trim()) count++;
    return count;
  }, [sectionFilter, healthFilter, excludeTerm]);

  return (
    <Box sx={{ p: { xs: 0.5, sm: 1, md: 1.5 }, maxWidth: 1600, mx: 'auto', overflowX: 'hidden' }}>
      <Toaster position="top-right" />

      {/* No shops message */}
      {shops.length === 0 && !(loading) && (
        <Paper sx={{ p: 3, mb: 2, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
            {t('noShopConnected')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('noShopConnectedDesc')}
          </Typography>
          <Button variant="contained" size="small" href="/ayarlar">
            {t('goToSettings')}
          </Button>
        </Paper>
      )}

      {/* Main Layout: Sidebar + Content */}
      <Box sx={{ display: 'flex', gap: 0 }}>

        {/* Left Sidebar (desktop only) */}
        {!isMobile && (
          <LeftSidebar
            shops={shops}
            selectedShopId={selectedShopId}
            onSelectShop={setSelectedShopId}
            statusFilter={statusFilter}
            onStatusChange={(s) => {
              setStatusFilter(s);
              setListings([]);
              setTotalCount(0);
            }}
            statusCounts={statusCounts}
            shopSections={shopSections}
            sectionCounts={sectionCounts}
            sectionFilter={sectionFilter}
            onSectionChange={setSectionFilter}
            healthFilter={healthFilter}
            onHealthChange={setHealthFilter}
            excludeTerm={excludeTerm}
            onExcludeTermChange={setExcludeTerm}
          />
        )}

        {/* Main Content */}
        <Box sx={{ flex: 1, minWidth: 0 }}>

          {/* Compact Stats Row */}
          {listings.length > 0 && (
            <Paper sx={{ px: 1.5, py: 0.5, mb: 0.5, display: 'flex', alignItems: 'center', gap: { xs: 1.5, sm: 2 }, flexWrap: 'wrap', minHeight: 32 }}>
              <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.82rem' }}>
                {t('listingCount', { count: totalCount })}
              </Typography>
              {!isMobile && (
                <>
                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.875rem' }}>
                    ·&nbsp;&nbsp;{quickStats.totalViews.toLocaleString()} {t('views')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.875rem' }}>
                    ·&nbsp;&nbsp;{quickStats.totalFavs.toLocaleString()} {t('favorites')}
                  </Typography>
                </>
              )}
              {quickStats.outOfStock > 0 && (
                <Typography
                  variant="body2"
                  sx={{ fontSize: '0.875rem', color: 'error.main', fontWeight: 600, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                  onClick={() => setHealthFilter('no_stock')}
                >
                  ·&nbsp;&nbsp;{t('outOfStockCount', { count: quickStats.outOfStock })}
                </Typography>
              )}
              {quickStats.withIssues > 0 && (
                <Typography
                  variant="body2"
                  sx={{ fontSize: '0.875rem', color: 'warning.main', fontWeight: 600, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                  onClick={() => setHealthFilter('issues')}
                >
                  ·&nbsp;&nbsp;{t('issuesCount', { count: quickStats.withIssues })}
                </Typography>
              )}
            </Paper>
          )}

          {/* Top Toolbar */}
          <Paper sx={{ px: 1.5, py: 0.75, mb: 0.5, overflow: 'hidden', width: '100%', boxSizing: 'border-box' }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>

              {/* Mobile: shop selector */}
              {isMobile && shops.length > 0 && (
                <FormControl size="small" sx={{ minWidth: 100 }}>
                  <Select
                    value={selectedShopId}
                    onChange={(e) => setSelectedShopId(e.target.value)}
                    displayEmpty
                    sx={{ fontSize: '0.82rem' }}
                  >
                    {shops.map((s) => (
                      <MenuItem key={s.shopId} value={s.shopId}>{s.shopName}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              {/* Page title */}
              <Typography variant="subtitle1" fontWeight={700} sx={{ display: { xs: 'none', sm: 'block' } }}>
                {statusFilter === 'active' ? t('stateActive') : statusFilter === 'draft' ? t('stateDraft') : statusFilter === 'inactive' ? t('stateInactive') : t('stateExpired')}
              </Typography>

              {/* Mobile: status filter */}
              {isMobile && (
                <FormControl size="small" sx={{ minWidth: 85 }}>
                  <Select
                    value={statusFilter}
                    onChange={(e) => {
                      const val = e.target.value as 'active' | 'draft' | 'inactive' | 'expired';
                      setStatusFilter(val);
                      setListings([]);
                      setTotalCount(0);
                    }}
                    sx={{ fontSize: '0.82rem' }}
                  >
                    <MenuItem value="active">{t('stateActive')}</MenuItem>
                    <MenuItem value="draft">{t('stateDraft')}</MenuItem>
                    <MenuItem value="inactive">{t('stateInactive')}</MenuItem>
                    <MenuItem value="expired">{t('stateExpired')}</MenuItem>
                  </Select>
                </FormControl>
              )}

              {/* Sync from Etsy */}
              <Tooltip title={lastSyncAt ? t('lastSyncAt', { time: new Date(lastSyncAt).toLocaleString() }) : t('neverSynced')}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={syncing ? <CircularProgress size={14} /> : <RefreshIcon fontSize="small" />}
                  onClick={syncListings}
                  disabled={syncing || loading}
                  sx={{
                    minHeight: 36, px: 1.5, borderRadius: '8px', textTransform: 'none',
                    fontWeight: 600, fontSize: '0.8rem', whiteSpace: 'nowrap',
                    border: '1px solid #e2e8f0', color: '#475569',
                    '&:hover': { bgcolor: '#f8fafc', borderColor: '#cbd5e1' },
                  }}
                >
                  {syncing ? t('syncing') : t('syncBtn')}
                </Button>
              </Tooltip>
              {lastSyncAt && !isMobile && (
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                  {t('lastSync')}: {(() => {
                    const diff = Math.round((Date.now() - new Date(lastSyncAt).getTime()) / 60000);
                    if (diff < 1) return t('justNow');
                    if (diff < 60) return t('minutesAgo', { count: diff });
                    if (diff < 1440) return t('hoursAgo', { count: Math.round(diff / 60) });
                    return t('daysAgo', { count: Math.round(diff / 1440) });
                  })()}
                </Typography>
              )}

              {/* Spacer */}
              <Box sx={{ flex: '1 0 0' }} />

              {/* Search */}
              <TextField
                size="small"
                placeholder={t('searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                sx={{ minWidth: { xs: 80, sm: 160 }, maxWidth: 240 }}
                InputProps={{
                  startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18 }} /></InputAdornment>,
                }}
              />

              {/* Mobile: Filters button */}
              {isMobile && (
                <Badge badgeContent={activeFilterCount} color="primary" sx={{ '& .MuiBadge-badge': { fontSize: 10, minWidth: 16, height: 16 } }}>
                  <IconButton
                    size="small"
                    onClick={() => setFilterDrawerOpen(true)}
                    sx={{
                      minWidth: 36, minHeight: 36, borderRadius: '8px', border: '1px solid',
                      borderColor: activeFilterCount > 0 ? 'primary.main' : '#e2e8f0',
                      color: activeFilterCount > 0 ? 'primary.main' : '#475569',
                    }}
                  >
                    <FilterListIcon fontSize="small" />
                  </IconButton>
                </Badge>
              )}

              {/* Tools menu */}
              <Button
                size="small"
                variant="outlined"
                onClick={(e) => setToolsMenuAnchor(e.currentTarget)}
                sx={{
                  minHeight: 36, whiteSpace: 'nowrap', minWidth: 0, borderRadius: '8px', textTransform: 'none', fontWeight: 600,
                  borderColor: '#e2e8f0', color: '#475569', px: 1.5, fontSize: '0.82rem',
                  '&:hover': { borderColor: '#cbd5e1', bgcolor: '#f8fafc' },
                }}
              >
                <MoreVertIcon sx={{ mr: { xs: 0, sm: 0.5 }, fontSize: 18 }} />
                <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{t('tools')}</Box>
              </Button>

              {/* + New Listing */}
              <Button
                variant="contained"
                size="small"
                onClick={() => setCreateDialogOpen(true)}
                sx={{
                  minHeight: 36, whiteSpace: 'nowrap', borderRadius: '8px', textTransform: 'none', fontWeight: 600,
                  background: 'linear-gradient(135deg, #10b981, #059669)', boxShadow: '0 2px 8px rgba(5,150,105,0.3)',
                  px: 2, fontSize: '0.82rem',
                  '&:hover': { background: 'linear-gradient(135deg, #059669, #047857)' },
                }}
              >
                <AddIcon sx={{ mr: 0.5, fontSize: 18 }} />
                <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{t('newListing')}</Box>
              </Button>
            </Box>
          </Paper>

          {/* Tools Menu */}
          <Menu
            anchorEl={toolsMenuAnchor}
            open={Boolean(toolsMenuAnchor)}
            onClose={() => setToolsMenuAnchor(null)}
            transformOrigin={{ horizontal: 'right', vertical: 'top' }}
            anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
          >
            <MenuItem onClick={() => { setToolsMenuAnchor(null); setFindReplaceOpen(true); }}>
              <ListItemIcon><FindReplaceIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('findReplace')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { setToolsMenuAnchor(null); setDuplicateDetectorOpen(true); }}>
              <ListItemIcon><ContentPasteSearchIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('duplicateDetection')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { setToolsMenuAnchor(null); setSmartPricingOpen(true); }}>
              <ListItemIcon><PriceChangeIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('smartPricing')}</ListItemText>
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => { setToolsMenuAnchor(null); handleExportCSV(); }}>
              <ListItemIcon><FileDownloadIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('csvDownload')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { setToolsMenuAnchor(null); handleCSVFileSelect(); }}>
              <ListItemIcon><FileUploadIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('csvUpload')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { setToolsMenuAnchor(null); setBackupManagerOpen(true); }}>
              <ListItemIcon><InventoryIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('backups')}</ListItemText>
            </MenuItem>
          </Menu>

          {/* Selection toolbar: Vela-style — N selected + Delete, Export, Copy, Edit */}
          {selectedCount > 0 && selectedShopId && (
            <Paper
              sx={{
                px: 1.5, py: 1, mb: 1.5,
                display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap',
                bgcolor: 'primary.50',
                border: '1px solid', borderColor: 'primary.200',
                borderRadius: 2,
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 700, color: 'primary.main', mr: 0.5, whiteSpace: 'nowrap' }}>
                {t('selected', { count: selectedCount })}
              </Typography>
              <BulkOperationsBar
                selectedCount={selectedCount}
                selectedListings={selectedListings}
                shopSections={shopSections}
                shopId={selectedShopId}
                allShops={shops}
                onOpenBulkEditor={() => setBulkEditorOpen(true)}
                onCompleted={() => {
                  fetchPendingDrafts();
                  fetchListings();
                }}
              />
              {selectedDraftIds.length > 0 && (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleSyncSelectedDrafts}
                  disabled={bulkSyncingDrafts}
                  startIcon={
                    bulkSyncingDrafts
                      ? <CircularProgress size={16} />
                      : <SyncIcon sx={{ fontSize: '16px !important' }} />
                  }
                  sx={{
                    minHeight: 36,
                    textTransform: 'none',
                    fontWeight: 700,
                    borderRadius: '8px',
                    whiteSpace: 'nowrap',
                    bgcolor: 'background.paper',
                  }}
                >
                  {isMobile
                    ? t('syncDraftsShort', { count: selectedDraftIds.length })
                    : t('syncDraftsToEtsy', { count: selectedDraftIds.length })}
                </Button>
              )}
              <Button
                variant="contained"
                size="small"
                onClick={() => setBulkEditorOpen(true)}
                startIcon={<EditIcon sx={{ fontSize: '16px !important' }} />}
                sx={{
                  minHeight: 36, textTransform: 'none', fontWeight: 700, borderRadius: '8px', ml: 'auto',
                  background: 'linear-gradient(135deg, #2563eb, #4f46e5)',
                  '&:hover': { background: 'linear-gradient(135deg, #1d4ed8, #4338ca)' },
                }}
              >
                {isMobile ? t('editShort') : t('bulkEdit')}
              </Button>
            </Paper>
          )}

          {/* Active Filter Chips (desktop, when sidebar filters are active) */}
          {!isMobile && activeFilterCount > 0 && (
            <Box sx={{ display: 'flex', gap: 0.5, mb: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              {sectionFilter && (
                <Chip
                  label={t('sectionChip', { name: shopSections.find(s => String(s.shop_section_id) === sectionFilter)?.title || sectionFilter })}
                  size="small"
                  onDelete={() => setSectionFilter('')}
                  sx={{ height: 28 }}
                />
              )}
              {healthFilter && (
                <Chip
                  label={t('healthChip', { filter: healthFilter === 'issues' ? t('healthChipIssues') : healthFilter === 'missing_images' ? t('healthChipMissingImages') : healthFilter === 'missing_tags' ? t('healthChipMissingTags') : healthFilter === 'short_title' ? t('healthChipShortTitle') : healthFilter === 'no_description' ? t('healthChipNoDescription') : healthFilter === 'no_video' ? t('healthChipNoVideo') : t('healthChipNoStock') })}
                  size="small"
                  onDelete={() => setHealthFilter('')}
                  color="warning"
                  sx={{ height: 28 }}
                />
              )}
              {excludeTerm.trim() && (
                <Chip
                  label={t('excludeChip', { term: excludeTerm })}
                  size="small"
                  onDelete={() => setExcludeTerm('')}
                  color="error"
                  variant="outlined"
                  sx={{ height: 28 }}
                />
              )}
              <Chip
                label={t('clearAll')}
                size="small"
                variant="outlined"
                onClick={() => { setSectionFilter(''); setHealthFilter(''); setExcludeTerm(''); }}
                sx={{ height: 28, cursor: 'pointer' }}
              />
            </Box>
          )}

          {/* Loading more indicator */}
          {loadingMore && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, px: 1 }}>
              <LinearProgress sx={{ flex: 1, height: 4, borderRadius: 2 }} />
              <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                {t('loadingProgress', { loaded: listings.length, total: totalCount })}
              </Typography>
            </Box>
          )}

          {/* Mobile Card List */}
          <Box sx={{ display: { xs: 'block', md: 'none' }, overflow: 'hidden', width: '100%', maxWidth: '100%' }}>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
              </Box>
            ) : filteredListings.length === 0 ? (
              <Paper sx={{ p: 3, textAlign: 'center' }}>
                <Typography color="text.secondary">
                  {selectedShopId ? t('noListingsFound') : t('selectShop')}
                </Typography>
              </Paper>
            ) : (
              <>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, px: 0.5 }}>
                  {filteredListings.length !== totalCount ? t('resultCountWithTotal', { count: filteredListings.length, total: totalCount }) : t('resultCount', { count: filteredListings.length })}
                </Typography>
                {filteredListings.slice(0, mobileVisibleCount).map((listing) => (
                  <MobileEtsyListingCard
                    key={listing.listing_id}
                    listing={listing}
                    onEdit={handleOpenEditor}
                    onCopy={handleCopyListing}
                    onDelete={(id) => setDeleteConfirmId(id)}
                    onRenew={handleRenewListing}
                    onDeactivate={handleDeactivateListing}
                    selected={mobileSelectedIds.has(listing.listing_id)}
                    onToggleSelect={handleMobileToggleSelect}
                    sectionName={listing.shop_section_id ? sectionNameMap[listing.shop_section_id] : undefined}
                  />
                ))}
                {mobileVisibleCount < filteredListings.length && (
                  <Button
                    fullWidth
                    variant="outlined"
                    onClick={() => setMobileVisibleCount((prev) => prev + 25)}
                    sx={{ mt: 1, mb: 2, minHeight: 44 }}
                  >
                    {t('loadMore', { count: Math.min(25, filteredListings.length - mobileVisibleCount) })}
                  </Button>
                )}
              </>
            )}
          </Box>

          {/* Column Preset Toggle + DataGrid (desktop only) */}
          <Paper sx={{ width: '100%', display: { xs: 'none', md: 'block' } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', px: 1.5, pt: 0.5, gap: 0.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>{t('viewPreset')}</Typography>
              {([
                { label: t('compact'), model: { expires: false, section: false } as Record<string, boolean> },
                { label: t('detailed'), model: { expires: false } as Record<string, boolean> },
                { label: t('all'), model: {} as Record<string, boolean> },
              ]).map((preset) => {
                const isActive = JSON.stringify(columnVisibilityModel) === JSON.stringify(preset.model);
                return (
                  <Chip
                    key={preset.label}
                    label={preset.label}
                    size="small"
                    onClick={() => setColumnVisibilityModel(preset.model)}
                    sx={{
                      height: 24, fontSize: '0.8rem', fontWeight: isActive ? 700 : 400,
                      bgcolor: isActive ? 'primary.main' : 'transparent',
                      color: isActive ? 'white' : 'text.secondary',
                      border: '1px solid', borderColor: isActive ? 'primary.main' : 'divider',
                      cursor: 'pointer',
                      '&:hover': { bgcolor: isActive ? 'primary.dark' : 'action.hover' },
                    }}
                  />
                );
              })}
            </Box>
            <DataGrid
              rows={filteredListings}
              columns={columns}
              loading={loading}
              checkboxSelection
              disableRowSelectionOnClick
              processRowUpdate={handleProcessRowUpdate}
              onProcessRowUpdateError={(error) => toast.error(t('updateError', { error: error.message }))}
              rowHeight={52}
              rowSelectionModel={selectedIds}
              onRowSelectionModelChange={(newSelection) => setSelectedIds(newSelection)}
              paginationModel={paginationModel}
              onPaginationModelChange={setPaginationModel}
              pageSizeOptions={[25, 50, 100]}
              columnVisibilityModel={columnVisibilityModel}
              onColumnVisibilityModelChange={(model) => setColumnVisibilityModel(model)}
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
                // Footer showing count like Vela
                '& .MuiTablePagination-displayedRows': {
                  fontSize: '0.82rem',
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
                      {selectedShopId ? t('noListingsFound') : t('selectShop')}
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
        </Box>
      </Box>

      {/* Delete confirmation dialog */}
      {deleteConfirmId !== null && (
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
          onClick={() => setDeleteConfirmId(null)}
        >
          <Paper
            sx={{ p: 3, maxWidth: 400, mx: 2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <Typography variant="h6" gutterBottom>
              {t('deleteListingTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('deleteListingConfirm')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
              <Button size="small" onClick={() => setDeleteConfirmId(null)}>
                {t('cancel')}
              </Button>
              <Button
                size="small"
                variant="contained"
                color="error"
                onClick={() => handleDeleteListing(deleteConfirmId)}
              >
                {t('delete')}
              </Button>
            </Box>
          </Paper>
        </Box>
      )}

      {/* Mobile Filter Drawer */}
      {isMobile && (
        <SwipeableDrawer
          anchor="bottom"
          open={filterDrawerOpen}
          onClose={() => setFilterDrawerOpen(false)}
          onOpen={() => setFilterDrawerOpen(true)}
          PaperProps={{ sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, px: 2, pb: 3, pt: 1 } }}
        >
          <Box sx={{ width: 40, height: 4, bgcolor: 'divider', borderRadius: 2, mx: 'auto', mb: 2 }} />
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>{t('filters')}</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <FormControl size="small" fullWidth>
              <InputLabel>{t('sectionLabel')}</InputLabel>
              <Select value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)} label={t('sectionLabel')}>
                <MenuItem value="">{t('allSections')}</MenuItem>
                {shopSections.map((s) => <MenuItem key={s.shop_section_id} value={String(s.shop_section_id)}>{s.title}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel>{t('healthLabel')}</InputLabel>
              <Select value={healthFilter} onChange={(e) => setHealthFilter(e.target.value)} label={t('healthLabel')}>
                <MenuItem value="">{t('allHealth')}</MenuItem>
                <MenuItem value="issues">{t('healthChipIssues')}</MenuItem>
                <MenuItem value="missing_images">{t('healthMissingImages')}</MenuItem>
                <MenuItem value="missing_tags">{t('healthMissingTags')}</MenuItem>
                <MenuItem value="short_title">{t('healthShortTitle')}</MenuItem>
                <MenuItem value="no_description">{t('healthNoDescription')}</MenuItem>
                <MenuItem value="no_video">{t('healthNoVideo')}</MenuItem>
                <MenuItem value="no_stock">{t('healthNoStock')}</MenuItem>
              </Select>
            </FormControl>
            <TextField
              size="small"
              fullWidth
              label={t('excludeLabel')}
              placeholder={t('excludeWordPlaceholder')}
              value={excludeTerm}
              onChange={(e) => setExcludeTerm(e.target.value)}
            />
            {activeFilterCount > 0 && (
              <Button size="small" color="error" onClick={() => { setSectionFilter(''); setHealthFilter(''); setExcludeTerm(''); }}>
                {t('clearFilters')}
              </Button>
            )}
          </Box>
        </SwipeableDrawer>
      )}

      {/* Editor Drawer */}
      <ListingEditorDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setDrawerListingId(null);
        }}
        listingId={drawerListingId}
        shopId={selectedShopId}
        refreshKey={drawerRefreshKey}
        shopSections={shopSections}
        shippingProfiles={shippingProfiles}
        returnPolicies={returnPolicies}
        onSaved={() => {
          Object.keys(listingsCacheRef.current).forEach(key => {
            if (key.startsWith(selectedShopId)) delete listingsCacheRef.current[key];
          });
          fetchPendingDrafts();
          fetchListings();
        }}
        onOpenListing={(newId) => {
          setStatusFilter('draft');
          setDrawerListingId(newId);
        }}
        marketResearchData={null}
      />

      {/* Creator Dialog */}
      <ListingCreatorDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        shopId={selectedShopId}
        shopSections={shopSections}
        shippingProfiles={shippingProfiles}
        returnPolicies={returnPolicies}
        marketResearchData={null}
        onCreated={(listingId) => {
          setCreateDialogOpen(false);
          if (listingId < 0) {
            toast.success('Listing draft saved locally. Use Sync to Etsy from the draft to create it.');
            fetchPendingDrafts();
            return;
          }
          toast.success(t('listingCreated', { id: listingId }));
          fetchListings();
        }}
      />

      {/* Find & Replace Dialog */}
      <FindReplaceDialog
        open={findReplaceOpen}
        onClose={() => setFindReplaceOpen(false)}
        listings={filteredListings.map((l) => ({
          listing_id: l.listing_id,
          title: l.title,
          description: l.description,
          tags: l.tags,
          materials: l.materials,
        }))}
        shopId={selectedShopId}
        onCompleted={() => {
          setFindReplaceOpen(false);
          fetchPendingDrafts();
          fetchListings();
        }}
      />

      {/* Smart Pricing Dialog */}
      <SmartPricing
        open={smartPricingOpen}
        onClose={() => setSmartPricingOpen(false)}
        listings={filteredListings.map((l) => ({
          listing_id: l.listing_id,
          title: l.title,
          price: l.price,
          views: l.views,
          quantity: l.quantity,
        }))}
      />

      {/* Duplicate Detector Dialog */}
      <DuplicateDetector
        open={duplicateDetectorOpen}
        onClose={() => setDuplicateDetectorOpen(false)}
        listings={filteredListings.map((l) => ({
          listing_id: l.listing_id,
          title: l.title,
          description: l.description,
          tags: l.tags,
          price: l.price,
          quantity: l.quantity,
          views: l.views,
          num_favorers: l.num_favorers,
          state: l.state,
        }))}
        shopId={selectedShopId}
        onEdit={(listingId) => handleOpenEditor(listingId)}
        onCompleted={() => {
          setDuplicateDetectorOpen(false);
          fetchPendingDrafts();
          fetchListings();
        }}
      />

      {/* Backup Manager Dialog */}
      <BackupManager
        open={backupManagerOpen}
        onClose={() => setBackupManagerOpen(false)}
        shopId={selectedShopId}
        onRestored={() => {
          setBackupManagerOpen(false);
          fetchPendingDrafts();
          fetchListings();
        }}
      />

      {/* Bulk Editor (Vela-style full-page) */}
      <BulkEditor
        open={bulkEditorOpen}
        onClose={() => setBulkEditorOpen(false)}
        listings={selectedListings}
        shopId={selectedShopId}
        shopName={shops.find(s => s.shopId === selectedShopId)?.shopName}
        shopSections={shopSections}
        shippingProfiles={shippingProfiles}
        returnPolicies={returnPolicies}
        onCompleted={() => {
          setBulkEditorOpen(false);
          fetchPendingDrafts();
          fetchListings();
        }}
        onChanged={() => {
          // Incremental photo/video edit staged — refresh drafts, keep editor open.
          fetchPendingDrafts();
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
                {t('csvImportInProgress')}
              </Typography>
              <LinearProgress variant="determinate" value={csvImportProgress} />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                {t('csvImportPercent', { percent: Math.round(csvImportProgress) })}
              </Typography>
            </Box>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('csvImportWillUpdate', { count: csvImportRows.length })}
              </Typography>
              <TableContainer sx={{ maxHeight: 400 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('csvListingId')}</TableCell>
                      <TableCell>{t('csvTitle')}</TableCell>
                      <TableCell>{t('csvPrice')}</TableCell>
                      <TableCell>{t('csvStock')}</TableCell>
                      <TableCell>{t('csvTags')}</TableCell>
                      <TableCell>{t('csvStatus')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {csvImportRows.slice(0, 50).map((row, i) => (
                      <TableRow key={i}>
                        <TableCell>{row.listing_id}</TableCell>
                        <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.title || '\u2014'}
                        </TableCell>
                        <TableCell>{row.price || '\u2014'}</TableCell>
                        <TableCell>{row.quantity || '\u2014'}</TableCell>
                        <TableCell sx={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.tags || '\u2014'}
                        </TableCell>
                        <TableCell>{row.state || '\u2014'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              {csvImportRows.length > 50 && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  {t('csvAndMoreRows', { count: csvImportRows.length - 50 })}
                </Typography>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCsvImportDialogOpen(false); setCsvImportRows([]); }} disabled={csvImporting}>
            {t('cancel')}
          </Button>
          <Button variant="contained" onClick={handleCSVImportConfirm} disabled={csvImporting || csvImportRows.length === 0}>
            {csvImporting ? t('csvImporting') : t('csvUpdateListings', { count: csvImportRows.length })}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// --- Layout wrapper (follows labels.tsx pattern) ---
function EtsyListingsPageWithLayout(props: any): JSX.Element {
  return (
    <AppLayout title="Etsy Listings - KolayXport">
      <EtsyListingsPage {...props} />
    </AppLayout>
  );
}

export default withAuth(EtsyListingsPageWithLayout);
