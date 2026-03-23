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
  Switch,
  Button,
  LinearProgress,
  Box,
  Typography,
  Paper,
  FormControl,
  InputLabel,
  FormControlLabel,
  Chip,
  useMediaQuery,
  useTheme,
  IconButton,
  Grid,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteIcon from '@mui/icons-material/Delete';
import { toast } from 'react-hot-toast';
import SEOIndicator from './SEOIndicator';

interface ListingCreatorDialogProps {
  open: boolean;
  onClose: () => void;
  shopId: string;
  shopSections: Array<{ shop_section_id: number; title: string }>;
  shippingProfiles: Array<{ shipping_profile_id: number; title: string }>;
  returnPolicies: Array<{ return_policy_id: number; description?: string }>;
  onCreated: (listingId: number) => void;
}

interface TaxonomyNode {
  id: number;
  name: string;
  children?: TaxonomyNode[];
  parent_id?: number;
  level?: number;
}

interface FlatTaxonomy {
  id: number;
  label: string;
}

const STEPS = ['Temel Bilgiler', 'Kategori ve Fiyat', 'Görseller', 'Önizleme ve Oluştur'];

const WHO_MADE_OPTIONS = [
  { value: 'i_did', label: 'Ben yaptım' },
  { value: 'collective', label: 'Kolektif / Atölye' },
  { value: 'someone_else', label: 'Başka biri' },
];

const WHEN_MADE_OPTIONS = [
  { value: 'made_to_order', label: 'Siparişe göre yapılıyor' },
  { value: '2020_2025', label: '2020-2025' },
  { value: '2010_2019', label: '2010-2019' },
  { value: '2004_2009', label: '2004-2009' },
  { value: 'before_2004', label: '2004 öncesi' },
  { value: '2000_2003', label: '2000-2003' },
  { value: '1990s', label: '1990\'lar' },
  { value: '1980s', label: '1980\'ler' },
  { value: '1970s', label: '1970\'ler' },
  { value: '1960s', label: '1960\'lar' },
  { value: '1950s', label: '1950\'ler' },
  { value: '1940s', label: '1940\'lar' },
  { value: '1930s', label: '1930\'lar' },
  { value: '1920s', label: '1920\'ler' },
  { value: '1910s', label: '1910\'lar' },
  { value: '1900s', label: '1900\'ler' },
];

function flattenTaxonomy(nodes: TaxonomyNode[], prefix = ''): FlatTaxonomy[] {
  const result: FlatTaxonomy[] = [];
  for (const node of nodes) {
    const label = prefix ? `${prefix} > ${node.name}` : node.name;
    result.push({ id: node.id, label });
    if (node.children && node.children.length > 0) {
      result.push(...flattenTaxonomy(node.children, label));
    }
  }
  return result;
}

