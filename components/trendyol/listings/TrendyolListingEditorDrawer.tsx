import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  SwipeableDrawer,
  Box,
  Typography,
  IconButton,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  CircularProgress,
  Chip,
  Alert,
  InputAdornment,
  LinearProgress,
  Tabs,
  Tab,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import ImageIcon from '@mui/icons-material/Image';
import InfoIcon from '@mui/icons-material/Info';
import UndoIcon from '@mui/icons-material/Undo';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import DeleteIcon from '@mui/icons-material/Delete';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TrendyolListingEditorDrawerProps {
  open: boolean;
  onClose: () => void;
  productId: string | null;
  onSaved?: () => void;
  siblingProducts?: Array<{ id: string; barcode: string; title: string; salePrice: any; quantity: number; thumbnailUrl?: string }>;
}

interface TrendyolImage {
  url: string;
}

interface TrendyolProductData {
  id: string;
  barcode: string;
  trendyolId: string;
  title: string;
  description: string;
  stockCode: string;
  productMainId: string;
  brandId: number;
  brandName: string;
  categoryId: number;
  categoryName: string;
  listPrice: any;
  salePrice: any;
  vatRate: number;
  quantity: number;
  images: TrendyolImage[];
  imageCount: number;
  thumbnailUrl: string;
  attributes: any[];
  approved: boolean;
  onSale: boolean;
  rejected: boolean;
  archived: boolean;
  blacklisted: boolean;
  rejectReasons: any[];
  dimensionalWeight: number;
  cargoCompanyId: number;
}

