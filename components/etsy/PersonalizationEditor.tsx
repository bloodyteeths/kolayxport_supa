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

interface PersonalizationEditorProps {
  listingId: string;
  shopId: string;
  apiKey: string;
  questions: PersonalizationQuestion[];
  onSaved: () => void;
}

const QUESTION_TYPE_LABELS: Record<PersonalizationQuestionType, string> = {
  text_input: 'Metin Girisi',
  dropdown: 'Acilir Menu',
  unlabeled_upload: 'Dosya Yukleme',
  labeled_upload: 'Etiketli Dosya Yukleme',
};

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

function validateQuestions(questions: PersonalizationQuestion[]): string | null {
  if (questions.length === 0) {
    return 'En az bir soru eklemelisiniz';
  }
  if (questions.length > MAX_QUESTIONS) {
    return `Maksimum ${MAX_QUESTIONS} soru eklenebilir`;
  }

  const uploadCount = questions.filter(
    (q) => q.question_type === 'unlabeled_upload' || q.question_type === 'labeled_upload'
  ).length;
  if (uploadCount > 1) {
    return 'Listeleme basina en fazla 1 yukleme sorusu eklenebilir';
  }

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];

    if (!q.question_text || q.question_text.length < 1 || q.question_text.length > 45) {
      return `Soru ${i + 1}: Soru metni 1-45 karakter olmalidir`;
    }
    if (q.instructions && q.instructions.length > 120) {
      return `Soru ${i + 1}: Talimatlar en fazla 120 karakter olmalidir`;
    }

    if (q.question_type === 'text_input') {
      if (!q.max_allowed_characters || q.max_allowed_characters < 1 || q.max_allowed_characters > 1024) {
        return `Soru ${i + 1}: Maksimum karakter sayisi 1-1024 araliginda olmalidir`;
      }
    }

    if (q.question_type === 'dropdown') {
      if (q.instructions) {
        return `Soru ${i + 1}: Acilir menu sorularinda talimat alani kullanilamaz`;
      }
      if (!q.options || q.options.length < 1 || q.options.length > 30) {
        return `Soru ${i + 1}: Acilir menu icin 1-30 arasi secenek gereklidir`;
      }
      for (let j = 0; j < q.options.length; j++) {
        if (!q.options[j].label || q.options[j].label.length < 1 || q.options[j].label.length > 20) {
          return `Soru ${i + 1}, secenek ${j + 1}: Etiket 1-20 karakter olmalidir`;
        }
      }
    }

    if (q.question_type === 'unlabeled_upload' || q.question_type === 'labeled_upload') {
      if (q.max_allowed_files !== undefined) {
        if (q.max_allowed_files < 1 || q.max_allowed_files > 10) {
          return `Soru ${i + 1}: Dosya sayisi 1-10 araliginda olmalidir`;
        }
      }
      if (q.question_type === 'labeled_upload' && q.options && q.max_allowed_files) {
        if (q.options.length !== q.max_allowed_files) {
          return `Soru ${i + 1}: Etiket sayisi dosya sayisina esit olmalidir`;
        }
      }
    }
  }

  return null;
}

