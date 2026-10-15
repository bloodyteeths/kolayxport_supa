// components/domain/listing-editor/sections/TagsSection.tsx — listing-editor §4.2 "Tags" (Etsy): 13 × 20 tags
// with per-tag validation from lib/etsy/seoRules (cleanTag, tagKey, tagTitleOverlap — nothing re-implemented),
// list paste with one summary line, title-overlap and single-word chip flags, AI tag ideas as "+ tag" chips,
// and materials (13 × 45, letters/numbers/spaces only, as Etsy enforces).
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page/Section';
import { Button, FormField, TagInput } from '@/components/ds/inputs';
import { icons } from '@/lib/ds/icons';
import { neutral, type as typeScale } from '@/lib/ds/tokens';
import { cleanTag, tagKey, tagTitleOverlap, TAG_MAX_COUNT, TAG_MAX_LEN } from '@/lib/etsy/seoRules';
import { RESEARCH_TOOL_PATH } from '@/components/domain/research/ResearchLayout';
import { sectionAnchorId } from '@/lib/listingEditor/sections';
import type { ListingSectionProps } from '@/lib/listingEditor/types';
import { displayList, displayText, fieldDomId, MATERIAL_MAX, MATERIAL_MAX_LEN } from './etsyShared';
import { useEtsySection, useFieldError } from './useEtsySection';
import type { FieldAiState } from './sectionTypes';

export interface TagsSectionProps extends Partial<ListingSectionProps> {
  /** "✦ Get tag ideas" (useListingAI `suggest_tags`, already `normalizeTags(…, { dropTitleOverlap: true })`). */
  aiTags?: FieldAiState<string[]>;
  /** Chips to highlight (ScorePanel "Show weak tags"). */
  flaggedTags?: string[];
  /** Keyword explorer link; default `/app/research/keywords?listing=<id>` once R2 ships the route (hidden before). */
  explorerHref?: string | null;
}

const MATERIAL_INVALID = /[^\p{L}\p{Nd}\p{Zs}]/u;
const TAG_INVALID = /[^\p{L}\p{Nd}\p{Zs}\-'™©®]/u;

/** Material entry: collapse spaces, keep case (Etsy shows materials as typed). */
export function normalizeMaterial(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function Count({ value, max }: { value: number; max: number }) {
  const t = useTranslations('listingEditor');
  return (
    <Box component="span" sx={{ fontSize: typeScale.caption[0], lineHeight: `${typeScale.caption[1]}px`, color: neutral[500], fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      {t('field.count', { count: value, max })}
    </Box>
  );
}

export function TagsSection({ id = 'tags', aiTags, flaggedTags, explorerHref }: TagsSectionProps) {
  const t = useTranslations('listingEditor');
  const api = useEtsySection();
  const errorFor = useFieldError(api);
  const tags = displayList(api.fields.tags);
  const materials = displayList(api.fields.materials);
  const title = displayText(api.fields.title);
  // Keyword explorer for this listing (a not-yet-created listing has a negative temp id: plain explorer).
  const href = explorerHref === undefined
    ? (api.listingId && !api.listingId.startsWith('-') ? `${RESEARCH_TOOL_PATH.keywords}?listing=${encodeURIComponent(api.listingId)}` : RESEARCH_TOOL_PATH.keywords)
    : explorerHref;

  const invalidTag = (tag: string) => {
    const m = tag.match(TAG_INVALID);
    return m ? t('tags.invalid', { tag, marketplace: 'Etsy', chars: m[0] }) : null;
  };
  const invalidMaterial = (m: string) => {
    const bad = m.match(MATERIAL_INVALID);
    return bad ? t('tags.invalid', { tag: m, marketplace: 'Etsy', chars: bad[0] }) : null;
  };

  const suggestions = aiTags?.value ?? undefined;
  const free = Math.max(0, TAG_MAX_COUNT - tags.length);
  const acceptAll = () => {
    if (!suggestions) return;
    const keys = new Set(tags.map((x) => tagKey(x) || x));
    const add: string[] = [];
    for (const s of suggestions) {
      const k = tagKey(s) || s;
      if (add.length >= free || keys.has(k) || s.length > TAG_MAX_LEN) continue;
      keys.add(k);
      add.push(s);
    }
    if (add.length) api.setField('tags', [...tags, ...add]);
    aiTags?.dismiss();
  };

  return (
    <Section id={sectionAnchorId(id)} title={t('section.tags')} variant="plain" data-testid="le-section-tags">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: 720 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <FormField
            label={t('field.tags')}
            htmlFor={fieldDomId('tags')}
            labelAction={<Count value={tags.length} max={TAG_MAX_COUNT} />}
            error={errorFor('tags')}
            dirty={api.isDirty('tags')}
            onRevert={() => api.revert('tags')}
          >
            <TagInput
              id={fieldDomId('tags')}
              value={tags}
              onChange={(next) => api.setField('tags', next)}
              max={TAG_MAX_COUNT}
              maxLength={TAG_MAX_LEN}
              normalize={cleanTag}
              tagKey={tagKey}
              overlap={tagTitleOverlap}
              flagOverlapWith={title}
              validate={invalidTag}
              singleWordHint
              flagged={flaggedTags}
              suggestions={suggestions}
              onAcceptAll={acceptAll}
              overLimitMessage={t('tags.overLimit', { max: TAG_MAX_COUNT, marketplace: 'Etsy' })}
              placeholder={t('tags.placeholder')}
              disabled={api.readOnly}
              data-testid="le-tags-input"
            />
          </FormField>
          {!api.readOnly ? (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
              {aiTags ? (
                <Button variant="ghost" size="sm" icon={icons.ai} onClick={aiTags.run} loading={aiTags.loading} loadingLabel={t('ai.writing')}>
                  {t('ai.tagIdeas')}
                </Button>
              ) : null}
              {href ? (
                <Button variant="ghost" size="sm" trailingIcon={icons.externalLink} href={href} external>
                  {t('tags.openExplorer')}
                </Button>
              ) : null}
              {aiTags?.error ? (
                <Box role="alert" sx={{ fontSize: 12, color: neutral[600] }}>{typeof aiTags.error === 'string' ? aiTags.error : t('ai.garbled')}</Box>
              ) : null}
            </Box>
          ) : null}
        </Box>

        <FormField
          label={t('field.materials')}
          htmlFor={fieldDomId('materials')}
          optional
          labelAction={<Count value={materials.length} max={MATERIAL_MAX} />}
          error={errorFor('materials')}
          dirty={api.isDirty('materials')}
          onRevert={() => api.revert('materials')}
        >
          <TagInput
            id={fieldDomId('materials')}
            value={materials}
            onChange={(next) => api.setField('materials', next)}
            max={MATERIAL_MAX}
            maxLength={MATERIAL_MAX_LEN}
            normalize={normalizeMaterial}
            validate={invalidMaterial}
            overLimitMessage={t('tags.overLimitMaterials', { max: MATERIAL_MAX, marketplace: 'Etsy' })}
            placeholder={t('tags.materialsPlaceholder')}
            disabled={api.readOnly}
            data-testid="le-materials-input"
          />
        </FormField>
      </Box>
    </Section>
  );
}

export default TagsSection;
