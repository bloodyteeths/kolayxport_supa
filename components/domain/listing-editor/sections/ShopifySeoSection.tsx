// components/domain/listing-editor/sections/ShopifySeoSection.tsx — M6b-D: Shopify "Search engine listing"
// (marketplace-editors §3 row 9, §4.3): page title (counter at Google's ~70) and meta description (≤ 320), read
// from `action=seo` by the adapter. Empty = Shopify uses the product title / description (shown as placeholder).
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page/Section';
import { FormField, TextArea, TextField } from '@/components/ds/inputs';
import { neutral } from '@/lib/ds/tokens';
import { fieldAnchorId, sectionAnchorId } from '@/lib/listingEditor/sections';
import type { ListingSectionProps } from '@/lib/listingEditor/types';
import { LIMITS } from '@/lib/catalogDrafts/schemas';
import { toStr, useCatalogSection } from './marketplaceSectionShared';

/** Google shows about this many characters of a page title. */
export const SEO_TITLE_SOFT_MAX = 70;
export const SEO_DESCRIPTION_MAX = LIMITS.shopifySeoDescription;

/** HTML description → plain text excerpt (the fallback Shopify uses for the meta description). Pure. */
export function seoFallbackDescription(html: string, max = SEO_DESCRIPTION_MAX): string {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function ShopifySeoSection({ id = 'seo' }: Partial<ListingSectionProps>) {
  const t = useTranslations('listingEditor');
  const { f, ro, errorFor, dirty, set, revert } = useCatalogSection();
  const title = toStr(f.seoTitle);
  const description = toStr(f.seoDescription);
  const fallbackTitle = toStr(f.title);
  const fallbackDescription = seoFallbackDescription(toStr(f.description));
  return (
    <Section id={sectionAnchorId(id)} title={t('section.seo')} description={t('shopify.seoHelp')} variant="plain" data-testid="le-section-seo">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: 720 }}>
        <FormField
          label={t('shopify.seoTitle')}
          htmlFor={fieldAnchorId('seoTitle')}
          counter={{ value: (title || fallbackTitle).length, max: SEO_TITLE_SOFT_MAX }}
          error={errorFor('seoTitle') ?? errorFor('seo')}
          dirty={dirty('seoTitle')}
          onRevert={() => revert('seoTitle')}
          optional
        >
          <TextField
            id={fieldAnchorId('seoTitle')}
            value={title}
            placeholder={fallbackTitle || undefined}
            onChange={(v) => set('seoTitle', v.replace(/[\r\n]+/g, ' '))}
            maxLength={LIMITS.shopifySeoTitle}
            readOnly={ro}
          />
        </FormField>
        <FormField
          label={t('shopify.seoDescription')}
          htmlFor={fieldAnchorId('seoDescription')}
          counter={{ value: (description || fallbackDescription).length, max: SEO_DESCRIPTION_MAX }}
          error={errorFor('seoDescription')}
          dirty={dirty('seoDescription')}
          onRevert={() => revert('seoDescription')}
          optional
        >
          <TextArea
            id={fieldAnchorId('seoDescription')}
            value={description}
            placeholder={fallbackDescription || undefined}
            onChange={(v) => set('seoDescription', v.replace(/[\r\n]+/g, ' '))}
            minRows={2}
            maxRows={6}
            maxLength={SEO_DESCRIPTION_MAX}
            readOnly={ro}
          />
        </FormField>
        {!title && !description ? <Box sx={{ color: neutral[600], fontSize: 13 }}>{t('shopify.seoFallback')}</Box> : null}
      </Box>
    </Section>
  );
}
