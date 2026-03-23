import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  IconButton,
  Chip,
  Card,
  CardContent,
  CardActions,
  Tooltip,
  Menu,
  MenuItem,
  Divider,
  ListItemIcon,
  ListItemText,
  FormControl,
  InputLabel,
  Select,
  Switch,
  FormControlLabel,
  Alert,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import StyleIcon from '@mui/icons-material/Style';
import ApplyIcon from '@mui/icons-material/PlayArrow';
import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { toast } from 'react-hot-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EbayListingRow {
  sku: string;
  title: string;
  description?: string;
  price?: number;
  quantity?: number;
  condition?: string;
  conditionDescription?: string;
  categoryId?: string;
  categoryName?: string;
  aspects?: Record<string, string[]>;
  listingPolicies?: {
    fulfillmentPolicyId?: string;
    paymentPolicyId?: string;
    returnPolicyId?: string;
  };
  format?: string;
  marketplaceId?: string;
  imageUrls?: string[];
}

export interface EbayListingTemplate {
  id: string;
  name: string;
  createdAt: string;
  fields: {
    title?: string;
    description?: string;
    price?: number;
    condition?: string;
    conditionDescription?: string;
    categoryId?: string;
    categoryName?: string;
    aspects?: Record<string, string[]>;
    listingPolicies?: {
      fulfillmentPolicyId?: string;
      paymentPolicyId?: string;
      returnPolicyId?: string;
    };
    format?: string;
    marketplaceId?: string;
  };
}

