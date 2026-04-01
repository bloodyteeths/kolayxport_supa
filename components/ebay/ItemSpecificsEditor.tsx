import React, { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  TextField,
  Autocomplete,
  Chip,
  IconButton,
  Button,
  Divider,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { useTranslations } from 'next-intl';

interface AspectMetadata {
  localizedAspectName: string;
  aspectConstraint: {
    aspectRequired: boolean;
    aspectMode: 'FREE_TEXT' | 'SELECTION_ONLY';
    aspectValues?: { localizedValue: string }[];
  };
}

interface ItemSpecificsEditorProps {
  aspects: Record<string, string[]>;
  requiredAspects: AspectMetadata[];
  recommendedAspects: AspectMetadata[];
  onChange: (aspects: Record<string, string[]>) => void;
  /** If provided, enables AI auto-fill button */
  onAIFill?: (aspectNames: string[], currentAspects: Record<string, string[]>) => Promise<Record<string, string[]> | null>;
  aiLoading?: boolean;
}

export default function ItemSpecificsEditor({
  aspects,
  requiredAspects,
  recommendedAspects,
  onChange,
  onAIFill,
  aiLoading,
}: ItemSpecificsEditorProps) {
  const t = useTranslations('ebay.listing');
  const [customKey, setCustomKey] = useState('');
  const [customValue, setCustomValue] = useState('');

  // Determine which aspect names are from required/recommended
  const knownAspectNames = useMemo(() => {
    const names = new Set<string>();
    requiredAspects.forEach((a) => names.add(a.localizedAspectName));
    recommendedAspects.forEach((a) => names.add(a.localizedAspectName));
    return names;
  }, [requiredAspects, recommendedAspects]);

  // Custom aspects = aspects not in required or recommended
  const customAspectNames = useMemo(() => {
    return Object.keys(aspects).filter((name) => !knownAspectNames.has(name));
  }, [aspects, knownAspectNames]);

  // Stats
  const totalAspects = requiredAspects.length + recommendedAspects.length + customAspectNames.length;
  const filledAspects = Object.keys(aspects).filter(
    (key) => aspects[key] && aspects[key].length > 0 && aspects[key].some((v) => v.trim() !== '')
  ).length;

  const updateAspect = (name: string, values: string[]) => {
    const updated = { ...aspects, [name]: values };
    if (values.length === 0 || (values.length === 1 && values[0] === '')) {
      delete updated[name];
    }
    onChange(updated);
  };

  const deleteAspect = (name: string) => {
    const updated = { ...aspects };
    delete updated[name];
    onChange(updated);
  };

  const handleAddCustom = () => {
    const key = customKey.trim();
    const value = customValue.trim();
    if (!key) return;
    if (!value) return;

    const existing = aspects[key] || [];
    updateAspect(key, [...existing, value]);
    setCustomKey('');
    setCustomValue('');
  };

  const renderAspectField = (meta: AspectMetadata) => {
    const name = meta.localizedAspectName;
    const isRequired = meta.aspectConstraint.aspectRequired;
    const isSelection = meta.aspectConstraint.aspectMode === 'SELECTION_ONLY';
    const predefinedValues = meta.aspectConstraint.aspectValues?.map((v) => v.localizedValue) || [];
    const currentValues = aspects[name] || [];
    const isFilled = currentValues.length > 0 && currentValues.some((v) => v.trim() !== '');

    if (isSelection) {
      return (
        <Box key={name} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          <Box sx={{ flex: 1 }}>
            <Autocomplete
              multiple
              freeSolo={false}
              options={predefinedValues}
              value={currentValues}
              onChange={(_, newValue) => updateAspect(name, newValue)}
              renderTags={(value, getTagProps) =>
                value.map((v, i) => (
                  <Chip {...getTagProps({ index: i })} key={v} label={v} size="small" />
                ))
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={
                    <span>
                      {name}
                      {isRequired && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}
                    </span>
                  }
                  size="small"
                />
              )}
              size="small"
              slotProps={{ popper: { style: { zIndex: 1600 } } }}
            />
          </Box>
          {isFilled ? (
            <CheckCircleIcon sx={{ color: '#22c55e', mt: 1, fontSize: 20 }} />
          ) : isRequired ? (
            <WarningIcon sx={{ color: '#ef4444', mt: 1, fontSize: 20 }} />
          ) : null}
        </Box>
      );
    }

    // FREE_TEXT mode
    if (predefinedValues.length > 0) {
      return (
        <Box key={name} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          <Box sx={{ flex: 1 }}>
            <Autocomplete
              multiple
              freeSolo
              options={predefinedValues}
              value={currentValues}
              onChange={(_, newValue) => updateAspect(name, newValue as string[])}
              renderTags={(value, getTagProps) =>
                value.map((v, i) => (
                  <Chip {...getTagProps({ index: i })} key={v} label={v} size="small" />
                ))
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={
                    <span>
                      {name}
                      {isRequired && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}
                    </span>
                  }
                  size="small"
                  placeholder={t('enterOrSelectValue')}
                />
              )}
              size="small"
              slotProps={{ popper: { style: { zIndex: 1600 } } }}
            />
          </Box>
          {isFilled ? (
            <CheckCircleIcon sx={{ color: '#22c55e', mt: 1, fontSize: 20 }} />
          ) : isRequired ? (
            <WarningIcon sx={{ color: '#ef4444', mt: 1, fontSize: 20 }} />
          ) : null}
        </Box>
      );
    }

    // Pure free text, no suggestions
    return (
      <Box key={name} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <TextField
          label={
            <span>
              {name}
              {isRequired && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}
            </span>
          }
          value={currentValues[0] || ''}
          onChange={(e) => updateAspect(name, e.target.value ? [e.target.value] : [])}
          size="small"
          fullWidth
        />
        {isFilled ? (
          <CheckCircleIcon sx={{ color: '#22c55e', mt: 1, fontSize: 20 }} />
        ) : isRequired ? (
          <WarningIcon sx={{ color: '#ef4444', mt: 1, fontSize: 20 }} />
        ) : null}
      </Box>
    );
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Count display + AI fill */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="body2" fontWeight={600}>
          {t('itemSpecifics')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          {onAIFill && (
            <Button
              size="small"
              variant="outlined"
              startIcon={aiLoading ? <CircularProgress size={14} /> : <AutoFixHighIcon />}
              disabled={aiLoading || (requiredAspects.length === 0 && recommendedAspects.length === 0)}
              onClick={async () => {
                const allNames = [
                  ...requiredAspects.map(a => a.localizedAspectName),
                  ...recommendedAspects.map(a => a.localizedAspectName),
                ];
                const result = await onAIFill(allNames, aspects);
                if (result) {
                  onChange({ ...aspects, ...result });
                }
              }}
              sx={{ fontSize: '0.7rem', py: 0.75 }}
            >
              {t('aiFill')}
            </Button>
          )}
          <Chip
            label={t('aspectsFilled', { filled: filledAspects, total: totalAspects })}
            size="small"
            color={filledAspects === totalAspects ? 'success' : filledAspects > 0 ? 'warning' : 'default'}
            sx={{ height: 22, fontSize: '0.75rem' }}
          />
        </Box>
      </Box>

      {/* Required aspects */}
      {requiredAspects.length > 0 && (
        <>
          <Typography variant="caption" fontWeight={600} color="error.main" sx={{ mt: 0.5 }}>
            {t('requiredAspects')}
          </Typography>
          {requiredAspects.map(renderAspectField)}
        </>
      )}

      {/* Recommended aspects */}
      {recommendedAspects.length > 0 && (
        <>
          <Divider sx={{ my: 0.5 }} />
          <Typography variant="caption" fontWeight={600} color="text.secondary">
            {t('recommendedAspects')}
          </Typography>
          {recommendedAspects.map(renderAspectField)}
        </>
      )}

      {/* Custom aspects */}
      {customAspectNames.length > 0 && (
        <>
          <Divider sx={{ my: 0.5 }} />
          <Typography variant="caption" fontWeight={600} color="text.secondary">
            {t('customAspects')}
          </Typography>
          {customAspectNames.map((name) => (
            <Box key={name} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <TextField
                label={name}
                value={(aspects[name] || []).join(', ')}
                onChange={(e) =>
                  updateAspect(
                    name,
                    e.target.value
                      .split(',')
                      .map((v) => v.trim())
                      .filter((v) => v)
                  )
                }
                size="small"
                fullWidth
              />
              <Tooltip title={t('deleteAspect')}>
                <IconButton size="small" color="error" onClick={() => deleteAspect(name)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          ))}
        </>
      )}

      {/* Add custom aspect */}
      <Divider sx={{ my: 0.5 }} />
      <Typography variant="caption" fontWeight={600} color="text.secondary">
        {t('addCustomAspect')}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexDirection: { xs: 'column', sm: 'row' } }}>
        <TextField
          label={t('aspectName')}
          value={customKey}
          onChange={(e) => setCustomKey(e.target.value)}
          size="small"
          sx={{ flex: 1, width: { xs: '100%', sm: 'auto' } }}
        />
        <TextField
          label={t('aspectValue')}
          value={customValue}
          onChange={(e) => setCustomValue(e.target.value)}
          size="small"
          sx={{ flex: 1, width: { xs: '100%', sm: 'auto' } }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAddCustom();
          }}
        />
        <Button
          variant="outlined"
          size="small"
          startIcon={<AddIcon />}
          onClick={handleAddCustom}
          disabled={!customKey.trim() || !customValue.trim()}
          sx={{ minWidth: 80, mt: 0.25, width: { xs: '100%', sm: 'auto' } }}
        >
          {t('add')}
        </Button>
      </Box>
    </Box>
  );
}
