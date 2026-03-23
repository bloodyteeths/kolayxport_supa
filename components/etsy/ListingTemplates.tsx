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
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import StyleIcon from '@mui/icons-material/Style';
import MergeIcon from '@mui/icons-material/CallMerge';
import ApplyIcon from '@mui/icons-material/PlayArrow';
import AddIcon from '@mui/icons-material/Add';
import { toast } from 'react-hot-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ListingTemplate {
  id: string;
  name: string;
  createdAt: string;
  fields: {
    title?: string;
    description?: string;
    tags?: string[];
    materials?: string[];
    who_made?: string;
    when_made?: string;
    is_supply?: boolean;
    shipping_profile_id?: number | '';
    return_policy_id?: number | '';
  };
}

export interface TagProfile {
  id: string;
  name: string;
  createdAt: string;
  tags: string[];
}

interface CurrentFields {
  title: string;
  description: string;
  tags: string[];
  materials: string[];
  who_made: string;
  when_made: string;
  is_supply: boolean;
  shipping_profile_id: number | '';
  return_policy_id: number | '';
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const TEMPLATES_KEY = 'etsy_listing_templates';
const TAG_PROFILES_KEY = 'etsy_tag_profiles';

function loadTemplates(): ListingTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTemplates(templates: ListingTemplate[]) {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
}

function loadTagProfiles(): TagProfile[] {
  try {
    const raw = localStorage.getItem(TAG_PROFILES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTagProfiles(profiles: TagProfile[]) {
  localStorage.setItem(TAG_PROFILES_KEY, JSON.stringify(profiles));
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------------------------------------------------------------------------
// WHO_MADE / WHEN_MADE labels (for preview)
// ---------------------------------------------------------------------------

const WHO_MADE_LABELS: Record<string, string> = {
  i_did: 'Ben yaptim',
  collective: 'Ekibimiz yapti',
  someone_else: 'Baskasi yapti',
};

const WHEN_MADE_LABELS: Record<string, string> = {
  made_to_order: 'Siparise ozel',
  '2020_2025': '2020-2025',
  '2010_2019': '2010-2019',
  '2004_2009': '2004-2009',
  before_2004: '2004 oncesi',
};

// ===================================================================
// SaveTemplateDialog — save current listing fields as a template
// ===================================================================

interface SaveTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  currentFields: CurrentFields;
}

export function SaveTemplateDialog({ open, onClose, currentFields }: SaveTemplateDialogProps) {
  const [name, setName] = useState('');

  useEffect(() => {
    if (open) setName('');
  }, [open]);

  const handleSave = () => {
    if (!name.trim()) {
      toast.error('Profil adi giriniz');
      return;
    }

    const templates = loadTemplates();
    const newTemplate: ListingTemplate = {
      id: generateId(),
      name: name.trim(),
      createdAt: new Date().toISOString(),
      fields: {
        title: currentFields.title,
        description: currentFields.description,
        tags: [...currentFields.tags],
        materials: [...currentFields.materials],
        who_made: currentFields.who_made,
        when_made: currentFields.when_made,
        is_supply: currentFields.is_supply,
        shipping_profile_id: currentFields.shipping_profile_id,
        return_policy_id: currentFields.return_policy_id,
      },
    };

    templates.push(newTemplate);
    saveTemplates(templates);
    toast.success('Profil kaydedildi');
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Profil Kaydet</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          label="Profil Adi"
          value={name}
          onChange={(e) => setName(e.target.value)}
          size="small"
          sx={{ mt: 1 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
          }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Kaydedilecek alanlar: Baslik, Aciklama, Etiketler, Malzemeler, Yapimci, Yapim zamani, Tedarik durumu, Kargo profili, Iade politikasi
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
  onApply: (template: ListingTemplate) => void;
}

export function LoadTemplateDialog({ open, onClose, onApply }: LoadTemplateDialogProps) {
  const [templates, setTemplates] = useState<ListingTemplate[]>([]);
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
    toast.success('Profil silindi');
  };

  const handleRename = (id: string) => {
    if (!editName.trim()) return;
    const updated = templates.map((t) =>
      t.id === id ? { ...t, name: editName.trim() } : t,
    );
    setTemplates(updated);
    saveTemplates(updated);
    setEditingId(null);
    toast.success('Profil yeniden adlandirildi');
  };

  const startEditing = (template: ListingTemplate) => {
    setEditingId(template.id);
    setEditName(template.name);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Profillerim</DialogTitle>
      <DialogContent>
        {templates.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
            Henuz kayitli profil yok. Bir listeyi duzenlerken &ldquo;Profil Kaydet&rdquo; butonunu kullanin.
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
                    {template.fields.tags && template.fields.tags.length > 0 && (
                      <Chip
                        label={`${template.fields.tags.length} etiket`}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.65rem', height: 20 }}
                      />
                    )}
                    {template.fields.materials && template.fields.materials.length > 0 && (
                      <Chip
                        label={`${template.fields.materials.length} malzeme`}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.65rem', height: 20 }}
                      />
                    )}
                    {template.fields.who_made && (
                      <Chip
                        label={WHO_MADE_LABELS[template.fields.who_made] || template.fields.who_made}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.65rem', height: 20 }}
                      />
                    )}
                    {template.fields.when_made && (
                      <Chip
                        label={WHEN_MADE_LABELS[template.fields.when_made] || template.fields.when_made}
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
                  <Tooltip title="Yeniden Adlandir">
                    <IconButton size="small" onClick={() => startEditing(template)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Profili Sil">
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
// TagProfileMenu — dropdown button for tag profiles
// ===================================================================

interface TagProfileMenuProps {
  currentTags: string[];
  onApplyTags: (tags: string[]) => void;
}

export function TagProfileMenu({ currentTags, onApplyTags }: TagProfileMenuProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [profiles, setProfiles] = useState<TagProfile[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [manageDialogOpen, setManageDialogOpen] = useState(false);

  const menuOpen = Boolean(anchorEl);

  const handleOpenMenu = (event: React.MouseEvent<HTMLElement>) => {
    setProfiles(loadTagProfiles());
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  // Apply: replace tags entirely
  const handleApply = (profile: TagProfile) => {
    onApplyTags(profile.tags.slice(0, 13));
    toast.success(`"${profile.name}" etiketleri uygulandi`);
    handleClose();
  };

  // Merge: add tags without removing existing
  const handleMerge = (profile: TagProfile) => {
    const newTags = profile.tags.filter((t) => !currentTags.includes(t));
    const merged = [...currentTags, ...newTags].slice(0, 13);
    onApplyTags(merged);
    toast.success(`${newTags.length} etiket birlestirildi`);
    handleClose();
  };

  // Save current tags as a profile
  const handleSaveProfile = () => {
    if (!newProfileName.trim()) {
      toast.error('Profil adi giriniz');
      return;
    }
    if (currentTags.length === 0) {
      toast.error('Kaydedilecek etiket yok');
      return;
    }

    const profiles = loadTagProfiles();
    const newProfile: TagProfile = {
      id: generateId(),
      name: newProfileName.trim(),
      createdAt: new Date().toISOString(),
      tags: [...currentTags],
    };

    profiles.push(newProfile);
    saveTagProfiles(profiles);
    toast.success('Etiket profili kaydedildi');
    setSaveDialogOpen(false);
    setNewProfileName('');
  };

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<StyleIcon sx={{ fontSize: 16 }} />}
        onClick={handleOpenMenu}
        sx={{ textTransform: 'none', fontSize: '0.75rem' }}
      >
        Etiket Profili
      </Button>

      <Menu
        anchorEl={anchorEl}
        open={menuOpen}
        onClose={handleClose}
        PaperProps={{ sx: { maxWidth: 320, maxHeight: 400 } }}
      >
        {/* Save current tags */}
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
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.3, mt: 0.5, maxWidth: 260 }}>
                {profile.tags.slice(0, 5).map((tag) => (
                  <Chip
                    key={tag}
                    label={tag}
                    size="small"
                    sx={{ fontSize: '0.6rem', height: 18 }}
                  />
                ))}
                {profile.tags.length > 5 && (
                  <Typography variant="caption" color="text.secondary">
                    +{profile.tags.length - 5}
                  </Typography>
                )}
              </Box>
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
                  startIcon={<MergeIcon sx={{ fontSize: 12 }} />}
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

      {/* Save Tag Profile Dialog */}
      <Dialog open={saveDialogOpen} onClose={() => setSaveDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Etiket Profili Kaydet</DialogTitle>
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
            {currentTags.map((tag) => (
              <Chip key={tag} label={tag} size="small" sx={{ fontSize: '0.7rem' }} />
            ))}
          </Box>
          {currentTags.length === 0 && (
            <Typography variant="caption" color="error" sx={{ mt: 1 }}>
              Kaydedilecek etiket yok
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveDialogOpen(false)}>Iptal</Button>
          <Button
            onClick={handleSaveProfile}
            variant="contained"
            disabled={currentTags.length === 0}
            startIcon={<SaveIcon />}
          >
            Kaydet
          </Button>
        </DialogActions>
      </Dialog>

      {/* Manage Tag Profiles Dialog */}
      <ManageTagProfilesDialog
        open={manageDialogOpen}
        onClose={() => setManageDialogOpen(false)}
      />
    </>
  );
}

// ===================================================================
// ManageTagProfilesDialog — rename, delete tag profiles
// ===================================================================

interface ManageTagProfilesDialogProps {
  open: boolean;
  onClose: () => void;
}

function ManageTagProfilesDialog({ open, onClose }: ManageTagProfilesDialogProps) {
  const [profiles, setProfiles] = useState<TagProfile[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  useEffect(() => {
    if (open) {
      setProfiles(loadTagProfiles());
      setEditingId(null);
    }
  }, [open]);

  const handleDelete = (id: string) => {
    const updated = profiles.filter((p) => p.id !== id);
    setProfiles(updated);
    saveTagProfiles(updated);
    toast.success('Etiket profili silindi');
  };

  const handleRename = (id: string) => {
    if (!editName.trim()) return;
    const updated = profiles.map((p) =>
      p.id === id ? { ...p, name: editName.trim() } : p,
    );
    setProfiles(updated);
    saveTagProfiles(updated);
    setEditingId(null);
    toast.success('Profil yeniden adlandirildi');
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Etiket Profillerini Yonet</DialogTitle>
      <DialogContent>
        {profiles.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
            Henuz kayitli etiket profili yok.
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
                    {profile.tags.map((tag) => (
                      <Chip
                        key={tag}
                        label={tag}
                        size="small"
                        sx={{ fontSize: '0.65rem', height: 20 }}
                      />
                    ))}
                  </Box>

                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    {new Date(profile.createdAt).toLocaleDateString('tr-TR')} &middot; {profile.tags.length} etiket
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
