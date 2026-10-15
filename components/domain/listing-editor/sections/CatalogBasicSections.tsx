// components/domain/listing-editor/sections/CatalogBasicSections.tsx — "Photos" and "Title & description" for the
// Trendyol, Wix and Shopify editors (marketplace-editors §3 rows 1–2; M6b-C). marketplace-editors §11 gives these two
// rows no section owner (M6b-D builds the marketplace-specific sections), so M6b-C provides them on the existing
// pieces: the eBay embedded ImageManager (DS photo strip, uploads to KolayXport hosting with signed public URLs) for
// the `images` URL list, and DS FormField / TextField / TextArea for title and description.
// They only call `setField`: the M6b-C adapters stage the URL list into CatalogDraft media / image operations and
// nothing reaches a marketplace until the footer's Send.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page/Section';
import { Button, FieldSuggestion, FormField, TextArea } from '@/components/ds/inputs';
import { useToast } from '@/components/ds/feedback/toast';
import { icons } from '@/lib/ds/icons';
import { neutral } from '@/lib/ds/tokens';
import { DESCRIPTION_MAX, LIMITS, TITLE_MAX } from '@/lib/catalogDrafts/schemas';
import { fieldAnchorId, sectionAnchorId } from '@/lib/listingEditor/sections';
import type { EditorMarketplace, FieldMap, ListingSectionProps } from '@/lib/listingEditor/types';
import EbayImageManager, { type EbayImageManagerHandle } from '@/components/ebay/ImageManager';
import { useListingEditor, useRegisterDraftSection } from '../useListingDraft';
import { useFieldError } from './useEtsySection';
import type { PhotosSummary } from './photosModel';
import type { FieldAiState } from './sectionTypes';
import { DESCRIPTION_MAX_ROWS, DESCRIPTION_MIN_ROWS, TitleInput } from './TitleInput';

type CatalogMp = Extract<EditorMarketplace, 'trendyol' | 'wix' | 'shopify'>;

/** Photos per product: Trendyol 8, Shopify 250; Wix has no product cap here (marketplace-editors §3 row 1). */
export const CATALOG_PHOTO_MAX: Record<CatalogMp, number> = { trendyol: LIMITS.trendyolImages, wix: Number.POSITIVE_INFINITY, shopify: 250 };
/** New photos per Send (the executors' add limits): Wix 15, Shopify 20; Trendyol sends the whole list. */
export const CATALOG_PHOTO_ADDS: Record<CatalogMp, number> = { trendyol: LIMITS.trendyolImages, wix: LIMITS.wixMediaAdds, shopify: LIMITS.shopifyImageAdds };

/**
 * Pure: the photo list the section stages. Photos already on the product are never dropped (a reorder or a remove
 * of a product over the add limit keeps every other photo); only new ones are capped, by the add limit and by
 * what the product cap leaves.
 */
export function capCatalogImages(next: readonly string[], known: readonly string[], mp: CatalogMp): string[] {
  const knownSet = new Set(known);
  const keptKnown = next.filter((u) => knownSet.has(u)).length;
  const room = Math.max(0, Math.min(CATALOG_PHOTO_ADDS[mp], CATALOG_PHOTO_MAX[mp] - keptKnown));
  let added = 0;
  return next.filter((u) => knownSet.has(u) || (added += 1) <= room);
}

/** Pure: how many photos the strip may hold now (photos on the product + the new ones allowed). */
export function catalogPhotoLimit(images: readonly string[], known: readonly string[], mp: CatalogMp): number {
  const knownSet = new Set(known);
  const keptKnown = images.filter((u) => knownSet.has(u)).length;
  return Math.min(CATALOG_PHOTO_MAX[mp], keptKnown + CATALOG_PHOTO_ADDS[mp]);
}

function isCatalogMp(m: EditorMarketplace): m is CatalogMp {
  return m === 'trendyol' || m === 'wix' || m === 'shopify';
}

