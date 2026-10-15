import React, { useState, useCallback, useEffect, useImperativeHandle, useMemo, useRef, forwardRef } from 'react';
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  TextField,
  Select,
  MenuItem,
  Switch,
  IconButton,
  Button,
  Chip,
  Box,
  Typography,
  FormControlLabel,
  FormControl,
  InputLabel,
  CircularProgress,
} from '@mui/material';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import { stageEtsyDraft } from '@/lib/etsy/draftClient';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { validateEtsyPersonalization, type FieldError } from '@/lib/etsy/validation';
import { decodeEntities } from '@/lib/text/decodeEntities';
import {
  Switch as DsSwitch,
  FormField,
  TextField as DsTextField,
  TextArea,
  Select as DsSelect,
  NumberField,
  TagInput,
  IconButton as DsIconButton,
  Button as DsButton,
} from '@/components/ds/inputs';
import { icons, ICON_STROKE } from '@/lib/ds/icons';
import { neutral, radius } from '@/lib/ds/tokens';

type PersonalizationQuestionType = 'text_input' | 'dropdown' | 'unlabeled_upload' | 'labeled_upload';

interface PersonalizationDropdownOption {
  label: string;
}

export interface PersonalizationQuestion {
  question_id?: number;
  question_type: PersonalizationQuestionType;
  question_text: string;
  instructions?: string;
  required: boolean;
  max_allowed_characters?: number;
  max_allowed_files?: number;
  options?: PersonalizationDropdownOption[];
}

export interface LegacyPersonalization {
  is_personalizable: boolean;
  personalization_is_required: boolean;
  personalization_instructions: string;
  personalization_char_count_max: number;
}

/** Registration object handed to the listing editor's autosave engine (listing-editor §5.1 `DraftSection`). */
export interface PersonalizationDraftSection {
  id: 'personalization';
  isDirty(): boolean;
  stage(): Promise<void>;
  validate(): FieldError[];
}

export interface PersonalizationEditorHandle {
  isDirty(): boolean;
  /** Stages `personalization` into the EtsyListingDraft (never sends). No-op when clean or structurally invalid. */
  stage(): Promise<void>;
  revert(): void;
  validate(): FieldError[];
  summary(): PersonalizationSummary;
}

export interface PersonalizationEditorProps {
  listingId: string;
  shopId: string;
  questions: PersonalizationQuestion[];
  legacy: LegacyPersonalization;
  /** Legacy (drawer): called after the own Save button staged. */
  onSaved?: () => void;
  /** listing-editor §5.1: DS inputs, no own save button, staging through `stage()` / `register`. */
  embedded?: boolean;
  /**
   * Embedded: the open draft's `personalizationPatch` (server-draft overlay, I0 8b). When set it wins over
   * `questions` / `legacy`, which describe what is live on Etsy.
   */
  draftPatch?: unknown;
  register?: (section: PersonalizationDraftSection) => () => void;
  /** Embedded: called after every edit with the current dirty flag. */
  onChange?: (dirty: boolean) => void;
  onSummaryChange?: (summary: PersonalizationSummary) => void;
  /** Embedded: fields read-only (e.g. while the draft is sending). */
  disabled?: boolean;
}

const MAX_QUESTIONS = 5;
const QUESTION_TEXT_MAX = 45;
const INSTRUCTIONS_MAX = 120;
const OPTION_LABEL_MAX = 20;
const DROPDOWN_OPTIONS_MAX = 30;

// ─── Pure helpers (shared by the embedded editor and tests) ────────────────────

export interface PersonalizationState {
  enabled: boolean;
  questions: PersonalizationQuestion[];
}

export interface PersonalizationSummary {
  enabled: boolean;
  /** At least one question is required. */
  required: boolean;
  count: number;
}

function isUpload(type: PersonalizationQuestionType): boolean {
  return type === 'unlabeled_upload' || type === 'labeled_upload';
}

function decodeQuestion(q: any): PersonalizationQuestion {
  const type: PersonalizationQuestionType = ['text_input', 'dropdown', 'unlabeled_upload', 'labeled_upload'].includes(q?.question_type)
    ? q.question_type
    : 'text_input';
  const out: PersonalizationQuestion = {
    question_type: type,
    question_text: decodeEntities(String(q?.question_text ?? '')),
    required: Boolean(q?.required),
  };
  if (q?.question_id != null) out.question_id = Number(q.question_id);
  if (q?.instructions != null) out.instructions = decodeEntities(String(q.instructions));
  if (q?.max_allowed_characters != null) out.max_allowed_characters = Number(q.max_allowed_characters);
  if (q?.max_allowed_files != null) out.max_allowed_files = Number(q.max_allowed_files);
  if (Array.isArray(q?.options)) out.options = q.options.map((o: any) => ({ label: decodeEntities(String(o?.label ?? '')) }));
  return out;
}

/**
 * Initial state: the open draft's patch first (server-draft overlay), then Etsy's questions, then the legacy
 * single-field personalization. Text is entity-decoded once here (DS P5) and never re-encoded.
 */
