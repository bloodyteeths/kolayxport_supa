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
import { useTranslations } from 'next-intl';
import { FormField, Select as DsSelect, TextArea } from '@/components/ds/inputs';
import { UNIVERSAL_CONDITIONS } from '@/lib/ebay/payloadRules';

interface ConditionOption {
  conditionId: string;
  conditionDescription?: string;
}

export interface ConditionSelectorProps {
  condition: string;
  conditionDescription: string;
  categoryConditions?: ConditionOption[];
  onChange: (condition: string, description: string) => void;
  /** listing-editor: DS FormField + Select + TextArea (labels above, counter, dirty marker), no MUI. */
  embedded?: boolean;
  /** Embedded: draws the FormField dirty marker + "Changed · Revert" on each field. */
  dirty?: { condition?: boolean; description?: boolean };
  onRevert?: { condition?: () => void; description?: () => void };
  /** Embedded: inline errors (already translated), e.g. from the send-time validation. */
  error?: { condition?: string | null; description?: string | null };
  disabled?: boolean;
}

/** eBay caps the condition description at 1000 characters. */
export const CONDITION_DESCRIPTION_MAX = 1000;

/**
 * eBay's Inventory API ConditionEnum. The used grades are prefixed USED_ — the
 * bare VERY_GOOD / GOOD / ACCEPTABLE we used to send are not valid values and
 * eBay rejected the whole request with "Could not serialize field [condition]".
 */
const CONDITION_KEYS: Record<string, string> = {
  NEW: 'conditionNew',
  LIKE_NEW: 'conditionLikeNew',
  NEW_OTHER: 'conditionNewOther',
  USED_EXCELLENT: 'conditionUsedExcellent',
  USED_VERY_GOOD: 'conditionUsedVeryGood',
  USED_GOOD: 'conditionUsedGood',
  USED_ACCEPTABLE: 'conditionUsedAcceptable',
  FOR_PARTS_OR_NOT_WORKING: 'conditionForParts',
};

export default function ConditionSelector({
  condition,
  conditionDescription,
  categoryConditions,
  onChange,
  embedded,
  dirty,
  onRevert,
  error,
  disabled,
}: ConditionSelectorProps) {
  const t = useTranslations('ebay.listing');
  const tLe = useTranslations('listingEditor.condition');

  function getConditionLabel(value: string): string {
    const key = CONDITION_KEYS[value];
    return key ? t(key) : value;
  }

  /**
   * eBay's condition-policy endpoint returns nothing for most categories, yet the
   * publish still enforces one. Verified against a model-car category: NEW and
   * USED_EXCELLENT publish, while LIKE_NEW and the graded USED_VERY_GOOD /
   * USED_GOOD / USED_ACCEPTABLE are rejected — those are media-only grades. So
   * default to the set that works everywhere and let an explicit category list
   * widen it.
   */
  // UNIVERSAL_CONDITIONS lives in lib/ebay/payloadRules (the AI fill validates its proposal against the same set).
  const DEFAULT_CONDITIONS = UNIVERSAL_CONDITIONS.map((value) => ({
    value,
    label: t(CONDITION_KEYS[value]),
  }));

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

  if (embedded) {
    // A stored value eBay no longer lists for this category stays selectable, so the field never shows blank.
    const options = conditions.some((c) => c.value === condition) || !condition
      ? conditions
      : [{ value: condition, label: getConditionLabel(condition) }, ...conditions];
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }} data-testid="condition-selector-embedded">
        <FormField
          label={tLe('label')}
          width="medium"
          required
          dirty={dirty?.condition}
          onRevert={onRevert?.condition}
          error={error?.condition ?? null}
        >
          <DsSelect<string>
            value={condition || null}
            onChange={(next) => onChange(next, next === 'NEW' ? '' : conditionDescription)}
            options={options}
            placeholder={tLe('placeholder')}
            disabled={disabled}
          />
        </FormField>
        {condition && condition !== 'NEW' && (
          <FormField
            label={tLe('description')}
            optional
            helper={tLe('descriptionHelp')}
            counter={{ value: conditionDescription.length, max: CONDITION_DESCRIPTION_MAX }}
            dirty={dirty?.description}
            onRevert={onRevert?.description}
            error={error?.description ?? null}
          >
            <TextArea
              value={conditionDescription}
              onChange={(v) => onChange(condition, v)}
              minRows={2}
              maxRows={8}
              maxLength={CONDITION_DESCRIPTION_MAX}
              placeholder={tLe('descriptionPlaceholder')}
              disabled={disabled}
            />
          </FormField>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <FormControl size="small" fullWidth>
        <InputLabel>{t('productCondition')}</InputLabel>
        <Select
          value={condition}
          label={t('productCondition')}
          onChange={handleConditionChange}
          MenuProps={{ sx: { zIndex: 1600 } }}
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
          label={t('conditionDescription')}
          value={conditionDescription}
          onChange={handleDescriptionChange}
          size="small"
          fullWidth
          multiline
          rows={2}
          placeholder={t('conditionDescriptionPlaceholder')}
          helperText={t('conditionDescriptionHelper')}
        />
      )}
    </Box>
  );
}