function urlList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((u): u is string => typeof u === 'string' && u.length > 0) : [];
}

/** Description preview: the seller's HTML in a sandboxed frame (no scripts, no same-origin, no forms). */
function HtmlPreview({ html, title }: { html: string; title: string }) {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{margin:0;padding:12px;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0F172A;overflow-wrap:break-word}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;
  return (
    <Box
      component="iframe"
      title={title}
      sandbox=""
      srcDoc={doc}
      data-testid="le-catalog-description-preview"
      sx={{ display: 'block', width: '100%', minHeight: 200, height: 320, border: 0, bgcolor: neutral[0] }}
    />
  );
}

/** HTML → text for the word count. */
function htmlWords(html: string): number {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').trim();
  return text ? text.split(/\s+/).length : 0;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Photos
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CatalogPhotosSectionProps extends Partial<ListingSectionProps> {
  /** Rendered above the strip (Trendyol: the approval / rejection banner). */
  banner?: React.ReactNode;
}

export function CatalogPhotosSection({ id = 'photos', banner }: CatalogPhotosSectionProps) {
  const t = useTranslations('listingEditor');
  const ed = useListingEditor<FieldMap>();
  const { readOnly, reportFacts, setField, mode, marketplaceName, marketplace } = ed;
  const ref = React.useRef<EbayImageManagerHandle | null>(null);
  const images = urlList(ed.view.fields.images);
  const baseline = urlList(ed.remote?.images);
  const known = mode === 'edit' ? baseline : [];
  const mp: CatalogMp = isCatalogMp(marketplace) ? marketplace : 'shopify';
  const max = catalogPhotoLimit(images, known, mp);
  const [summary, setSummary] = React.useState<PhotosSummary | null>(null);

  // Uploads in flight are unsaved work (their URL is not in the field yet): Send waits for them.
  useRegisterDraftSection({
    id: 'photos',
    key: 'photos:images',
    isDirty: () => ref.current?.isDirty() ?? false,
    stage: () => ref.current?.stage() ?? Promise.resolve(),
    changes: () => [{ group: 'photos' }],
  });

  React.useEffect(() => {
    if (summary) reportFacts({ images: summary.images, hasVideo: false });
  }, [summary, reportFacts]);

  const full = images.length >= max;
  const emptyMessage =
    mode === 'create' ? (
      <Box component="span" sx={{ display: 'inline-flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: '4px' }}>
        <span>{t('photos.dropzone')}</span>
        <Box component="span" sx={{ fontWeight: 500 }}>{t('photos.choose')}</Box>
      </Box>
    ) : (
      t('photos.noPhotos', { marketplace: marketplaceName })
    );

  return (
    <Section id={sectionAnchorId(id)} title={t('section.photosEbay')} variant="plain" data-testid="le-section-photos">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
        {banner}
        <EbayImageManager
          ref={ref}
          embedded
          images={images}
          baseline={known}
          onImagesChanged={(next) => setField('images', capCatalogImages(next, known, mp))}
          productTitle={String(ed.view.fields.title ?? '')}
          maxImages={max}
          onSummary={setSummary}
          readOnly={readOnly}
          emptyMessage={emptyMessage}
        />
        <Box sx={{ fontSize: 12, color: neutral[500] }}>{t('photos.hint', { max })}</Box>
        {!readOnly && !full ? (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            <Box component="span" id={fieldAnchorId('images')} tabIndex={-1} sx={{ outline: 'none' }}>
              <Button variant="ghost" size="sm" icon={icons.upload} onClick={() => ref.current?.openUpload()}>
                {t('photos.choose')}
              </Button>
            </Box>
          </Box>
        ) : null}
      </Box>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Title & description
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CatalogTitleSectionProps extends Partial<ListingSectionProps> {
  /** Trendyol AI (M6b-E `useListingAI`): proposals only, Use writes the field (autosave), never sends. */
  aiTitle?: FieldAiState<string>;
  aiDescription?: FieldAiState<string>;
}

export function CatalogTitleSection({ id = 'title', aiTitle, aiDescription }: CatalogTitleSectionProps) {
  const t = useTranslations('listingEditor');
  const toast = useToast();
  const ed = useListingEditor<FieldMap>();
  const errorFor = useFieldError({ issues: ed.issues });
  const ro = ed.readOnly;
  const mp = isCatalogMp(ed.marketplace) ? ed.marketplace : 'shopify';
  const titleMax = TITLE_MAX[mp];
  const descMax = DESCRIPTION_MAX[mp];
  const title = String(ed.view.fields.title ?? '');
  const description = String(ed.view.fields.description ?? '');
  const dirty = (key: string) => ed.mode === 'edit' && ed.isFieldDirty(key);

  const use = (key: 'title' | 'description', value: string, done: () => void) => {
    const previous = key === 'title' ? title : description;
    ed.setField(key, key === 'title' ? value.slice(0, titleMax) : value);
    done();
    toast.success(t('ai.replaced', { field: t(key === 'title' ? 'field.title' : 'field.description') }), {
      undo: () => ed.setField(key, previous),
      undoLabel: t('banner.undo'),
    });
  };
  const aiButton = (state: FieldAiState<string> | undefined, label: string) =>
    state && !ro ? (
      <Button variant="ghost" size="sm" icon={icons.ai} onClick={state.run} loading={state.loading} loadingLabel={t('ai.writing')}>
        {label}
      </Button>
    ) : null;
  const suggestion = (state: FieldAiState<string> | undefined, key: 'title' | 'description') =>
    state && (state.loading || state.value != null || state.error) ? (
      <FieldSuggestion
        value={state.value ?? ''}
        counter={key === 'title' && state.value ? { value: state.value.length, max: titleMax } : undefined}
        basis={state.basis}
        rationale={state.rationale}
        loading={state.loading}
        error={state.error}
        credits={state.credits}
        onUse={() => state.value && use(key, state.value, state.dismiss)}
        onDismiss={state.dismiss}
        onRetry={state.run}
        data-testid={`le-catalog-${key}-suggestion`}
      />
    ) : null;

  return (
    <Section id={sectionAnchorId(id)} title={t('section.title')} variant="plain" data-testid="le-section-title">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: 720 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <FormField
            label={t('field.title')}
            htmlFor={fieldAnchorId('title')}
            counter={{ value: title.length, max: titleMax }}
            error={errorFor('title')}
            dirty={dirty('title')}
            onRevert={() => ed.revert(['title'])}
            labelAction={aiButton(aiTitle, t('ai.suggestTitle'))}
            required
          >
            <TitleInput
              id={fieldAnchorId('title')}
              value={title}
              onChange={(v) => ed.setField('title', v)}
              readOnly={ro}
              data-testid="le-catalog-title-input"
            />
          </FormField>
          {suggestion(aiTitle, 'title')}
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <FormField
            label={t('field.description')}
            htmlFor={fieldAnchorId('description')}
            helper={
              <Box component="span" sx={{ color: neutral[500], fontVariantNumeric: 'tabular-nums' }}>
                {t('field.descriptionWords', { count: htmlWords(description) })}
              </Box>
            }
            error={errorFor('description')}
            dirty={dirty('description')}
            onRevert={() => ed.revert(['description'])}
            labelAction={aiButton(aiDescription, t('ai.writeDescription'))}
          >
            <TextArea
              id={fieldAnchorId('description')}
              value={description}
              onChange={(v) => ed.setField('description', v)}
              minRows={DESCRIPTION_MIN_ROWS}
              maxRows={DESCRIPTION_MAX_ROWS}
              maxLength={descMax}
              preview={(v) => <HtmlPreview html={v} title={t('catalog.descriptionPreview')} />}
              readOnly={ro}
              data-testid="le-catalog-description-input"
            />
          </FormField>
          {suggestion(aiDescription, 'description')}
        </Box>
      </Box>
    </Section>
  );
}
