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
import { useTranslations } from 'next-intl';
import { icons, ICON_STROKE } from '@/lib/ds/icons';
import { tone as dsTone } from '@/lib/ds/tokens';
import {
  FormField,
  Combobox,
  TextField as DsTextField,
  TagInput,
  Button as DsButton,
  IconButton as DsIconButton,
  type ComboboxOption,
} from '@/components/ds/inputs';
import { ASPECT_NAME_MAX, ASPECT_VALUE_MAX } from '@/lib/ebay/payloadRules';

export interface AspectMetadata {
  localizedAspectName: string;
  aspectConstraint: {
    aspectRequired: boolean;
    aspectMode: 'FREE_TEXT' | 'SELECTION_ONLY';
    aspectValues?: { localizedValue: string }[];
  };
}

export interface ItemSpecificsEditorProps {
  aspects: Record<string, string[]>;
  requiredAspects: AspectMetadata[];
  recommendedAspects: AspectMetadata[];
  onChange: (aspects: Record<string, string[]>) => void;
  /** If provided, enables AI auto-fill button (legacy only; embedded AI goes through proposals in SpecificsSection). */
  onAIFill?: (aspectNames: string[], currentAspects: Record<string, string[]>) => Promise<Record<string, string[]> | null>;
  aiLoading?: boolean;
  /** listing-editor: DS inputs (Combobox / TextField / TagInput), grouped Required · Recommended · Your own. */
  embedded?: boolean;
  /** Embedded: aspect names that differ from the live listing (dirty marker + Revert). */
  dirtyNames?: string[];
  onRevertAspect?: (name: string) => void;
  /** Embedded: send-time errors per aspect name (already translated). */
  errors?: Record<string, string>;
  /** Embedded: aspects to highlight (ScorePanel "fill required specifics" fix). */
  disabled?: boolean;
}

/** Filled = at least one non-blank value. */
export function isAspectFilled(values: string[] | undefined): boolean {
  return Array.isArray(values) && values.some((v) => String(v).trim() !== '');
}

/** Required aspect names without a value (score check `aspects_required`, send-time validation). */
export function missingRequiredAspects(aspects: Record<string, string[]>, required: AspectMetadata[]): string[] {
  return required.map((a) => a.localizedAspectName).filter((name) => !isAspectFilled(aspects[name]));
}

/** Sets one aspect; empty values remove the key (legacy rule: eBay rejects empty values, 25719). */
export function setAspectValues(aspects: Record<string, string[]>, name: string, values: string[]): Record<string, string[]> {
  const cleaned = values.map((v) => String(v)).filter((v) => v.trim() !== '');
  const next = { ...aspects };
  if (cleaned.length === 0) delete next[name];
  else next[name] = cleaned;
  return next;
}

const REQUIRED_MARK = '*';

export default function ItemSpecificsEditor(props: ItemSpecificsEditorProps) {
  if (props.embedded) return <EmbeddedItemSpecifics {...props} />;
  return <LegacyItemSpecificsEditor {...props} />;
}

