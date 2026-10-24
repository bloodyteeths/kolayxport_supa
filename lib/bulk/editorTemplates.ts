// lib/bulk/editorTemplates.ts — saved bulk-edit templates ("Christmas: price −15% + these tags + this shipping
// profile"). A template is a named list of steps; each step is exactly what one of the listings page's bulk dialogs
// stages (Change price, Tags, Set field), saved from that dialog and replayed on the selected listings later.
// Applying STAGES drafts like the dialogs do; nothing reaches the marketplace before "Send N changes".
// Shared by the API (validation) and the client (types); no React / component imports here.

export const TEMPLATE_LIMITS = { perUser: 50, steps: 10, name: 60, tags: 13, tagLen: 20, text: 102400 } as const;

export const TEMPLATE_PRICE_MODES = ['set', 'incPct', 'decPct', 'incAmt', 'decAmt'] as const;
export const TEMPLATE_PRICE_ROUNDS = ['99', '00', 'none'] as const;
export const TEMPLATE_TAG_MODES = ['add', 'remove', 'replace'] as const;
/** Same keys as SetFieldModal SET_FIELD_KEYS (a test keeps them equal). */
export const TEMPLATE_FIELD_KEYS = ['shipping', 'returnPolicy', 'processing', 'category', 'itemDetails', 'materials', 'description', 'personalization', 'weight', 'dimensions'] as const;

export type TemplatePriceStep = { kind: 'price'; mode: (typeof TEMPLATE_PRICE_MODES)[number]; value: number; round: (typeof TEMPLATE_PRICE_ROUNDS)[number] };
export type TemplateTagsStep = { kind: 'tags'; mode: (typeof TEMPLATE_TAG_MODES)[number]; tags: string[] };
/** `value` is SetFieldModal's SetFieldValue (validated loosely here; the dialog's builder validates it again on apply). */
export type TemplateFieldStep = { kind: 'field'; key: (typeof TEMPLATE_FIELD_KEYS)[number]; value: Record<string, unknown> };
export type TemplateStep = TemplatePriceStep | TemplateTagsStep | TemplateFieldStep;

export interface EditorTemplate {
  id: string;
  name: string;
  marketplace: 'etsy';
  steps: TemplateStep[];
  updatedAt: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const oneOf = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => typeof v === 'string' && (list as readonly string[]).includes(v);

/** Field values allowed in a step (SetFieldValue keys); anything else is dropped. */
const FIELD_VALUE_KEYS = new Set([
  'shippingProfileId', 'returnPolicyId', 'readinessStateId', 'taxonomyId', 'whoMade', 'whenMade', 'supply', 'materials', 'materialsMode',
  'description', 'descriptionMode', 'personalization', 'personalizationRequired', 'personalizationInstructions', 'personalizationMaxChars',
  'weight', 'weightUnit', 'length', 'width', 'height', 'dimensionsUnit',
]);

/** A stored or posted step, normalised; null when it is not a valid step (pure). */
export function normaliseTemplateStep(raw: unknown): TemplateStep | null {
  if (!isObj(raw)) return null;
  if (raw.kind === 'price') {
    const value = Number(raw.value);
    if (!oneOf(TEMPLATE_PRICE_MODES, raw.mode) || !oneOf(TEMPLATE_PRICE_ROUNDS, raw.round) || !Number.isFinite(value) || value < 0 || value > 1_000_000) return null;
    if ((raw.mode === 'incPct' || raw.mode === 'decPct') && value > 1000) return null;
    if (raw.mode === 'set' && value === 0) return null;
    return { kind: 'price', mode: raw.mode, value, round: raw.round };
  }
  if (raw.kind === 'tags') {
    if (!oneOf(TEMPLATE_TAG_MODES, raw.mode) || !Array.isArray(raw.tags)) return null;
    const seen = new Set<string>();
    const tags = raw.tags
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim().slice(0, TEMPLATE_LIMITS.tagLen))
      .filter((x) => x && !seen.has(x.toLocaleLowerCase()) && seen.add(x.toLocaleLowerCase()))
      .slice(0, TEMPLATE_LIMITS.tags);
    return tags.length ? { kind: 'tags', mode: raw.mode, tags } : null;
  }
  if (raw.kind === 'field') {
    if (!oneOf(TEMPLATE_FIELD_KEYS, raw.key) || !isObj(raw.value)) return null;
    const value: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw.value)) {
      if (!FIELD_VALUE_KEYS.has(k)) continue;
      if (typeof v === 'string') value[k] = v.slice(0, TEMPLATE_LIMITS.text);
      else if (typeof v === 'number' && Number.isFinite(v)) value[k] = v;
      else if (typeof v === 'boolean' || v === null) value[k] = v;
      else if (Array.isArray(v)) value[k] = v.filter((x) => typeof x === 'string').slice(0, 13).map((x: string) => x.slice(0, 45));
    }
    return Object.keys(value).length ? { kind: 'field', key: raw.key, value } : null;
  }
  return null;
}

/**
 * A step added to a template (pure): one price step at most (a new one replaces it), one step per field key
 * (same), tag steps accumulate in order. Capped at TEMPLATE_LIMITS.steps.
 */
export function addTemplateStep(steps: TemplateStep[], step: TemplateStep): TemplateStep[] {
  const kept = steps.filter((s) => {
    if (step.kind === 'price') return s.kind !== 'price';
    if (step.kind === 'field') return !(s.kind === 'field' && s.key === step.key);
    return true;
  });
  return [...kept, step].slice(-TEMPLATE_LIMITS.steps);
}

/** Stored JSON → steps (drops anything invalid, pure). */
export function templateStepsOf(raw: unknown): TemplateStep[] {
  return (Array.isArray(raw) ? raw : []).map(normaliseTemplateStep).filter((s): s is TemplateStep => s !== null).slice(0, TEMPLATE_LIMITS.steps);
}

export function normaliseTemplateName(raw: unknown): string | null {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, TEMPLATE_LIMITS.name) : '';
  return name || null;
}
