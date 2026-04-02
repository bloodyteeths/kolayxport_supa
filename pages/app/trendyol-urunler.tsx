import React, { useState, useMemo, useEffect, useCallback } from 'react';
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
  Menu,
  ListItemIcon,
  ListItemText,
  Checkbox,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  DataGrid,
  GridColDef,
  GridPaginationModel,
  GridRenderCellParams,
  GridRowSelectionModel,
} from '@mui/x-data-grid';
import {
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Edit as EditIcon,
  Archive as ArchiveIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Add as AddIcon,
  MoreVert as MoreVertIcon,
  FindReplace as FindReplaceIcon,
  FileDownload as FileDownloadIcon,
  FileUpload as FileUploadIcon,
  PriceChange as PriceChangeIcon,
  Inventory as InventoryIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { toast, Toaster } from 'react-hot-toast';
import AppLayout from '@/components/AppLayout';
import withAuth from '@/components/withAuth';
import { useAuth } from '@/lib/auth-context';
import { useTranslations } from 'next-intl';
import TrendyolListingEditorDrawer from '@/components/trendyol/listings/TrendyolListingEditorDrawer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TrendyolProductRow {
  id: string;
  barcode: string;
  stockCode: string;
  productMainId: string;
  trendyolId: string;
  title: string;
  description: string;
  brandId: number;
  brandName: string;
  categoryId: number;
  categoryName: string;
  listPrice: number;
  salePrice: number;
  currencyType: string;
  quantity: number;
  vatRate: number;
  images: { url: string }[];
  thumbnailUrl: string;
  imageCount: number;
  attributes: any[];
  approved: boolean;
  onSale: boolean;
  rejected: boolean;
  blacklisted: boolean;
  archived: boolean;
  rejectReasons: any[];
  dimensionalWeight: number;
  cargoCompanyId: number;
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
}

type StatusFilter = 'all' | 'approved' | 'onSale' | 'rejected' | 'archived' | 'pending';

// ---------------------------------------------------------------------------
// Trendyol Orange Accent
// ---------------------------------------------------------------------------