export interface AspectProfile {
  id: string;
  name: string;
  createdAt: string;
  categoryId?: string;
  aspects: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const TEMPLATES_KEY = 'ebay_listing_templates';
const ASPECT_PROFILES_KEY = 'ebay_aspect_profiles';

function loadTemplates(): EbayListingTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTemplates(templates: EbayListingTemplate[]) {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
}

function loadAspectProfiles(): AspectProfile[] {
  try {
    const raw = localStorage.getItem(ASPECT_PROFILES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveAspectProfiles(profiles: AspectProfile[]) {
  localStorage.setItem(ASPECT_PROFILES_KEY, JSON.stringify(profiles));
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------------------------------------------------------------------------
// Condition labels (for preview)
// ---------------------------------------------------------------------------

const CONDITION_LABELS: Record<string, string> = {
  NEW: 'Yeni',
  LIKE_NEW: 'Yeni Gibi',
  NEW_OTHER: 'Yeni (Diger)',
  NEW_WITH_DEFECTS: 'Yeni (Kusurlu)',
  MANUFACTURER_REFURBISHED: 'Uretici Yenilemis',
  CERTIFIED_REFURBISHED: 'Sertifikali Yenilemis',
  EXCELLENT_REFURBISHED: 'Mukemmel Yenilemis',
  VERY_GOOD_REFURBISHED: 'Cok Iyi Yenilemis',
  GOOD_REFURBISHED: 'Iyi Yenilemis',
  SELLER_REFURBISHED: 'Satici Yenilemis',
  USED_EXCELLENT: 'Kullanilmis - Mukemmel',
  USED_VERY_GOOD: 'Kullanilmis - Cok Iyi',
  USED_GOOD: 'Kullanilmis - Iyi',
  USED_ACCEPTABLE: 'Kullanilmis - Kabul Edilebilir',
  FOR_PARTS_OR_NOT_WORKING: 'Parca icin / Calismayan',
};

const FORMAT_LABELS: Record<string, string> = {
  FIXED_PRICE: 'Sabit Fiyat',
  AUCTION: 'Acik Artirma',
};

// ===================================================================
// SaveTemplateDialog — save current listing fields as a template
// ===================================================================

interface SaveTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  currentFields: Partial<EbayListingTemplate['fields']>;
}

export function SaveTemplateDialog({ open, onClose, currentFields }: SaveTemplateDialogProps) {
  const [name, setName] = useState('');

  useEffect(() => {
    if (open) setName('');
  }, [open]);

  const handleSave = () => {
    if (!name.trim()) {
      toast.error('Sablon adi giriniz');
      return;
    }

    const templates = loadTemplates();
    const newTemplate: EbayListingTemplate = {
      id: generateId(),
      name: name.trim(),
      createdAt: new Date().toISOString(),
      fields: {
        title: currentFields.title,
        description: currentFields.description,
        price: currentFields.price,
        condition: currentFields.condition,
        conditionDescription: currentFields.conditionDescription,
        categoryId: currentFields.categoryId,
        categoryName: currentFields.categoryName,
        aspects: currentFields.aspects ? { ...currentFields.aspects } : undefined,
        listingPolicies: currentFields.listingPolicies
          ? { ...currentFields.listingPolicies }
          : undefined,
        format: currentFields.format,
        marketplaceId: currentFields.marketplaceId,
      },
    };

    templates.push(newTemplate);
    saveTemplates(templates);
    toast.success('Sablon kaydedildi');
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Sablon Kaydet</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          label="Sablon Adi"
          value={name}
          onChange={(e) => setName(e.target.value)}
          size="small"
          sx={{ mt: 1 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
          }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Kaydedilecek alanlar: Baslik, Aciklama, Fiyat, Durum, Kategori, Ozellikler, Politikalar, Format
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Iptal</Button>
        <Button onClick={handleSave} variant="contained" startIcon={<SaveIcon />}>
          Kaydet
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ===================================================================
// LoadTemplateDialog — browse, apply, rename, delete templates
// ===================================================================

interface LoadTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  onApply: (template: EbayListingTemplate) => void;
}

export function LoadTemplateDialog({ open, onClose, onApply }: LoadTemplateDialogProps) {
  const [templates, setTemplates] = useState<EbayListingTemplate[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  useEffect(() => {
    if (open) {
      setTemplates(loadTemplates());
      setEditingId(null);
    }
  }, [open]);

  const handleDelete = (id: string) => {
    const updated = templates.filter((t) => t.id !== id);
    setTemplates(updated);
    saveTemplates(updated);
    toast.success('Sablon silindi');
  };

  const handleRename = (id: string) => {
    if (!editName.trim()) return;
    const updated = templates.map((t) =>
      t.id === id ? { ...t, name: editName.trim() } : t,
    );
    setTemplates(updated);
    saveTemplates(updated);
    setEditingId(null);
    toast.success('Sablon yeniden adlandirildi');
  };

  const startEditing = (template: EbayListingTemplate) => {
    setEditingId(template.id);
    setEditName(template.name);
  };

  const handleDuplicate = (template: EbayListingTemplate) => {
    const copy: EbayListingTemplate = {
      ...template,
      id: generateId(),
      name: `${template.name} (Kopya)`,
      createdAt: new Date().toISOString(),
    };
    const updated = [...templates, copy];
    setTemplates(updated);
    saveTemplates(updated);
    toast.success('Sablon kopyalandi');
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>eBay Sablonlarim</DialogTitle>
      <DialogContent>
        {templates.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
            Henuz kayitli sablon yok. Bir ilan olusturma ekraninda &ldquo;Sablon Kaydet&rdquo; butonunu kullanin.
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
            {templates.map((template) => (
              <Card key={template.id} variant="outlined" sx={{ position: 'relative' }}>
                <CardContent sx={{ pb: 1, '&:last-child': { pb: 1 } }}>
                  {editingId === template.id ? (
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <TextField
                        autoFocus
                        size="small"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRename(template.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        sx={{ flex: 1 }}
                      />
                      <Button size="small" onClick={() => handleRename(template.id)}>
                        Kaydet
                      </Button>
                      <Button size="small" onClick={() => setEditingId(null)}>
                        Iptal
                      </Button>
                    </Box>
                  ) : (
                    <Typography variant="subtitle2" fontWeight={600}>
                      {template.name}
                    </Typography>
                  )}

                  {/* Preview of fields */}
                  <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {template.fields.title && (
                      <Chip
                        label={`Baslik: ${template.fields.title.substring(0, 30)}${template.fields.title.length > 30 ? '...' : ''}`}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.65rem', height: 20 }}
                      />
                    )}
                    {template.fields.condition && (
                      <Chip
                        label={CONDITION_LABELS[template.fields.condition] || template.fields.condition}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.65rem', height: 20 }}
                      />
                    )}
                    {template.fields.price != null && (
                      <Chip
                        label={`Fiyat: $${template.fields.price.toFixed(2)}`}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.65rem', height: 20 }}
                      />
                    )}
                    {template.fields.categoryName && (
                      <Chip
                        label={`Kategori: ${template.fields.categoryName.substring(0, 25)}${template.fields.categoryName.length > 25 ? '...' : ''}`}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.65rem', height: 20 }}
                      />
                    )}
                    {template.fields.aspects && Object.keys(template.fields.aspects).length > 0 && (
                      <Chip
                        label={`${Object.keys(template.fields.aspects).length} ozellik`}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.65rem', height: 20 }}
                      />
                    )}
                    {template.fields.format && (
                      <Chip
                        label={FORMAT_LABELS[template.fields.format] || template.fields.format}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.65rem', height: 20 }}
                      />
                    )}
                    {template.fields.listingPolicies && (
                      <Chip
                        label="Politikalar var"
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.65rem', height: 20 }}
                      />
                    )}
                    {template.fields.description && (
                      <Chip
                        label="Aciklama var"
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.65rem', height: 20 }}
                      />
                    )}
                  </Box>

                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    {new Date(template.createdAt).toLocaleDateString('tr-TR')}
                  </Typography>
                </CardContent>
                <CardActions sx={{ pt: 0, px: 2, pb: 1 }}>
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<ApplyIcon />}
                    onClick={() => {
                      onApply(template);
                      onClose();
                    }}
                    sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                  >
                    Uygula
                  </Button>
                  <Tooltip title="Kopyala">
                    <IconButton size="small" onClick={() => handleDuplicate(template)}>
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Yeniden Adlandir">
                    <IconButton size="small" onClick={() => startEditing(template)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Sablonu Sil">
                    <IconButton size="small" color="error" onClick={() => handleDelete(template.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </CardActions>
              </Card>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Kapat</Button>
      </DialogActions>
    </Dialog>
  );
}

// ===================================================================
// AspectProfileMenu — dropdown button for aspect profiles
// ===================================================================

interface AspectProfileMenuProps {
  currentAspects: Record<string, string[]>;
  categoryId?: string;
  onApplyAspects: (aspects: Record<string, string[]>) => void;
}

export function AspectProfileMenu({ currentAspects, categoryId, onApplyAspects }: AspectProfileMenuProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [profiles, setProfiles] = useState<AspectProfile[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [manageDialogOpen, setManageDialogOpen] = useState(false);

  const menuOpen = Boolean(anchorEl);

  const handleOpenMenu = (event: React.MouseEvent<HTMLElement>) => {
    setProfiles(loadAspectProfiles());
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  // Apply: replace aspects entirely
  const handleApply = (profile: AspectProfile) => {
    onApplyAspects({ ...profile.aspects });
    toast.success(`"${profile.name}" ozellikleri uygulandi`);
    handleClose();
  };

  // Merge: add aspects without removing existing
  const handleMerge = (profile: AspectProfile) => {
    const merged = { ...currentAspects };
    for (const [key, values] of Object.entries(profile.aspects)) {
      if (!merged[key]) {
        merged[key] = [...values];
      } else {
        const existing = new Set(merged[key]);
        for (const v of values) {
          if (!existing.has(v)) merged[key].push(v);
        }
      }
    }
    onApplyAspects(merged);
    toast.success('Ozellikler birlestirildi');
    handleClose();
  };

  // Save current aspects as a profile
  const handleSaveProfile = () => {
    if (!newProfileName.trim()) {
      toast.error('Profil adi giriniz');
      return;
    }
    const aspectKeys = Object.keys(currentAspects);
    if (aspectKeys.length === 0) {
      toast.error('Kaydedilecek ozellik yok');
      return;
    }

    const allProfiles = loadAspectProfiles();
    const newProfile: AspectProfile = {
      id: generateId(),
      name: newProfileName.trim(),
      createdAt: new Date().toISOString(),
      categoryId,
      aspects: { ...currentAspects },
    };

    allProfiles.push(newProfile);
    saveAspectProfiles(allProfiles);
    toast.success('Ozellik profili kaydedildi');
    setSaveDialogOpen(false);
    setNewProfileName('');
  };

  const aspectCount = Object.keys(currentAspects).length;

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<StyleIcon sx={{ fontSize: 16 }} />}
        onClick={handleOpenMenu}
        sx={{ textTransform: 'none', fontSize: '0.75rem' }}
      >
        Ozellik Profili
      </Button>

      <Menu
        anchorEl={anchorEl}
        open={menuOpen}
        onClose={handleClose}
        PaperProps={{ sx: { maxWidth: 360, maxHeight: 400 } }}
      >
        {/* Save current aspects */}
        <MenuItem
          onClick={() => {
            handleClose();
            setNewProfileName('');
            setSaveDialogOpen(true);
          }}
        >
          <ListItemIcon>
            <AddIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Yeni Profil Olustur</ListItemText>
        </MenuItem>

        {/* Manage profiles */}
        <MenuItem
          onClick={() => {
            handleClose();
            setManageDialogOpen(true);
          }}
        >
          <ListItemIcon>
            <FolderOpenIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Profilleri Yonet</ListItemText>
        </MenuItem>

        {profiles.length > 0 && <Divider />}

        {profiles.map((profile) => (
          <Box key={profile.id}>
            <MenuItem sx={{ flexDirection: 'column', alignItems: 'flex-start', py: 1 }}>
              <Typography variant="body2" fontWeight={600}>
                {profile.name}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.3, mt: 0.5, maxWidth: 300 }}>
                {Object.entries(profile.aspects)
                  .slice(0, 4)
                  .map(([key, values]) => (
                    <Chip
                      key={key}
                      label={`${key}: ${values[0]}${values.length > 1 ? ` +${values.length - 1}` : ''}`}
                      size="small"
                      sx={{ fontSize: '0.6rem', height: 18 }}
                    />
                  ))}
                {Object.keys(profile.aspects).length > 4 && (
                  <Typography variant="caption" color="text.secondary">
                    +{Object.keys(profile.aspects).length - 4}
                  </Typography>
                )}
              </Box>
              {profile.categoryId && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.3 }}>
                  Kategori: {profile.categoryId}
                </Typography>
              )}
              <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, width: '100%' }}>
                <Button
                  size="small"
                  variant="contained"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleApply(profile);
                  }}
                  sx={{ textTransform: 'none', fontSize: '0.65rem', py: 0, minHeight: 24, flex: 1 }}
                >
                  Uygula
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMerge(profile);
                  }}
                  sx={{ textTransform: 'none', fontSize: '0.65rem', py: 0, minHeight: 24, flex: 1 }}
                >
                  Birlestir
                </Button>
              </Box>
            </MenuItem>
          </Box>
        ))}
      </Menu>

      {/* Save Aspect Profile Dialog */}
      <Dialog open={saveDialogOpen} onClose={() => setSaveDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Ozellik Profili Kaydet</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Profil Adi"
            value={newProfileName}
            onChange={(e) => setNewProfileName(e.target.value)}
            size="small"
            sx={{ mt: 1 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveProfile();
            }}
          />
          <Box sx={{ mt: 1.5, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {Object.entries(currentAspects).map(([key, values]) => (
              <Chip
                key={key}
                label={`${key}: ${values.join(', ')}`}
                size="small"
                sx={{ fontSize: '0.7rem' }}
              />
            ))}
          </Box>
          {aspectCount === 0 && (
            <Typography variant="caption" color="error" sx={{ mt: 1 }}>
              Kaydedilecek ozellik yok
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveDialogOpen(false)}>Iptal</Button>
          <Button
            onClick={handleSaveProfile}
            variant="contained"
            disabled={aspectCount === 0}
            startIcon={<SaveIcon />}
          >
            Kaydet
          </Button>
        </DialogActions>
      </Dialog>

      {/* Manage Aspect Profiles Dialog */}
      <ManageAspectProfilesDialog
        open={manageDialogOpen}
        onClose={() => setManageDialogOpen(false)}
      />
    </>
  );
}

// ===================================================================
// ManageAspectProfilesDialog — rename, delete aspect profiles
// ===================================================================

interface ManageAspectProfilesDialogProps {
  open: boolean;
  onClose: () => void;
}

function ManageAspectProfilesDialog({ open, onClose }: ManageAspectProfilesDialogProps) {
  const [profiles, setProfiles] = useState<AspectProfile[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  useEffect(() => {
    if (open) {
      setProfiles(loadAspectProfiles());
      setEditingId(null);
    }
  }, [open]);

  const handleDelete = (id: string) => {
    const updated = profiles.filter((p) => p.id !== id);
    setProfiles(updated);
    saveAspectProfiles(updated);
    toast.success('Ozellik profili silindi');
  };

  const handleRename = (id: string) => {
    if (!editName.trim()) return;
    const updated = profiles.map((p) =>
      p.id === id ? { ...p, name: editName.trim() } : p,
    );
    setProfiles(updated);
    saveAspectProfiles(updated);
    setEditingId(null);
    toast.success('Profil yeniden adlandirildi');
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Ozellik Profillerini Yonet</DialogTitle>
      <DialogContent>
        {profiles.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
            Henuz kayitli ozellik profili yok.
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
            {profiles.map((profile) => (
              <Card key={profile.id} variant="outlined">
                <CardContent sx={{ pb: 1, '&:last-child': { pb: 1 } }}>
                  {editingId === profile.id ? (
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <TextField
                        autoFocus
                        size="small"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRename(profile.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        sx={{ flex: 1 }}
                      />
                      <Button size="small" onClick={() => handleRename(profile.id)}>
                        Kaydet
                      </Button>
                      <Button size="small" onClick={() => setEditingId(null)}>
                        Iptal
                      </Button>
                    </Box>
                  ) : (
                    <Typography variant="subtitle2" fontWeight={600}>
                      {profile.name}
                    </Typography>
                  )}

                  <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {Object.entries(profile.aspects).map(([key, values]) => (
                      <Chip
                        key={key}
                        label={`${key}: ${values.join(', ')}`}
                        size="small"
                        sx={{ fontSize: '0.65rem', height: 20 }}
                      />
                    ))}
                  </Box>

                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    {new Date(profile.createdAt).toLocaleDateString('tr-TR')} &middot; {Object.keys(profile.aspects).length} ozellik
                    {profile.categoryId && ` &middot; Kategori: ${profile.categoryId}`}
                  </Typography>
                </CardContent>
                <CardActions sx={{ pt: 0, px: 2, pb: 1 }}>
                  <Tooltip title="Yeniden Adlandir">
                    <IconButton
                      size="small"
                      onClick={() => {
                        setEditingId(profile.id);
                        setEditName(profile.name);
                      }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Profili Sil">
                    <IconButton size="small" color="error" onClick={() => handleDelete(profile.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </CardActions>
              </Card>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Kapat</Button>
      </DialogActions>
    </Dialog>
  );
}

// ===================================================================
// ListingTemplates — main component for template management
// ===================================================================

interface ListingTemplatesProps {
  onApply: (template: EbayListingTemplate) => void;
  listings: EbayListingRow[];
}

export default function ListingTemplates({ onApply, listings }: ListingTemplatesProps) {
  const [templates, setTemplates] = useState<EbayListingTemplate[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [selectedListing, setSelectedListing] = useState<EbayListingRow | null>(null);
  const [createFromListingOpen, setCreateFromListingOpen] = useState(false);

  useEffect(() => {
    setTemplates(loadTemplates());
  }, []);

  const handleCreateFromListing = (listing: EbayListingRow) => {
    setSelectedListing(listing);
    setCreateFromListingOpen(true);
  };

  const refreshTemplates = useCallback(() => {
    setTemplates(loadTemplates());
  }, []);

  return (
    <Box>
      {/* Action buttons */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<FolderOpenIcon />}
          onClick={() => setLoadDialogOpen(true)}
          sx={{ textTransform: 'none' }}
        >
          Sablonlarim ({templates.length})
        </Button>
      </Box>

      {/* Quick template cards from existing listings */}
      {listings.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Mevcut Ilanlardan Sablon Olustur
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 300, overflow: 'auto' }}>
            {listings.slice(0, 10).map((listing) => (
              <Card key={listing.sku} variant="outlined" sx={{ p: 0 }}>
                <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography
                        variant="body2"
                        noWrap
                        sx={{ fontWeight: 500 }}
                      >
                        {listing.title}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 0.5, mt: 0.3 }}>
                        {listing.condition && (
                          <Chip
                            label={CONDITION_LABELS[listing.condition] || listing.condition}
                            size="small"
                            sx={{ fontSize: '0.6rem', height: 18 }}
                          />
                        )}
                        {listing.price != null && (
                          <Chip
                            label={`$${listing.price.toFixed(2)}`}
                            size="small"
                            sx={{ fontSize: '0.6rem', height: 18 }}
                          />
                        )}
                        {listing.categoryName && (
                          <Chip
                            label={listing.categoryName}
                            size="small"
                            sx={{ fontSize: '0.6rem', height: 18 }}
                          />
                        )}
                      </Box>
                    </Box>
                    <Tooltip title="Sablon Olarak Kaydet">
                      <IconButton
                        size="small"
                        onClick={() => handleCreateFromListing(listing)}
                      >
                        <SaveIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </CardContent>
              </Card>
            ))}
          </Box>
        </Box>
      )}

      {/* Template list */}
      {templates.length > 0 && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Kayitli Sablonlar
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {templates.map((template) => (
              <Card key={template.id} variant="outlined">
                <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}>
                  <Typography variant="subtitle2" fontWeight={600}>
                    {template.name}
                  </Typography>
                  <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {template.fields.title && (
                      <Chip
                        label={`Baslik: ${template.fields.title.substring(0, 25)}...`}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.6rem', height: 18 }}
                      />
                    )}
                    {template.fields.condition && (
                      <Chip
                        label={CONDITION_LABELS[template.fields.condition] || template.fields.condition}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.6rem', height: 18 }}
                      />
                    )}
                    {template.fields.categoryName && (
                      <Chip
                        label={template.fields.categoryName}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.6rem', height: 18 }}
                      />
                    )}
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.3 }}>
                    {new Date(template.createdAt).toLocaleDateString('tr-TR')}
                  </Typography>
                </CardContent>
                <CardActions sx={{ pt: 0, px: 2, pb: 1 }}>
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<ApplyIcon />}
                    onClick={() => onApply(template)}
                    sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                  >
                    Uygula
                  </Button>
                  <Tooltip title="Sablonu Sil">
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => {
                        const updated = templates.filter((t) => t.id !== template.id);
                        setTemplates(updated);
                        saveTemplates(updated);
                        toast.success('Sablon silindi');
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </CardActions>
              </Card>
            ))}
          </Box>
        </Box>
      )}

      {/* Load Template Dialog */}
      <LoadTemplateDialog
        open={loadDialogOpen}
        onClose={() => {
          setLoadDialogOpen(false);
          refreshTemplates();
        }}
        onApply={onApply}
      />

      {/* Save from existing listing dialog */}
      {selectedListing && (
        <SaveTemplateDialog
          open={createFromListingOpen}
          onClose={() => {
            setCreateFromListingOpen(false);
            refreshTemplates();
          }}
          currentFields={{
            title: selectedListing.title,
            description: selectedListing.description,
            price: selectedListing.price,
            condition: selectedListing.condition,
            conditionDescription: selectedListing.conditionDescription,
            categoryId: selectedListing.categoryId,
            categoryName: selectedListing.categoryName,
            aspects: selectedListing.aspects,
            listingPolicies: selectedListing.listingPolicies,
            format: selectedListing.format,
            marketplaceId: selectedListing.marketplaceId,
          }}
        />
      )}
    </Box>
  );
}
