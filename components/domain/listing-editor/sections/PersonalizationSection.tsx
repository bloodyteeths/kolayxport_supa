// components/domain/listing-editor/sections/PersonalizationSection.tsx — listing-editor §2.1 #7 "Personalization"
// (Etsy, M6 Group D). `components/etsy/PersonalizationEditor` in embedded mode: one question list (a single text
// question is the simple case), DS inputs, no own Save button; staged as the same `personalization` patch the legacy
// buttons sent. The open draft's `personalizationPatch` is overlaid on what Etsy has (I0 8b). Edit mode with
// personalization on starts as "On · Required · 1 question · Edit"; off shows the switch inline. Mobile: sheet
// (held out of autosave while open). A failed draft check blocks the editor until Retry succeeds (never edit over
// an unseen staged patch, same rule as VariationEditor); Discard changes remounts it from what is live.
import * as React from 'react';
import { useTranslations } from 'next-intl';
import type { DraftSection, FieldIssue, ListingFacts, ListingSectionProps } from '@/lib/listingEditor/types';
import Typography from '@mui/material/Typography';
import { Section } from '@/components/ds/page/Section';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { neutral } from '@/lib/ds/tokens';
import { sectionAnchorId } from '@/lib/listingEditor/sections';
import PersonalizationEditor, {
  personalizationStateFrom,
  summarizePersonalization,
  type LegacyPersonalization,
  type PersonalizationEditorHandle,
  type PersonalizationQuestion,
  type PersonalizationSummary,
} from '@/components/etsy/PersonalizationEditor';
import { useListingEditor, useRegisterDraftSection } from '../useListingDraft';
import { SubEditorFrame, useDiscardGeneration, useSheetHold } from './VariationsSection';

export type PersonalizationSectionProps = Partial<ListingSectionProps>;

const OPEN_STATUSES = ['draft', 'failed', 'conflict'];

/** `ListingMeta.personalization` (adapters/etsy.ts) → the editor's inputs. Pure, exported for tests. */
export function personalizationInputs(meta: unknown): { questions: PersonalizationQuestion[]; legacy: LegacyPersonalization } {
  const m = (meta && typeof meta === 'object' ? meta : {}) as Record<string, unknown>;
  return {
    questions: Array.isArray(m.personalization_questions) ? (m.personalization_questions as PersonalizationQuestion[]) : [],
    legacy: {
      is_personalizable: Boolean(m.is_personalizable),
      personalization_is_required: Boolean(m.personalization_is_required),
      personalization_instructions: typeof m.personalization_instructions === 'string' ? m.personalization_instructions : '',
      personalization_char_count_max: Number(m.personalization_char_count_max) || 0,
    },
  };
}

/** The open draft's personalization patch (overlay), or undefined. */
export function openPersonalizationPatch(draft: { status: string; personalizationPatch?: unknown } | null): unknown {
  if (!draft || !OPEN_STATUSES.includes(draft.status)) return undefined;
  const p = draft.personalizationPatch;
  return p && typeof p === 'object' && Object.keys(p as object).length > 0 ? p : undefined;
}

export function personalizationFact(s: PersonalizationSummary): NonNullable<ListingFacts['personalization']> {
  return { enabled: s.enabled, required: s.required, questions: s.count };
}

/** `etsy`-relative FieldErrors → engine FieldIssues (section `personalization`). */
export function toPersonalizationIssues(
  errors: Array<{ field: string; severity: string; key?: string; params?: Record<string, string | number>; message?: string }>,
): FieldIssue[] {
  return errors.map((e) => ({
    field: 'personalization',
    section: 'personalization',
    severity: e.severity === 'block_save' ? 'block_save' : 'block_sync',
    key: e.key ? `etsy.${e.key}` : 'etsy.personalization.toastError',
    params: e.params,
    message: e.message,
  }));
}