function LegacyItemSpecificsEditor({
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
                      {isRequired && <span style={{ color: '#ef4444', marginLeft: 2 }}>{REQUIRED_MARK}</span>}
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
            <Box component="span" sx={{ color: dsTone.success.fg, mt: 1, display: 'inline-flex' }}><icons.done size={20} strokeWidth={ICON_STROKE} /></Box>
          ) : isRequired ? (
            <Box component="span" sx={{ color: dsTone.danger.fg, mt: 1, display: 'inline-flex' }}><icons.warning size={20} strokeWidth={ICON_STROKE} /></Box>
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
                      {isRequired && <span style={{ color: '#ef4444', marginLeft: 2 }}>{REQUIRED_MARK}</span>}
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
            <Box component="span" sx={{ color: dsTone.success.fg, mt: 1, display: 'inline-flex' }}><icons.done size={20} strokeWidth={ICON_STROKE} /></Box>
          ) : isRequired ? (
            <Box component="span" sx={{ color: dsTone.danger.fg, mt: 1, display: 'inline-flex' }}><icons.warning size={20} strokeWidth={ICON_STROKE} /></Box>
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
              {isRequired && <span style={{ color: '#ef4444', marginLeft: 2 }}>{REQUIRED_MARK}</span>}
            </span>
          }
          value={currentValues[0] || ''}
          onChange={(e) => updateAspect(name, e.target.value ? [e.target.value] : [])}
          size="small"
          fullWidth
        />
        {isFilled ? (
          <Box component="span" sx={{ color: dsTone.success.fg, mt: 1, display: 'inline-flex' }}><icons.done size={20} strokeWidth={ICON_STROKE} /></Box>
        ) : isRequired ? (
          <Box component="span" sx={{ color: dsTone.danger.fg, mt: 1, display: 'inline-flex' }}><icons.warning size={20} strokeWidth={ICON_STROKE} /></Box>
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
              startIcon={aiLoading ? <CircularProgress size={14} /> : <icons.ai size={16} strokeWidth={ICON_STROKE} />}
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
              sx={{ fontSize: '0.85rem', py: 0.75 }}
            >
              {t('aiFill')}
            </Button>
          )}
          <Chip
            label={t('aspectsFilled', { filled: filledAspects, total: totalAspects })}
            size="small"
            color={filledAspects === totalAspects ? 'success' : filledAspects > 0 ? 'warning' : 'default'}
            sx={{ height: 26, fontSize: '0.85rem' }}
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
                  <icons.delete size={16} strokeWidth={ICON_STROKE} />
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
          startIcon={<icons.add size={16} strokeWidth={ICON_STROKE} />}
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

// ─── Embedded mode (listing editor, DS inputs) ───────────────────────────────

function toOptions(values: string[]): ComboboxOption[] {
  return values.map((v) => ({ value: v, label: v }));
}

function EmbeddedItemSpecifics({
  aspects, requiredAspects, recommendedAspects, onChange, dirtyNames, onRevertAspect, errors, disabled,
}: ItemSpecificsEditorProps) {
  const t = useTranslations('listingEditor.specifics');
  const [customKey, setCustomKey] = useState('');
  const [customValue, setCustomValue] = useState('');

  const knownNames = useMemo(() => {
    const names = new Set<string>();
    requiredAspects.forEach((a) => names.add(a.localizedAspectName));
    recommendedAspects.forEach((a) => names.add(a.localizedAspectName));
    return names;
  }, [requiredAspects, recommendedAspects]);
  const customNames = useMemo(() => Object.keys(aspects).filter((name) => !knownNames.has(name)), [aspects, knownNames]);
  const total = requiredAspects.length + recommendedAspects.length + customNames.length;
  const filled = Object.keys(aspects).filter((k) => isAspectFilled(aspects[k])).length;
  const dirtySet = new Set(dirtyNames || []);

  const update = (name: string, values: string[]) => onChange(setAspectValues(aspects, name, values));
  const tooLong = (values: string[]) => values.some((v) => v.trim().length > ASPECT_VALUE_MAX);

  const renderAspect = (meta: AspectMetadata) => {
    const name = meta.localizedAspectName;
    const required = meta.aspectConstraint.aspectRequired;
    const selectionOnly = meta.aspectConstraint.aspectMode === 'SELECTION_ONLY';
    const predefined = meta.aspectConstraint.aspectValues?.map((v) => v.localizedValue) || [];
    const current = aspects[name] || [];
    const error = errors?.[name] ?? (tooLong(current) ? t('tooLong', { max: ASPECT_VALUE_MAX }) : null);
    return (
      <FormField
        key={name}
        label={name}
        required={required}
        optional={!required}
        dirty={dirtySet.has(name)}
        onRevert={onRevertAspect ? () => onRevertAspect(name) : undefined}
        error={error}
        data-testid={`aspect-${name}`}
      >
        {selectionOnly || predefined.length > 0 ? (
          <Combobox
            multiple
            options={toOptions(predefined)}
            value={toOptions(current)}
            onChange={(opts) => update(name, opts.map((o) => o.value))}
            creatable={!selectionOnly}
            placeholder={selectionOnly ? t('chooseValue') : t('typeOrChoose')}
            disabled={disabled}
          />
        ) : (
          <DsTextField
            value={current[0] || ''}
            onChange={(v) => update(name, v ? [v] : [])}
            maxLength={ASPECT_VALUE_MAX}
            disabled={disabled}
          />
        )}
      </FormField>
    );
  };

  const addCustom = () => {
    const key = customKey.trim().slice(0, ASPECT_NAME_MAX);
    const value = customValue.trim();
    if (!key || !value) return;
    update(key, [...(aspects[key] || []), value]);
    setCustomKey('');
    setCustomValue('');
  };

  const groupTitle = (text: string) => (
    <Typography variant="body2" component="h3" sx={{ m: 0, fontWeight: 600 }}>{text}</Typography>
  );

  return (
    <Box data-testid="item-specifics-embedded" sx={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: 720 }}>
      <Typography variant="caption" component="p" sx={{ m: 0 }} data-testid="item-specifics-count">
        {t('filled', { filled, total })}
      </Typography>
      {requiredAspects.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {groupTitle(t('required'))}
          {requiredAspects.map(renderAspect)}
        </Box>
      )}
      {recommendedAspects.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {groupTitle(t('recommended'))}
          {recommendedAspects.map(renderAspect)}
        </Box>
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {groupTitle(t('custom'))}
        {customNames.map((name) => (
          <Box key={name} sx={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <FormField
                label={name}
                dirty={dirtySet.has(name)}
                onRevert={onRevertAspect ? () => onRevertAspect(name) : undefined}
                error={errors?.[name] ?? null}
              >
                <TagInput
                  value={aspects[name] || []}
                  onChange={(values) => update(name, values)}
                  maxLength={ASPECT_VALUE_MAX}
                  placeholder={t('valuePlaceholder')}
                  disabled={disabled}
                />
              </FormField>
            </Box>
            <Box sx={{ pt: '24px' }}>
              <DsIconButton icon={icons.delete} label={t('remove', { name })} tone="danger" disabled={disabled} onClick={() => update(name, [])} />
            </Box>
          </Box>
        ))}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr auto' }, gap: '12px', alignItems: 'end' }}>
          <FormField label={t('name')} counter={customKey ? { value: customKey.length, max: ASPECT_NAME_MAX } : undefined}>
            <DsTextField value={customKey} onChange={setCustomKey} maxLength={ASPECT_NAME_MAX} disabled={disabled} />
          </FormField>
          <FormField label={t('value')} counter={customValue ? { value: customValue.length, max: ASPECT_VALUE_MAX } : undefined}>
            <DsTextField
              value={customValue}
              onChange={setCustomValue}
              maxLength={ASPECT_VALUE_MAX}
              disabled={disabled}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
            />
          </FormField>
          <DsButton
            variant="secondary"
            icon={icons.add}
            onClick={addCustom}
            disabled={disabled || !customKey.trim() || !customValue.trim()}
            disabledReason={!customKey.trim() || !customValue.trim() ? t('addNeedsBoth') : undefined}
          >
            {t('add')}
          </DsButton>
        </Box>
      </Box>
    </Box>
  );
}
