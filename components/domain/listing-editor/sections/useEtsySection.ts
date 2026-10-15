// components/domain/listing-editor/sections/useEtsySection.ts — Group B: maps the editor engine
// (`useListingEditor()`, Group A) onto the narrow `EtsySectionApi` the Etsy field sections use.
import { useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { EtsyEditorFields, EtsyFieldKey, QueuedAction } from '@/lib/listingEditor/types';
import { useListingEditor } from '../useListingDraft';
import type { EtsySectionApi } from './sectionTypes';

export function useEtsySection(): EtsySectionApi {
  const ed = useListingEditor<EtsyEditorFields>();
  const { setField: edSetField, revert: edRevert, isFieldDirty, stageActions: edStageActions, saveNow, ctx, mode } = ed;

  const setField = useCallback(<K extends EtsyFieldKey>(key: K, value: EtsyEditorFields[K]) => {
    edSetField(key, value);
  }, [edSetField]);

  const isDirty = useCallback((key: EtsyFieldKey) => mode === 'edit' && isFieldDirty(key), [mode, isFieldDirty]);
  const revert = useCallback((key: EtsyFieldKey) => edRevert([key]), [edRevert]);

  const stageActions = useCallback(async (actions: QueuedAction[], fields?: Partial<EtsyEditorFields>) => {
    // A blank create has no local listing id until its first save: save first so the action has a draft.
    if (!ctx.listingId) await saveNow();
    // Action + temp-id field in one request (drawer behaviour): never a queued create with nothing pointing at it.
    const d = await edStageActions(actions, fields as Record<string, unknown> | undefined);
    if (!d) throw new Error('STAGE_ACTIONS_NO_DRAFT');
  }, [ctx.listingId, saveNow, edStageActions]);

  const defaults = useMemo(() => new Set(ed.defaultsApplied), [ed.defaultsApplied]);

  return {
    shopId: ctx.shopId,
    listingId: ctx.listingId,
    mode,
    readOnly: ed.readOnly,
    fields: ed.view.fields,
    remote: ed.remote,
    currency: ed.view.meta.currency || 'USD',
    facts: ed.view.facts,
    draft: ed.draft,
    setField,
    isDirty,
    revert,
    issues: ed.issues,
    register: ed.register,
    notifyChange: ed.notifyChange,
    stageActions,
    reportFacts: ed.reportFacts,
    fromDefaults: defaults,
  };
}

/**
 * Inline error text for a field from the engine's issues (`FieldIssue.key` is a full i18n path, e.g.
 * `etsy.validation.titleTooLong`). Unknown keys fall back to the issue's message (never raw server text: the
 * adapter only passes validator messages).
 */
export function useFieldError(api: Pick<EtsySectionApi, 'issues'>): (field: string) => string | null {
  const root = useTranslations();
  return useCallback((field: string) => {
    const issue = api.issues.find((i) => i.field === field && i.severity !== 'warn');
    if (!issue) return null;
    if (issue.key && root.has(issue.key)) return root(issue.key, (issue.params ?? {}) as Record<string, string | number>);
    return issue.message ?? null;
  }, [api.issues, root]);
}