const TRENDYOL_ORANGE = '#F27A1A';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrice(value: number | null | undefined, currency?: string): string {
  if (value == null) return '\u2014';
  return `\u20ba${value.toFixed(2)}`;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '\u2014';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '\u2014';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear().toString().slice(-2)}`;
  } catch {
    return '\u2014';
  }
}

// ---------------------------------------------------------------------------
// Status Helpers
// ---------------------------------------------------------------------------

function getProductStatus(product: TrendyolProductRow): StatusFilter {
  if (product.archived) return 'archived';
  if (product.rejected) return 'rejected';
  if (product.approved && product.onSale) return 'onSale';
  if (product.approved) return 'approved';
  return 'pending';
}

function getStatusChip(product: TrendyolProductRow): { label: string; color: 'success' | 'info' | 'error' | 'default' | 'warning' } {
  const status = getProductStatus(product);
  switch (status) {
    case 'onSale': return { label: 'On Sale', color: 'success' };
    case 'approved': return { label: 'Approved', color: 'info' };
    case 'rejected': return { label: 'Rejected', color: 'error' };
    case 'archived': return { label: 'Archived', color: 'default' };
    case 'pending': return { label: 'Pending', color: 'warning' };
    default: return { label: 'Unknown', color: 'default' };
  }
}

// ---------------------------------------------------------------------------
// Health Score + Letter Grade
// ---------------------------------------------------------------------------

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

function calculateTrendyolHealth(product: TrendyolProductRow): { overall: number; grade: string; color: string } {
  const titleLen = product.title?.length || 0;
  const titleScore = titleLen >= 80 && titleLen <= 150 ? 25 : Math.round(Math.min(titleLen / 150, 1) * 25);
  const imgScore = Math.round(Math.min((product.imageCount || 0) / 5, 1) * 25);
  const descScore = Math.round(Math.min((product.description?.length || 0) / 300, 1) * 25);
  const attrScore = (product.attributes?.length || 0) > 0 ? 25 : 0;
  const overall = titleScore + imgScore + descScore + attrScore;
  const grade = scoreToGrade(overall);
  const color = gradeColor(grade);
  return { overall, grade, color };
}

// ---------------------------------------------------------------------------
// Mobile Card Component
// ---------------------------------------------------------------------------

function MobileTrendyolCard({
  product,
  onEdit,
  onArchive,
  selected,
  onToggleSelect,
  t,
}: {
  product: TrendyolProductRow;
  onEdit: (id: string) => void;
  onArchive: (id: string) => void;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  t: (key: string, values?: Record<string, any>) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const health = calculateTrendyolHealth(product);
  const statusChip = getStatusChip(product);

  return (
    <Paper
      sx={{
        mb: 1,
        overflow: 'hidden',
        borderRadius: 2,
        maxWidth: '100%',
        width: '100%',
        border: selected ? '2px solid' : '1px solid',
        borderColor: selected ? TRENDYOL_ORANGE : 'divider',
      }}
    >
      {/* Always-visible header */}
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
        {/* Checkbox */}
        <Checkbox
          checked={selected}
          onChange={(e) => { e.stopPropagation(); onToggleSelect(product.id); }}
          onClick={(e) => e.stopPropagation()}
          size="small"
          sx={{ p: 0.5, flexShrink: 0, '&.Mui-checked': { color: TRENDYOL_ORANGE } }}
        />

        {/* Thumbnail */}
        {product.thumbnailUrl ? (
          <Box
            component="img"
            src={product.thumbnailUrl}
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
            {product.title}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', mt: 0.25, flexWrap: 'wrap' }}>
            <Typography variant="body2" fontWeight={600} fontSize="0.82rem">
              {formatPrice(product.salePrice)}
            </Typography>
            <Typography variant="caption" color="text.secondary" fontSize="0.72rem">
              {t('quantity')}: {product.quantity}
            </Typography>
            <Chip
              label={t(getProductStatus(product))}
              size="small"
              color={statusChip.color}
              variant="outlined"
              sx={{ height: 18, fontSize: 10, '& .MuiChip-label': { px: 0.5 } }}
            />
            <Chip
              label={health.grade}
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
          {/* Info grid */}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
            <Box sx={{ flex: '1 1 45%' }}>
              <Typography variant="caption" color="text.secondary">{t('brand')}</Typography>
              <Typography variant="body2">{product.brandName || '\u2014'}</Typography>
            </Box>
            <Box sx={{ flex: '1 1 45%' }}>
              <Typography variant="caption" color="text.secondary">{t('category')}</Typography>
              <Typography variant="body2">{product.categoryName || '\u2014'}</Typography>
            </Box>
            <Box sx={{ flex: '1 1 45%' }}>
              <Typography variant="caption" color="text.secondary">{t('barcode')}</Typography>
              <Typography variant="body2" sx={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>{product.barcode || '\u2014'}</Typography>
            </Box>
            <Box sx={{ flex: '1 1 45%' }}>
              <Typography variant="caption" color="text.secondary">{t('listPrice')}</Typography>
              <Typography variant="body2">{formatPrice(product.listPrice)}</Typography>
            </Box>
            <Box sx={{ flex: '1 1 45%' }}>
              <Typography variant="caption" color="text.secondary">{t('quantity')}</Typography>
              <Typography variant="body2">{product.quantity}</Typography>
            </Box>
            <Box sx={{ flex: '1 1 45%' }}>
              <Typography variant="caption" color="text.secondary">{t('healthScore')}</Typography>
              <Typography variant="body2" sx={{ color: health.color, fontWeight: 700 }}>
                {health.grade} ({health.overall}/100)
              </Typography>
            </Box>
          </Box>

          {/* Reject reasons */}
          {product.rejected && product.rejectReasons?.length > 0 && (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="caption" color="error" fontWeight={600}>{t('rejectReason')}:</Typography>
              {product.rejectReasons.map((r: any, i: number) => (
                <Typography key={i} variant="caption" color="error" display="block" sx={{ ml: 1 }}>
                  {typeof r === 'string' ? r : r.reason || JSON.stringify(r)}
                </Typography>
              ))}
            </Box>
          )}

          {/* Actions */}
          <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
            <Button
              size="small"
              variant="contained"
              startIcon={<EditIcon sx={{ fontSize: '16px !important' }} />}
              onClick={(e) => { e.stopPropagation(); onEdit(product.id); }}
              sx={{
                flex: 1,
                minHeight: 42,
                borderRadius: '10px',
                textTransform: 'none',
                fontWeight: 600,
                fontSize: '0.8rem',
                background: `linear-gradient(135deg, ${TRENDYOL_ORANGE}, #e06a10)`,
                boxShadow: `0 2px 8px rgba(242,122,26,0.25)`,
                '&:hover': { background: `linear-gradient(135deg, #e06a10, #cc5a00)` },
              }}
            >
              {t('editProduct')}
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={<ArchiveIcon sx={{ fontSize: '16px !important' }} />}
              onClick={(e) => { e.stopPropagation(); onArchive(product.id); }}
              sx={{
                flex: 1,
                minHeight: 42,
                borderRadius: '10px',
                textTransform: 'none',
                fontWeight: 600,
                fontSize: '0.8rem',
                background: 'linear-gradient(135deg, #78909c, #607d8b)',
                boxShadow: '0 2px 8px rgba(96,125,139,0.25)',
                '&:hover': { background: 'linear-gradient(135deg, #607d8b, #546e7a)' },
              }}
            >
              {t('archiveProduct')}
            </Button>
          </Box>
        </Box>
      </Collapse>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

