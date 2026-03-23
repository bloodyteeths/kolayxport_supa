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
} from '@mui/icons-material';
import { toast, Toaster } from 'react-hot-toast';
import AppLayout from '@/components/AppLayout';
import withAuth from '@/components/withAuth';
import { useAuth } from '@/lib/auth-context';

import { Tabs, Tab, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import SEOIndicator from '@/components/ebay/SEOIndicator';
import ListingEditorDrawer from '@/components/ebay/ListingEditorDrawer';
import ListingCreatorDialog from '@/components/ebay/ListingCreatorDialog';
import FindReplaceDialog from '@/components/ebay/FindReplaceDialog';
import BulkOperationsBar from '@/components/ebay/BulkOperationsBar';
import MarketResearch from '@/components/ebay/MarketResearch';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EbayListingRow {
  id: string; // SKU (used as row id)
  sku: string;
  offerId?: string;
  listingId?: string;
  title: string;
  description: string;
  price: { value: string; currency: string };
  quantity: number;
  status: string; // PUBLISHED, UNPUBLISHED
  condition: string; // NEW, LIKE_NEW, etc.
  categoryId: string;
  categoryName?: string;
  imageUrl?: string; // first image URL
  imageCount: number;
  aspects: Record<string, string[]>;
  format: string; // FIXED_PRICE
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
  if (!price) return '—';
  const symbols: Record<string, string> = { USD: '$', GBP: '\u00a3', EUR: '\u20ac', TRY: '\u20ba' };
  const val = parseFloat(price.value || '0');
  return `${symbols[price.currency] || price.currency + ' '}${val.toFixed(2)}`;
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

  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({
    page: 0,
    pageSize: 25,
  });

  // Metadata
  const [fulfillmentPolicies, setFulfillmentPolicies] = useState<any[]>([]);
  const [returnPolicies, setReturnPolicies] = useState<any[]>([]);
  const [paymentPolicies, setPaymentPolicies] = useState<any[]>([]);

  // Page-level tab: 0 = Listings, 1 = Market Research
  const [pageTab, setPageTab] = useState(0);

  // Dialogs
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSku, setEditorSku] = useState('');
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<EbayListingRow | null>(null);

  // --- Fetch listings ---
  const fetchListings = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/clawd/ebay?action=listings&user_id=${userId}&marketplace_id=EBAY_US`,
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const rows: EbayListingRow[] = (data.offers || []).map((l: any) => ({
        id: l.offerId || l.sku || String(l.listingId),
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
      }));
      setListings(rows);
    } catch (err: any) {
      console.error('Failed to fetch eBay listings:', err);
      toast.error(`Listelemeler yuklenemedi: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [userId]);

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
      return true;
    });
  }, [listings, searchTerm, statusFilter]);

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
              imageCount: false,
            }
          : {}
      );
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <Box sx={{ p: { xs: 1, sm: 2, md: 3 }, maxWidth: 1600, mx: 'auto' }}>
      <Toaster position="top-right" />

      {/* Statistics Bar */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Paper sx={{ p: 1.5, flex: 1, minWidth: 120 }}>
          <Typography variant="caption" color="text.secondary">
            Toplam Listeleme
          </Typography>
          <Typography variant="h6" fontWeight={700}>
            {totalCount}
          </Typography>
        </Paper>
        <Paper sx={{ p: 1.5, flex: 1, minWidth: 120 }}>
          <Typography variant="caption" color="text.secondary">
            Yayinda
          </Typography>
          <Typography variant="h6" fontWeight={700} color="success.main">
            {publishedCount}
          </Typography>
        </Paper>
        <Paper sx={{ p: 1.5, flex: 1, minWidth: 120 }}>
          <Typography variant="caption" color="text.secondary">
            Taslak
          </Typography>
          <Typography variant="h6" fontWeight={700} color="warning.main">
            {unpublishedCount}
          </Typography>
        </Paper>
        <Paper sx={{ p: 1.5, flex: 1, minWidth: 120 }}>
          <Typography variant="caption" color="text.secondary">
            Stok Biten
          </Typography>
          <Typography variant="h6" fontWeight={700} color="error">
            {outOfStock}
          </Typography>
        </Paper>
      </Box>

      {/* Page Tabs: Listings | Market Research */}
      <Tabs value={pageTab} onChange={(_, v) => setPageTab(v)} sx={{ mb: 2 }}>
        <Tab label="Listelemeler" />
        <Tab label="Pazar Araştırması" />
      </Tabs>

      {/* Market Research Tab */}
      {pageTab === 1 && (
        <MarketResearch userId={userId} />
      )}

      {/* Listings Tab */}
      {pageTab === 0 && (<>

      {/* Toolbar */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2, alignItems: 'center' }}>
        {/* Search */}
        <TextField
          size="small"
          placeholder="Listeleme ara..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          sx={{ minWidth: 200 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />

        {/* Status filter */}
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <MenuItem value="all">Tumu</MenuItem>
            <MenuItem value="PUBLISHED">Yayinda</MenuItem>
            <MenuItem value="UNPUBLISHED">Taslak</MenuItem>
          </Select>
        </FormControl>

        <Box sx={{ flex: 1 }} />

        {/* Action buttons */}
        <Button variant="contained" size="small" onClick={() => setCreatorOpen(true)}>
          + Yeni Listeleme
        </Button>
        <Button variant="outlined" size="small" onClick={() => setFindReplaceOpen(true)}>
          Bul ve Degistir
        </Button>
        <Button variant="outlined" size="small" onClick={handleExportCSV}>
          CSV Indir
        </Button>
        <IconButton size="small" onClick={fetchListings} disabled={loading}>
          <RefreshIcon />
        </IconButton>
      </Box>

      {/* DataGrid */}
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
          getRowId={(row) => row.sku}
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

      </>)}

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
