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
  FavoriteBorder as FavoriteBorderIcon,
} from '@mui/icons-material';
import { toast, Toaster } from 'react-hot-toast';
import AppLayout from '@/components/AppLayout';
import withAuth from '@/components/withAuth';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';

import SEOIndicator from '@/components/etsy/SEOIndicator';
import ListingEditorDrawer from '@/components/etsy/ListingEditorDrawer';
import ListingCreatorDialog from '@/components/etsy/ListingCreatorDialog';
import FindReplaceDialog from '@/components/etsy/FindReplaceDialog';
import BulkOperationsBar from '@/components/etsy/BulkOperationsBar';

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
        ? '\u20AC'
        : price.currency_code === 'GBP'
          ? '\u00A3'
          : price.currency_code === 'TRY'
            ? '\u20BA'
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
  expired: 'S\u00FCr. Dolmu\u015F',
};

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

function EtsyListingsPage() {
  const { user } = useAuth();
  const apiKey = process.env.NEXT_PUBLIC_CLAWD_API_KEY || '';

  // --- State ---
  const [listings, setListings] = useState<EtsyListingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  const [selectedIds, setSelectedIds] = useState<GridRowSelectionModel>({ type: 'include' as const, ids: new Set<GridRowId>() });
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'draft' | 'inactive' | 'expired'>('active');
  const [sectionFilter, setSectionFilter] = useState<string>('');

  const [drawerListingId, setDrawerListingId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);

  const [shops, setShops] = useState<ShopInfo[]>([]);
  const [selectedShopId, setSelectedShopId] = useState<string>('');
  const [shopSections, setShopSections] = useState<ShopSection[]>([]);
  const [shippingProfiles, setShippingProfiles] = useState<ShippingProfile[]>([]);
  const [returnPolicies, setReturnPolicies] = useState<ReturnPolicy[]>([]);

  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({
    page: 0,
    pageSize: 25,
  });

  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // --- Fetch shops from database ---
  useEffect(() => {
    if (!(user as any)?.id) return;
    (async () => {
      const { data, error } = await (supabase as any)
        .from('EtsyShop')
        .select('shopId, shopName, isActive')
        .eq('userId', (user as any).id);
      if (error) {
        console.error('Failed to fetch Etsy shops:', error);
        return;
      }
      const shopList: ShopInfo[] = (data || []).map((s: any) => ({
        shopId: s.shopId,
        shopName: s.shopName || s.shopId,
        isActive: s.isActive,
      }));
      setShops(shopList);
      if (shopList.length > 0 && !selectedShopId) {
        setSelectedShopId(shopList[0].shopId);
      }
    })();
  }, [(user as any)?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Fetch listings ---
  const fetchListings = useCallback(async () => {
    if (!selectedShopId || !apiKey) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=listings_with_images&shop_id=${selectedShopId}&limit=100&state=${statusFilter}`,
        { headers: { 'x-api-key': apiKey } }
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const results: any[] = data.results || [];
      const rows: EtsyListingRow[] = results.map((l: any) => {
        const images = l.images || [];
        const firstImage = images.length > 0 ? images[0] : null;
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
          thumbnail: firstImage
            ? {
                listing_image_id: firstImage.listing_image_id,
                url_75x75: firstImage.url_75x75,
                url_170x135: firstImage.url_170x135,
                url_570xN: firstImage.url_570xN,
              }
            : null,
          image_count: images.length,
        };
      });
      setListings(rows);
      setTotalCount(data.count || rows.length);
    } catch (err: any) {
      console.error('Failed to fetch listings:', err);
      toast.error(`Listing\u2019lar y\u00FCklenemedi: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [selectedShopId, apiKey, statusFilter]);

  // --- Fetch shop metadata (sections, shipping profiles, return policies) ---
  const fetchShopMeta = useCallback(async () => {
    if (!selectedShopId || !apiKey) return;
    try {
      const [sectionsRes, shippingRes, returnRes] = await Promise.all([
        fetch(`/api/clawd/etsy?action=shop_sections&shop_id=${selectedShopId}`, {
          headers: { 'x-api-key': apiKey },
        }),
        fetch(`/api/clawd/etsy?action=shipping_profiles&shop_id=${selectedShopId}`, {
          headers: { 'x-api-key': apiKey },
        }),
        fetch(`/api/clawd/etsy?action=return_policies&shop_id=${selectedShopId}`, {
          headers: { 'x-api-key': apiKey },
        }),
      ]);

      if (sectionsRes.ok) {
        const d = await sectionsRes.json();
        setShopSections(d.results || []);
      }
      if (shippingRes.ok) {
        const d = await shippingRes.json();
        setShippingProfiles(d.results || []);
      }
      if (returnRes.ok) {
        const d = await returnRes.json();
        setReturnPolicies(d.results || []);
      }
    } catch (err) {
      console.error('Failed to fetch shop metadata:', err);
    }
  }, [selectedShopId, apiKey]);

  useEffect(() => {
    if (selectedShopId) {
      fetchListings();
      fetchShopMeta();
    }
  }, [selectedShopId, statusFilter, fetchListings, fetchShopMeta]);

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
    return result;
  }, [listings, searchTerm, sectionFilter]);

  // --- Delete listing ---
  const handleDeleteListing = useCallback(
    async (listingId: number) => {
      try {
        const res = await fetch(
          `/api/clawd/etsy?action=delete_listing&listing_id=${listingId}&shop_id=${selectedShopId}`,
          { method: 'DELETE', headers: { 'x-api-key': apiKey } }
        );
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }
        toast.success('Listing silindi');
        setDeleteConfirmId(null);
        fetchListings();
      } catch (err: any) {
        toast.error(`Silinemedi: ${err.message}`);
      }
    },
    [selectedShopId, apiKey, fetchListings]
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

  // --- Open editor drawer ---
  const handleOpenEditor = (listingId: number) => {
    setDrawerListingId(String(listingId));
    setDrawerOpen(true);
  };

  // --- Selected listing objects for bulk operations ---
  const selectedListings = useMemo(() => {
    const idSet = 'ids' in selectedIds ? selectedIds.ids : new Set<GridRowId>();
    return filteredListings
      .filter((l) => idSet.has(l.id))
      .map((l) => ({
        listing_id: l.listing_id,
        title: l.title,
        price: l.price,
        tags: l.tags,
        state: l.state,
        shop_section_id: l.shop_section_id,
      }));
  }, [selectedIds, filteredListings]);

  // --- DataGrid Columns ---
  const columns: GridColDef[] = useMemo(
    () => [
      {
        field: 'thumbnail',
        headerName: '',
        width: 60,
        sortable: false,
        filterable: false,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => {
          const thumb = params.row.thumbnail;
          return thumb ? (
            <Box
              component="img"
              src={thumb.url_75x75}
              alt=""
              sx={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 1 }}
            />
          ) : (
            <Box
              sx={{
                width: 50,
                height: 50,
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
        headerName: 'Ba\u015Fl\u0131k',
        flex: 1,
        minWidth: 200,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => (
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
              onClick={() => handleOpenEditor(params.row.listing_id)}
            >
              {params.row.title}
            </Typography>
          </Tooltip>
        ),
      },
      {
        field: 'price',
        headerName: 'Fiyat',
        width: 100,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => (
          <Typography variant="body2">{formatPrice(params.row.price)}</Typography>
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
        field: 'quantity',
        headerName: 'Stok',
        width: 80,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => {
          const qty = params.row.quantity;
          const color = qty === 0 ? 'error' : qty < 5 ? 'warning' : 'success';
          return <Chip label={qty} size="small" color={color} variant="outlined" />;
        },
      },
      {
        field: 'tags',
        headerName: 'Etiketler',
        width: 90,
        sortable: false,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => {
          const count = params.row.tags?.length || 0;
          const color = count >= 10 ? 'success' : count >= 5 ? 'warning' : 'error';
          return (
            <Tooltip title={params.row.tags?.join(', ') || 'Etiket yok'} arrow>
              <Chip label={`${count}/13`} size="small" color={color} variant="outlined" />
            </Tooltip>
          );
        },
      },
      {
        field: 'seo',
        headerName: 'SEO',
        width: 60,
        sortable: false,
        filterable: false,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => (
          <SEOIndicator
            tags={params.row.tags || []}
            title={params.row.title || ''}
            description={params.row.description || ''}
            compact
          />
        ),
      },
      {
        field: 'views',
        headerName: 'G\u00F6r\u00FCnt\u00FC',
        width: 80,
        type: 'number',
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => (
          <Typography variant="body2">{params.row.views.toLocaleString()}</Typography>
        ),
      },
      {
        field: 'num_favorers',
        headerName: 'Favori',
        width: 80,
        type: 'number',
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <FavoriteBorderIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
            <Typography variant="body2">{params.row.num_favorers.toLocaleString()}</Typography>
          </Box>
        ),
      },
      {
        field: 'state',
        headerName: 'Durum',
        width: 100,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => (
          <Chip
            label={STATE_LABELS[params.row.state] || params.row.state}
            size="small"
            color={STATE_COLORS[params.row.state] || 'default'}
          />
        ),
      },
      {
        field: 'updated_timestamp',
        headerName: 'G\u00FCncelleme',
        width: 100,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => (
          <Typography variant="body2" color="text.secondary">
            {formatTimestamp(params.row.updated_timestamp)}
          </Typography>
        ),
      },
      {
        field: 'actions',
        headerName: '',
        width: 90,
        sortable: false,
        filterable: false,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <IconButton size="small" onClick={() => handleOpenEditor(params.row.listing_id)}>
              <EditIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              color="error"
              onClick={() => setDeleteConfirmId(params.row.listing_id)}
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
              tags: false,
              seo: false,
              views: false,
              num_favorers: false,
              updated_timestamp: false,
              state: false,
            }
          : {}
      );
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- Statistics ---
  const totalViews = useMemo(() => listings.reduce((s, l) => s + l.views, 0), [listings]);
  const totalFavorites = useMemo(() => listings.reduce((s, l) => s + l.num_favorers, 0), [listings]);
  const outOfStock = useMemo(() => listings.filter((l) => l.quantity === 0).length, [listings]);

  return (
    <Box sx={{ p: { xs: 1, sm: 2, md: 3 }, maxWidth: 1600, mx: 'auto' }}>
      <Toaster position="top-right" />

      {/* Statistics Bar */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Paper sx={{ p: 1.5, flex: 1, minWidth: 120 }}>
          <Typography variant="caption" color="text.secondary">
            Toplam Listing
          </Typography>
          <Typography variant="h6" fontWeight={700}>
            {totalCount}
          </Typography>
        </Paper>
        <Paper sx={{ p: 1.5, flex: 1, minWidth: 120 }}>
          <Typography variant="caption" color="text.secondary">
            Toplam G\u00F6r\u00FCnt\u00FClenme
          </Typography>
          <Typography variant="h6" fontWeight={700}>
            {totalViews.toLocaleString()}
          </Typography>
        </Paper>
        <Paper sx={{ p: 1.5, flex: 1, minWidth: 120 }}>
          <Typography variant="caption" color="text.secondary">
            Toplam Favori
          </Typography>
          <Typography variant="h6" fontWeight={700}>
            {totalFavorites.toLocaleString()}
          </Typography>
        </Paper>
        <Paper sx={{ p: 1.5, flex: 1, minWidth: 120 }}>
          <Typography variant="caption" color="text.secondary">
            Stoksuz
          </Typography>
          <Typography variant="h6" fontWeight={700} color="error">
            {outOfStock}
          </Typography>
        </Paper>
      </Box>

      {/* Toolbar */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2, alignItems: 'center' }}>
        {/* Shop selector */}
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <Select
            value={selectedShopId}
            onChange={(e) => setSelectedShopId(e.target.value)}
            displayEmpty
          >
            {shops.length === 0 && (
              <MenuItem value="" disabled>
                Ma\u011Faza yok
              </MenuItem>
            )}
            {shops.map((s) => (
              <MenuItem key={s.shopId} value={s.shopId}>
                {s.shopName}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Search */}
        <TextField
          size="small"
          placeholder="Listing ara..."
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
            onChange={(e) =>
              setStatusFilter(e.target.value as 'active' | 'draft' | 'inactive' | 'expired')
            }
          >
            <MenuItem value="active">Aktif</MenuItem>
            <MenuItem value="draft">Taslak</MenuItem>
            <MenuItem value="inactive">Deaktif</MenuItem>
            <MenuItem value="expired">S\u00FCresi Dolmu\u015F</MenuItem>
          </Select>
        </FormControl>

        {/* Section filter */}
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <Select
            value={sectionFilter}
            onChange={(e) => setSectionFilter(e.target.value)}
            displayEmpty
          >
            <MenuItem value="">T\u00FCm B\u00F6l\u00FCmler</MenuItem>
            {shopSections.map((s) => (
              <MenuItem key={s.shop_section_id} value={String(s.shop_section_id)}>
                {s.title}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Box sx={{ flex: 1 }} />

        {/* Action buttons */}
        <Button variant="outlined" size="small" onClick={() => setFindReplaceOpen(true)}>
          Bul ve De\u011Fi\u015Ftir
        </Button>
        <Button variant="outlined" size="small" onClick={handleExportCSV}>
          CSV \u0130ndir
        </Button>
        <Button variant="contained" size="small" onClick={() => setCreateDialogOpen(true)}>
          + Yeni Listing
        </Button>
        <IconButton size="small" onClick={fetchListings} disabled={loading}>
          <RefreshIcon />
        </IconButton>
      </Box>

      {/* Bulk operations bar */}
      {('ids' in selectedIds ? selectedIds.ids.size : 0) > 0 && (
        <BulkOperationsBar
          selectedCount={'ids' in selectedIds ? selectedIds.ids.size : 0}
          selectedListings={selectedListings}
          shopSections={shopSections}
          shopId={selectedShopId}
          apiKey={apiKey}
          onCompleted={() => {
            setSelectedIds({ type: 'include' as const, ids: new Set<GridRowId>() });
            fetchListings();
          }}
        />
      )}

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
                  {selectedShopId ? 'Listing bulunamad\u0131' : 'L\u00FCtfen bir ma\u011Faza se\u00E7in'}
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
              Bu listing&apos;i silmek istedi\u011Finizden emin misiniz? Bu i\u015Flem geri al\u0131namaz.
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
              <Button size="small" onClick={() => setDeleteConfirmId(null)}>
                \u0130ptal
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

      {/* Editor Drawer */}
      <ListingEditorDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setDrawerListingId(null);
        }}
        listingId={drawerListingId}
        shopId={selectedShopId}
        apiKey={apiKey}
        shopSections={shopSections}
        shippingProfiles={shippingProfiles}
        returnPolicies={returnPolicies}
        onSaved={() => {
          fetchListings();
        }}
      />

      {/* Creator Dialog */}
      <ListingCreatorDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        shopId={selectedShopId}
        apiKey={apiKey}
        shopSections={shopSections}
        shippingProfiles={shippingProfiles}
        returnPolicies={returnPolicies}
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
        apiKey={apiKey}
        onCompleted={() => {
          setFindReplaceOpen(false);
          fetchListings();
        }}
      />
    </Box>
  );
}

// --- Layout wrapper (follows labels.tsx pattern) ---
function EtsyListingsPageWithLayout(props: any): JSX.Element {
  return (
    <AppLayout title="Etsy Listings \u2014 KolayXport">
      <EtsyListingsPage {...props} />
    </AppLayout>
  );
}

export default withAuth(EtsyListingsPageWithLayout);