export function personalizationStateFrom(input: {
  questions?: PersonalizationQuestion[] | null;
  legacy?: Partial<LegacyPersonalization> | null;
  draftPatch?: unknown;
}): PersonalizationState {
  const patch = input.draftPatch && typeof input.draftPatch === 'object' ? (input.draftPatch as Record<string, any>) : null;
  if (patch?.remove) return { enabled: false, questions: [] };
  if (patch && Array.isArray(patch.personalization_questions)) {
    return { enabled: patch.personalization_questions.length > 0, questions: patch.personalization_questions.map(decodeQuestion) };
  }
  if (Array.isArray(input.questions) && input.questions.length > 0) {
    return { enabled: true, questions: input.questions.map(decodeQuestion) };
  }
  const legacy = input.legacy;
  if (legacy?.is_personalizable) {
    return {
      enabled: true,
      questions: [{
        question_type: 'text_input',
        question_text: 'Personalization',
        instructions: decodeEntities(legacy.personalization_instructions || ''),
        required: Boolean(legacy.personalization_is_required),
        max_allowed_characters: legacy.personalization_char_count_max || 256,
      }],
    };
  }
  return { enabled: false, questions: [] };
}

/** The `personalization` patch the legacy Save buttons staged (same cleaning rules). */
export function buildPersonalizationPatch(state: PersonalizationState): Record<string, any> {
  if (!state.enabled || state.questions.length === 0) return { remove: true };
  return {
    personalization_questions: state.questions.map((q) => {
      const cleaned: Record<string, any> = {
        question_type: q.question_type,
        question_text: q.question_text.trim(),
        required: q.required,
      };
      if (q.instructions && q.question_type !== 'dropdown') cleaned.instructions = q.instructions;
      if (q.question_type === 'text_input') cleaned.max_allowed_characters = q.max_allowed_characters;
      if (q.question_type === 'dropdown') cleaned.options = q.options;
      if (isUpload(q.question_type)) cleaned.max_allowed_files = q.max_allowed_files;
      if (q.question_type === 'labeled_upload') cleaned.options = q.options;
      return cleaned;
    }),
  };
}

/** Comparable key of what would be staged (two states with the same key stage the same patch). */
export function personalizationKey(state: PersonalizationState): string {
  return JSON.stringify(buildPersonalizationPatch(state));
}

export function summarizePersonalization(state: PersonalizationState): PersonalizationSummary {
  const on = state.enabled && state.questions.length > 0;
  return { enabled: on, required: on && state.questions.some((q) => q.required), count: on ? state.questions.length : 0 };
}

/**
 * Etsy's question rules (the advanced editor's checks) as FieldErrors with `etsy`-namespace keys, plus the shared
 * `validateEtsyPersonalization` (server) rules. `params.index` is 1-based; `field` is `personalization` or
 * `personalization.<index>` for a per-question error.
 */
export function personalizationIssues(state: PersonalizationState): FieldError[] {
  if (!state.enabled || state.questions.length === 0) return [];
  const qs = state.questions;
  const out: FieldError[] = [];
  const push = (index: number | null, key: string, params: Record<string, string | number> = {}) => {
    out.push({ field: index == null ? 'personalization' : `personalization.${index}`, severity: 'block_sync', key: `personalization.${key}`, params, message: key });
  };
  if (qs.length > MAX_QUESTIONS) push(null, 'validateMaxQuestions', { max: MAX_QUESTIONS });
  if (qs.filter((q) => isUpload(q.question_type)).length > 1) push(null, 'validateMaxOneUpload');
  qs.forEach((q, i) => {
    const n = i + 1;
    const text = q.question_text.trim();
    if (text.length < 1 || text.length > QUESTION_TEXT_MAX) push(n, 'validateQuestionTextLength', { index: n });
    if (q.instructions && q.instructions.length > INSTRUCTIONS_MAX) push(n, 'validateInstructionsLength', { index: n });
    if (q.question_type === 'text_input' && (!q.max_allowed_characters || q.max_allowed_characters < 1 || q.max_allowed_characters > 1024)) {
      push(n, 'validateMaxCharRange', { index: n });
    }
    if (q.question_type === 'dropdown') {
      if (!q.options || q.options.length < 1 || q.options.length > DROPDOWN_OPTIONS_MAX) push(n, 'validateDropdownOptionsRange', { index: n });
      (q.options || []).forEach((o, j) => {
        if (!o.label || o.label.length > OPTION_LABEL_MAX) push(n, 'validateOptionLabelLength', { index: n, optIndex: j + 1 });
      });
    }
    if (isUpload(q.question_type)) {
      if (!q.max_allowed_files || q.max_allowed_files < 1 || q.max_allowed_files > 10) push(n, 'validateFileCountRange', { index: n });
      if (q.question_type === 'labeled_upload') {
        if (!q.options || q.options.length !== q.max_allowed_files) push(n, 'validateLabelCountMatch', { index: n });
        (q.options || []).forEach((o, j) => {
          if (!o.label || o.label.length > OPTION_LABEL_MAX) push(n, 'validateOptionLabelLength', { index: n, optIndex: j + 1 });
        });
      }
    }
  });
  return out;
}

/** True when the server would refuse to even store the patch (`block_save`): staging waits until it is fixed. */
export function personalizationBlocksSave(state: PersonalizationState): boolean {
  return validateEtsyPersonalization(buildPersonalizationPatch(state)).some((e) => e.severity === 'block_save');
}

/** Changing a question's type keeps text + required and resets type-specific fields (legacy rule). */
export function withQuestionType(q: PersonalizationQuestion, type: PersonalizationQuestionType): PersonalizationQuestion {
  const base: PersonalizationQuestion = { question_type: type, question_text: q.question_text, required: q.required };
  if (q.question_id != null) base.question_id = q.question_id;
  switch (type) {
    case 'text_input':
      base.max_allowed_characters = 256;
      base.instructions = q.instructions || '';
      break;
    case 'dropdown':
      base.options = [];
      break;
    case 'unlabeled_upload':
      base.max_allowed_files = 1;
      base.instructions = q.instructions || '';
      break;
    case 'labeled_upload':
      base.max_allowed_files = 1;
      base.options = [{ label: '' }];
      base.instructions = q.instructions || '';
      break;
  }
  return base;
}