export default function ListingCreatorDialog({
  open,
  onClose,
  shopId,
  shopSections,
  shippingProfiles,
  returnPolicies,
  onCreated,
}: ListingCreatorDialogProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [activeStep, setActiveStep] = useState(0);
  const [creating, setCreating] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);

  // Step 1
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [materials, setMaterials] = useState<string[]>([]);
  const [whoMade, setWhoMade] = useState('i_did');
  const [whenMade, setWhenMade] = useState('made_to_order');
  const [isSupply, setIsSupply] = useState(false);

  // Step 2
  const [taxonomyOptions, setTaxonomyOptions] = useState<FlatTaxonomy[]>([]);
  const [taxonomyLoading, setTaxonomyLoading] = useState(false);
  const [selectedTaxonomy, setSelectedTaxonomy] = useState<FlatTaxonomy | null>(null);
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [shopSectionId, setShopSectionId] = useState<number | ''>('');
  const [shippingProfileId, setShippingProfileId] = useState<number | ''>('');
  const [returnPolicyId, setReturnPolicyId] = useState<number | ''>('');

  // Step 3
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch taxonomy on open
  useEffect(() => {
    if (open && taxonomyOptions.length === 0) {
      setTaxonomyLoading(true);
      fetch(`/api/clawd/etsy?action=taxonomy&shop_id=${shopId}`)
        .then((res) => res.json())
        .then((data) => {
          const nodes: TaxonomyNode[] = data.results || data;
          const flat = flattenTaxonomy(Array.isArray(nodes) ? nodes : []);
          setTaxonomyOptions(flat);
        })
        .catch(() => {
          toast.error('Kategoriler yüklenemedi');
        })
        .finally(() => setTaxonomyLoading(false));
    }
  }, [open, shopId, taxonomyOptions.length]);

  // Generate previews for selected files
  useEffect(() => {
    const urls = selectedFiles.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [selectedFiles]);

  const resetForm = useCallback(() => {
    setActiveStep(0);
    setTitle('');
    setDescription('');
    setTags([]);
    setMaterials([]);
    setWhoMade('i_did');
    setWhenMade('made_to_order');
    setIsSupply(false);
    setSelectedTaxonomy(null);
    setPrice('');
    setQuantity('1');
    setShopSectionId('');
    setShippingProfileId('');
    setReturnPolicyId('');
    setSelectedFiles([]);
    setCreating(false);
    setUploadProgress(0);
    setUploadTotal(0);
  }, []);

  const handleClose = () => {
    if (creating) return;
    resetForm();
    onClose();
  };

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
        if (!selectedTaxonomy) {
          toast.error('Kategori seçimi zorunludur');
          return false;
        }
        if (!price || parseFloat(price) <= 0) {
          toast.error('Geçerli bir fiyat giriniz');
          return false;
        }
        if (!shippingProfileId) {
          toast.error('Kargo profili seçimi zorunludur');
          return false;
        }
        if (!returnPolicyId) {
          toast.error('İade politikası seçimi zorunludur');
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newFiles = Array.from(files);
    const total = selectedFiles.length + newFiles.length;
    if (total > 10) {
      toast.error('Maksimum 10 görsel seçilebilir');
      return;
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const validFiles = newFiles.filter((f) => {
      if (!validTypes.includes(f.type)) {
        toast.error(`${f.name}: Desteklenmeyen format`);
        return false;
      }
      return true;
    });

    setSelectedFiles((prev) => [...prev, ...validFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCreate = async (publish: boolean) => {
    setCreating(true);
    try {
      // 1. Create listing
      const body: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim(),
        tags,
        materials,
        who_made: whoMade,
        when_made: whenMade,
        is_supply: isSupply,
        taxonomy_id: selectedTaxonomy!.id,
        price: parseFloat(price),
        quantity: parseInt(quantity) || 1,
        shipping_profile_id: shippingProfileId,
        return_policy_id: returnPolicyId,
      };
      if (shopSectionId) {
        body.shop_section_id = shopSectionId;
      }

      const createRes = await fetch(
        `/api/clawd/etsy?action=create_listing&shop_id=${shopId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );

      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        throw new Error(err.error || 'Listing oluşturulamadı');
      }

      const created = await createRes.json();
      const newId = created.listing_id;

      // 2. Upload images
      if (selectedFiles.length > 0) {
        setUploadTotal(selectedFiles.length);
        for (let i = 0; i < selectedFiles.length; i++) {
          setUploadProgress(i + 1);
          const file = selectedFiles[i];

          // Convert to base64
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as string).split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          const uploadRes = await fetch(
            `/api/clawd/etsy?action=upload_image&listing_id=${newId}&shop_id=${shopId}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                image_base64: base64,
                image_content_type: file.type,
                image_filename: file.name,
                rank: i + 1,
              }),
            }
          );

          if (!uploadRes.ok) {
            toast.error(`Görsel ${i + 1} yüklenemedi`);
          }
        }
      }

      // 3. Publish if requested
      if (publish) {
        const pubRes = await fetch(
          `/api/clawd/etsy?action=publish&listing_id=${newId}&shop_id=${shopId}`,
          { method: 'POST' }
        );
        if (!pubRes.ok) {
          toast.error('Listing yayınlanamadı, taslak olarak kaydedildi');
        } else {
          toast.success('Listing oluşturuldu ve yayınlandı!');
        }
      } else {
        toast.success('Listing taslak olarak oluşturuldu!');
      }

      onCreated(newId);
      resetForm();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Bir hata oluştu');
    } finally {
      setCreating(false);
    }
  };

  const whoMadeLabel = WHO_MADE_OPTIONS.find((o) => o.value === whoMade)?.label || whoMade;
  const whenMadeLabel = WHEN_MADE_OPTIONS.find((o) => o.value === whenMade)?.label || whenMade;

  const renderStep1 = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <TextField
        label="Başlık"
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, 140))}
        required
        fullWidth
        helperText={`${title.length}/140 karakter`}
        inputProps={{ maxLength: 140 }}
      />
      <TextField
        label="Açıklama"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        required
        fullWidth
        multiline
        minRows={4}
        helperText={`${description.length} karakter`}
      />
      <Autocomplete
        multiple
        freeSolo
        options={[]}
        value={tags}
        onChange={(_, newVal) => {
          if (newVal.length <= 13) setTags(newVal as string[]);
          else toast.error('Maksimum 13 etiket eklenebilir');
        }}
        renderTags={(value, getTagProps) =>
          value.map((option, index) => (
            <Chip
              {...getTagProps({ index })}
              key={option}
              label={option}
              size="small"
            />
          ))
        }
        renderInput={(params) => (
          <TextField
            {...params}
            label="Etiketler"
            helperText={`${tags.length}/13 etiket — Enter ile ekleyin`}
          />
        )}
      />
      <Autocomplete
        multiple
        freeSolo
        options={[]}
        value={materials}
        onChange={(_, newVal) => {
          if (newVal.length <= 13) setMaterials(newVal as string[]);
          else toast.error('Maksimum 13 malzeme eklenebilir');
        }}
        renderTags={(value, getTagProps) =>
          value.map((option, index) => (
            <Chip
              {...getTagProps({ index })}
              key={option}
              label={option}
              size="small"
            />
          ))
        }
        renderInput={(params) => (
          <TextField
            {...params}
            label="Malzemeler"
            helperText={`${materials.length}/13 malzeme`}
          />
        )}
      />
      <FormControl fullWidth required>
        <InputLabel>Kim yaptı?</InputLabel>
        <Select
          value={whoMade}
          label="Kim yaptı?"
          onChange={(e) => setWhoMade(e.target.value)}
        >
          {WHO_MADE_OPTIONS.map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>
              {opt.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControl fullWidth required>
        <InputLabel>Ne zaman yapıldı?</InputLabel>
        <Select
          value={whenMade}
          label="Ne zaman yapıldı?"
          onChange={(e) => setWhenMade(e.target.value)}
        >
          {WHEN_MADE_OPTIONS.map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>
              {opt.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControlLabel
        control={
          <Switch
            checked={isSupply}
            onChange={(e) => setIsSupply(e.target.checked)}
          />
        }
        label="Bu bir malzeme/araçtır (supply)"
      />
    </Box>
  );

  const renderStep2 = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Autocomplete
        options={taxonomyOptions}
        getOptionLabel={(opt) => opt.label}
        value={selectedTaxonomy}
        onChange={(_, newVal) => setSelectedTaxonomy(newVal)}
        loading={taxonomyLoading}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Kategori"
            required
            helperText="Kategori ağacından arayarak seçin"
          />
        )}
        isOptionEqualToValue={(opt, val) => opt.id === val.id}
        noOptionsText="Kategori bulunamadı"
        loadingText="Yükleniyor..."
      />
      <TextField
        label="Fiyat"
        type="number"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        required
        fullWidth
        inputProps={{ min: 0, step: '0.01' }}
      />
      <TextField
        label="Miktar"
        type="number"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        fullWidth
        inputProps={{ min: 1 }}
      />
      <FormControl fullWidth>
        <InputLabel>Mağaza Bölümü</InputLabel>
        <Select
          value={shopSectionId}
          label="Mağaza Bölümü"
          onChange={(e) => setShopSectionId(e.target.value as number | '')}
        >
          <MenuItem value="">
            <em>Seçim yok</em>
          </MenuItem>
          {shopSections.map((s) => (
            <MenuItem key={s.shop_section_id} value={s.shop_section_id}>
              {s.title}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControl fullWidth required>
        <InputLabel>Kargo Profili</InputLabel>
        <Select
          value={shippingProfileId}
          label="Kargo Profili"
          onChange={(e) => setShippingProfileId(e.target.value as number)}
        >
          {shippingProfiles.map((s) => (
            <MenuItem key={s.shipping_profile_id} value={s.shipping_profile_id}>
              {s.title}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControl fullWidth required>
        <InputLabel>İade Politikası</InputLabel>
        <Select
          value={returnPolicyId}
          label="İade Politikası"
          onChange={(e) => setReturnPolicyId(e.target.value as number)}
        >
          {returnPolicies.map((r) => (
            <MenuItem key={r.return_policy_id} value={r.return_policy_id}>
              {r.description || `Politika #${r.return_policy_id}`}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Box>
  );

  const renderStep3 = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Listing oluşturulduktan sonra görseller yüklenecektir
      </Typography>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        multiple
        hidden
        onChange={handleFileSelect}
      />
      <Button
        variant="outlined"
        startIcon={<CloudUploadIcon />}
        onClick={() => fileInputRef.current?.click()}
        disabled={selectedFiles.length >= 10}
      >
        Görsel Seç ({selectedFiles.length}/10)
      </Button>
      {previews.length > 0 && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
            gap: 1.5,
            mt: 1,
          }}
        >
          {previews.map((src, i) => (
            <Box
              key={i}
              sx={{
                position: 'relative',
                borderRadius: 1,
                overflow: 'hidden',
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              <img
                src={src}
                alt={`Görsel ${i + 1}`}
                style={{
                  width: '100%',
                  height: 120,
                  objectFit: 'cover',
                  display: 'block',
                }}
              />
              <IconButton
                size="small"
                onClick={() => removeFile(i)}
                sx={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  bgcolor: 'rgba(0,0,0,0.5)',
                  color: 'white',
                  '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
              <Typography
                variant="caption"
                sx={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  bgcolor: 'rgba(0,0,0,0.5)',
                  color: 'white',
                  textAlign: 'center',
                  py: 0.25,
                }}
              >
                {i + 1}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );

  const renderStep4 = () => {
    const sectionLabel = shopSections.find((s) => s.shop_section_id === shopSectionId)?.title;
    const shippingLabel = shippingProfiles.find((s) => s.shipping_profile_id === shippingProfileId)?.title;
    const returnLabel =
      returnPolicies.find((r) => r.return_policy_id === returnPolicyId)?.description ||
      (returnPolicyId ? `Politika #${returnPolicyId}` : '');

    const summaryFields: Array<{ label: string; value: string | number }> = [
      { label: 'Başlık', value: title },
      { label: 'Açıklama', value: description.length > 200 ? description.slice(0, 200) + '...' : description },
      { label: 'Etiketler', value: tags.join(', ') || '-' },
      { label: 'Malzemeler', value: materials.join(', ') || '-' },
      { label: 'Kim yaptı', value: whoMadeLabel },
      { label: 'Ne zaman yapıldı', value: whenMadeLabel },
      { label: 'Malzeme/Araç', value: isSupply ? 'Evet' : 'Hayır' },
      { label: 'Kategori', value: selectedTaxonomy?.label || '-' },
      { label: 'Fiyat', value: price },
      { label: 'Miktar', value: quantity },
      { label: 'Mağaza Bölümü', value: sectionLabel || '-' },
      { label: 'Kargo Profili', value: shippingLabel || '-' },
      { label: 'İade Politikası', value: returnLabel || '-' },
      { label: 'Görseller', value: `${selectedFiles.length} adet` },
    ];

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Listing Özeti
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {summaryFields.map((field) => (
              <Box
                key={field.label}
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  py: 0.5,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Typography variant="body2" color="text.secondary" sx={{ minWidth: 140, flexShrink: 0 }}>
                  {field.label}
                </Typography>
                <Typography variant="body2" sx={{ textAlign: 'right', wordBreak: 'break-word' }}>
                  {field.value}
                </Typography>
              </Box>
            ))}
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <SEOIndicator tags={tags} title={title} description={description} />
        </Paper>

        {creating && uploadTotal > 0 && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              Görseller yükleniyor: {uploadProgress}/{uploadTotal}
            </Typography>
            <LinearProgress
              variant="determinate"
              value={(uploadProgress / uploadTotal) * 100}
              sx={{ height: 6, borderRadius: 3 }}
            />
          </Box>
        )}

        <Box sx={{ display: 'flex', gap: 2, mt: 1, flexWrap: 'wrap' }}>
          <Button
            variant="contained"
            onClick={() => handleCreate(false)}
            disabled={creating}
            sx={{ flex: 1, minWidth: 180 }}
          >
            {creating ? 'Oluşturuluyor...' : 'Taslak Olarak Oluştur'}
          </Button>
          <Button
            variant="outlined"
            onClick={() => handleCreate(true)}
            disabled={creating}
            sx={{ flex: 1, minWidth: 180 }}
          >
            {creating ? 'Oluşturuluyor...' : 'Oluştur ve Yayınla'}
          </Button>
        </Box>
      </Box>
    );
  };

  const stepContent = [renderStep1, renderStep2, renderStep3, renderStep4];

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullScreen={isMobile}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: { minHeight: isMobile ? '100vh' : '70vh' },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 3,
          py: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Typography variant="h6">Yeni Listing Oluştur</Typography>
        <IconButton onClick={handleClose} disabled={creating}>
          <CloseIcon />
        </IconButton>
      </Box>

      {creating && <LinearProgress />}

      <Box sx={{ px: 3, pt: 3 }}>
        <Stepper activeStep={activeStep} alternativeLabel={!isMobile}>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{isMobile && activeStep !== STEPS.indexOf(label) ? '' : label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      </Box>

      <Box sx={{ px: 3, py: 3, flex: 1, overflow: 'auto' }}>
        {stepContent[activeStep]()}
      </Box>

      {activeStep < 3 && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            px: 3,
            py: 2,
            borderTop: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Button disabled={activeStep === 0} onClick={handleBack}>
            Geri
          </Button>
          <Button variant="contained" onClick={handleNext}>
            İleri
          </Button>
        </Box>
      )}

      {activeStep === 3 && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'flex-start',
            px: 3,
            py: 2,
            borderTop: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Button disabled={creating} onClick={handleBack}>
            Geri
          </Button>
        </Box>
      )}
    </Dialog>
  );
}
