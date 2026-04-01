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
} from '@mui/icons-material';
import { toast, Toaster } from 'react-hot-toast';
import AppLayout from '@/components/AppLayout';
import withAuth from '@/components/withAuth';
import { useAuth } from '@/lib/auth-context';

import SEOIndicator from '@/components/etsy/SEOIndicator';
import ListingEditorDrawer from '@/components/etsy/ListingEditorDrawer';
import ListingCreatorDialog from '@/components/etsy/ListingCreatorDialog';
import FindReplaceDialog from '@/components/etsy/FindReplaceDialog';
import BulkOperationsBar from '@/components/etsy/BulkOperationsBar';
import BulkEditor from '@/components/etsy/BulkEditor';
import SmartPricing from '@/components/etsy/SmartPricing';
import DuplicateDetector from '@/components/etsy/DuplicateDetector';
import BackupManager from '@/components/etsy/BackupManager';

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
  active: 'Aktif',
  draft: 'Taslak',
  inactive: 'Deaktif',
  expired: 'Sur. Dolmus',
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
  const tagCount = listing.tags?.length || 0;
  const tagsScore = tagCount >= 13 ? 25 : tagCount >= 10 ? 15 : 5;
  const tagsColor = tagCount >= 13 ? '#4caf50' : tagCount >= 10 ? '#ff9800' : '#f44336';
  const tagsLabel = `${tagCount}/13 etiket`;

  const imgCount = listing.image_count || 0;
  const imagesScore = imgCount >= 10 ? 25 : imgCount >= 5 ? 15 : 5;
  const imagesColor = imgCount >= 10 ? '#4caf50' : imgCount >= 5 ? '#ff9800' : '#f44336';
  const imagesLabel = `${imgCount} resim`;

  const titleLen = listing.title?.length || 0;
  const titleScore = titleLen >= 100 ? 25 : titleLen >= 60 ? 15 : 5;
  const titleColor = titleLen >= 100 ? '#4caf50' : titleLen >= 60 ? '#ff9800' : '#f44336';
  const titleLabel = `${titleLen} karakter baslik`;

  const descLen = listing.description?.length || 0;
  const descScore = descLen >= 500 ? 25 : descLen >= 200 ? 15 : 5;
  const descColor = descLen >= 500 ? '#4caf50' : descLen >= 200 ? '#ff9800' : '#f44336';
  const descLabel = `${descLen} karakter aciklama`;

  const overall = tagsScore + imagesScore + titleScore + descScore;
  const color = overall >= 80 ? '#4caf50' : overall >= 60 ? '#ff9800' : '#f44336';
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
  selected,
  onToggleSelect,
  sectionName,
}: {
  listing: EtsyListingRow;
  onEdit: (listingId: number) => void;
  onCopy: (listingId: number) => void;
  onDelete: (listingId: number) => void;
  selected?: boolean;
  onToggleSelect?: (listingId: number) => void;
  sectionName?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const health = calculateHealth(listing);

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
            <Typography variant="caption" color="text.secondary" fontSize="0.72rem">
              Stok: {listing.quantity}
            </Typography>
            <Chip
              label={STATE_LABELS[listing.state] || listing.state}
              size="small"
              color={STATE_COLORS[listing.state] || 'default'}
              variant="outlined"
              sx={{ height: 18, fontSize: 10, '& .MuiChip-label': { px: 0.5 } }}
            />
            {/* Grade badge */}
            <Chip
              label={health.grade}
              size="small"
              sx={{
                height: 20,
                fontSize: 10,
                fontWeight: 700,
                bgcolor: `${gradeColor(health.grade)}15`,
                color: gradeColor(health.grade),
                border: `1px solid ${gradeColor(health.grade)}`,
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
                Etiketler ({listing.tags.length}/13)
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
              <Typography variant="caption" color="text.secondary">Goruntulenme</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <VisibilityIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                <Typography variant="body2">{listing.views.toLocaleString()}</Typography>
              </Box>
            </Box>
            <Box sx={{ flex: '1 1 45%' }}>
              <Typography variant="caption" color="text.secondary">Favori</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <FavoriteBorderIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                <Typography variant="body2">{listing.num_favorers.toLocaleString()}</Typography>
              </Box>
            </Box>
            <Box sx={{ flex: '1 1 45%' }}>
              <Typography variant="caption" color="text.secondary">Gorseller</Typography>
              <Typography variant="body2">{listing.image_count} resim{listing.has_video ? ' + video' : ''}</Typography>
            </Box>
            <Box sx={{ flex: '1 1 45%' }}>
              <Typography variant="caption" color="text.secondary">Son Guncelleme</Typography>
              <Typography variant="body2">{formatTimestamp(listing.updated_timestamp)}</Typography>
            </Box>
            {sectionName && (
              <Box sx={{ flex: '1 1 45%' }}>
                <Typography variant="caption" color="text.secondary">Bolum</Typography>
                <Typography variant="body2">{sectionName}</Typography>
              </Box>
            )}
          </Box>

          {/* Health breakdown chips */}
          <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {[health.tags, health.images, health.title, health.description].map((item, i) => (
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
              Duzenle
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
              Kopyala
            </Button>
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
              Sil
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
              Etsy&apos;de Gor
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
              Magaza
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
        <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10, mb: 0.5, display: 'block' }}>
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
                <span>{STATE_LABELS[state]}</span>
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
          Listing Skor
        </Typography>
        <FormControl size="small" fullWidth>
          <Select
            value={healthFilter}
            onChange={(e) => onHealthChange(e.target.value)}
            displayEmpty
            sx={{ fontSize: '0.82rem', '& .MuiSelect-select': { py: 0.75 } }}
          >
            <MenuItem value="">Tumu</MenuItem>
            <MenuItem value="issues">Sorunlu (&lt;70)</MenuItem>
            <MenuItem value="missing_images">Resim Eksik (&lt;10)</MenuItem>
            <MenuItem value="missing_tags">Etiket Eksik (&lt;13)</MenuItem>
            <MenuItem value="short_title">Kisa Baslik (&lt;100)</MenuItem>
            <MenuItem value="no_description">Aciklama Yok</MenuItem>
            <MenuItem value="no_video">Video Yok</MenuItem>
            <MenuItem value="no_stock">Stok Yok</MenuItem>
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
              Bolum
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
              <span>Tum Bolumler</span>
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
          Haric Tut
        </Typography>
        <TextField
          size="small"
          fullWidth
          placeholder="Kelime..."
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

  // --- State ---
  const [listings, setListings] = useState<EtsyListingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  // In-memory cache: avoid re-fetching when switching back to same shop+status
  const listingsCacheRef = useRef<Record<string, { listings: EtsyListingRow[]; total: number; ts: number }>>({});

  // We cache status counts per shop to show in sidebar without re-fetching
  const statusCountsCacheRef = useRef<Record<string, Record<string, number>>>({});

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
      created_timestamp: l.created_timestamp || 0,
      updated_timestamp: l.updated_timestamp || 0,
      thumbnail: thumb,
      image_count: l.image_count || (l.images ? l.images.length : 0),
      has_video: l.has_video || false,
    };
  };

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
      const limit = 100;
      const cacheBust = Date.now();
      const buildUrl = (offset: number) =>
        `/api/clawd/etsy?action=listings_with_images&shop_id=${selectedShopId}&limit=${limit}&offset=${offset}&state=${statusFilter}&_t=${cacheBust}`;

      // First page - show immediately
      const firstRes = await fetch(buildUrl(0));
      if (!firstRes.ok) {
        const errData = await firstRes.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${firstRes.status}`);
      }
      const firstData = await firstRes.json();
      const total = firstData.count || 0;
      const firstResults: any[] = firstData.listings || firstData.results || [];
      const firstRows: EtsyListingRow[] = firstResults.map(mapListing);

      // Show first page immediately so user sees data fast
      setListings(firstRows);
      setTotalCount(total || firstRows.length);
      setLoading(false);

      // Update status counts cache
      statusCountsCacheRef.current[selectedShopId] = {
        ...statusCountsCacheRef.current[selectedShopId],
        [statusFilter]: total || firstRows.length,
      };

      // Fetch remaining pages in background
      if (total > limit) {
        setLoadingMore(true);
        const remainingPages = Math.ceil((total - limit) / limit);
        const allRows = [...firstRows];
        for (let batch = 0; batch < remainingPages; batch += 5) {
          const batchSize = Math.min(5, remainingPages - batch);
          const fetches = Array.from({ length: batchSize }, (_, i) =>
            fetch(buildUrl((batch + i + 1) * limit)).then(async (res) => {
              if (!res.ok) return [];
              const data = await res.json();
              return (data.listings || data.results || []).map(mapListing);
            })
          );
          const pages = await Promise.all(fetches);
          pages.forEach((rows) => allRows.push(...rows));
          setListings([...allRows]);
        }
        setLoadingMore(false);
        listingsCacheRef.current[cacheKey] = { listings: allRows, total, ts: Date.now() };
      } else {
        listingsCacheRef.current[cacheKey] = { listings: firstRows, total, ts: Date.now() };
      }
    } catch (err: any) {
      console.error('Failed to fetch listings:', err);
      toast.error(`Listing'lar yuklenemedi: ${err.message}`);
      setLoading(false);
      setLoadingMore(false);
    }
  }, [selectedShopId, statusFilter]);

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

  useEffect(() => {
    if (selectedShopId) {
      fetchListings();
      fetchShopMeta();
    }
  }, [selectedShopId, statusFilter, fetchListings, fetchShopMeta]);

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
  }, [selectedShopId, totalCount, statusFilter]);

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
        const res = await fetch(
          `/api/clawd/etsy?action=delete_listing&listing_id=${listingId}&shop_id=${selectedShopId}`,
          { method: 'DELETE' }
        );
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData.error || `HTTP ${res.status}`;
          if (res.status === 403 && errMsg.includes('removed')) {
            // Already deleted on Etsy - just remove from our UI
          } else {
            throw new Error(errMsg);
          }
        }
        toast.success('Listing silindi');
        setDeleteConfirmId(null);
        setListings((prev) => prev.filter((l) => l.listing_id !== listingId));
        setTotalCount((prev) => Math.max(0, prev - 1));
        const cacheKey = `${selectedShopId}:${statusFilter}`;
        delete listingsCacheRef.current[cacheKey];
      } catch (err: any) {
        toast.error(`Silinemedi: ${err.message}`);
      }
    },
    [selectedShopId, statusFilter]
  );

  // --- CSV Export ---
  const handleExportCSV = () => {
    if (filteredListings.length === 0) {
      toast.error('Disa aktarilacak listing yok');
      return;
    }
    const rows = filteredListings.map((l) => ({
      listing_id: l.listing_id,
      title: l.title,
      description: l.description.substring(0, 200),
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
          toast.error('CSV dosyasi bos veya gecersiz format');
          return;
        }
        const validRows = rows.filter((r) => r.listing_id && r.listing_id.trim() !== '');
        if (validRows.length === 0) {
          toast.error('CSV dosyasinda listing_id sutunu bulunamadi');
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
      if (row.price !== undefined && row.price !== '') body.price = parseFloat(row.price);
      if (row.quantity !== undefined && row.quantity !== '') body.quantity = parseInt(row.quantity, 10);
      if (row.state !== undefined && row.state !== '') body.state = row.state;

      if (Object.keys(body).length === 0) {
        failed++;
        setCsvImportProgress(((i + 1) / csvImportRows.length) * 100);
        continue;
      }

      try {
        const res = await fetch(
          `/api/clawd/etsy?action=update_listing&listing_id=${listingId}&shop_id=${selectedShopId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        );
        if (res.ok) succeeded++;
        else failed++;
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
      toast.success(`CSV import tamamlandi: ${succeeded} listing guncellendi`);
    } else {
      toast.error(`CSV import: ${succeeded} basarili, ${failed} basarisiz`);
    }

    fetchListings();
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
        const res = await fetch(
          `/api/clawd/etsy?action=update_listing&listing_id=${newRow.listing_id}&shop_id=${selectedShopId}`,
          { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        toast.success('Guncellendi');
        setListings((prev) => prev.map((l) => (l.listing_id === newRow.listing_id ? { ...l, ...body } : l)));
        const cacheKey = `${selectedShopId}:${statusFilter}`;
        delete listingsCacheRef.current[cacheKey];
        return newRow;
      } catch (err: any) {
        toast.error(`Guncelleme basarisiz: ${err.message}`);
        return oldRow;
      }
    },
    [selectedShopId, statusFilter]
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
    const toastId = toast.loading('Kopya olusturuluyor...');
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=copy_listing&shop_id=${shopId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_listing_id: listingId }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const draftCacheKey = `${shopId}:draft`;
      delete listingsCacheRef.current[draftCacheKey];

      setDrawerListingId(String(data.new_listing_id));
      setDrawerOpen(true);

      const sourceImages: Array<{ url_fullxfull: string; rank: number }> = data.source_images || [];
      if (sourceImages.length > 0) {
        toast.loading(`Gorseller kopyalaniyor (0/${sourceImages.length})...`, { id: toastId });
        let copied = 0;
        for (const img of sourceImages.sort((a, b) => (a.rank || 1) - (b.rank || 1))) {
          if (!img.url_fullxfull) continue;
          try {
            const uploadRes = await fetch(
              `/api/clawd/etsy?action=upload_image&listing_id=${data.new_listing_id}&shop_id=${shopId}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_url: img.url_fullxfull, rank: img.rank || 1, overwrite: false }),
              }
            );
            if (!uploadRes.ok) {
              const errData = await uploadRes.json().catch(() => ({}));
              console.warn(`Image copy rank ${img.rank} failed:`, errData);
              continue;
            }
            copied++;
            toast.loading(`Gorseller kopyalaniyor (${copied}/${sourceImages.length})...`, { id: toastId });
          } catch { /* skip failed image */ }
        }
        setDrawerRefreshKey((k) => k + 1);
        toast.success(`Kopya tamamlandi - ${copied} gorsel kopyalandi`, { id: toastId });
      } else {
        toast.success('Kopya olusturuldu', { id: toastId });
      }
    } catch (err: any) {
      toast.error(err.message || 'Kopyalama basarisiz', { id: toastId });
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
        state: l.state,
        shop_section_id: l.shop_section_id,
        thumbnail: l.thumbnail,
      }));
  }, [selectedIds, filteredListings]);

  const selectedCount = useMemo(() => ('ids' in selectedIds ? selectedIds.ids.size : 0), [selectedIds]);

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
        headerName: 'Baslik',
        flex: 1,
        minWidth: 280,
        editable: true,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => (
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
            <Tooltip title={params.row.title} arrow>
              <Typography
                variant="body2"
                sx={{
                  cursor: 'pointer',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  pr: 8,
                  '&:hover': { color: 'primary.main', textDecoration: 'underline' },
                }}
                onClick={() => handleOpenEditor(params.row.listing_id)}
              >
                {params.row.title}
              </Typography>
            </Tooltip>
            <Box className="row-actions">
              <Tooltip title="Duzenle" arrow>
                <IconButton size="small" onClick={() => handleOpenEditor(params.row.listing_id)} sx={{ p: 0.5 }}>
                  <EditIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Kopyala" arrow>
                <IconButton size="small" onClick={() => handleCopyListing(params.row.listing_id)} sx={{ p: 0.5 }}>
                  <ContentCopyIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Sil" arrow>
                <IconButton size="small" color="error" onClick={() => setDeleteConfirmId(params.row.listing_id)} sx={{ p: 0.5 }}>
                  <DeleteIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>
        ),
      },
      {
        field: 'quantity',
        headerName: 'Stok',
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
        headerName: 'Fiyat',
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
        headerName: 'Bitis',
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
        headerName: 'Bolum',
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
        headerName: 'Skor',
        width: 70,
        sortable: true,
        filterable: false,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => {
          const h = calculateHealth(params.row);
          const gc = gradeColor(h.grade);
          return (
            <Tooltip
              arrow
              title={
                <Box sx={{ fontSize: 12 }}>
                  <Box sx={{ fontWeight: 700, mb: 0.5 }}>Skor: {h.overall}/100</Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: h.tags.color }} />
                    {h.tags.label}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: h.images.color }} />
                    {h.images.label}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: h.title.color }} />
                    {h.title.label}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: h.description.color }} />
                    {h.description.label}
                  </Box>
                </Box>
              }
            >
              <Chip
                label={h.grade}
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
    [sectionNameMap] // eslint-disable-line react-hooks/exhaustive-deps
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
    <Box sx={{ p: { xs: 1, sm: 2, md: 3 }, maxWidth: 1800, mx: 'auto', overflowX: 'hidden' }}>
      <Toaster position="top-right" />

      {/* No shops message */}
      {shops.length === 0 && !(loading) && (
        <Paper sx={{ p: 3, mb: 2, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
            Henuz bagli bir Etsy magazaniz yok.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Etsy magazanizi baglamak icin Ayarlar sayfasina gidin.
          </Typography>
          <Button variant="contained" size="small" href="/ayarlar">
            Ayarlar Sayfasina Git
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
            <Paper sx={{ px: 1.5, py: 0.75, mb: 1, display: 'flex', alignItems: 'center', gap: { xs: 1.5, sm: 2 }, flexWrap: 'wrap', minHeight: 36 }}>
              <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.82rem' }}>
                {totalCount} listing
              </Typography>
              {!isMobile && (
                <>
                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.78rem' }}>
                    ·&nbsp;&nbsp;{quickStats.totalViews.toLocaleString()} goruntuleme
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.78rem' }}>
                    ·&nbsp;&nbsp;{quickStats.totalFavs.toLocaleString()} favori
                  </Typography>
                </>
              )}
              {quickStats.outOfStock > 0 && (
                <Typography
                  variant="body2"
                  sx={{ fontSize: '0.78rem', color: 'error.main', fontWeight: 600, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                  onClick={() => setHealthFilter('no_stock')}
                >
                  ·&nbsp;&nbsp;{quickStats.outOfStock} stoksuz
                </Typography>
              )}
              {quickStats.withIssues > 0 && (
                <Typography
                  variant="body2"
                  sx={{ fontSize: '0.78rem', color: 'warning.main', fontWeight: 600, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                  onClick={() => setHealthFilter('issues')}
                >
                  ·&nbsp;&nbsp;{quickStats.withIssues} sorunlu
                </Typography>
              )}
            </Paper>
          )}

          {/* Top Toolbar */}
          <Paper sx={{ px: 1.5, py: 1, mb: 1.5, overflow: 'hidden', width: '100%', boxSizing: 'border-box' }}>
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
                {STATE_LABELS[statusFilter] || statusFilter}
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
                    <MenuItem value="active">Aktif</MenuItem>
                    <MenuItem value="draft">Taslak</MenuItem>
                    <MenuItem value="inactive">Deaktif</MenuItem>
                    <MenuItem value="expired">Sur. Dolmus</MenuItem>
                  </Select>
                </FormControl>
              )}

              {/* Refresh */}
              <IconButton
                size="small"
                onClick={() => {
                  const cacheKey = `${selectedShopId}:${statusFilter}`;
                  delete listingsCacheRef.current[cacheKey];
                  fetchListings();
                }}
                disabled={loading}
                sx={{
                  minWidth: 36, minHeight: 36, borderRadius: '8px', border: '1px solid #e2e8f0',
                  color: '#475569', '&:hover': { bgcolor: '#f8fafc', borderColor: '#cbd5e1' },
                }}
              >
                <RefreshIcon fontSize="small" />
              </IconButton>

              {/* Spacer */}
              <Box sx={{ flex: '1 0 0' }} />

              {/* Search */}
              <TextField
                size="small"
                placeholder="Ara..."
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
                <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Araclar</Box>
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
                <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Yeni Listing</Box>
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
              <ListItemText>Bul &amp; Degistir</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { setToolsMenuAnchor(null); setDuplicateDetectorOpen(true); }}>
              <ListItemIcon><ContentPasteSearchIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Tekrar Tespit</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { setToolsMenuAnchor(null); setSmartPricingOpen(true); }}>
              <ListItemIcon><PriceChangeIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Akilli Fiyat</ListItemText>
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => { setToolsMenuAnchor(null); handleExportCSV(); }}>
              <ListItemIcon><FileDownloadIcon fontSize="small" /></ListItemIcon>
              <ListItemText>CSV Indir</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { setToolsMenuAnchor(null); handleCSVFileSelect(); }}>
              <ListItemIcon><FileUploadIcon fontSize="small" /></ListItemIcon>
              <ListItemText>CSV Yukle</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { setToolsMenuAnchor(null); setBackupManagerOpen(true); }}>
              <ListItemIcon><InventoryIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Yedekler</ListItemText>
            </MenuItem>
          </Menu>

          {/* Selection toolbar: when items are selected */}
          {selectedCount > 0 && selectedShopId && (
            <Paper sx={{ px: 1.5, py: 1, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', bgcolor: 'primary.50', border: '1px solid', borderColor: 'primary.200' }}>
              <Typography variant="body2" sx={{ fontWeight: 700, color: 'primary.main', mr: 1 }}>
                {selectedCount} secildi
              </Typography>
              <Button
                variant="contained"
                size="small"
                onClick={() => setBulkEditorOpen(true)}
                sx={{
                  minHeight: 36, textTransform: 'none', fontWeight: 700, borderRadius: '8px',
                  background: 'linear-gradient(135deg, #2563eb, #4f46e5)',
                  '&:hover': { background: 'linear-gradient(135deg, #1d4ed8, #4338ca)' },
                }}
              >
                <EditIcon sx={{ mr: 0.5, fontSize: 18 }} />
                {isMobile ? 'Duzenle' : 'Toplu Duzenle'}
              </Button>
              <BulkOperationsBar
                selectedCount={selectedCount}
                selectedListings={selectedListings}
                shopSections={shopSections}
                shopId={selectedShopId}
                allShops={shops}
                onCompleted={() => {
                  setSelectedIds({ type: 'include' as const, ids: new Set<GridRowId>() });
                  const cacheKey = `${selectedShopId}:${statusFilter}`;
                  delete listingsCacheRef.current[cacheKey];
                  fetchListings();
                }}
              />
            </Paper>
          )}

          {/* Active Filter Chips (desktop, when sidebar filters are active) */}
          {!isMobile && activeFilterCount > 0 && (
            <Box sx={{ display: 'flex', gap: 0.5, mb: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              {sectionFilter && (
                <Chip
                  label={`Bolum: ${shopSections.find(s => String(s.shop_section_id) === sectionFilter)?.title || sectionFilter}`}
                  size="small"
                  onDelete={() => setSectionFilter('')}
                  sx={{ height: 28 }}
                />
              )}
              {healthFilter && (
                <Chip
                  label={`Saglik: ${healthFilter === 'issues' ? 'Sorunlu' : healthFilter === 'missing_images' ? 'Resim Eksik' : healthFilter === 'missing_tags' ? 'Etiket Eksik' : healthFilter === 'short_title' ? 'Kisa Baslik' : healthFilter === 'no_description' ? 'Aciklama Yok' : healthFilter === 'no_video' ? 'Video Yok' : 'Stok Yok'}`}
                  size="small"
                  onDelete={() => setHealthFilter('')}
                  color="warning"
                  sx={{ height: 28 }}
                />
              )}
              {excludeTerm.trim() && (
                <Chip
                  label={`Haric: ${excludeTerm}`}
                  size="small"
                  onDelete={() => setExcludeTerm('')}
                  color="error"
                  variant="outlined"
                  sx={{ height: 28 }}
                />
              )}
              <Chip
                label="Tumunu Temizle"
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
                {listings.length}/{totalCount} yukleniyor...
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
                  {selectedShopId ? 'Listing bulunamadi' : 'Lutfen bir magaza secin'}
                </Typography>
              </Paper>
            ) : (
              <>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, px: 0.5 }}>
                  {filteredListings.length} sonuc{filteredListings.length !== totalCount ? ` (toplam ${totalCount})` : ''}
                </Typography>
                {filteredListings.slice(0, mobileVisibleCount).map((listing) => (
                  <MobileEtsyListingCard
                    key={listing.listing_id}
                    listing={listing}
                    onEdit={handleOpenEditor}
                    onCopy={handleCopyListing}
                    onDelete={(id) => setDeleteConfirmId(id)}
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
                    Daha Fazla Yukle ({Math.min(25, filteredListings.length - mobileVisibleCount)} daha)
                  </Button>
                )}
              </>
            )}
          </Box>

          {/* Column Preset Toggle + DataGrid (desktop only) */}
          <Paper sx={{ width: '100%', display: { xs: 'none', md: 'block' } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', px: 1.5, pt: 1, gap: 0.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>Gorunum:</Typography>
              {([
                { label: 'Kompakt', model: { expires: false, section: false } as Record<string, boolean> },
                { label: 'Detayli', model: { expires: false } as Record<string, boolean> },
                { label: 'Tumu', model: {} as Record<string, boolean> },
              ]).map((preset) => {
                const isActive = JSON.stringify(columnVisibilityModel) === JSON.stringify(preset.model);
                return (
                  <Chip
                    key={preset.label}
                    label={preset.label}
                    size="small"
                    onClick={() => setColumnVisibilityModel(preset.model)}
                    sx={{
                      height: 26, fontSize: '0.75rem', fontWeight: isActive ? 700 : 400,
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
          </Paper>
          <Paper sx={{ width: '100%', display: { xs: 'none', md: 'block' } }}>
            <DataGrid
              rows={filteredListings}
              columns={columns}
              loading={loading}
              checkboxSelection
              disableRowSelectionOnClick
              processRowUpdate={handleProcessRowUpdate}
              onProcessRowUpdateError={(error) => toast.error(`Guncelleme hatasi: ${error.message}`)}
              rowHeight={64}
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
                      {selectedShopId ? 'Listing bulunamadi' : 'Lutfen bir magaza secin'}
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
              Listing Sil
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Bu listing&apos;i silmek istediginizden emin misiniz? Bu islem geri alinamaz.
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
              <Button size="small" onClick={() => setDeleteConfirmId(null)}>
                Iptal
              </Button>
              <Button
                size="small"
                variant="contained"
                color="error"
                onClick={() => handleDeleteListing(deleteConfirmId)}
              >
                Sil
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
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>Filtreler</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <FormControl size="small" fullWidth>
              <InputLabel>Bolum</InputLabel>
              <Select value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)} label="Bolum">
                <MenuItem value="">Tum Bolumler</MenuItem>
                {shopSections.map((s) => <MenuItem key={s.shop_section_id} value={String(s.shop_section_id)}>{s.title}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel>Saglik</InputLabel>
              <Select value={healthFilter} onChange={(e) => setHealthFilter(e.target.value)} label="Saglik">
                <MenuItem value="">Tum Saglik</MenuItem>
                <MenuItem value="issues">Sorunlu</MenuItem>
                <MenuItem value="missing_images">Resim Eksik (&lt;10)</MenuItem>
                <MenuItem value="missing_tags">Etiket Eksik (&lt;13)</MenuItem>
                <MenuItem value="short_title">Kisa Baslik (&lt;100)</MenuItem>
                <MenuItem value="no_description">Aciklama Yok</MenuItem>
                <MenuItem value="no_video">Video Yok</MenuItem>
                <MenuItem value="no_stock">Stok Yok</MenuItem>
              </Select>
            </FormControl>
            <TextField
              size="small"
              fullWidth
              label="Icermez"
              placeholder="Haric tutulacak kelime..."
              value={excludeTerm}
              onChange={(e) => setExcludeTerm(e.target.value)}
            />
            {activeFilterCount > 0 && (
              <Button size="small" color="error" onClick={() => { setSectionFilter(''); setHealthFilter(''); setExcludeTerm(''); }}>
                Filtreleri Temizle
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
          toast.success(`Listing #${listingId} olusturuldu`);
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
        onCompleted={() => {
          setBulkEditorOpen(false);
          setSelectedIds({ type: 'include' as const, ids: new Set<GridRowId>() });
          const cacheKey = `${selectedShopId}:${statusFilter}`;
          delete listingsCacheRef.current[cacheKey];
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
                {csvImportRows.length} listing guncellenecek. Asagida degisiklikler listelenmistir.
              </Typography>
              <TableContainer sx={{ maxHeight: 400 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Listing ID</TableCell>
                      <TableCell>Baslik</TableCell>
                      <TableCell>Fiyat</TableCell>
                      <TableCell>Stok</TableCell>
                      <TableCell>Etiketler</TableCell>
                      <TableCell>Durum</TableCell>
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
            {csvImporting ? 'Import ediliyor...' : `${csvImportRows.length} Listing Guncelle`}
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
