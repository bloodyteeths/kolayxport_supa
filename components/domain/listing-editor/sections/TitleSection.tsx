// components/domain/listing-editor/sections/TitleSection.tsx — listing-editor §2.1 #2 "Title & description" (Etsy).
// Title (140, Title Case / commas helper, "'blanket' repeats in 2 tags"), description with Edit | Preview that
// auto-grows with its text (the page scrolls, never a box inside it); the title is a 2-line auto-growing box, word count, inline AI proposals (never silent; Use writes
// the field, a 6s toast offers Undo; nothing is sent to Etsy). Text is shown entity-decoded ("one's", never
// "one&#39;s"), so every edit stages decoded text.
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page/Section';
import { Button, FieldSuggestion, FormField, TextArea } from '@/components/ds/inputs';
import { useToast } from '@/components/ds/feedback/toast';
import { icons } from '@/lib/ds/icons';
import { neutral } from '@/lib/ds/tokens';
import { TITLE_MAX } from '@/lib/etsy/seoRules';
import { sectionAnchorId } from '@/lib/listingEditor/sections';
import type { ListingSectionProps } from '@/lib/listingEditor/types';
import { DESCRIPTION_MAX, displayText, displayList, fieldDomId, titleTagRepeats, wordCount } from './etsyShared';
import { useEtsySection, useFieldError } from './useEtsySection';
import type { FieldAiState } from './sectionTypes';
import { DESCRIPTION_MAX_ROWS, DESCRIPTION_MIN_ROWS, TitleInput } from './TitleInput';

export interface TitleSectionProps extends Partial<ListingSectionProps> {
  /** "✦ Suggest a title" (useListingAI `optimize_title`, already `normalizeTitle`d). Omit to hide the action. */
  aiTitle?: FieldAiState<string>;
  /** "✦ Write description" (useListingAI `generate_description`). */
  aiDescription?: FieldAiState<string>;
}

/** Etsy shows descriptions as plain text with line breaks (no HTML). */
const renderPlain = (value: string) => value || ' ';

export function TitleSection({ id = 'title', aiTitle, aiDescription }: TitleSectionProps) {
  const t = useTranslations('listingEditor');
  const toast = useToast();
  const api = useEtsySection();
  const errorFor = useFieldError(api);

  const title = displayText(api.fields.title);
  const description = displayText(api.fields.description);
  const repeats = titleTagRepeats(title, displayList(api.fields.tags));
  const words = wordCount(description);

  const use = (key: 'title' | 'description', value: string, done: () => void) => {
    const previous = key === 'title' ? title : description;
    api.setField(key, value);
    done();
    toast.success(t('ai.replaced', { field: t(key === 'title' ? 'field.title' : 'field.description') }), {
      undo: () => api.setField(key, previous),
      undoLabel: t('banner.undo'),
    });
  };

  const aiButton = (state: FieldAiState<string> | undefined, label: string) =>
    state && !api.readOnly ? (
      <Button variant="ghost" size="sm" icon={icons.ai} onClick={state.run} loading={state.loading} loadingLabel={t('ai.writing')}>
        {label}
      </Button>
    ) : null;

  const helper = (
    <Box component="span" sx={{ display: 'flex', flexDirection: 'column' }}>
      <span>{t('field.titleHelperEtsy')}</span>
      {repeats ? <span>{t('field.titleRepeats', { word: repeats.word, count: repeats.count })}</span> : null}
    </Box>
  );

  return (
    <Section id={sectionAnchorId(id)} title={t('section.title')} variant="plain" data-testid="le-section-title">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: 720 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <FormField
            label={t('field.title')}
            htmlFor={fieldDomId('title')}
            counter={{ value: title.length, max: TITLE_MAX }}
            helper={helper}
            error={errorFor('title')}
            dirty={api.isDirty('title')}
            onRevert={() => api.revert('title')}
            labelAction={aiButton(aiTitle, t('ai.suggestTitle'))}
            required
          >
            <TitleInput
              id={fieldDomId('title')}
              value={title}
              onChange={(v) => api.setField('title', v)}
              readOnly={api.readOnly}
              data-testid="le-title-input"
            />
          </FormField>
          {aiTitle && (aiTitle.loading || aiTitle.value != null || aiTitle.error) ? (
            <FieldSuggestion
              value={aiTitle.value ?? ''}
              counter={aiTitle.value ? { value: aiTitle.value.length, max: TITLE_MAX } : undefined}
              basis={aiTitle.basis}
              rationale={aiTitle.rationale}
              loading={aiTitle.loading}
              error={aiTitle.error}
              credits={aiTitle.credits}
              onUse={() => aiTitle.value && use('title', aiTitle.value, aiTitle.dismiss)}
              onDismiss={aiTitle.dismiss}
              onRetry={aiTitle.run}
              data-testid="le-title-suggestion"
            />
          ) : null}
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <FormField
            label={t('field.description')}
            htmlFor={fieldDomId('description')}
            helper={<Box component="span" sx={{ color: neutral[500], fontVariantNumeric: 'tabular-nums' }}>{t('field.descriptionWords', { count: words })}</Box>}
            error={errorFor('description')}
            dirty={api.isDirty('description')}
            onRevert={() => api.revert('description')}
            labelAction={aiButton(aiDescription, t('ai.writeDescription'))}
            required
          >
            <TextArea
              id={fieldDomId('description')}
              value={description}
              onChange={(v) => api.setField('description', v)}
              minRows={DESCRIPTION_MIN_ROWS}
              maxRows={DESCRIPTION_MAX_ROWS}
              maxLength={DESCRIPTION_MAX}
              preview={renderPlain}
              readOnly={api.readOnly}
              data-testid="le-description-input"
            />
          </FormField>
          {aiDescription && (aiDescription.loading || aiDescription.value != null || aiDescription.error) ? (
            <FieldSuggestion
              value={aiDescription.value ?? ''}
              basis={aiDescription.basis}
              rationale={aiDescription.rationale}
              loading={aiDescription.loading}
              error={aiDescription.error}
              credits={aiDescription.credits}
              onUse={() => aiDescription.value && use('description', aiDescription.value, aiDescription.dismiss)}
              onDismiss={aiDescription.dismiss}
              onRetry={aiDescription.run}
              data-testid="le-description-suggestion"
            />
          ) : null}
        </Box>
      </Box>
    </Section>
  );
}

export default TitleSection;
