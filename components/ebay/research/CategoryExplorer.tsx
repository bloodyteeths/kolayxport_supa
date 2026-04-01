import React, { useState, useMemo } from 'react';
import {
  Box, Typography, Paper, Chip, CircularProgress, LinearProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Collapse, IconButton, Button, Alert, Divider, Stack,
  useMediaQuery, useTheme,
} from '@mui/material';
import {
  Grid, TrendingUp, Package, ChevronRight, ChevronDown, ChevronUp,
  Search, DollarSign, BarChart2, Layers, ArrowRight,
} from 'lucide-react';
import { toast } from 'react-hot-toast';

interface CategoryExplorerProps {
  userId: string;
  onNavigate?: (tool: string, data?: any) => void;
}

interface CategoryNode {
  categoryId: string;
  categoryName: string;
  children?: CategoryNode[];
}

interface BestsellerItem {
  itemId?: string;
  title: string;
  price?: { value: string; currency: string };
  condition?: string;
  image?: { imageUrl: string };
  thumbnailImages?: { imageUrl: string }[];
}

const POPULAR_CATEGORIES = [
  { id: '293', name: 'Elektronik', icon: '⚡' },
  { id: '11450', name: 'Giyim', icon: '👕' },
  { id: '1', name: 'Koleksiyon', icon: '🏆' },
  { id: '11700', name: 'Ev & Bahçe', icon: '🏠' },
  { id: '888', name: 'Spor', icon: '⚽' },
  { id: '220', name: 'Oyuncak', icon: '🧸' },
  { id: '267', name: 'Kitap', icon: '📚' },
  { id: '281', name: 'Takı', icon: '💎' },
  { id: '6000', name: 'Oto Parça', icon: '🚗' },
  { id: '26395', name: 'Sağlık & Güzellik', icon: '💄' },
  { id: '15032', name: 'Cep Telefonu', icon: '📱' },
  { id: '58058', name: 'Bilgisayar', icon: '💻' },
];

async function ebayApiCall(action: string, userId: string, params: Record<string, any> = {}) {
  const query = new URLSearchParams({
    action, user_id: userId, ...Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null).map(([k, v]) => [k, String(v)])
    ),
  });
  const res = await fetch(`/api/clawd/ebay?${query.toString()}`);
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `API hatası: ${res.status}`);
  }
  return res.json();
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{value}</Typography>
    </Box>
  );
}

function CategoryTreeNode({
  node,
  depth,
  onSelect,
  selectedId,
}: {
  node: CategoryNode;
  depth: number;
  onSelect: (id: string, name: string) => void;
  selectedId: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedId === node.categoryId;

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          pl: depth * 2,
          py: 0.75,
          px: 1,
          cursor: 'pointer',
          borderRadius: 1,
          bgcolor: isSelected ? 'primary.50' : 'transparent',
          '&:hover': { bgcolor: isSelected ? 'primary.50' : 'grey.50' },
        }}
        onClick={() => {
          onSelect(node.categoryId, node.categoryName);
          if (hasChildren) setExpanded(prev => !prev);
        }}
      >
        {hasChildren ? (
          <IconButton size="small" sx={{ mr: 0.5, p: 0.25 }} onClick={(e) => { e.stopPropagation(); setExpanded(prev => !prev); }}>
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </IconButton>
        ) : (
          <Box sx={{ width: 28 }} />
        )}
        <Typography
          variant="body2"
          sx={{ fontWeight: isSelected ? 700 : 400, color: isSelected ? 'primary.main' : 'text.primary' }}
        >
          {node.categoryName}
        </Typography>
      </Box>
      {hasChildren && (
        <Collapse in={expanded}>
          {node.children!.map((child) => (
            <CategoryTreeNode
              key={child.categoryId}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
              selectedId={selectedId}
            />
          ))}
        </Collapse>
      )}
    </Box>
  );
}