interface EditableFields {
  title: string;
  description: string;
  stockCode: string;
  listPrice: string;
  salePrice: string;
  vatRate: number;
  quantity: number;
  images: TrendyolImage[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRENDYOL_ORANGE = '#F27A1A';
const VAT_RATES = [0, 1, 10, 20];
const MAX_UNDO = 10;
const AUTOSAVE_KEY = 'trendyol_editor_draft_';

// ---------------------------------------------------------------------------
// Health Score (100 points, 8+ factors)
// ---------------------------------------------------------------------------

interface HealthBreakdown {
  titleLength: number;
  titleBrand: number;
  titleCategory: number;
  images: number;
  description: number;
  attributes: number;
  priceSanity: number;
  stock: number;
  notRejected: number;
  dimWeight: number;
  total: number;
}

function computeHealthBreakdown(product: TrendyolProductData, fields: EditableFields): HealthBreakdown {
  const titleLen = fields.title?.length || 0;
  const titleLength = titleLen >= 80 && titleLen <= 150 ? 15 : titleLen >= 60 ? 10 : titleLen >= 40 ? 5 : 0;

  const brandLower = (product.brandName || '').toLowerCase();
  const titleLower = fields.title.toLowerCase();
  const titleBrand = brandLower && titleLower.includes(brandLower) ? 5 : 0;

  const catWords = (product.categoryName || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const titleCategory = catWords.length > 0 && catWords.some(w => titleLower.includes(w)) ? 5 : 0;

  const imgCount = fields.images?.length || 0;
  const images = imgCount >= 5 ? 20 : imgCount * 4;

  const descLen = fields.description?.length || 0;
  const description = descLen >= 300 ? 15 : descLen >= 200 ? 10 : descLen >= 100 ? 5 : 0;

  const attrCount = product.attributes?.length || 0;
  const attributes = attrCount >= 5 ? 15 : attrCount >= 3 ? 12 : attrCount >= 1 ? 8 : 0;

  const lp = parseFloat(String(fields.listPrice)) || 0;
  const sp = parseFloat(String(fields.salePrice)) || 0;
  const priceSanity = sp > 0 && lp > sp ? 10 : sp > 0 && lp === sp ? 5 : 0;

  const stock = fields.quantity > 0 ? 5 : 0;
  const notRejected = product.approved && !product.rejected ? 5 : 0;
  const dimWeight = product.dimensionalWeight ? 5 : 0;

  const total = titleLength + titleBrand + titleCategory + images + description + attributes + priceSanity + stock + notRejected + dimWeight;

  return { titleLength, titleBrand, titleCategory, images, description, attributes, priceSanity, stock, notRejected, dimWeight, total };
}

function scoreToGrade(score: number): string {
  if (score >= 95) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 75) return 'B+';
  if (score >= 65) return 'B';
  if (score >= 55) return 'C+';
  if (score >= 45) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

function gradeColor(grade: string): string {
  if (grade.startsWith('A')) return '#4caf50';
  if (grade.startsWith('B')) return '#8bc34a';
  if (grade.startsWith('C')) return '#ff9800';
  if (grade.startsWith('D')) return '#ff5722';
  return '#f44336';
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function parsePrice(val: any): string {
  if (val == null) return '0';
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  return isNaN(n) ? '0' : n.toFixed(2);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TrendyolListingEditorDrawer({
  open,
  onClose,
  productId,
  onSaved,
  siblingProducts,
}: TrendyolListingEditorDrawerProps) {
  const t = useTranslations('trendyolListings');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // State
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState<TrendyolProductData | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fields, setFields] = useState<EditableFields | null>(null);
  const [saving, setSaving] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState(0);
  const [undoStack, setUndoStack] = useState<EditableFields[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiAnalysisOpen, setAiAnalysisOpen] = useState(false);
  const [newImageUrl, setNewImageUrl] = useState('');
  const initialFieldsRef = useRef<EditableFields | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch product detail
  // ---------------------------------------------------------------------------

  const fetchProduct = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/trendyol/products?action=detail&id=${productId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const p: TrendyolProductData = data.product ?? data;
      setProduct(p);

      // Check for auto-saved draft
      const draftKey = AUTOSAVE_KEY + productId;
      const draft = localStorage.getItem(draftKey);
      let initialFields: EditableFields;
      if (draft) {
        try {
          initialFields = JSON.parse(draft);
          toast(t('editor.draftRestored') || 'Draft restored', { icon: '📝' });
        } catch {
          initialFields = productToFields(p);
        }
      } else {
        initialFields = productToFields(p);
      }

      setFields(initialFields);
      initialFieldsRef.current = productToFields(p);
      setUndoStack([]);
      setHasChanges(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setFetchError(msg);
    } finally {
      setLoading(false);
    }
  }, [productId, t]);

  function productToFields(p: TrendyolProductData): EditableFields {
    return {
      title: p.title ?? '',
      description: p.description ?? '',
      stockCode: p.stockCode ?? '',
      listPrice: parsePrice(p.listPrice),
      salePrice: parsePrice(p.salePrice),
      vatRate: p.vatRate ?? 10,
      quantity: p.quantity ?? 0,
      images: p.images ?? [],
    };
  }

  useEffect(() => {
    if (open && productId) {
      fetchProduct();
      setBatchId(null);
      setBatchStatus(null);
      setActiveTab(0);
      setAiAnalysis(null);
    }
    if (!open) {
      setProduct(null);
      setFields(null);
      setFetchError(null);
      setHasChanges(false);
      setUndoStack([]);
    }
  }, [open, productId, fetchProduct]);

  // ---------------------------------------------------------------------------
  // Auto-save to localStorage
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!fields || !productId || !hasChanges) return;
    const timer = setTimeout(() => {
      localStorage.setItem(AUTOSAVE_KEY + productId, JSON.stringify(fields));
    }, 1000);
    return () => clearTimeout(timer);
  }, [fields, productId, hasChanges]);

