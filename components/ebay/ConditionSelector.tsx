import React from 'react';
import {
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';

interface ConditionOption {
  conditionId: string;
  conditionDescription?: string;
}

interface ConditionSelectorProps {
  condition: string;
  conditionDescription: string;
  categoryConditions?: ConditionOption[];
  onChange: (condition: string, description: string) => void;
}

const DEFAULT_CONDITIONS: { value: string; label: string }[] = [
  { value: 'NEW', label: 'Yeni' },
  { value: 'LIKE_NEW', label: 'Yeni Gibi' },
  { value: 'VERY_GOOD', label: 'Çok İyi' },
  { value: 'GOOD', label: 'İyi' },
  { value: 'ACCEPTABLE', label: 'Kabul Edilebilir' },
  { value: 'FOR_PARTS_OR_NOT_WORKING', label: 'Parça/Çalışmıyor' },
];

function getConditionLabel(value: string): string {
  const found = DEFAULT_CONDITIONS.find((c) => c.value === value);
  return found ? found.label : value;
}

export default function ConditionSelector({
  condition,
  conditionDescription,
  categoryConditions,
  onChange,
}: ConditionSelectorProps) {
  // Use category-specific conditions if provided, otherwise defaults
  const conditions = categoryConditions && categoryConditions.length > 0
    ? categoryConditions.map((cc) => ({
        value: cc.conditionId,
        label: getConditionLabel(cc.conditionId),
      }))
    : DEFAULT_CONDITIONS;

  const handleConditionChange = (e: SelectChangeEvent) => {
    const newCondition = e.target.value;
    // Clear description when switching to NEW
    const newDesc = newCondition === 'NEW' ? '' : conditionDescription;
    onChange(newCondition, newDesc);
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(condition, e.target.value);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <FormControl size="small" fullWidth>
        <InputLabel>Ürün Durumu</InputLabel>
        <Select
          value={condition}
          label="Ürün Durumu"
          onChange={handleConditionChange}
        >
          {conditions.map((c) => (
            <MenuItem key={c.value} value={c.value}>
              {c.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {condition && condition !== 'NEW' && (
        <TextField
          label="Durum Açıklaması"
          value={conditionDescription}
          onChange={handleDescriptionChange}
          size="small"
          fullWidth
          multiline
          rows={2}
          placeholder="Ürünün durumunu detaylı açıklayın..."
          helperText="Alıcıların ürünün durumunu anlamasına yardımcı olur"
        />
      )}
    </Box>
  );
}