export function PersonalizationSection({ id = 'personalization' }: PersonalizationSectionProps) {
  const t = useTranslations('listingEditor');
  const ed = useListingEditor();
  const { ctx, mode, readOnly, notifyChange, reportFacts, reloadDraft, draftCheckFailed } = ed;
  const listingId = ctx.listingId;
  const shopId = ctx.shopId;
  const handleRef = React.useRef<PersonalizationEditorHandle | null>(null);
  const sheet = useSheetHold();
  const discardGen = useDiscardGeneration();
  // The editor starts from `draftPatch`, so it may only mount once the drafts check has succeeded. A later failed
  // reload (after a stage) does not unmount an editor that already started from a known draft.
  const [draftSeen, setDraftSeen] = React.useState(!draftCheckFailed);
  React.useEffect(() => {
    if (!draftCheckFailed) setDraftSeen(true);
  }, [draftCheckFailed]);
  const blocked = !draftSeen;
  const [retrying, setRetrying] = React.useState(false);
  const retry = async () => {
    setRetrying(true);
    try {
      await reloadDraft();
    } finally {
      setRetrying(false);
    }
  };

  const { questions, legacy } = personalizationInputs(ed.view.meta.personalization);
  const draftPatch = openPersonalizationPatch(ed.draft);
  // Initial summary from the same overlay the editor uses; the editor reports later edits.
  const initial = React.useMemo(
    () => summarizePersonalization(personalizationStateFrom({ questions, legacy, draftPatch })),
    // Recomputed when the listing or its staged patch changes, not on every render's new objects.
    [JSON.stringify(ed.view.meta.personalization ?? null), JSON.stringify(draftPatch ?? null)],
  );
  const [summary, setSummary] = React.useState<PersonalizationSummary>(initial);
  // Decided once: a section that starts off stays inline even after the seller switches it on (no collapse mid-edit).
  const [startsOpen] = React.useState(() => mode === 'create' || !initial.enabled);
  const editorReported = React.useRef(false);
  React.useEffect(() => {
    if (editorReported.current) return;
    setSummary(initial);
    reportFacts({ personalization: personalizationFact(initial) });
  }, [initial, reportFacts]);

  useRegisterDraftSection({
    id: 'personalization',
    isDirty: () => !blocked && !sheet.held() && (handleRef.current?.isDirty() ?? false),
    stage: async () => {
      const h = handleRef.current;
      if (blocked || sheet.held() || !h || !h.isDirty()) return;
      await h.stage();
      void reloadDraft();
    },
    validate: () => toPersonalizationIssues(handleRef.current?.validate() ?? []),
    reset: () => {
      // Discard: the editor's baseline is the discarded staged patch; remount it from the live questions.
      editorReported.current = false;
      discardGen.bump();
    },
    changes: () => [{ group: 'personalization' }],
  } satisfies DraftSection);

  const onSummaryChange = React.useCallback((s: PersonalizationSummary) => {
    editorReported.current = true;
    setSummary(s);
    reportFacts({ personalization: personalizationFact(s) });
  }, [reportFacts]);

  if (!listingId) {
    return (
      <Section id={sectionAnchorId(id)} title={t('section.personalization')} variant="plain" data-testid="le-section-personalization">
        <Typography variant="body2" sx={{ color: neutral[600], maxWidth: 720 }}>{t('personalization.createNeedsDraft')}</Typography>
      </Section>
    );
  }

  if (blocked) {
    return (
      <Section id={sectionAnchorId(id)} title={t('section.personalization')} variant="plain" data-testid="le-section-personalization">
        <ErrorState
          variant="inline"
          title={t('personalization.draftCheckFailed')}
          onRetry={() => { void retry(); }}
          retrying={retrying}
          data-testid="le-personalization-draft-check-failed"
        />
      </Section>
    );
  }

  const summaryText = summary.enabled
    ? t('personalization.summary', { required: summary.required ? 'true' : 'false', count: summary.count })
    : t('personalization.off');

  return (
    <SubEditorFrame
      id="personalization"
      title={t('section.personalization')}
      summary={summaryText}
      actionLabel={summary.enabled ? t('personalization.edit') : t('personalization.setUp')}
      // Off (or create): the switch itself is the whole editor, so it shows inline.
      alwaysOpen={startsOpen}
      sheetTitle={t('section.personalization')}
      onSheetDone={async () => {
        const h = handleRef.current;
        if (h?.isDirty()) {
          await h.stage();
          void reloadDraft();
        }
      }}
      onSheetCancel={() => {
        handleRef.current?.revert();
      }}
      onSheetOpenChange={(open) => {
        sheet.onSheetOpenChange(open);
        if (!open) notifyChange();
      }}
      disabled={readOnly}
      stageFailedMessage={t('personalization.stageFailed')}
    >
      <PersonalizationEditor
        ref={handleRef}
        embedded
        key={`${shopId}:${listingId}:${discardGen.generation}`}
        listingId={listingId}
        shopId={shopId}
        questions={questions}
        legacy={legacy}
        draftPatch={draftPatch}
        disabled={readOnly}
        onChange={() => { if (!sheet.held()) notifyChange(); }}
        onSummaryChange={onSummaryChange}
      />
    </SubEditorFrame>
  );
}

export default PersonalizationSection;