export default function CategoryExplorer({ userId, onNavigate }: CategoryExplorerProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [selectedCategory, setSelectedCategory] = useState<{ id: string; name: string } | null>(null);
  const [treeCategories, setTreeCategories] = useState<CategoryNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeLoaded, setTreeLoaded] = useState(false);
  const [treeExpanded, setTreeExpanded] = useState(false);

  const [bestsellers, setBestsellers] = useState<BestsellerItem[]>([]);
  const [bestsellersLoading, setBestsellersLoading] = useState(false);

  const stats = useMemo(() => {
    if (bestsellers.length === 0) return null;
    const prices = bestsellers
      .map(item => parseFloat(item.price?.value || '0'))
      .filter(p => p > 0);
    const avg = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
    return { count: bestsellers.length, avgPrice: avg };
  }, [bestsellers]);

  const loadCategoryTree = async () => {
    if (treeLoaded) {
      setTreeExpanded(prev => !prev);
      return;
    }
    setTreeLoading(true);
    try {
      const data = await ebayApiCall('top_categories', userId, { marketplace_id: 'EBAY_US' });
      setTreeCategories(data.categories || []);
      setTreeLoaded(true);
      setTreeExpanded(true);
    } catch (err: any) {
      toast.error(err.message || 'Kategori ağacı yüklenemedi');
    } finally {
      setTreeLoading(false);
    }
  };

  const selectCategory = async (id: string, name: string) => {
    setSelectedCategory({ id, name });
    setBestsellers([]);
    setBestsellersLoading(true);
    try {
      const data = await ebayApiCall('category_bestsellers', userId, {
        category_id: id,
        marketplace_id: 'EBAY_US',
      });
      setBestsellers(data.items || []);
    } catch (err: any) {
      toast.error(err.message || 'Çok satanlar yüklenemedi');
    } finally {
      setBestsellersLoading(false);
    }
  };

  const getItemImage = (item: BestsellerItem): string | null => {
    return item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || null;
  };

  const getItemPrice = (item: BestsellerItem): string => {
    if (!item.price?.value) return '-';
    const currency = item.price.currency === 'USD' ? '$' : item.price.currency || '$';
    return `${currency}${parseFloat(item.price.value).toFixed(2)}`;
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Header */}
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
        <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700 }}>
          <Layers size={20} />
          Kategori Keşfet
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Popüler kategorileri keşfedin, en çok satanları görün ve niş fırsatlarını yakalayın. Aşağıdan bir kategori seçerek başlayın.
        </Typography>
      </Paper>

      {/* Popular Categories Grid */}
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
        <Typography variant="subtitle2" fontWeight={700} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TrendingUp size={16} />
          Popüler Kategoriler
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(3, 1fr)', md: 'repeat(4, 1fr)' },
            gap: 1.5,
            mt: 1.5,
          }}
        >
          {POPULAR_CATEGORIES.map((cat) => (
            <Paper
              key={cat.id}
              variant="outlined"
              onClick={() => selectCategory(cat.id, cat.name)}
              sx={{
                p: 1.5,
                textAlign: 'center',
                cursor: 'pointer',
                borderColor: selectedCategory?.id === cat.id ? 'primary.main' : 'divider',
                bgcolor: selectedCategory?.id === cat.id ? 'primary.50' : 'transparent',
                transition: 'all 0.15s ease',
                '&:hover': { borderColor: 'primary.main', bgcolor: 'grey.50' },
              }}
            >
              <Typography variant="h6" sx={{ lineHeight: 1 }}>{cat.icon}</Typography>
              <Typography
                variant="caption"
                sx={{
                  mt: 0.5,
                  display: 'block',
                  fontWeight: selectedCategory?.id === cat.id ? 700 : 500,
                  fontSize: { xs: '0.68rem', md: '0.75rem' },
                }}
              >
                {cat.name}
              </Typography>
            </Paper>
          ))}
        </Box>
      </Paper>

      {/* Category Tree Browser */}
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
        <Box
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
          onClick={loadCategoryTree}
        >
          <Typography variant="subtitle2" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Grid size={16} />
            Kategori Ağacı
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {treeLoading && <CircularProgress size={16} />}
            <IconButton size="small">
              {treeExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </IconButton>
          </Box>
        </Box>

        <Collapse in={treeExpanded}>
          {treeCategories.length > 0 ? (
            <Box sx={{ mt: 1.5, maxHeight: 400, overflowY: 'auto' }}>
              {treeCategories.map((node) => (
                <CategoryTreeNode
                  key={node.categoryId}
                  node={node}
                  depth={0}
                  onSelect={selectCategory}
                  selectedId={selectedCategory?.id || null}
                />
              ))}
            </Box>
          ) : treeLoaded ? (
            <Alert severity="info" sx={{ mt: 1.5 }}>Kategori ağacı verisi bulunamadı. Lütfen daha sonra tekrar deneyin.</Alert>
          ) : null}
        </Collapse>
      </Paper>

      {/* Bestsellers Section */}
      {selectedCategory && (
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Package size={16} />
              {selectedCategory.name} — Çok Satanlar
            </Typography>
            {onNavigate && (
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="outlined"
                  endIcon={<ArrowRight size={14} />}
                  onClick={() => onNavigate('product_database', { categoryId: selectedCategory.id })}
                  sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                >
                  Bu kategoride ara
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  endIcon={<BarChart2 size={14} />}
                  onClick={() => onNavigate('niche_finder', { categoryId: selectedCategory.id })}
                  sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                >
                  Niş Analizi
                </Button>
              </Stack>
            )}
          </Box>

          {bestsellersLoading && <LinearProgress sx={{ mt: 2 }} />}

          {/* Stats */}
          {stats && !bestsellersLoading && (
            <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
              <Paper variant="outlined" sx={{ p: 1.5, flex: 1, textAlign: 'center' }}>
                <Box sx={{ display: 'flex', justifyContent: 'center', mb: 0.5, color: 'text.secondary' }}>
                  <Package size={18} />
                </Box>
                <Typography variant="caption" color="text.secondary">Ürün Sayısı</Typography>
                <Typography variant="h6" fontWeight={700}>{stats.count}</Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 1.5, flex: 1, textAlign: 'center' }}>
                <Box sx={{ display: 'flex', justifyContent: 'center', mb: 0.5, color: 'text.secondary' }}>
                  <DollarSign size={18} />
                </Box>
                <Typography variant="caption" color="text.secondary">Ort. Fiyat</Typography>
                <Typography variant="h6" fontWeight={700}>${stats.avgPrice.toFixed(2)}</Typography>
              </Paper>
            </Stack>
          )}

          {/* Items — Desktop Table */}
          {!bestsellersLoading && bestsellers.length > 0 && !isMobile && (
            <TableContainer sx={{ mt: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700, width: 56 }}>Görsel</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Başlık</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="right">Fiyat</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Durum</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {bestsellers.map((item, idx) => {
                    const imgUrl = getItemImage(item);
                    return (
                      <TableRow key={item.itemId || idx}>
                        <TableCell>
                          {imgUrl ? (
                            <Box
                              component="img"
                              src={imgUrl}
                              alt=""
                              sx={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 1 }}
                            />
                          ) : (
                            <Box sx={{ width: 40, height: 40, bgcolor: 'grey.200', borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Package size={16} color="#999" />
                            </Box>
                          )}
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.title}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" fontWeight={600}>{getItemPrice(item)}</Typography>
                        </TableCell>
                        <TableCell>
                          <Chip label={item.condition || '-'} size="small" variant="outlined" />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {/* Items — Mobile Cards */}
          {!bestsellersLoading && bestsellers.length > 0 && isMobile && (
            <Stack spacing={1} sx={{ mt: 2 }}>
              {bestsellers.map((item, idx) => {
                const imgUrl = getItemImage(item);
                return (
                  <Paper key={item.itemId || idx} variant="outlined" sx={{ p: 1.5 }}>
                    <Box sx={{ display: 'flex', gap: 1.5 }}>
                      {imgUrl ? (
                        <Box
                          component="img"
                          src={imgUrl}
                          alt=""
                          sx={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }}
                        />
                      ) : (
                        <Box sx={{ width: 40, height: 40, bgcolor: 'grey.200', borderRadius: 1, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Package size={16} color="#999" />
                        </Box>
                      )}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.title}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1, mt: 0.5, alignItems: 'center' }}>
                          <Typography variant="body2" fontWeight={700}>{getItemPrice(item)}</Typography>
                          {item.condition && <Chip label={item.condition} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />}
                        </Box>
                      </Box>
                    </Box>
                  </Paper>
                );
              })}
            </Stack>
          )}

          {!bestsellersLoading && bestsellers.length === 0 && (
            <Alert severity="info" sx={{ mt: 2 }}>Bu kategoride henüz çok satan ürün bulunamadı. Farklı bir kategori deneyebilir veya alt kategorilere göz atabilirsiniz.</Alert>
          )}
        </Paper>
      )}
    </Box>
  );
}