export default function PersonalizationEditor({
  listingId,
  shopId,
  apiKey,
  questions: initialQuestions,
  onSaved,
}: PersonalizationEditorProps) {
  const [questions, setQuestions] = useState<PersonalizationQuestion[]>(
    initialQuestions.length > 0 ? initialQuestions : []
  );
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | false>(
    initialQuestions.length === 0 ? false : 0
  );
  const [newOptionText, setNewOptionText] = useState<Record<number, string>>({});

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
      toast.error(`Maksimum ${MAX_QUESTIONS} soru eklenebilir`);
      return;
    }
    setQuestions((prev) => [...prev, createEmptyQuestion()]);
    setExpandedIndex(questions.length);
  }, [questions.length]);

  const removeQuestion = useCallback((index: number) => {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
    setExpandedIndex(false);
  }, []);

  const addOption = useCallback(
    (questionIndex: number) => {
      const text = (newOptionText[questionIndex] || '').trim();
      if (!text) return;
      if (text.length > 20) {
        toast.error('Secenek etiketi en fazla 20 karakter olmalidir');
        return;
      }

      setQuestions((prev) => {
        const updated = [...prev];
        const q = { ...updated[questionIndex] };
        const currentOptions = q.options || [];

        if (q.question_type === 'dropdown' && currentOptions.length >= 30) {
          toast.error('Acilir menude en fazla 30 secenek olabilir');
          return prev;
        }

        q.options = [...currentOptions, { label: text }];
        updated[questionIndex] = q;
        return updated;
      });

      setNewOptionText((prev) => ({ ...prev, [questionIndex]: '' }));
    },
    [newOptionText]
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

      const res = await fetch(
        `/api/clawd/etsy?action=set_personalization&listing_id=${listingId}&shop_id=${shopId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
          },
          body: JSON.stringify({ personalization_questions: payload }),
        }
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Kisisellestirme kaydedilemedi');
      }

      toast.success('Kisisellestirme sorulari kaydedildi');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Bir hata olustu');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveAll = async () => {
    if (!confirm('Tum kisisellestirme sorularini kaldirmak istediginizden emin misiniz?')) {
      return;
    }

    setRemoving(true);
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=remove_personalization&listing_id=${listingId}&shop_id=${shopId}`,
        {
          method: 'POST',
          headers: { 'x-api-key': apiKey },
        }
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Kisisellestirme kaldirilamadi');
      }

      setQuestions([]);
      toast.success('Tum kisisellestirme sorulari kaldirildi');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Bir hata olustu');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          Kisisellestirme Sorulari ({questions.length}/{MAX_QUESTIONS})
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
              Tumunu Kaldir
            </Button>
          )}
          <Button
            variant="contained"
            size="small"
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
            onClick={handleSave}
            disabled={saving || removing || questions.length === 0}
          >
            Kaydet
          </Button>
        </Box>
      </Box>

      {questions.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, textAlign: 'center', py: 3 }}>
          Henuz kisisellestirme sorusu eklenmemis. Asagidaki butonu kullanarak soru ekleyebilirsiniz.
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
                {q.question_text || `Soru ${index + 1}`}
              </Typography>
              {q.required && <Chip label="Zorunlu" size="small" color="warning" />}
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
                <InputLabel>Soru Tipi</InputLabel>
                <Select
                  value={q.question_type}
                  label="Soru Tipi"
                  onChange={(e) => {
                    const newType = e.target.value as PersonalizationQuestionType;
                    if (
                      (newType === 'unlabeled_upload' || newType === 'labeled_upload') &&
                      !canAddUpload() &&
                      q.question_type !== 'unlabeled_upload' &&
                      q.question_type !== 'labeled_upload'
                    ) {
                      toast.error('Listeleme basina en fazla 1 yukleme sorusu eklenebilir');
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
                label="Soru Metni"
                size="small"
                fullWidth
                value={q.question_text}
                onChange={(e) => updateQuestion(index, { question_text: e.target.value })}
                inputProps={{ maxLength: 45 }}
                helperText={`${q.question_text.length}/45 karakter`}
                error={q.question_text.length > 45 || (q.question_text.length > 0 && q.question_text.length < 1)}
              />

              {/* Instructions - not for dropdown */}
              {q.question_type !== 'dropdown' && (
                <TextField
                  label="Talimatlar (opsiyonel)"
                  size="small"
                  fullWidth
                  multiline
                  rows={2}
                  value={q.instructions || ''}
                  onChange={(e) => updateQuestion(index, { instructions: e.target.value })}
                  inputProps={{ maxLength: 120 }}
                  helperText={`${(q.instructions || '').length}/120 karakter`}
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
                label="Zorunlu"
              />

              {/* Text input: max characters */}
              {q.question_type === 'text_input' && (
                <TextField
                  label="Maksimum Karakter Sayisi"
                  size="small"
                  type="number"
                  fullWidth
                  value={q.max_allowed_characters || ''}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    updateQuestion(index, { max_allowed_characters: Math.min(Math.max(val, 0), 1024) });
                  }}
                  inputProps={{ min: 1, max: 1024 }}
                  helperText="1-1024 arasi"
                  error={
                    q.max_allowed_characters !== undefined &&
                    (q.max_allowed_characters < 1 || q.max_allowed_characters > 1024)
                  }
                />
              )}

              {/* Upload types: max files */}
              {(q.question_type === 'unlabeled_upload' || q.question_type === 'labeled_upload') && (
                <TextField
                  label="Maksimum Dosya Sayisi"
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
                  helperText="1-10 arasi"
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
                    Secenekler ({(q.options || []).length}/30)
                  </Typography>

                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                    {(q.options || []).map((opt, optIdx) => (
                      <Chip
                        key={optIdx}
                        label={opt.label || '(bos)'}
                        size="small"
                        onDelete={() => removeOption(index, optIdx)}
                        color={opt.label.length < 1 || opt.label.length > 20 ? 'error' : 'default'}
                      />
                    ))}
                  </Box>

                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                    <TextField
                      label="Yeni secenek"
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
                      helperText={`${(newOptionText[index] || '').length}/20 karakter`}
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
                    Dosya Etiketleri (dosya sayisina esit olmalidir)
                  </Typography>

                  {(q.options || []).map((opt, optIdx) => (
                    <TextField
                      key={optIdx}
                      label={`Etiket ${optIdx + 1}`}
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
                      helperText={`${opt.label.length}/20 karakter`}
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
        Soru Ekle
      </Button>
    </Box>
  );
}