  // ---------------------------------------------------------------------------
  // Batch status polling
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!batchId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/trendyol/products?action=batch_status&batchRequestId=${batchId}`);
        if (!res.ok) return;
        const data = await res.json();
        const status = data.status ?? data.batchRequestStatus;
        if (!cancelled) {
          setBatchStatus(status);
          if (status === 'COMPLETED' || status === 'FAILED') {
            setBatchId(null);
          }
        }
      } catch { /* ignore */ }
    };
    const interval = setInterval(poll, 3000);
    poll();
    return () => { cancelled = true; clearInterval(interval); };
  }, [batchId]);

  // ---------------------------------------------------------------------------
  // Field helpers with undo tracking
  // ---------------------------------------------------------------------------

  const pushUndo = useCallback(() => {
    if (!fields) return;
    setUndoStack(prev => [...prev.slice(-(MAX_UNDO - 1)), { ...fields }]);
  }, [fields]);

  const updateField = <K extends keyof EditableFields>(key: K, value: EditableFields[K]) => {
    pushUndo();
    setFields(prev => (prev ? { ...prev, [key]: value } : prev));
    setHasChanges(true);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack(s => s.slice(0, -1));
    setFields(prev);
    setHasChanges(true);
  };

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  const handleSave = async () => {
    if (!product || !fields) return;
    setSaving(true);
    try {
      const payload = {
        items: [
          {
            barcode: product.barcode,
            title: fields.title,
            description: fields.description,
            stockCode: fields.stockCode,
            listPrice: parseFloat(fields.listPrice) || 0,
            salePrice: parseFloat(fields.salePrice) || 0,
            vatRate: fields.vatRate,
            quantity: fields.quantity,
            images: fields.images,
          },
        ],
      };
      const res = await fetch('/api/trendyol/products?action=update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.batchRequestId) {
        setBatchId(data.batchRequestId);
        setBatchStatus('IN_PROGRESS');
        toast.success(t('batchProcessing'));
      } else {
        toast.success(t('editor.saved') || 'Saved');
      }
      // Clear draft
      if (productId) localStorage.removeItem(AUTOSAVE_KEY + productId);
      setHasChanges(false);
      initialFieldsRef.current = fields ? { ...fields } : null;
      onSaved?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // AI actions
  // ---------------------------------------------------------------------------

  const handleAiAction = async (action: string) => {
    if (!product || !fields) return;
    setAiLoading(prev => ({ ...prev, [action]: true }));
    try {
      const res = await fetch(`/api/ai/trendyol?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: fields.title,
          description: fields.description,
          brand: product.brandName,
          categoryName: product.categoryName,
          attributes: product.attributes,
          product: action === 'analyze_listing' ? {
            ...product,
            title: fields.title,
            description: fields.description,
            listPrice: fields.listPrice,
            salePrice: fields.salePrice,
            imageCount: fields.images?.length || 0,
          } : undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (action === 'optimize_title') {
        const newTitle = data.optimizedTitle || data.title;
        if (newTitle && typeof newTitle === 'string' && newTitle.length > 5) {
          pushUndo();
          updateField('title', newTitle);
          if (data.tips?.length) {
            toast.success(data.tips[0], { duration: 4000 });
          } else {
            toast.success(t('aiOptimizeTitle') + ' ✓');
          }
        } else {
          toast.error('AI returned invalid title');
        }
      } else if (action === 'optimize_description') {
        const newDesc = data.description;
        if (newDesc && typeof newDesc === 'string' && newDesc.length > 10) {
          pushUndo();
          updateField('description', newDesc);
          toast.success(t('aiOptimizeDescription') + ' ✓');
        } else {
          toast.error('AI returned invalid description');
        }
      } else if (action === 'analyze_listing') {
        const analysis = data.analysis;
        if (analysis && typeof analysis === 'string') {
          setAiAnalysis(analysis);
          setAiAnalysisOpen(true);
        } else {
          toast.error('AI returned empty analysis');
        }
      } else if (action === 'suggest_attributes') {
        const suggestions = data.suggestions;
        if (Array.isArray(suggestions) && suggestions.length > 0) {
          toast.success(`${suggestions.length} ${t('aiSuggestAttributes')}`);
          // TODO: apply attribute suggestions when attribute editor is built
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'AI error';
      toast.error(msg);
    } finally {
      setAiLoading(prev => ({ ...prev, [action]: false }));
    }
  };

  // ---------------------------------------------------------------------------
  // Image management
  // ---------------------------------------------------------------------------

  const addImage = () => {
    if (!newImageUrl.trim() || !fields) return;
    const url = newImageUrl.trim();
    if (!url.startsWith('http')) { toast.error('Invalid URL'); return; }
    pushUndo();
    setFields(prev => prev ? { ...prev, images: [...prev.images, { url }] } : prev);
    setNewImageUrl('');
    setHasChanges(true);
  };

  const removeImage = (index: number) => {
    if (!fields) return;
    pushUndo();
    setFields(prev => prev ? { ...prev, images: prev.images.filter((_, i) => i !== index) } : prev);
    setHasChanges(true);
  };

  const moveImage = (fromIndex: number, toIndex: number) => {
    if (!fields || toIndex < 0 || toIndex >= fields.images.length) return;
    pushUndo();
    const imgs = [...fields.images];
    const [moved] = imgs.splice(fromIndex, 1);
    imgs.splice(toIndex, 0, moved);
    setFields(prev => prev ? { ...prev, images: imgs } : prev);
    setHasChanges(true);
  };

  // ---------------------------------------------------------------------------
  // Computed values
  // ---------------------------------------------------------------------------

  const health = product && fields ? computeHealthBreakdown(product, fields) : null;
  const grade = health ? scoreToGrade(health.total) : 'F';
  const gColor = gradeColor(grade);
  const discountPct = fields ? (() => {
    const lp = parseFloat(fields.listPrice) || 0;
    const sp = parseFloat(fields.salePrice) || 0;
    return lp > 0 && sp > 0 && lp > sp ? Math.round((1 - sp / lp) * 100) : 0;
  })() : 0;

