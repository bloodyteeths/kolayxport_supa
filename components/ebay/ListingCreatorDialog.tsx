import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Dialog,
  Stepper,
  Step,
  StepLabel,
  TextField,
  Select,
  MenuItem,
  Autocomplete,
  Button,
  LinearProgress,
  Box,
  Typography,
  FormControl,
  InputLabel,
  Chip,
  useMediaQuery,
  useTheme,
  IconButton,
  Divider,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import CloseIcon from '@mui/icons-material/Close';
import { toast } from 'react-hot-toast';
import SEOIndicator from './SEOIndicator';
import ImageManager from './ImageManager';
import ItemSpecificsEditor from './ItemSpecificsEditor';
import ConditionSelector from './ConditionSelector';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Policy {
  policyId: string;
  name: string;
  description?: string;
}

interface ListingCreatorDialogProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  apiKey: string;
  fulfillmentPolicies: Policy[];
  returnPolicies: Policy[];
  paymentPolicies: Policy[];
  onCreated: (sku: string) => void;
}

interface CategoryOption {
  id: string;
  name: string;
}

interface AspectMetadata {
  localizedAspectName: string;
  aspectConstraint: {
    aspectRequired: boolean;
    aspectMode: 'FREE_TEXT' | 'SELECTION_ONLY';
    aspectValues?: { localizedValue: string }[];
  };
}

const STEPS = ['Temel Bilgiler', 'Kategori ve Fiyat', 'Görseller', 'Politikalar ve Önizleme'];

