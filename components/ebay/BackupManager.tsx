import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Chip,
  Tooltip,
  Button,
  Alert,
  Card,
  CardContent,
  LinearProgress,
  Paper,
} from '@mui/material';
import {
  Restore as RestoreIcon,
  Delete as DeleteIcon,
  DeleteSweep as DeleteSweepIcon,
  Backup as BackupIcon,
  FileDownload as FileDownloadIcon,
  FileUpload as FileUploadIcon,
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EbayBackupListing {
  sku: string;
  title: string;
  description?: string;
  price?: number;
  quantity?: number;
  condition?: string;
  categoryId?: string;
  categoryName?: string;
  aspects?: Record<string, string[]>;
  imageUrls?: string[];
}

export interface EbayBackupEntry {
  id: string;
  timestamp: number;
  listing_count: number;
  version: string;
  user_id: string;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'ebay_backups';
const MAX_BACKUPS = 15;

function loadBackupIndex(): EbayBackupEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as EbayBackupEntry[];
  } catch {
    return [];
  }
}

function saveBackupIndex(entries: EbayBackupEntry[]): void {
  const trimmed = entries.slice(0, MAX_BACKUPS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

function getBackupDataKey(id: string): string {
  return `ebay_backup_data_${id}`;
}

function saveBackupData(id: string, listings: EbayBackupListing[]): void {
  localStorage.setItem(getBackupDataKey(id), JSON.stringify(listings));
}

function loadBackupData(id: string): EbayBackupListing[] {
  try {
    const raw = localStorage.getItem(getBackupDataKey(id));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function deleteBackupData(id: string): void {
  localStorage.removeItem(getBackupDataKey(id));
}

function generateId(): string {
  return `backup_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface BackupManagerProps {
  listings: any[];
  userId: string;
}

export default function BackupManager({ listings, userId }: BackupManagerProps) {
  const t = useTranslations('common');
  const [backups, setBackups] = useState<EbayBackupEntry[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    setBackups(loadBackupIndex().filter((b) => b.user_id === userId));
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // --- Create backup (export to localStorage + download) ---
  const handleCreateBackup = () => {
    if (listings.length === 0) {
      toast.error('Yedeklenecek ilan yok');
      return;
    }

    const backupListings: EbayBackupListing[] = listings.map((l: any) => ({
      sku: l.sku,
      title: l.title || '',
      description: l.description,
      price: l.price,
      quantity: l.quantity,
      condition: l.condition,
      categoryId: l.categoryId,
      categoryName: l.categoryName,
      aspects: l.aspects,
      imageUrls: l.imageUrls,
    }));

    const id = generateId();
    const entry: EbayBackupEntry = {
      id,
      timestamp: Date.now(),
      listing_count: backupListings.length,
      version: new Date().toISOString(),
      user_id: userId,
    };

    // Save to localStorage
    saveBackupData(id, backupListings);
    const index = loadBackupIndex();
    index.unshift(entry);
    saveBackupIndex(index);

    refresh();
    toast.success(`${backupListings.length} ilan yedeklendi`);
  };

  // --- Download backup as JSON file ---
  const handleDownload = (backup: EbayBackupEntry) => {
    const data = loadBackupData(backup.id);
    if (data.length === 0) {
      toast.error('Yedek verisi bulunamadi');
      return;
    }

    const exportData = {
      version: '1.0',
      platform: 'ebay',
      created_at: new Date(backup.timestamp).toISOString(),
      user_id: userId,
      listing_count: data.length,
      listings: data,
    };

    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `ebay_backup_${new Date(backup.timestamp).toISOString().slice(0, 10)}_${data.length}listings.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success('Yedek dosyasi indirildi');
  };

  // --- Download all listings directly ---
  const handleExportAll = () => {
    if (listings.length === 0) {
      toast.error('Indirilecek ilan yok');
      return;
    }

    const exportData = {
      version: '1.0',
      platform: 'ebay',
      created_at: new Date().toISOString(),
      user_id: userId,
      listing_count: listings.length,
      listings: listings.map((l: any) => ({
        sku: l.sku,
        title: l.title || '',
        description: l.description,
        price: l.price,
        quantity: l.quantity,
        condition: l.condition,
        categoryId: l.categoryId,
        categoryName: l.categoryName,
        aspects: l.aspects,
        imageUrls: l.imageUrls,
      })),
    };

    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `ebay_export_${new Date().toISOString().slice(0, 10)}_${listings.length}listings.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success(`${listings.length} ilan JSON olarak indirildi`);
  };

  // --- Import from JSON file ---
  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.listings || !Array.isArray(data.listings)) {
        toast.error('Gecersiz yedek dosyasi: listings alani bulunamadi');
        return;
      }

      if (data.platform && data.platform !== 'ebay') {
        toast.error(`Bu bir ${data.platform} yedegi, eBay yedegi degil`);
        return;
      }

      const importedListings: EbayBackupListing[] = data.listings.map((l: any) => ({
        sku: l.sku || `imported_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: l.title || '',
        description: l.description,
        price: l.price,
        quantity: l.quantity,
        condition: l.condition,
        categoryId: l.categoryId,
        categoryName: l.categoryName,
        aspects: l.aspects,
        imageUrls: l.imageUrls,
      }));

      // Save as a new backup entry
      const id = generateId();
      const entry: EbayBackupEntry = {
        id,
        timestamp: Date.now(),
        listing_count: importedListings.length,
        version: data.version || '1.0',
        user_id: userId,
      };

      saveBackupData(id, importedListings);
      const index = loadBackupIndex();
      index.unshift(entry);
      saveBackupIndex(index);

      refresh();
      toast.success(`${importedListings.length} ilan ice aktarildi ve yedeklendi`);
    } catch (err: any) {
      toast.error(`Dosya okunamadi: ${err.message}`);
    }
  };

  // --- Delete one backup ---
  const handleDeleteOne = (id: string) => {
    deleteBackupData(id);
    const index = loadBackupIndex().filter((b) => b.id !== id);
    saveBackupIndex(index);
    refresh();
    toast.success('Yedek silindi');
  };

  // --- Clear all backups ---
  const handleClearAll = () => {
    const allBackups = loadBackupIndex();
    for (const b of allBackups) {
      deleteBackupData(b.id);
    }
    localStorage.removeItem(STORAGE_KEY);
    setBackups([]);
    toast.success('Tum yedekler temizlendi');
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <BackupIcon sx={{ color: 'info.main' }} />
        <Typography variant="subtitle1" fontWeight={600}>
          Yedek Yonetimi
        </Typography>
        {backups.length > 0 && (
          <Chip label={`${backups.length} yedek`} size="small" color="info" sx={{ ml: 1 }} />
        )}
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Ilanlarinizi JSON olarak yedekleyin, indirin veya daha once olusturulmus yedekten geri yukleyin.
      </Typography>

      {/* Action buttons */}
      <Box sx={{ display: 'flex', gap: 1, mb: 3, flexWrap: 'wrap' }}>
        <Button
          variant="contained"
          size="small"
          startIcon={<BackupIcon />}
          onClick={handleCreateBackup}
          disabled={listings.length === 0}
        >
          Yedek Olustur ({listings.length} ilan)
        </Button>
        <Button
          variant="outlined"
          size="small"
          startIcon={<FileDownloadIcon />}
          onClick={handleExportAll}
          disabled={listings.length === 0}
        >
          JSON Indir
        </Button>
        <Button
          variant="outlined"
          size="small"
          startIcon={<FileUploadIcon />}
          onClick={handleImportClick}
        >
          JSON Ice Aktar
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </Box>

      {/* Import progress */}
      {importing && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary">
            Ice aktarma devam ediyor...
          </Typography>
          <LinearProgress variant="determinate" value={importProgress} sx={{ mt: 0.5 }} />
          <Typography variant="caption" color="text.secondary">
            %{Math.round(importProgress)} tamamlandi
          </Typography>
        </Box>
      )}

      {/* Backup history */}
      {backups.length === 0 ? (
        <Alert severity="info">
          Henuz yedek bulunmuyor. Ilanlarinizi yedeklemek icin yukardaki butonu kullanin.
        </Alert>
      ) : (
        <>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Yedek Gecmisi
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Tarih</TableCell>
                  <TableCell>Ilan Sayisi</TableCell>
                  <TableCell>Surum</TableCell>
                  <TableCell align="right">Islem</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {backups.map((backup) => (
                  <TableRow key={backup.id}>
                    <TableCell>
                      <Typography variant="body2">{formatDate(backup.timestamp)}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={`${backup.listing_count} ilan`}
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(backup.timestamp).toISOString().slice(0, 19).replace('T', ' ')}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                        <Tooltip title="JSON Indir">
                          <IconButton
                            size="small"
                            color="primary"
                            onClick={() => handleDownload(backup)}
                          >
                            <FileDownloadIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('delete')}>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDeleteOne(backup.id)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Clear all button */}
          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              color="error"
              size="small"
              onClick={handleClearAll}
              startIcon={<DeleteSweepIcon />}
            >
              Tum Yedekleri Temizle
            </Button>
          </Box>
        </>
      )}
    </Box>
  );
}