function TrendyolListingsPage() {
  const t = useTranslations('trendyolListings');
  const { user } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  // State
  const [products, setProducts] = useState<TrendyolProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drawerProductId, setDrawerProductId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [toolsMenuAnchor, setToolsMenuAnchor] = useState<null | HTMLElement>(null);

  // ---------------------------------------------------------------------------
  // Fetch Products
  // ---------------------------------------------------------------------------

  const fetchProducts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/trendyol/products?action=list&fromCache=true&size=500');
      if (!res.ok) throw new Error('Failed to fetch products');
      const data = await res.json();
      setProducts(Array.isArray(data?.content) ? data.content : data.products || []);
    } catch (err) {
      console.error('Failed to fetch Trendyol products:', err);
      toast.error(t('syncFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // ---------------------------------------------------------------------------
  // Sync
  // ---------------------------------------------------------------------------

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/trendyol/products?action=sync', { method: 'POST' });
      if (!res.ok) throw new Error();
      toast.success(t('syncComplete'));
      await fetchProducts();
    } catch {
      toast.error(t('syncFailed'));
    } finally {
      setSyncing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------------

  const filteredProducts = useMemo(() => {
    let result = products;

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter((p) => getProductStatus(p) === statusFilter);
    }

    // Search
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      result = result.filter(
        (p) =>
          p.title?.toLowerCase().includes(term) ||
          p.barcode?.toLowerCase().includes(term) ||
          p.brandName?.toLowerCase().includes(term) ||
          p.stockCode?.toLowerCase().includes(term)
      );
    }

    return result;
  }, [products, statusFilter, searchTerm]);

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectionModelChange = (model: GridRowSelectionModel) => {
    if ('ids' in model) {
      setSelectedIds(new Set(Array.from(model.ids).map(String)));
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  // ---------------------------------------------------------------------------
  // Placeholder Actions
  // ---------------------------------------------------------------------------

  const handleEdit = (id: string) => {
    setDrawerProductId(id);
    setDrawerOpen(true);
  };

  const handleArchive = (id: string) => {
    toast(t('archiveProduct') + ' (coming soon)');
  };

  const handleCreate = () => {
    toast(t('createProduct') + ' (coming soon)');
  };

  // ---------------------------------------------------------------------------
  // DataGrid Columns
  // ---------------------------------------------------------------------------

  const columns: GridColDef[] = useMemo(
    () => [
      {
        field: 'thumbnail',
        headerName: '',
        width: 60,
        sortable: false,
        filterable: false,
        renderCell: (params: GridRenderCellParams<TrendyolProductRow>) => (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
            {params.row.thumbnailUrl ? (
              <Box
                component="img"
                src={params.row.thumbnailUrl}
                alt=""
                sx={{ width: 42, height: 42, objectFit: 'cover', borderRadius: 1 }}
              />
            ) : (
              <Box
                sx={{
                  width: 42,
                  height: 42,
                  borderRadius: 1,
                  bgcolor: '#e0e0e0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Typography variant="caption" color="text.disabled">N/A</Typography>
              </Box>
            )}
          </Box>
        ),
      },
      {
        field: 'title',
        headerName: 'Title',
        flex: 1,
        minWidth: 200,
        renderCell: (params: GridRenderCellParams<TrendyolProductRow>) => (
          <Tooltip title={params.row.title} arrow>
            <Typography
              variant="body2"
              sx={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontWeight: 500,
                cursor: 'pointer',
                '&:hover': { color: TRENDYOL_ORANGE },
              }}
              onClick={() => handleEdit(params.row.id)}
            >
              {params.row.title}
            </Typography>
          </Tooltip>
        ),
      },
      {
        field: 'brandName',
        headerName: t('brand'),
        width: 120,
      },
      {
        field: 'categoryName',
        headerName: t('category'),
        width: 150,
      },
      {
        field: 'listPrice',
        headerName: t('listPrice'),
        width: 100,
        align: 'right',
        headerAlign: 'right',
        renderCell: (params: GridRenderCellParams<TrendyolProductRow>) => (
          <Typography variant="body2" color="text.secondary">
            {formatPrice(params.row.listPrice)}
          </Typography>
        ),
      },
      {
        field: 'salePrice',
        headerName: t('salePrice'),
        width: 100,
        align: 'right',
        headerAlign: 'right',
        renderCell: (params: GridRenderCellParams<TrendyolProductRow>) => (
          <Typography variant="body2" fontWeight={600}>
            {formatPrice(params.row.salePrice)}
          </Typography>
        ),
      },
      {
        field: 'quantity',
        headerName: t('quantity'),
        width: 80,
        align: 'center',
        headerAlign: 'center',
        renderCell: (params: GridRenderCellParams<TrendyolProductRow>) => (
          <Chip
            label={params.row.quantity}
            size="small"
            color={params.row.quantity > 0 ? 'default' : 'error'}
            variant="outlined"
            sx={{ minWidth: 40 }}
          />
        ),
      },
      {
        field: 'status',
        headerName: t('filterByStatus'),
        width: 110,
        sortable: false,
        renderCell: (params: GridRenderCellParams<TrendyolProductRow>) => {
          const chip = getStatusChip(params.row);
          return (
            <Chip
              label={t(getProductStatus(params.row))}
              size="small"
              color={chip.color}
              variant="filled"
              sx={{ fontWeight: 600, fontSize: 11 }}
            />
          );
        },
      },
      {
        field: 'health',
        headerName: t('healthScore'),
        width: 90,
        align: 'center',
        headerAlign: 'center',
        sortable: true,
        valueGetter: (_value: any, row: TrendyolProductRow) => calculateTrendyolHealth(row).overall,
        renderCell: (params: GridRenderCellParams<TrendyolProductRow>) => {
          const health = calculateTrendyolHealth(params.row);
          return (
            <Tooltip
              title={`${health.overall}/100 - Title: ${params.row.title?.length || 0} chars, Images: ${params.row.imageCount || 0}, Desc: ${params.row.description?.length || 0} chars, Attrs: ${params.row.attributes?.length || 0}`}
              arrow
            >
              <Chip
                label={health.grade}
                size="small"
                sx={{
                  fontWeight: 700,
                  bgcolor: `${health.color}15`,
                  color: health.color,
                  border: `1px solid ${health.color}`,
                  minWidth: 40,
                }}
              />
            </Tooltip>
          );
        },
      },
      {
        field: 'actions',
        headerName: '',
        width: 90,
        sortable: false,
        filterable: false,
        renderCell: (params: GridRenderCellParams<TrendyolProductRow>) => (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title={t('editProduct')}>
              <IconButton size="small" onClick={() => handleEdit(params.row.id)} sx={{ color: TRENDYOL_ORANGE }}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('archiveProduct')}>
              <IconButton size="small" onClick={() => handleArchive(params.row.id)}>
                <ArchiveIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        ),
      },
    ],
    [t]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <AppLayout title={t('title')}>
      <Toaster position="top-right" />
      <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1400, mx: 'auto' }}>
        {/* Toolbar */}
        <Paper
          sx={{
            p: { xs: 1.5, md: 2 },
            mb: 2,
            borderRadius: 2,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1.5,
            alignItems: 'center',
          }}
        >
          {/* Search */}
          <TextField
            size="small"
            placeholder={t('searchProducts')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
                </InputAdornment>
              ),
            }}
            sx={{ flex: '1 1 200px', minWidth: 180 }}
          />

          {/* Status Filter */}
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>{t('filterByStatus')}</InputLabel>
            <Select
              value={statusFilter}
              label={t('filterByStatus')}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <MenuItem value="all">{t('all')}</MenuItem>
              <MenuItem value="approved">{t('approved')}</MenuItem>
              <MenuItem value="onSale">{t('onSale')}</MenuItem>
              <MenuItem value="rejected">{t('rejected')}</MenuItem>
              <MenuItem value="archived">{t('archived')}</MenuItem>
              <MenuItem value="pending">{t('pending')}</MenuItem>
            </Select>
          </FormControl>

          {/* Sync Button */}
          <Button
            variant="contained"
            startIcon={syncing ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
            onClick={handleSync}
            disabled={syncing}
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              bgcolor: TRENDYOL_ORANGE,
              '&:hover': { bgcolor: '#e06a10' },
              minWidth: 100,
            }}
          >
            {syncing ? t('syncing') : t('sync')}
          </Button>

          {/* Create Product */}
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={handleCreate}
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              borderColor: TRENDYOL_ORANGE,
              color: TRENDYOL_ORANGE,
              '&:hover': { borderColor: '#e06a10', bgcolor: `${TRENDYOL_ORANGE}08` },
            }}
          >
            {t('createProduct')}
          </Button>

          {/* Tools Menu */}
          <IconButton
            onClick={(e) => setToolsMenuAnchor(e.currentTarget)}
            sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}
          >
            <MoreVertIcon />
          </IconButton>
          <Menu
            anchorEl={toolsMenuAnchor}
            open={Boolean(toolsMenuAnchor)}
            onClose={() => setToolsMenuAnchor(null)}
          >
            <MenuItem onClick={() => { setToolsMenuAnchor(null); toast(t('findReplace') + ' (coming soon)'); }}>
              <ListItemIcon><FindReplaceIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('findReplace')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { setToolsMenuAnchor(null); toast(t('backup') + ' (coming soon)'); }}>
              <ListItemIcon><FileDownloadIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('backup')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { setToolsMenuAnchor(null); toast(t('restore') + ' (coming soon)'); }}>
              <ListItemIcon><FileUploadIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('restore')}</ListItemText>
            </MenuItem>
          </Menu>
        </Paper>

        {/* Summary bar */}
        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
          <Chip
            label={`${filteredProducts.length} ${t('title').toLowerCase()}`}
            size="small"
            sx={{ fontWeight: 600 }}
          />
          {statusFilter !== 'all' && (
            <Chip
              label={t(statusFilter)}
              size="small"
              color="primary"
              onDelete={() => setStatusFilter('all')}
              sx={{ fontWeight: 600 }}
            />
          )}
        </Box>

        {/* Loading */}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
            <CircularProgress sx={{ color: TRENDYOL_ORANGE }} />
          </Box>
        ) : filteredProducts.length === 0 ? (
          /* Empty State */
          <Paper sx={{ p: 6, textAlign: 'center', borderRadius: 2 }}>
            <InventoryIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
            <Typography variant="h6" color="text.secondary" gutterBottom>
              {t('noProducts')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              {t('connectTrendyol')}
            </Typography>
            <Button
              variant="contained"
              startIcon={<RefreshIcon />}
              onClick={handleSync}
              sx={{ bgcolor: TRENDYOL_ORANGE, '&:hover': { bgcolor: '#e06a10' } }}
            >
              {t('sync')}
            </Button>
          </Paper>
        ) : isMobile ? (
          /* Mobile: Expandable Cards */
          <Box>
            {filteredProducts.map((product) => (
              <MobileTrendyolCard
                key={product.id}
                product={product}
                onEdit={handleEdit}
                onArchive={handleArchive}
                selected={selectedIds.has(product.id)}
                onToggleSelect={handleToggleSelect}
                t={t}
              />
            ))}
          </Box>
        ) : (
          /* Desktop: DataGrid */
          <Paper sx={{ borderRadius: 2, overflow: 'hidden' }}>
            <DataGrid
              rows={filteredProducts}
              columns={columns}
              checkboxSelection
              disableRowSelectionOnClick
              rowSelectionModel={{ type: 'include' as const, ids: new Set(selectedIds) }}
              onRowSelectionModelChange={handleSelectionModelChange}
              paginationModel={paginationModel}
              onPaginationModelChange={setPaginationModel}
              pageSizeOptions={[10, 25, 50, 100]}
              rowHeight={56}
              getRowId={(row) => row.id}
              sx={{
                border: 'none',
                '& .MuiDataGrid-columnHeaders': {
                  bgcolor: '#fafafa',
                  borderBottom: '2px solid',
                  borderColor: 'divider',
                },
                '& .MuiDataGrid-row:hover': {
                  bgcolor: `${TRENDYOL_ORANGE}05`,
                },
                '& .MuiDataGrid-cell': {
                  borderColor: '#f0f0f0',
                },
                '& .MuiCheckbox-root.Mui-checked': {
                  color: TRENDYOL_ORANGE,
                },
              }}
              autoHeight
            />
          </Paper>
        )}

        {/* Bulk Operations Bar */}
        {selectedIds.size > 0 && (
          <Paper
            sx={{
              position: 'fixed',
              bottom: 0,
              left: { xs: 0, md: 240 },
              right: 0,
              p: { xs: 1.5, md: 2 },
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              flexWrap: 'wrap',
              borderRadius: 0,
              borderTop: '2px solid',
              borderColor: TRENDYOL_ORANGE,
              zIndex: 1200,
              bgcolor: 'background.paper',
              boxShadow: '0 -4px 12px rgba(0,0,0,0.1)',
            }}
          >
            <Typography variant="body2" fontWeight={700} sx={{ color: TRENDYOL_ORANGE }}>
              {t('selected', { count: selectedIds.size })}
            </Typography>

            <Button
              size="small"
              variant="outlined"
              startIcon={<PriceChangeIcon />}
              onClick={() => toast(t('bulkPriceUpdate') + ' (coming soon)')}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              {t('bulkPriceUpdate')}
            </Button>

            <Button
              size="small"
              variant="outlined"
              startIcon={<InventoryIcon />}
              onClick={() => toast(t('bulkStockUpdate') + ' (coming soon)')}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              {t('bulkStockUpdate')}
            </Button>

            <Button
              size="small"
              variant="outlined"
              startIcon={<ArchiveIcon />}
              onClick={() => toast(t('bulkArchive') + ' (coming soon)')}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              {t('bulkArchive')}
            </Button>

            <Box sx={{ flex: 1 }} />

            <IconButton size="small" onClick={clearSelection}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Paper>
        )}
      </Box>

      {/* Listing Editor Drawer */}
      <TrendyolListingEditorDrawer
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setDrawerProductId(null); }}
        productId={drawerProductId}
        onSaved={() => { setDrawerOpen(false); setDrawerProductId(null); fetchProducts(); }}
      />
    </AppLayout>
  );
}

export default withAuth(TrendyolListingsPage);