const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD' },
  { value: 'GBP', label: 'GBP' },
  { value: 'EUR', label: 'EUR' },
  { value: 'TRY', label: 'TRY' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ListingCreatorDialog({
  open,
  onClose,
  userId,
  apiKey,
  fulfillmentPolicies,
  returnPolicies,
  paymentPolicies,
  onCreated,
}: ListingCreatorDialogProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [activeStep, setActiveStep] = useState(0);
  const [creating, setCreating] = useState(false);

  // Step 1: Basic Info
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [skuInput, setSkuInput] = useState('');
  const [condition, setCondition] = useState('NEW');
  const [conditionDescription, setConditionDescription] = useState('');

  // Step 2: Category & Price
  const [categorySearchQuery, setCategorySearchQuery] = useState('');
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const [categorySearching, setCategorySearching] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<CategoryOption | null>(null);
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [quantity, setQuantity] = useState('1');
  const [aspects, setAspects] = useState<Record<string, string[]>>({});
  const [requiredAspects, setRequiredAspects] = useState<AspectMetadata[]>([]);
  const [recommendedAspects, setRecommendedAspects] = useState<AspectMetadata[]>([]);
  const [aspectsLoading, setAspectsLoading] = useState(false);

  // Step 3: Images
  const [images, setImages] = useState<string[]>([]);

  // Step 4: Policies
  const [fulfillmentPolicyId, setFulfillmentPolicyId] = useState('');
  const [returnPolicyId, setReturnPolicyId] = useState('');
  const [paymentPolicyId, setPaymentPolicyId] = useState('');

  const categorySearchTimeout = useRef<NodeJS.Timeout | null>(null);

  // --------------------------------------------------
  // Category search with debounce
  // --------------------------------------------------
  const handleCategorySearch = (query: string) => {
    setCategorySearchQuery(query);

    if (categorySearchTimeout.current) {
      clearTimeout(categorySearchTimeout.current);
    }

    if (!query.trim()) {
      setCategoryOptions([]);
      return;
    }

    categorySearchTimeout.current = setTimeout(async () => {
      setCategorySearching(true);
      try {
        const res = await fetch(
          `/api/clawd/ebay?action=category_suggestions&q=${encodeURIComponent(query)}&user_id=${userId}`,
          {
            headers: { 'x-api-key': apiKey },
          }
        );
        if (res.ok) {
          const data = await res.json();
          setCategoryOptions(
            (data.categorySuggestions || []).map((c: any) => ({
              id: c.category?.categoryId || c.categoryId,
              name: c.category?.categoryName || c.categoryName || c.name,
            }))
          );
        }
      } catch {
        // ignore
      } finally {
        setCategorySearching(false);
      }
    }, 400);
  };

  // --------------------------------------------------
  // Fetch item aspects when category selected
  // --------------------------------------------------
  const fetchAspectsForCategory = async (categoryId: string) => {
    setAspectsLoading(true);
    try {
      const res = await fetch(
        `/api/clawd/ebay?action=item_aspects&category_id=${categoryId}&user_id=${userId}`,
        {
          headers: { 'x-api-key': apiKey },
        }
      );
      if (res.ok) {
        const data = await res.json();
        const allAspects: AspectMetadata[] = data.aspects || [];
        setRequiredAspects(allAspects.filter((a) => a.aspectConstraint.aspectRequired));
        setRecommendedAspects(allAspects.filter((a) => !a.aspectConstraint.aspectRequired));
      }
    } catch {
      // Non-critical
    } finally {
      setAspectsLoading(false);
    }
  };

  // --------------------------------------------------
  // Reset form
  // --------------------------------------------------
  const resetForm = useCallback(() => {
    setActiveStep(0);
    setTitle('');
    setDescription('');
    setSkuInput('');
    setCondition('NEW');
    setConditionDescription('');
    setCategorySearchQuery('');
    setCategoryOptions([]);
    setSelectedCategory(null);
    setPrice('');
    setCurrency('USD');
    setQuantity('1');
    setAspects({});
    setRequiredAspects([]);
    setRecommendedAspects([]);
    setImages([]);
    setFulfillmentPolicyId('');
    setReturnPolicyId('');
    setPaymentPolicyId('');
    setCreating(false);
  }, []);

  const handleClose = () => {
    if (creating) return;
    resetForm();
    onClose();
  };

  // --------------------------------------------------
  // Validation
  // --------------------------------------------------
  const validateStep = (step: number): boolean => {
    switch (step) {
      case 0:
        if (!title.trim()) {
          toast.error('Başlık zorunludur');
          return false;
        }
        if (!description.trim()) {
          toast.error('Açıklama zorunludur');
          return false;
        }
        return true;
      case 1:
        if (!selectedCategory) {
          toast.error('Kategori seçimi zorunludur');
          return false;
        }
        if (!price || parseFloat(price) <= 0) {
          toast.error('Geçerli bir fiyat giriniz');
          return false;
        }
        return true;
      case 2:
        return true;
      default:
        return true;
    }
  };

  const handleNext = () => {
    if (validateStep(activeStep)) {
      setActiveStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    setActiveStep((prev) => prev - 1);
  };

  // --------------------------------------------------
  // Create listing
  // --------------------------------------------------
  const handleCreate = async (publish: boolean) => {
    // Validate policies
    if (!fulfillmentPolicyId) {
      toast.error('Teslimat politikası seçimi zorunludur');
      return;
    }
    if (!returnPolicyId) {
      toast.error('İade politikası seçimi zorunludur');
      return;
    }
    if (!paymentPolicyId) {
      toast.error('Ödeme politikası seçimi zorunludur');
      return;
    }

    setCreating(true);
    try {
      const sku = skuInput.trim() || `SKU-${Date.now()}`;

      // 1. Create inventory item
      const inventoryPayload = {
        product: {
          title: title.trim(),
          description: description.trim(),
          aspects,
          imageUrls: images,
        },
        condition,
        conditionDescription: condition !== 'NEW' ? conditionDescription : undefined,
        availability: {
          shipToLocationAvailability: {
            quantity: parseInt(quantity) || 1,
          },
        },
      };

      const inventoryRes = await fetch(
        `/api/clawd/ebay?action=create_inventory_item&sku=${encodeURIComponent(sku)}&user_id=${userId}`,
        {
          method: 'PUT',
          headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(inventoryPayload),
        }
      );

      if (!inventoryRes.ok) {
        const err = await inventoryRes.json().catch(() => ({}));
        throw new Error(err.error || 'Envanter öğesi oluşturulamadı');
      }

      // 2. Create offer
      const offerPayload = {
        sku,
        marketplaceId: 'EBAY_US',
        format: 'FIXED_PRICE',
        listingDescription: description.trim(),
        pricingSummary: {
          price: {
            value: price,
            currency,
          },
        },
        listingPolicies: {
          fulfillmentPolicyId,
          returnPolicyId,
          paymentPolicyId,
        },
        categoryId: selectedCategory!.id,
      };

      const offerRes = await fetch(
        `/api/clawd/ebay?action=create_offer&user_id=${userId}`,
        {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(offerPayload),
        }
      );

      if (!offerRes.ok) {
        const err = await offerRes.json().catch(() => ({}));
        throw new Error(err.error || 'Teklif oluşturulamadı');
      }

      const offerData = await offerRes.json();

      // 3. Optionally publish
      if (publish && offerData.offerId) {
        const publishRes = await fetch(
          `/api/clawd/ebay?action=publish_offer&offer_id=${offerData.offerId}&user_id=${userId}`,
          {
            method: 'POST',
            headers: { 'x-api-key': apiKey },
          }
        );

        if (!publishRes.ok) {
          toast.error('Liste oluşturuldu ancak yayınlanamadı');
        } else {
          toast.success('Liste oluşturuldu ve yayınlandı');
        }
      } else {
        toast.success('Taslak oluşturuldu');
      }

      onCreated(sku);
      handleClose();
    } catch (err: any) {
      toast.error(err.message || 'Oluşturma başarısız');
    } finally {
      setCreating(false);
    }
  };

  // --------------------------------------------------
  // Render steps
  // --------------------------------------------------
  const renderStep0 = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, mt: 2 }}>
      <TextField
        label="Başlık"
        value={title}
        onChange={(e) => {
          if (e.target.value.length <= 80) setTitle(e.target.value);
        }}
        fullWidth
        size="small"
        helperText={`${title.length}/80 karakter`}
        inputProps={{ maxLength: 80 }}
        autoFocus
      />

      <TextField
        label="Açıklama"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        fullWidth
        multiline
        rows={5}
        size="small"
        helperText={`${description.length} karakter`}
      />

      <TextField
        label="SKU (Boş bırakılırsa otomatik oluşturulur)"
        value={skuInput}
        onChange={(e) => setSkuInput(e.target.value)}
        fullWidth
        size="small"
        placeholder="Örn: MY-PRODUCT-001"
      />

      <ConditionSelector
        condition={condition}
        conditionDescription={conditionDescription}
        onChange={(c, d) => {
          setCondition(c);
          setConditionDescription(d);
        }}
      />
    </Box>
  );

  const renderStep1 = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, mt: 2 }}>
      {/* Category search */}
      <Autocomplete
        options={categoryOptions}
        getOptionLabel={(opt) => typeof opt === 'string' ? opt : opt.name}
        inputValue={categorySearchQuery}
        onInputChange={(_, value) => handleCategorySearch(value)}
        value={selectedCategory}
        onChange={(_, value) => {
          if (value && typeof value !== 'string') {
            setSelectedCategory(value);
            fetchAspectsForCategory(value.id);
          }
        }}
        loading={categorySearching}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Kategori Ara"
            size="small"
            placeholder="Kategori adı yazın..."
            required
          />
        )}
        size="small"
        isOptionEqualToValue={(opt, val) => opt.id === val.id}
      />

      {selectedCategory && (
        <Chip
          label={`${selectedCategory.name} (ID: ${selectedCategory.id})`}
          onDelete={() => {
            setSelectedCategory(null);
            setRequiredAspects([]);
            setRecommendedAspects([]);
          }}
          color="primary"
          variant="outlined"
          size="small"
        />
      )}

      <Box sx={{ display: 'flex', gap: 2 }}>
        <TextField
          label="Fiyat"
          value={price}
          onChange={(e) => {
            const val = e.target.value;
            if (/^\d*\.?\d{0,2}$/.test(val) || val === '') {
              setPrice(val);
            }
          }}
          size="small"
          sx={{ flex: 1 }}
          required
        />
        <FormControl size="small" sx={{ minWidth: 90 }}>
          <InputLabel>Para Birimi</InputLabel>
          <Select
            value={currency}
            label="Para Birimi"
            onChange={(e: SelectChangeEvent) => setCurrency(e.target.value)}
          >
            {CURRENCY_OPTIONS.map((c) => (
              <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          label="Stok"
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          size="small"
          sx={{ width: 100 }}
          inputProps={{ min: 1 }}
        />
      </Box>

      {/* Item specifics */}
      {selectedCategory && (
        <>
          <Divider />
          {aspectsLoading ? (
            <LinearProgress />
          ) : (
            <ItemSpecificsEditor
              aspects={aspects}
              requiredAspects={requiredAspects}
              recommendedAspects={recommendedAspects}
              onChange={setAspects}
            />
          )}
        </>
      )}
    </Box>
  );

  const renderStep2 = () => (
    <Box sx={{ mt: 2 }}>
      <ImageManager
        images={images}
        onImagesChanged={setImages}
        maxImages={24}
      />
    </Box>
  );

  const renderStep3 = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, mt: 2 }}>
      {/* Policy selects */}
      <FormControl size="small" fullWidth required>
        <InputLabel>Teslimat Politikası</InputLabel>
        <Select
          value={fulfillmentPolicyId}
          label="Teslimat Politikası"
          onChange={(e: SelectChangeEvent) => setFulfillmentPolicyId(e.target.value)}
        >
          {fulfillmentPolicies.map((p) => (
            <MenuItem key={p.policyId} value={p.policyId}>{p.name}</MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" fullWidth required>
        <InputLabel>İade Politikası</InputLabel>
        <Select
          value={returnPolicyId}
          label="İade Politikası"
          onChange={(e: SelectChangeEvent) => setReturnPolicyId(e.target.value)}
        >
          {returnPolicies.map((p) => (
            <MenuItem key={p.policyId} value={p.policyId}>{p.name}</MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" fullWidth required>
        <InputLabel>Ödeme Politikası</InputLabel>
        <Select
          value={paymentPolicyId}
          label="Ödeme Politikası"
          onChange={(e: SelectChangeEvent) => setPaymentPolicyId(e.target.value)}
        >
          {paymentPolicies.map((p) => (
            <MenuItem key={p.policyId} value={p.policyId}>{p.name}</MenuItem>
          ))}
        </Select>
      </FormControl>

      <Divider />

      {/* Summary / Preview */}
      <Typography variant="subtitle2" fontWeight={600}>Özet</Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">Başlık</Typography>
          <Typography variant="caption" fontWeight={600}>
            {title.length > 50 ? title.slice(0, 50) + '...' : title}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">Kategori</Typography>
          <Typography variant="caption" fontWeight={600}>{selectedCategory?.name || '-'}</Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">Fiyat</Typography>
          <Typography variant="caption" fontWeight={600}>{price} {currency}</Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">Stok</Typography>
          <Typography variant="caption" fontWeight={600}>{quantity}</Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">Görseller</Typography>
          <Typography variant="caption" fontWeight={600}>{images.length}</Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">Durum</Typography>
          <Typography variant="caption" fontWeight={600}>{condition}</Typography>
        </Box>
      </Box>

      {/* SEO score */}
      <SEOIndicator
        title={title}
        description={description}
        aspects={aspects}
        imageCount={images.length}
      />

      {/* Create buttons */}
      <Box sx={{ display: 'flex', gap: 1.5, mt: 1 }}>
        <Button
          variant="outlined"
          fullWidth
          onClick={() => handleCreate(false)}
          disabled={creating}
        >
          {creating ? 'Oluşturuluyor...' : 'Taslak Oluştur'}
        </Button>
        <Button
          variant="contained"
          fullWidth
          onClick={() => handleCreate(true)}
          disabled={creating}
        >
          {creating ? 'Oluşturuluyor...' : 'Oluştur ve Yayınla'}
        </Button>
      </Box>
    </Box>
  );

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullScreen={isMobile}
      maxWidth="md"
      fullWidth
    >
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 3, pt: 2 }}>
        <Typography variant="h6" fontWeight={600}>
          Yeni eBay Listesi Oluştur
        </Typography>
        <IconButton onClick={handleClose} disabled={creating}>
          <CloseIcon />
        </IconButton>
      </Box>

      {/* Stepper */}
      <Box sx={{ px: 3, pt: 2 }}>
        <Stepper activeStep={activeStep} alternativeLabel={isMobile}>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      </Box>

      {/* Step content */}
      <Box sx={{ px: 3, pb: 3, overflow: 'auto', flex: 1 }}>
        {creating && <LinearProgress sx={{ mt: 2 }} />}

        {activeStep === 0 && renderStep0()}
        {activeStep === 1 && renderStep1()}
        {activeStep === 2 && renderStep2()}
        {activeStep === 3 && renderStep3()}

        {/* Navigation buttons (not on last step — it has its own buttons) */}
        {activeStep < 3 && (
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
            <Button
              onClick={handleBack}
              disabled={activeStep === 0 || creating}
            >
              Geri
            </Button>
            <Button
              variant="contained"
              onClick={handleNext}
              disabled={creating}
            >
              İleri
            </Button>
          </Box>
        )}

        {activeStep === 3 && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-start', mt: 2 }}>
            <Button onClick={handleBack} disabled={creating}>
              Geri
            </Button>
          </Box>
        )}
      </Box>
    </Dialog>
  );
}
