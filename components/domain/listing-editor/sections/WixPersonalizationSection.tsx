// components/domain/listing-editor/sections/WixPersonalizationSection.tsx — M6b-D: Wix "Personalization"
// (marketplace-editors §3 row 7, §4.2): custom text fields the buyer fills in (title, max length, required).
// Up to two, as the current Wix UI allows. Mobile: summary + full-height sheet. Only `setField('customTextFields')`.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page/Section';
import { Button, Checkbox, FormField, IconButton, NumberField, TextField } from '@/components/ds/inputs';
import { icons } from '@/lib/ds/icons';
import { neutral, tone } from '@/lib/ds/tokens';
import { fieldAnchorId, sectionAnchorId } from '@/lib/listingEditor/sections';
import type { FieldIssue, ListingSectionProps } from '@/lib/listingEditor/types';
import { LIMITS, type WixCustomTextField } from '@/lib/catalogDrafts/schemas';
import { useRegisterDraftSection } from '../useListingDraft';
import { MobileEditSheet, decodeTextFields, encodeTextFields, useCatalogSection } from './marketplaceSectionShared';

/** Wix Stores shows at most two custom text fields per product. */
export const WIX_TEXT_FIELDS_MAX = Math.min(2, LIMITS.wixTextFields);
const DEFAULT_MAX_LENGTH = 50;

/** Text fields with an empty title (Wix refuses them). Pure. */
export function untitledTextFields(list: WixCustomTextField[]): number[] {
  return list.map((f, i) => (f.title.trim() ? -1 : i)).filter((i) => i >= 0);
}

export function WixPersonalizationSection({ id = 'personalization' }: Partial<ListingSectionProps>) {
  const t = useTranslations('listingEditor');
  const { f, ro, errorFor, dirty, set, revert } = useCatalogSection();
  const list = React.useMemo(() => decodeTextFields(f.customTextFields), [f.customTextFields]);
  const write = (next: WixCustomTextField[]) => set('customTextFields', encodeTextFields(next));
  const update = (i: number, patch: Partial<WixCustomTextField>) => write(list.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const untitled = untitledTextFields(list);
  useRegisterDraftSection({
    id: 'personalization',
    key: 'personalization:wix',
    isDirty: () => false,
    stage: async () => undefined,
    validate: (): FieldIssue[] =>
      untitled.length ? [{ field: 'customTextFields', section: 'personalization', severity: 'block_sync', key: 'listingEditor.wix.textFieldTitleRequired' }] : [],
  });

  const summary = list.length
    ? [t('wix.textFields', { count: list.length }), ...list.map((x) => `"${x.title}"`)].join(' · ')
    : t('personalization.off');

  const editor = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: 720 }}>
      {list.map((x, i) => (
        <Box key={i} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 120px auto auto' }, gap: '12px', alignItems: 'end' }} data-testid="le-wix-text-field">
          <FormField
            label={t('wix.textFieldTitle', { index: i + 1 })}
            htmlFor={fieldAnchorId(`customTextFields.${i}.title`)}
            error={untitled.includes(i) ? t('wix.textFieldTitleRequired') : null}
          >
            <TextField
              id={fieldAnchorId(`customTextFields.${i}.title`)}
              value={x.title}
              placeholder={t('wix.textFieldPlaceholder')}
              onChange={(v) => update(i, { title: v })}
              maxLength={LIMITS.wixTextFieldTitle}
              readOnly={ro}
            />
          </FormField>
          <FormField label={t('personalization.charLimit')} htmlFor={fieldAnchorId(`customTextFields.${i}.maxLength`)}>
            <NumberField
              id={fieldAnchorId(`customTextFields.${i}.maxLength`)}
              value={x.maxLength || null}
              onChange={(n) => update(i, { maxLength: n === null ? 0 : Math.max(1, Math.min(LIMITS.wixTextFieldMaxLength, Math.round(n))) })}
              min={1}
              max={LIMITS.wixTextFieldMaxLength}
              decimals={0}
              readOnly={ro}
            />
          </FormField>
          <Box sx={{ pb: '6px' }}>
            <Checkbox checked={x.mandatory} onChange={(c) => update(i, { mandatory: c })} label={t('personalization.required')} disabled={ro} />
          </Box>
          <Box sx={{ pb: '2px' }}>
            <IconButton icon={icons.delete} label={t('wix.removeTextField', { index: i + 1 })} onClick={() => write(list.filter((_, j) => j !== i))} disabled={ro} />
          </Box>
        </Box>
      ))}
      {list.length === 0 ? <Box sx={{ color: neutral[600], fontSize: 14 }}>{t('wix.textFieldsHelp')}</Box> : null}
      {!ro && list.length < WIX_TEXT_FIELDS_MAX ? (
        <Box>
          <Button variant="secondary" size="sm" icon={icons.add} onClick={() => write([...list, { title: '', maxLength: DEFAULT_MAX_LENGTH, mandatory: false }])} data-testid="le-wix-add-text-field">
            {t('wix.addTextField')}
          </Button>
        </Box>
      ) : list.length >= WIX_TEXT_FIELDS_MAX ? (
        <Box sx={{ color: neutral[600], fontSize: 13 }}>{t('wix.textFieldsMax', { max: WIX_TEXT_FIELDS_MAX })}</Box>
      ) : null}
    </Box>
  );

  return (
    <Section id={sectionAnchorId(id)} title={t('section.personalization')} variant="plain" data-testid="le-section-personalization">
      <Box id={fieldAnchorId('customTextFields')} sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {errorFor('customTextFields') && !untitled.length ? <Box sx={{ color: tone.danger.fg, fontSize: 13 }}>{errorFor('customTextFields')}</Box> : null}
        {dirty('customTextFields') && !ro ? (
          <Box>
            <Button variant="ghost" size="sm" icon={icons.revert} onClick={() => revert('customTextFields')}>{t('common.revertAll')}</Button>
          </Box>
        ) : null}
        <MobileEditSheet title={t('section.personalization')} summary={summary} keys={['customTextFields']} disabled={ro} data-testid="le-wix-text-fields-sheet">
          {editor}
        </MobileEditSheet>
      </Box>
    </Section>
  );
}