  // ---------------------------------------------------------------------------
  // Tab labels
  // ---------------------------------------------------------------------------

  const tabLabels = [
    t('images'),
    t('editor.basics') || 'Basics',
    t('editor.seoAi') || 'SEO & AI',
    t('editor.pricing') || 'Pricing',
    t('attributes'),
    t('editor.variations') || 'Variations',
    t('editor.status') || 'Status',
  ];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      <SwipeableDrawer
        anchor="right"
        open={open}
        onClose={onClose}
        onOpen={() => {}}
        disableSwipeToOpen
        PaperProps={{
          sx: { width: isMobile ? '100%' : 560, maxWidth: '100vw' },
        }}
      >
        {/* Header */}
        <Box
          sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            pt: { xs: 'calc(env(safe-area-inset-top, 0px) + 8px)', sm: 1 },
            pb: 1, px: 2,
            borderBottom: '1px solid', borderColor: 'divider',
            bgcolor: 'background.paper', position: 'sticky', top: 0, zIndex: 10,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, mr: 1 }}>
            <IconButton onClick={onClose} sx={{ mr: 1, minWidth: 44, minHeight: 44 }}>
              <ArrowBackIcon />
            </IconButton>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="subtitle1" fontWeight={600} noWrap title={product?.title}
                  sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
                >
                  {product?.title || t('editProduct')}
                </Typography>
                {hasChanges && (
                  <Chip label="•" size="small" sx={{ bgcolor: TRENDYOL_ORANGE, color: '#fff', height: 18, minWidth: 18, '& .MuiChip-label': { px: 0.3 } }} />
                )}
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                {product?.rejected && <Chip label={t('rejected')} color="error" size="small" sx={{ height: 20, fontSize: 10 }} />}
                {product?.archived && <Chip label={t('archived')} size="small" sx={{ bgcolor: '#9e9e9e', color: '#fff', height: 20, fontSize: 10 }} />}
                {product?.onSale && <Chip label={t('onSale')} size="small" sx={{ bgcolor: '#4caf50', color: '#fff', height: 20, fontSize: 10 }} />}
                {product?.approved && !product.onSale && !product.rejected && (
                  <Chip label={t('approved')} size="small" sx={{ bgcolor: '#2196f3', color: '#fff', height: 20, fontSize: 10 }} />
                )}
                {health && (
                  <Chip label={`${grade} ${health.total}/100`} size="small"
                    sx={{ height: 20, fontSize: 10, fontWeight: 700, bgcolor: `${gColor}15`, color: gColor, border: `1px solid ${gColor}` }}
                  />
                )}
              </Box>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {undoStack.length > 0 && (
              <Tooltip title="Undo">
                <IconButton onClick={handleUndo} size="small"><UndoIcon fontSize="small" /></IconButton>
              </Tooltip>
            )}
            <IconButton onClick={onClose}><CloseIcon /></IconButton>
          </Box>
        </Box>

        {/* Loading / Error */}
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
            <CircularProgress sx={{ color: TRENDYOL_ORANGE }} />
          </Box>
        )}
        {fetchError && <Box sx={{ p: 3 }}><Alert severity="error">{fetchError}</Alert></Box>}

        {/* Batch status banner */}
        {batchStatus && (
          <Box sx={{ px: 2, pt: 1 }}>
            <Alert severity={batchStatus === 'COMPLETED' ? 'success' : batchStatus === 'FAILED' ? 'error' : 'info'}
              onClose={() => setBatchStatus(null)}
            >
              Batch: {batchStatus}
            </Alert>
          </Box>
        )}

        {/* Tabs + Body */}
        {!loading && !fetchError && product && fields && (
          <>
            <Tabs
              value={activeTab}
              onChange={(_, v) => setActiveTab(v)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{
                borderBottom: '1px solid', borderColor: 'divider', minHeight: 40,
                '& .MuiTab-root': { minHeight: 40, textTransform: 'none', fontSize: '0.8rem', fontWeight: 600, py: 0.5 },
                '& .Mui-selected': { color: TRENDYOL_ORANGE },
                '& .MuiTabs-indicator': { bgcolor: TRENDYOL_ORANGE },
              }}
            >
              {tabLabels.map((label, i) => <Tab key={i} label={label} />)}
            </Tabs>

            <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 2, pb: 12 }}>
              {/* TAB 0: Images */}
              {activeTab === 0 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Typography variant="subtitle2" fontWeight={600}>
                    {t('images')} ({fields.images.length})
                  </Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 1 }}>
                    {fields.images.map((img, idx) => (
                      <Box key={idx} sx={{ position: 'relative', border: idx === 0 ? `2px solid ${TRENDYOL_ORANGE}` : '1px solid', borderColor: idx === 0 ? TRENDYOL_ORANGE : 'divider', borderRadius: 1, overflow: 'hidden' }}>
                        <Box component="img" src={img.url} alt={`${idx + 1}`}
                          sx={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }}
                        />
                        {idx === 0 && (
                          <Chip label="Primary" size="small"
                            sx={{ position: 'absolute', top: 2, left: 2, height: 16, fontSize: 9, bgcolor: TRENDYOL_ORANGE, color: '#fff' }}
                          />
                        )}
                        <Box sx={{ position: 'absolute', top: 2, right: 2, display: 'flex', gap: 0.25 }}>
                          {idx > 0 && (
                            <IconButton size="small" onClick={() => moveImage(idx, idx - 1)}
                              sx={{ bgcolor: 'rgba(255,255,255,0.8)', width: 24, height: 24 }}
                            >
                              <DragIndicatorIcon sx={{ fontSize: 14 }} />
                            </IconButton>
                          )}
                          <IconButton size="small" onClick={() => removeImage(idx)}
                            sx={{ bgcolor: 'rgba(255,255,255,0.8)', width: 24, height: 24 }}
                          >
                            <DeleteIcon sx={{ fontSize: 14, color: '#f44336' }} />
                          </IconButton>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <TextField
                      size="small" fullWidth
                      placeholder={t('addImageUrl')}
                      value={newImageUrl}
                      onChange={e => setNewImageUrl(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addImage()}
                    />
                    <Button variant="outlined" onClick={addImage} startIcon={<AddPhotoAlternateIcon />}
                      sx={{ textTransform: 'none', borderColor: TRENDYOL_ORANGE, color: TRENDYOL_ORANGE, whiteSpace: 'nowrap' }}
                    >
                      {t('editor.addImage') || 'Add'}
                    </Button>
                  </Box>
                </Box>
              )}

              {/* TAB 1: Basics */}
              {activeTab === 1 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <TextField
                    label={t('title')} value={fields.title}
                    onChange={e => updateField('title', e.target.value)}
                    fullWidth required size="small"
                    helperText={`${fields.title.length} ${t('editor.chars') || 'chars'} (${t('editor.optimal') || 'optimal'}: 80-150)`}
                    error={fields.title.length < 20}
                  />
                  <Button size="small" variant="outlined"
                    startIcon={aiLoading['optimize_title'] ? <CircularProgress size={16} /> : <AutoFixHighIcon />}
                    onClick={() => handleAiAction('optimize_title')}
                    disabled={aiLoading['optimize_title']}
                    sx={{ textTransform: 'none', borderColor: TRENDYOL_ORANGE, color: TRENDYOL_ORANGE, alignSelf: 'flex-start' }}
                  >
                    {t('aiOptimizeTitle')}
                  </Button>

                  <TextField
                    label={t('description')} value={fields.description}
                    onChange={e => updateField('description', e.target.value)}
                    fullWidth multiline rows={5} size="small"
                    helperText={`${fields.description.length} ${t('editor.chars') || 'chars'} (${t('editor.optimal') || 'optimal'}: 300+)`}
                  />
                  <Button size="small" variant="outlined"
                    startIcon={aiLoading['optimize_description'] ? <CircularProgress size={16} /> : <AutoFixHighIcon />}
                    onClick={() => handleAiAction('optimize_description')}
                    disabled={aiLoading['optimize_description']}
                    sx={{ textTransform: 'none', borderColor: TRENDYOL_ORANGE, color: TRENDYOL_ORANGE, alignSelf: 'flex-start' }}
                  >
                    {t('aiOptimizeDescription')}
                  </Button>

                  <Divider />

                  <TextField label={t('barcode')} value={product.barcode ?? ''} fullWidth disabled size="small" />
                  <TextField label={t('stockCode')} value={fields.stockCode}
                    onChange={e => updateField('stockCode', e.target.value)} fullWidth size="small"
                  />
                  {product.productMainId && (
                    <TextField label="Product Main ID" value={product.productMainId} fullWidth disabled size="small" />
                  )}
                </Box>
              )}

              {/* TAB 2: SEO & AI */}
              {activeTab === 2 && health && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {/* Health Score Breakdown */}
                  <Typography variant="subtitle2" fontWeight={600}>{t('healthScore')}: {health.total}/100 ({grade})</Typography>
                  <LinearProgress variant="determinate" value={health.total}
                    sx={{ height: 10, borderRadius: 5, bgcolor: '#e0e0e0', '& .MuiLinearProgress-bar': { bgcolor: gColor, borderRadius: 5 } }}
                  />

                  {[
                    { label: t('editor.titleLength') || 'Title Length', score: health.titleLength, max: 15 },
                    { label: t('editor.titleBrand') || 'Brand in Title', score: health.titleBrand, max: 5 },
                    { label: t('editor.titleCategory') || 'Category Keywords', score: health.titleCategory, max: 5 },
                    { label: t('images'), score: health.images, max: 20 },
                    { label: t('description'), score: health.description, max: 15 },
                    { label: t('attributes'), score: health.attributes, max: 15 },
                    { label: t('editor.priceSanity') || 'Price Discount', score: health.priceSanity, max: 10 },
                    { label: t('quantity'), score: health.stock, max: 5 },
                    { label: t('editor.notRejected') || 'Not Rejected', score: health.notRejected, max: 5 },
                    { label: t('dimensionalWeight'), score: health.dimWeight, max: 5 },
                  ].map((item, i) => (
                    <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="caption" sx={{ width: 120, flexShrink: 0 }}>{item.label}</Typography>
                      <LinearProgress variant="determinate" value={item.max > 0 ? (item.score / item.max) * 100 : 0}
                        sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: '#e0e0e0',
                          '& .MuiLinearProgress-bar': { bgcolor: item.score === item.max ? '#4caf50' : item.score > 0 ? '#ff9800' : '#f44336', borderRadius: 3 }
                        }}
                      />
                      <Typography variant="caption" fontWeight={600} sx={{ width: 40, textAlign: 'right' }}>
                        {item.score}/{item.max}
                      </Typography>
                    </Box>
                  ))}

                  <Divider />

                  <Button variant="contained"
                    startIcon={aiLoading['analyze_listing'] ? <CircularProgress size={16} color="inherit" /> : <AnalyticsIcon />}
                    onClick={() => handleAiAction('analyze_listing')}
                    disabled={aiLoading['analyze_listing']}
                    sx={{ textTransform: 'none', bgcolor: TRENDYOL_ORANGE, '&:hover': { bgcolor: '#e06c10' } }}
                  >
                    {t('editor.aiAnalyze') || 'AI Full Analysis'}
                  </Button>

                  {aiAnalysis && (
                    <Alert severity="info" sx={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem' }}>
                      {aiAnalysis}
                    </Alert>
                  )}
                </Box>
              )}

              {/* TAB 3: Pricing */}
              {activeTab === 3 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <TextField
                    label={t('listPrice')} value={fields.listPrice}
                    onChange={e => updateField('listPrice', e.target.value)}
                    fullWidth type="number" size="small"
                    InputProps={{ startAdornment: <InputAdornment position="start">₺</InputAdornment> }}
                  />
                  <TextField
                    label={t('salePrice')} value={fields.salePrice}
                    onChange={e => updateField('salePrice', e.target.value)}
                    fullWidth type="number" size="small"
                    InputProps={{ startAdornment: <InputAdornment position="start">₺</InputAdornment> }}
                  />
                  {discountPct > 0 && (
                    <Chip label={`${discountPct}% ${t('editor.discount') || 'discount'}`} size="small"
                      sx={{ alignSelf: 'flex-start', bgcolor: '#4caf5015', color: '#4caf50', fontWeight: 700, border: '1px solid #4caf50' }}
                    />
                  )}
                  {discountPct === 0 && parseFloat(fields.listPrice) > 0 && (
                    <Alert severity="warning" sx={{ fontSize: '0.8rem' }}>
                      {t('editor.noDiscount') || 'No discount — set list price higher than sale price to show a discount on Trendyol'}
                    </Alert>
                  )}

                  <FormControl fullWidth size="small">
                    <InputLabel>{t('vatRate')}</InputLabel>
                    <Select value={fields.vatRate} label={t('vatRate')}
                      onChange={e => updateField('vatRate', Number(e.target.value))}
                    >
                      {VAT_RATES.map(rate => <MenuItem key={rate} value={rate}>{rate}%</MenuItem>)}
                    </Select>
                  </FormControl>

                  <TextField
                    label={t('quantity')} value={fields.quantity}
                    onChange={e => updateField('quantity', Math.max(0, parseInt(e.target.value) || 0))}
                    fullWidth type="number" size="small"
                    error={fields.quantity === 0}
                    helperText={fields.quantity === 0 ? (t('editor.outOfStock') || 'Out of stock') : ''}
                  />

                  {/* Inline profit calc */}
                  {parseFloat(fields.salePrice) > 0 && (
                    <Box sx={{ p: 1.5, bgcolor: '#f5f5f5', borderRadius: 1, fontSize: '0.8rem' }}>
                      <Typography variant="caption" fontWeight={600} sx={{ mb: 0.5, display: 'block' }}>
                        {t('editor.profitEstimate') || 'Profit Estimate'}
                      </Typography>
                      {(() => {
                        const sp = parseFloat(fields.salePrice);
                        const commission = sp * 0.18; // ~18% avg Trendyol commission
                        const vat = sp * (fields.vatRate / 100 / (1 + fields.vatRate / 100));
                        const net = sp - commission - vat;
                        return (
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                            <Typography variant="caption">{t('salePrice')}: ₺{sp.toFixed(2)}</Typography>
                            <Typography variant="caption">{t('editor.commission') || 'Commission'} (~18%): -₺{commission.toFixed(2)}</Typography>
                            <Typography variant="caption">{t('vatRate')} ({fields.vatRate}%): -₺{vat.toFixed(2)}</Typography>
                            <Divider />
                            <Typography variant="caption" fontWeight={700} sx={{ color: net > 0 ? '#4caf50' : '#f44336' }}>
                              {t('editor.netRevenue') || 'Net'}: ₺{net.toFixed(2)}
                            </Typography>
                          </Box>
                        );
                      })()}
                    </Box>
                  )}
                </Box>
              )}

              {/* TAB 4: Attributes */}
              {activeTab === 4 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Typography variant="subtitle2" fontWeight={600}>
                    {t('attributes')} ({product.attributes?.length || 0})
                  </Typography>
                  {product.attributes && product.attributes.length > 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {product.attributes.map((attr: any, i: number) => (
                        <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 1, bgcolor: '#f5f5f5', borderRadius: 1 }}>
                          <Typography variant="body2" fontWeight={500}>
                            {attr.attributeName || attr.name || `Attribute ${attr.attributeId}`}
                          </Typography>
                          <Chip label={attr.attributeValue || attr.value || attr.customValue || '—'} size="small" variant="outlined" />
                        </Box>
                      ))}
                    </Box>
                  ) : (
                    <Alert severity="warning" sx={{ fontSize: '0.8rem' }}>
                      {t('editor.noAttributes') || 'No attributes set. Attributes improve search visibility and are required for some categories.'}
                    </Alert>
                  )}
                  <Button size="small" variant="outlined"
                    startIcon={aiLoading['suggest_attributes'] ? <CircularProgress size={16} /> : <AutoFixHighIcon />}
                    onClick={() => handleAiAction('suggest_attributes')}
                    disabled={aiLoading['suggest_attributes']}
                    sx={{ textTransform: 'none', borderColor: TRENDYOL_ORANGE, color: TRENDYOL_ORANGE, alignSelf: 'flex-start' }}
                  >
                    {t('aiSuggestAttributes')}
                  </Button>

                  <Divider />
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {product.brandName && <Chip label={`${t('brand')}: ${product.brandName}`} variant="outlined" size="small" />}
                    {product.categoryName && <Chip label={`${t('category')}: ${product.categoryName}`} variant="outlined" size="small" />}
                  </Box>
                </Box>
              )}

              {/* TAB 5: Variations */}
              {activeTab === 5 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Typography variant="subtitle2" fontWeight={600}>
                    {t('editor.variations') || 'Variations'}
                  </Typography>
                  {product.productMainId ? (
                    <>
                      <Typography variant="body2" color="text.secondary">
                        Product Main ID: {product.productMainId}
                      </Typography>
                      {siblingProducts && siblingProducts.length > 0 ? (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          {siblingProducts.map((sib) => (
                            <Box key={sib.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, bgcolor: sib.id === product.id ? `${TRENDYOL_ORANGE}10` : '#f5f5f5', borderRadius: 1, border: sib.id === product.id ? `1px solid ${TRENDYOL_ORANGE}` : '1px solid transparent' }}>
                              {sib.thumbnailUrl && (
                                <Box component="img" src={sib.thumbnailUrl} alt="" sx={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 0.5 }} />
                              )}
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="body2" noWrap sx={{ fontSize: '0.8rem' }}>{sib.title}</Typography>
                                <Typography variant="caption" color="text.secondary">{sib.barcode}</Typography>
                              </Box>
                              <Typography variant="body2" fontWeight={600}>₺{parsePrice(sib.salePrice)}</Typography>
                              <Chip label={sib.quantity} size="small" color={sib.quantity > 0 ? 'default' : 'error'} variant="outlined" />
                            </Box>
                          ))}
                        </Box>
                      ) : (
                        <Alert severity="info" sx={{ fontSize: '0.8rem' }}>
                          {t('editor.noSiblings') || 'No sibling variants found. Sync products to see all variants.'}
                        </Alert>
                      )}
                    </>
                  ) : (
                    <Alert severity="info" sx={{ fontSize: '0.8rem' }}>
                      {t('editor.noVariations') || 'This product has no productMainId — it is a standalone product.'}
                    </Alert>
                  )}
                </Box>
              )}

              {/* TAB 6: Status */}
              {activeTab === 6 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Typography variant="subtitle2" fontWeight={600}>{t('editor.status') || 'Status'}</Typography>

                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    <Chip label={product.approved ? t('approved') : t('editor.notApproved') || 'Not Approved'}
                      color={product.approved ? 'success' : 'default'} size="small" />
                    <Chip label={product.onSale ? t('onSale') : t('editor.notOnSale') || 'Not On Sale'}
                      color={product.onSale ? 'success' : 'default'} size="small" />
                    {product.rejected && <Chip label={t('rejected')} color="error" size="small" />}
                    {product.archived && <Chip label={t('archived')} size="small" sx={{ bgcolor: '#9e9e9e', color: '#fff' }} />}
                    {product.blacklisted && <Chip label="Blacklisted" color="error" size="small" />}
                  </Box>

                  {/* Reject reasons */}
                  {product.rejected && product.rejectReasons && (
                    <Alert severity="error">
                      <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.5 }}>{t('rejectReason')}</Typography>
                      {(Array.isArray(product.rejectReasons) ? product.rejectReasons : [product.rejectReasons]).map((reason: any, i: number) => (
                        <Typography key={i} variant="body2">
                          • {typeof reason === 'string' ? reason : reason?.reason || reason?.rejectReason || JSON.stringify(reason)}
                        </Typography>
                      ))}
                    </Alert>
                  )}

                  <Divider />
                  <Typography variant="caption" color="text.secondary">
                    Barcode: {product.barcode}<br />
                    Trendyol ID: {product.trendyolId || '—'}<br />
                    Category ID: {product.categoryId || '—'}<br />
                    Brand ID: {product.brandId || '—'}<br />
                    Cargo Company: {product.cargoCompanyId || '—'}<br />
                    Dimensional Weight: {product.dimensionalWeight || '—'}
                  </Typography>
                </Box>
              )}
            </Box>
          </>
        )}

        {/* Footer */}
        {!loading && !fetchError && product && fields && (
          <Box
            sx={{
              position: 'sticky', bottom: 0, zIndex: 10,
              display: 'flex', gap: 1, p: 2,
              pb: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 16px)', sm: 2 },
              borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper',
            }}
          >
            <Button variant="outlined" onClick={onClose} sx={{ flex: 1, textTransform: 'none' }}>
              {t('editor.cancel') || 'Cancel'}
            </Button>
            <Button variant="contained" onClick={handleSave} disabled={saving || !hasChanges}
              startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
              sx={{
                flex: 2, textTransform: 'none',
                bgcolor: TRENDYOL_ORANGE, '&:hover': { bgcolor: '#e06c10' },
                '&.Mui-disabled': { bgcolor: '#e0e0e0', color: '#9e9e9e' },
              }}
            >
              {saving ? '...' : (t('editor.save') || 'Save')}
            </Button>
          </Box>
        )}
      </SwipeableDrawer>

      {/* AI Analysis Dialog */}
      <Dialog open={aiAnalysisOpen} onClose={() => setAiAnalysisOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('editor.aiAnalyze') || 'AI Analysis'}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{aiAnalysis}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAiAnalysisOpen(false)}>{t('editor.close') || 'Close'}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