/** Labeled uploads carry exactly one label per file. */
export function withFileCount(q: PersonalizationQuestion, count: number | null): PersonalizationQuestion {
  const clamped = count == null ? undefined : Math.min(Math.max(Math.round(count), 1), 10);
  const next: PersonalizationQuestion = { ...q, max_allowed_files: clamped };
  if (q.question_type === 'labeled_upload' && clamped) {
    const opts = [...(q.options || [])];
    while (opts.length < clamped) opts.push({ label: '' });
    next.options = opts.slice(0, clamped);
  }
  return next;
}

function createEmptyQuestion(): PersonalizationQuestion {
  return {
    question_type: 'text_input',
    question_text: '',
    instructions: '',
    required: false,
    max_allowed_characters: 256,
  };
}

// ─── Simple Mode Component ───────────────────────────────────────────────────

function SimpleModeEditor({
  listingId,
  shopId,
  initialQuestions,
  legacy,
  onSaved,
}: {
  listingId: string;
  shopId: string;
  initialQuestions: PersonalizationQuestion[];
  legacy: LegacyPersonalization;
  onSaved: () => void;
}) {
  const t = useTranslations('etsy.personalization');
  const existingTextQuestion = initialQuestions.find((q) => q.question_type === 'text_input');
  const [isPersonalizable, setIsPersonalizable] = useState(
    initialQuestions.length > 0 || legacy.is_personalizable
  );
  const [questionText, setQuestionText] = useState(existingTextQuestion?.question_text || 'Personalization');
  const [isRequired, setIsRequired] = useState(existingTextQuestion?.required ?? legacy.personalization_is_required);
  const [instructions, setInstructions] = useState(
    existingTextQuestion?.instructions || legacy.personalization_instructions || ''
  );
  const [charCountMax, setCharCountMax] = useState(
    existingTextQuestion?.max_allowed_characters || legacy.personalization_char_count_max || 256
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async (overrideOff?: boolean) => {
    const personalizable = overrideOff ? false : isPersonalizable;

    setSaving(true);
    try {
      await stageEtsyDraft({
        shopId,
        listingId,
        personalization: personalizable
          ? {
              personalization_questions: [{
                question_type: 'text_input',
                question_text: questionText.trim() || 'Personalization',
                instructions,
                required: isRequired,
                max_allowed_characters: Math.min(Math.max(charCountMax, 1), 1024),
              }],
            }
          : { remove: true },
      });

      if (overrideOff) {
        setIsPersonalizable(false);
      }

      toast.success(overrideOff ? 'Personalization removal saved to draft' : 'Personalization saved to draft');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || t('toastError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <FormControlLabel
        control={
          <Switch
            checked={isPersonalizable}
            onChange={(e) => setIsPersonalizable(e.target.checked)}
            disabled={saving}
          />
        }
        label={t('personalizationToggle')}
      />

      {isPersonalizable && (
        <>
          <TextField
            label={t('questionText')}
            size="small"
            fullWidth
            value={questionText}
            onChange={(e) => setQuestionText(e.target.value)}
            inputProps={{ maxLength: 45 }}
            helperText={t('charCount', { count: questionText.length })}
            disabled={saving}
            error={questionText.length > 45}
          />

          <FormControlLabel
            control={
              <Switch
                checked={isRequired}
                onChange={(e) => setIsRequired(e.target.checked)}
                size="small"
                disabled={saving}
              />
            }
            label={t('required')}
          />

          <TextField
            label={t('instructions')}
            size="small"
            fullWidth
            multiline
            rows={3}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={t('instructionsPlaceholder')}
            disabled={saving}
          />

          <TextField
            label={t('maxCharacters')}
            size="small"
            type="number"
            fullWidth
            value={charCountMax}
            onChange={(e) => {
              const val = parseInt(e.target.value) || 0;
              setCharCountMax(Math.min(Math.max(val, 0), 1024));
            }}
            inputProps={{ min: 1, max: 1024 }}
            helperText={t('maxCharactersHelper')}
            disabled={saving}
          />
        </>
      )}

      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button
          variant="contained"
          size="small"
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <icons.check size={16} strokeWidth={ICON_STROKE} />}
          onClick={() => handleSave()}
          disabled={saving}
        >
          {t('save')}
        </Button>

        {isPersonalizable && (
          <Button
            variant="outlined"
            color="error"
            size="small"
            onClick={() => handleSave(true)}
            disabled={saving}
          >
            {t('turnOffPersonalization')}
          </Button>
        )}
      </Box>
    </Box>
  );
}

// ─── Advanced Mode Component ─────────────────────────────────────────────────

function AdvancedModeEditor({
  listingId,
  shopId,
  initialQuestions,
  onSaved,
  onFallbackToLegacy,
}: {
  listingId: string;
  shopId: string;
  initialQuestions: PersonalizationQuestion[];
  onSaved: () => void;
  onFallbackToLegacy: () => void;
}) {
  const t = useTranslations('etsy.personalization');
  const confirmDialog = useConfirm();
  const [questions, setQuestions] = useState<PersonalizationQuestion[]>(
    initialQuestions.length > 0 ? initialQuestions : []
  );
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | false>(
    initialQuestions.length === 0 ? false : 0
  );
  const [newOptionText, setNewOptionText] = useState<Record<number, string>>({});

  const QUESTION_TYPE_LABELS: Record<PersonalizationQuestionType, string> = {
    text_input: t('typeTextInput'),
    dropdown: t('typeDropdown'),
    unlabeled_upload: t('typeUnlabeledUpload'),
    labeled_upload: t('typeLabeledUpload'),
  };

  const validateQuestions = useCallback((qs: PersonalizationQuestion[]): string | null => {
    if (qs.length === 0) {
      return t('validateMinOneQuestion');
    }
    if (qs.length > MAX_QUESTIONS) {
      return t('validateMaxQuestions', { max: MAX_QUESTIONS });
    }

    const uploadCount = qs.filter(
      (q) => q.question_type === 'unlabeled_upload' || q.question_type === 'labeled_upload'
    ).length;
    if (uploadCount > 1) {
      return t('validateMaxOneUpload');
    }

    for (let i = 0; i < qs.length; i++) {
      const q = qs[i];

      if (!q.question_text || q.question_text.length < 1 || q.question_text.length > 45) {
        return t('validateQuestionTextLength', { index: i + 1 });
      }
      if (q.instructions && q.instructions.length > 120) {
        return t('validateInstructionsLength', { index: i + 1 });
      }

      if (q.question_type === 'text_input') {
        if (!q.max_allowed_characters || q.max_allowed_characters < 1 || q.max_allowed_characters > 1024) {
          return t('validateMaxCharRange', { index: i + 1 });
        }
      }

      if (q.question_type === 'dropdown') {
        if (q.instructions) {
          return t('validateDropdownNoInstructions', { index: i + 1 });
        }
        if (!q.options || q.options.length < 1 || q.options.length > 30) {
          return t('validateDropdownOptionsRange', { index: i + 1 });
        }
        for (let j = 0; j < q.options.length; j++) {
          if (!q.options[j].label || q.options[j].label.length < 1 || q.options[j].label.length > 20) {
            return t('validateOptionLabelLength', { index: i + 1, optIndex: j + 1 });
          }
        }
      }

      if (q.question_type === 'unlabeled_upload' || q.question_type === 'labeled_upload') {
        if (!q.max_allowed_files || q.max_allowed_files < 1 || q.max_allowed_files > 10) {
          return t('validateFileCountRange', { index: i + 1 });
        }
        if (q.question_type === 'labeled_upload') {
          if (!q.options || q.options.length !== q.max_allowed_files) {
            return t('validateLabelCountMatch', { index: i + 1 });
          }
          for (let j = 0; j < q.options.length; j++) {
            if (!q.options[j].label || q.options[j].label.length < 1 || q.options[j].label.length > 20) {
              return t('validateOptionLabelLength', { index: i + 1, optIndex: j + 1 });
            }
          }
        }
      }
    }

    return null;
  }, [t]);

  const updateQuestion = useCallback(
    (index: number, updates: Partial<PersonalizationQuestion>) => {
      setQuestions((prev) => {
        const updated = [...prev];
        updated[index] = { ...updated[index], ...updates };
        return updated;
      });
    },
    []
  );

  const handleTypeChange = useCallback(
    (index: number, newType: PersonalizationQuestionType) => {
      setQuestions((prev) => {
        const updated = [...prev];
        const base: PersonalizationQuestion = {
          question_type: newType,
          question_text: updated[index].question_text,
          required: updated[index].required,
        };

        switch (newType) {
          case 'text_input':
            base.max_allowed_characters = 256;
            base.instructions = updated[index].instructions || '';
            break;
          case 'dropdown':
            base.options = [{ label: '' }];
            break;
          case 'unlabeled_upload':
            base.max_allowed_files = 1;
            base.instructions = updated[index].instructions || '';
            break;
          case 'labeled_upload':
            base.max_allowed_files = 1;
            base.options = [{ label: '' }];
            base.instructions = updated[index].instructions || '';
            break;
        }

        updated[index] = base;
        return updated;
      });
    },
    []
  );

  const addQuestion = useCallback(() => {
    if (questions.length >= MAX_QUESTIONS) {
      toast.error(t('toastMaxQuestions', { max: MAX_QUESTIONS }));
      return;
    }
    setQuestions((prev) => [...prev, createEmptyQuestion()]);
    setExpandedIndex(questions.length);
  }, [questions.length, t]);

  const removeQuestion = useCallback((index: number) => {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
    setExpandedIndex(false);
  }, []);

  const addOption = useCallback(
    (questionIndex: number) => {
      const text = (newOptionText[questionIndex] || '').trim();
      if (!text) return;
      if (text.length > 20) {
        toast.error(t('toastOptionLabelMax'));
        return;
      }

      setQuestions((prev) => {
        const updated = [...prev];
        const q = { ...updated[questionIndex] };
        const currentOptions = q.options || [];

        if (q.question_type === 'dropdown' && currentOptions.length >= 30) {
          toast.error(t('toastMaxDropdownOptions'));
          return prev;
        }

        q.options = [...currentOptions, { label: text }];
        updated[questionIndex] = q;
        return updated;
      });

      setNewOptionText((prev) => ({ ...prev, [questionIndex]: '' }));
    },
    [newOptionText, t]
  );

  const removeOption = useCallback((questionIndex: number, optionIndex: number) => {
    setQuestions((prev) => {
      const updated = [...prev];
      const q = { ...updated[questionIndex] };
      q.options = (q.options || []).filter((_, i) => i !== optionIndex);
      updated[questionIndex] = q;
      return updated;
    });
  }, []);

  const canAddUpload = useCallback(() => {
    return !questions.some(
      (q) => q.question_type === 'unlabeled_upload' || q.question_type === 'labeled_upload'
    );
  }, [questions]);

  const handleSave = async () => {
    const error = validateQuestions(questions);
    if (error) {
      toast.error(error);
      return;
    }

    setSaving(true);
    try {
      const payload = questions.map((q) => {
        const cleaned: Record<string, any> = {
          question_type: q.question_type,
          question_text: q.question_text,
          required: q.required,
        };

        if (q.instructions && q.question_type !== 'dropdown') {
          cleaned.instructions = q.instructions;
        }
        if (q.question_type === 'text_input') {
          cleaned.max_allowed_characters = q.max_allowed_characters;
        }
        if (q.question_type === 'dropdown') {
          cleaned.options = q.options;
        }
        if (q.question_type === 'unlabeled_upload' || q.question_type === 'labeled_upload') {
          cleaned.max_allowed_files = q.max_allowed_files;
        }
        if (q.question_type === 'labeled_upload') {
          cleaned.options = q.options;
        }

        return cleaned;
      });

      await stageEtsyDraft({ shopId, listingId, personalization: { personalization_questions: payload } });
      toast.success('Personalization questions saved to draft');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || t('toastError'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveAll = async () => {
    if (!(await confirmDialog({ title: t('confirmRemoveAll'), destructive: true }))) {
      return;
    }

    setRemoving(true);
    try {
      await stageEtsyDraft({ shopId, listingId, personalization: { remove: true } });

      setQuestions([]);
      toast.success('Personalization removal saved to draft');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || t('toastError'));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          {t('questionsTitle', { count: questions.length, max: MAX_QUESTIONS })}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {questions.length > 0 && (
            <Button
              variant="outlined"
              color="error"
              size="small"
              startIcon={removing ? <CircularProgress size={16} /> : <icons.delete size={16} strokeWidth={ICON_STROKE} />}
              onClick={handleRemoveAll}
              disabled={saving || removing}
            >
              {t('removeAll')}
            </Button>
          )}
          <Button
            variant="contained"
            size="small"
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <icons.check size={16} strokeWidth={ICON_STROKE} />}
            onClick={handleSave}
            disabled={saving || removing || questions.length === 0}
          >
            {t('save')}
          </Button>
        </Box>
      </Box>

      {questions.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, textAlign: 'center', py: 3 }}>
          {t('noQuestions')}
        </Typography>
      )}

      {questions.map((q, index) => (
        <Accordion
          key={index}
          expanded={expandedIndex === index}
          onChange={(_, isExpanded) => setExpandedIndex(isExpanded ? index : false)}
          sx={{ mb: 1 }}
        >
          <AccordionSummary expandIcon={<icons.disclosure size={18} strokeWidth={ICON_STROKE} />}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%', pr: 1 }}>
              <Chip
                label={QUESTION_TYPE_LABELS[q.question_type]}
                size="small"
                color="primary"
                variant="outlined"
              />
              <Typography variant="body2" sx={{ flexGrow: 1 }} noWrap>
                {q.question_text || t('questionPlaceholder', { index: index + 1 })}
              </Typography>
              {q.required && <Chip label={t('required')} size="small" color="warning" />}
              <IconButton
                size="small"
                color="error"
                onClick={(e) => {
                  e.stopPropagation();
                  removeQuestion(index);
                }}
              >
                <icons.delete size={16} strokeWidth={ICON_STROKE} />
              </IconButton>
            </Box>
          </AccordionSummary>

          <AccordionDetails>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* Question type selector */}
              <FormControl size="small" fullWidth>
                <InputLabel>{t('questionType')}</InputLabel>
                <Select
                  value={q.question_type}
                  label={t('questionType')}
                  onChange={(e) => {
                    const newType = e.target.value as PersonalizationQuestionType;
                    if (
                      (newType === 'unlabeled_upload' || newType === 'labeled_upload') &&
                      !canAddUpload() &&
                      q.question_type !== 'unlabeled_upload' &&
                      q.question_type !== 'labeled_upload'
                    ) {
                      toast.error(t('toastMaxOneUpload'));
                      return;
                    }
                    handleTypeChange(index, newType);
                  }}
                >
                  {Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => (
                    <MenuItem key={value} value={value}>
                      {label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {/* Question text */}
              <TextField
                label={t('questionText')}
                size="small"
                fullWidth
                value={q.question_text}
                onChange={(e) => updateQuestion(index, { question_text: e.target.value })}
                inputProps={{ maxLength: 45 }}
                helperText={t('charCount', { count: q.question_text.length })}
                error={q.question_text.length > 45 || (q.question_text.length > 0 && q.question_text.length < 1)}
              />

              {/* Instructions - not for dropdown */}
              {q.question_type !== 'dropdown' && (
                <TextField
                  label={t('instructionsOptional')}
                  size="small"
                  fullWidth
                  multiline
                  rows={2}
                  value={q.instructions || ''}
                  onChange={(e) => updateQuestion(index, { instructions: e.target.value })}
                  inputProps={{ maxLength: 120 }}
                  helperText={t('instructionsCharCount', { count: (q.instructions || '').length })}
                  error={(q.instructions || '').length > 120}
                />
              )}

              {/* Required toggle */}
              <FormControlLabel
                control={
                  <Switch
                    checked={q.required}
                    onChange={(e) => updateQuestion(index, { required: e.target.checked })}
                    size="small"
                  />
                }
                label={t('required')}
              />

              {/* Text input: max characters */}
              {q.question_type === 'text_input' && (
                <TextField
                  label={t('maxCharCount')}
                  size="small"
                  type="number"
                  fullWidth
                  value={q.max_allowed_characters || ''}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    updateQuestion(index, { max_allowed_characters: Math.min(Math.max(val, 0), 1024) });
                  }}
                  inputProps={{ min: 1, max: 1024 }}
                  helperText={t('maxCharRange')}
                  error={
                    q.max_allowed_characters !== undefined &&
                    (q.max_allowed_characters < 1 || q.max_allowed_characters > 1024)
                  }
                />
              )}

              {/* Upload types: max files */}
              {(q.question_type === 'unlabeled_upload' || q.question_type === 'labeled_upload') && (
                <TextField
                  label={t('maxFileCount')}
                  size="small"
                  type="number"
                  fullWidth
                  value={q.max_allowed_files || ''}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    const clamped = Math.min(Math.max(val, 0), 10);
                    const updates: Partial<PersonalizationQuestion> = { max_allowed_files: clamped };

                    // For labeled_upload, adjust options array to match file count
                    if (q.question_type === 'labeled_upload' && clamped > 0) {
                      const currentOptions = q.options || [];
                      if (currentOptions.length < clamped) {
                        const newOptions = [...currentOptions];
                        while (newOptions.length < clamped) {
                          newOptions.push({ label: '' });
                        }
                        updates.options = newOptions;
                      } else if (currentOptions.length > clamped) {
                        updates.options = currentOptions.slice(0, clamped);
                      }
                    }

                    updateQuestion(index, updates);
                  }}
                  inputProps={{ min: 1, max: 10 }}
                  helperText={t('maxFileRange')}
                  error={
                    q.max_allowed_files !== undefined &&
                    (q.max_allowed_files < 1 || q.max_allowed_files > 10)
                  }
                />
              )}

              {/* Dropdown options */}
              {q.question_type === 'dropdown' && (
                <Box>
                  <Typography variant="body2" fontWeight={500} sx={{ mb: 1 }}>
                    {t('options', { count: (q.options || []).length })}
                  </Typography>

                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                    {(q.options || []).map((opt, optIdx) => (
                      <Chip
                        key={optIdx}
                        label={opt.label || t('emptyOption')}
                        size="small"
                        onDelete={() => removeOption(index, optIdx)}
                        color={opt.label.length < 1 || opt.label.length > 20 ? 'error' : 'default'}
                      />
                    ))}
                  </Box>

                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                    <TextField
                      label={t('newOption')}
                      size="small"
                      value={newOptionText[index] || ''}
                      onChange={(e) =>
                        setNewOptionText((prev) => ({ ...prev, [index]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addOption(index);
                        }
                      }}
                      inputProps={{ maxLength: 20 }}
                      helperText={t('optionCharCount', { count: (newOptionText[index] || '').length })}
                      sx={{ flexGrow: 1 }}
                    />
                    <IconButton
                      color="primary"
                      onClick={() => addOption(index)}
                      disabled={(q.options || []).length >= 30}
                      sx={{ mt: 0.5 }}
                    >
                      <icons.add size={16} strokeWidth={ICON_STROKE} />
                    </IconButton>
                  </Box>
                </Box>
              )}

              {/* Labeled upload options */}
              {q.question_type === 'labeled_upload' && (
                <Box>
                  <Typography variant="body2" fontWeight={500} sx={{ mb: 1 }}>
                    {t('fileLabels')}
                  </Typography>

                  {(q.options || []).map((opt, optIdx) => (
                    <TextField
                      key={optIdx}
                      label={t('labelN', { index: optIdx + 1 })}
                      size="small"
                      fullWidth
                      value={opt.label}
                      onChange={(e) => {
                        setQuestions((prev) => {
                          const updated = [...prev];
                          const qCopy = { ...updated[index] };
                          const optsCopy = [...(qCopy.options || [])];
                          optsCopy[optIdx] = { label: e.target.value };
                          qCopy.options = optsCopy;
                          updated[index] = qCopy;
                          return updated;
                        });
                      }}
                      inputProps={{ maxLength: 20 }}
                      helperText={t('optionCharCount', { count: opt.label.length })}
                      error={opt.label.length < 1 || opt.label.length > 20}
                      sx={{ mb: 1 }}
                    />
                  ))}
                </Box>
              )}
            </Box>
          </AccordionDetails>
        </Accordion>
      ))}

      <Button
        variant="outlined"
        startIcon={<icons.add size={16} strokeWidth={ICON_STROKE} />}
        onClick={addQuestion}
        disabled={questions.length >= MAX_QUESTIONS || saving || removing}
        fullWidth
        sx={{ mt: 1 }}
      >
        {t('addQuestion')}
      </Button>
    </Box>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

const PersonalizationEditor = forwardRef<PersonalizationEditorHandle, PersonalizationEditorProps>(function PersonalizationEditor(
  props,
  ref,
) {
  if (props.embedded) return <EmbeddedPersonalizationEditor {...props} handleRef={ref} />;
  return <LegacyPersonalizationEditor {...props} onSaved={props.onSaved ?? (() => {})} />;
});

export default PersonalizationEditor;

function LegacyPersonalizationEditor({
  listingId,
  shopId,
  questions: initialQuestions,
  legacy,
  onSaved,
}: PersonalizationEditorProps & { onSaved: () => void }) {
  const t = useTranslations('etsy.personalization');
  const [advancedMode, setAdvancedMode] = useState(
    initialQuestions.length > 1 || initialQuestions.some((q) => q.question_type !== 'text_input')
  );

  const handleFallbackToLegacy = useCallback(() => {
    setAdvancedMode(false);
  }, []);

  return (
    <Box>
      {/* Mode toggle */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          {t('title')}
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={advancedMode}
              onChange={(e) => setAdvancedMode(e.target.checked)}
              size="small"
            />
          }
          label={
            <Typography variant="body2" color="text.secondary">
              {t('advancedMode')}
            </Typography>
          }
          labelPlacement="start"
          sx={{ mr: 0 }}
        />
      </Box>

      {advancedMode ? (
        <AdvancedModeEditor
          listingId={listingId}
          shopId={shopId}
          initialQuestions={initialQuestions}
          onSaved={onSaved}
          onFallbackToLegacy={handleFallbackToLegacy}
        />
      ) : (
        <SimpleModeEditor
          listingId={listingId}
          shopId={shopId}
          initialQuestions={initialQuestions}
          legacy={legacy}
          onSaved={onSaved}
        />
      )}
    </Box>
  );
}

// ─── Embedded mode (listing editor, DS inputs) ───────────────────────────────

type EmbeddedProps = PersonalizationEditorProps & { handleRef?: React.ForwardedRef<PersonalizationEditorHandle> };

function cloneState(state: PersonalizationState): PersonalizationState {
  return JSON.parse(JSON.stringify(state)) as PersonalizationState;
}

function EmbeddedPersonalizationEditor({
  listingId, shopId, questions, legacy, draftPatch, register, onChange, onSummaryChange, disabled, handleRef,
}: EmbeddedProps) {
  const t = useTranslations('listingEditor.personalization');
  const tEtsy = useTranslations('etsy');
  const [state, setState] = useState<PersonalizationState>(() => personalizationStateFrom({ questions, legacy, draftPatch }));
  // What is already in the draft (or live on Etsy when nothing is staged). Ref: updated synchronously on stage.
  const baselineRef = useRef<PersonalizationState>(cloneState(state));
  const [baselineVersion, setBaselineVersion] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const stagingRef = useRef<Promise<void> | null>(null);
  const editedRef = useRef(false);

  const dirty = useMemo(
    () => personalizationKey(state) !== personalizationKey(baselineRef.current),
    // baselineVersion: the baseline lives in a ref.
    [state, baselineVersion],
  );
  const issues = useMemo(() => personalizationIssues(state), [state]);

  const handle = useMemo<PersonalizationEditorHandle>(() => {
    const isDirtyNow = () => personalizationKey(stateRef.current) !== personalizationKey(baselineRef.current);
    const stageOnce = async () => {
      if (!isDirtyNow()) return;
      const snap = cloneState(stateRef.current);
      // A structurally invalid patch (block_save) is refused by the server; keep it dirty and report it via validate().
      if (personalizationBlocksSave(snap)) return;
      await stageEtsyDraft({ shopId, listingId, personalization: buildPersonalizationPatch(snap) });
      baselineRef.current = snap;
      setBaselineVersion((v) => v + 1);
    };
    return {
      isDirty: isDirtyNow,
      stage: async () => {
        while (stagingRef.current) {
          try { await stagingRef.current; } catch { /* earlier caller reports its own failure */ }
        }
        const run = stageOnce();
        stagingRef.current = run;
        try { await run; } finally { stagingRef.current = null; }
      },
      revert: () => setState(cloneState(baselineRef.current)),
      validate: () => {
        const errs = personalizationIssues(stateRef.current);
        if (personalizationBlocksSave(stateRef.current)) {
          for (const e of validateEtsyPersonalization(buildPersonalizationPatch(stateRef.current))) {
            if (e.severity === 'block_save') errs.push(e);
          }
        }
        return errs;
      },
      summary: () => summarizePersonalization(stateRef.current),
    };
  }, [shopId, listingId]);

  useImperativeHandle(handleRef, () => handle, [handle]);

  useEffect(() => {
    if (!register) return undefined;
    return register({ id: 'personalization', isDirty: handle.isDirty, stage: handle.stage, validate: handle.validate });
  }, [register, handle]);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSummaryRef = useRef(onSummaryChange);
  onSummaryRef.current = onSummaryChange;
  useEffect(() => {
    onSummaryRef.current?.(summarizePersonalization(state));
    if (editedRef.current) onChangeRef.current?.(dirty);
  }, [state, dirty]);

  const update = (fn: (prev: PersonalizationState) => PersonalizationState) => {
    editedRef.current = true;
    setState(fn);
  };
  const updateQuestion = (index: number, fn: (q: PersonalizationQuestion) => PersonalizationQuestion) =>
    update((prev) => ({ ...prev, questions: prev.questions.map((q, i) => (i === index ? fn(q) : q)) }));

  const hasUpload = state.questions.some((q) => isUpload(q.question_type));
  const issueFor = (index: number): string | null => {
    const e = issues.find((x) => x.field === `personalization.${index}`);
    return e?.key && tEtsy.has(e.key as any) ? tEtsy(e.key as any, e.params as any) : null;
  };
  const generalIssue = (() => {
    const e = issues.find((x) => x.field === 'personalization');
    return e?.key && tEtsy.has(e.key as any) ? tEtsy(e.key as any, e.params as any) : null;
  })();

  const typeOptions = (current: PersonalizationQuestionType) => ([
    { value: 'text_input' as const, label: t('typeText') },
    { value: 'dropdown' as const, label: t('typeDropdown') },
    { value: 'unlabeled_upload' as const, label: t('typeUpload'), disabled: hasUpload && !isUpload(current) },
    { value: 'labeled_upload' as const, label: t('typeLabeledUpload'), disabled: hasUpload && !isUpload(current) },
  ]);

  const toggle = (on: boolean) => update((prev) => {
    if (!on) return { ...prev, enabled: false };
    // Turning it back on restores the questions the seller had; a first switch-on starts one text question.
    const qs = prev.questions.length > 0 ? prev.questions : [{ question_type: 'text_input' as const, question_text: '', instructions: '', required: false, max_allowed_characters: 256 }];
    return { enabled: true, questions: qs };
  });

  return (
    <Box data-testid="personalization-editor-embedded" sx={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: 720 }}>
      <DsSwitch checked={state.enabled} onChange={toggle} label={t('toggle')} description={t('toggleHelp')} disabled={disabled} />
      {state.enabled && (
        <>
          {state.questions.map((q, i) => {
            const n = i + 1;
            const qError = issueFor(n);
            return (
              <Box
                key={i}
                data-testid={`personalization-question-${n}`}
                sx={{ border: `1px solid ${neutral[200]}`, borderRadius: `${radius.md}px`, p: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>{t('questionN', { index: n })}</Typography>
                  <DsIconButton
                    icon={icons.delete}
                    label={t('removeQuestion', { index: n })}
                    tone="danger"
                    disabled={disabled}
                    onClick={() => update((prev) => {
                      const rest = prev.questions.filter((_, j) => j !== i);
                      return { enabled: rest.length > 0, questions: rest };
                    })}
                  />
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' }, gap: '12px' }}>
                  <FormField label={t('questionText')} counter={{ value: q.question_text.length, max: QUESTION_TEXT_MAX }} error={qError}>
                    <DsTextField
                      value={q.question_text}
                      onChange={(v) => updateQuestion(i, (x) => ({ ...x, question_text: v }))}
                      maxLength={QUESTION_TEXT_MAX}
                      placeholder={t('questionPlaceholder')}
                      disabled={disabled}
                    />
                  </FormField>
                  <FormField label={t('answerType')}>
                    <DsSelect<PersonalizationQuestionType>
                      value={q.question_type}
                      onChange={(v) => updateQuestion(i, (x) => withQuestionType(x, v))}
                      options={typeOptions(q.question_type)}
                      disabled={disabled}
                    />
                  </FormField>
                </Box>
                {q.question_type !== 'dropdown' && (
                  <FormField label={t('instructions')} optional counter={{ value: (q.instructions || '').length, max: INSTRUCTIONS_MAX }}>
                    <TextArea
                      value={q.instructions || ''}
                      onChange={(v) => updateQuestion(i, (x) => ({ ...x, instructions: v }))}
                      maxLength={INSTRUCTIONS_MAX}
                      minRows={2}
                      maxRows={4}
                      placeholder={t('instructionsPlaceholder')}
                      disabled={disabled}
                    />
                  </FormField>
                )}
                {q.question_type === 'text_input' && (
                  <FormField label={t('charLimit')} helper={t('charLimitHelp')} width="short">
                    <NumberField
                      value={q.max_allowed_characters ?? null}
                      onChange={(v) => updateQuestion(i, (x) => ({ ...x, max_allowed_characters: v ?? undefined }))}
                      min={1}
                      max={1024}
                      disabled={disabled}
                    />
                  </FormField>
                )}
                {isUpload(q.question_type) && (
                  <FormField label={t('fileCount')} helper={t('fileCountHelp')} width="short">
                    <NumberField
                      value={q.max_allowed_files ?? null}
                      onChange={(v) => updateQuestion(i, (x) => withFileCount(x, v))}
                      min={1}
                      max={10}
                      disabled={disabled}
                    />
                  </FormField>
                )}
                {q.question_type === 'dropdown' && (
                  <FormField label={t('choices')} counter={{ value: (q.options || []).length, max: DROPDOWN_OPTIONS_MAX }} helper={t('choicesHelp')}>
                    <TagInput
                      value={(q.options || []).map((o) => o.label)}
                      onChange={(labels) => updateQuestion(i, (x) => ({ ...x, options: labels.map((label) => ({ label })) }))}
                      max={DROPDOWN_OPTIONS_MAX}
                      maxLength={OPTION_LABEL_MAX}
                      placeholder={t('choicesPlaceholder')}
                      disabled={disabled}
                    />
                  </FormField>
                )}
                {q.question_type === 'labeled_upload' && (q.options || []).map((o, j) => (
                  <FormField key={j} label={t('fileLabel', { index: j + 1 })} counter={{ value: o.label.length, max: OPTION_LABEL_MAX }}>
                    <DsTextField
                      value={o.label}
                      onChange={(v) => updateQuestion(i, (x) => ({ ...x, options: (x.options || []).map((opt, k) => (k === j ? { label: v } : opt)) }))}
                      maxLength={OPTION_LABEL_MAX}
                      disabled={disabled}
                    />
                  </FormField>
                ))}
                <DsSwitch
                  checked={q.required}
                  onChange={(v) => updateQuestion(i, (x) => ({ ...x, required: v }))}
                  label={t('required')}
                  disabled={disabled}
                />
              </Box>
            );
          })}
          {generalIssue && (
            <Typography variant="caption" role="alert" sx={{ color: 'error.main' }}>{generalIssue}</Typography>
          )}
          <Box>
            <DsButton
              variant="ghost"
              size="sm"
              icon={icons.add}
              disabled={disabled || state.questions.length >= MAX_QUESTIONS}
              disabledReason={state.questions.length >= MAX_QUESTIONS ? t('maxQuestions', { max: MAX_QUESTIONS }) : undefined}
              onClick={() => update((prev) => ({
                ...prev,
                questions: [...prev.questions, { question_type: 'text_input', question_text: '', instructions: '', required: false, max_allowed_characters: 256 }],
              }))}
            >
              {t('addQuestion')}
            </DsButton>
          </Box>
        </>
      )}
    </Box>
  );
}
