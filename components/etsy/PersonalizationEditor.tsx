import React, { useState, useCallback } from 'react';
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
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import SaveIcon from '@mui/icons-material/Save';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import { stageEtsyDraft } from '@/lib/etsy/draftClient';

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

interface LegacyPersonalization {
  is_personalizable: boolean;
  personalization_is_required: boolean;
  personalization_instructions: string;
  personalization_char_count_max: number;
}

interface PersonalizationEditorProps {
  listingId: string;
  shopId: string;
  questions: PersonalizationQuestion[];
  legacy: LegacyPersonalization;
  onSaved: () => void;
}

const MAX_QUESTIONS = 5;

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
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
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
    if (!confirm(t('confirmRemoveAll'))) {
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
              startIcon={removing ? <CircularProgress size={16} /> : <DeleteSweepIcon />}
              onClick={handleRemoveAll}
              disabled={saving || removing}
            >
              {t('removeAll')}
            </Button>
          )}
          <Button
            variant="contained"
            size="small"
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
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
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
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
                <DeleteIcon fontSize="small" />
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
                      <AddIcon />
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
        startIcon={<AddIcon />}
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

export default function PersonalizationEditor({
  listingId,
  shopId,
  questions: initialQuestions,
  legacy,
  onSaved,
}: PersonalizationEditorProps) {
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
