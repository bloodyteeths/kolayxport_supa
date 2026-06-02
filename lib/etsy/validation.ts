// Etsy listing client-side validators.
//
// These mirror the rules Etsy actually enforces on POST/PATCH /listings.
// Goal: catch the 80% of "Etsy 400 ..." failures BEFORE the user wastes a sync.
//
// The returned `ValidationResult` is consumed by ListingEditorDrawer to:
//   - star required field labels,
//   - render inline errors,
//   - gate the Save Draft / Sync to Etsy buttons,
//   - assemble a top-banner summary.
//
// Two severities:
//   - "block_sync": the listing will fail when sent to Etsy. Block sync, allow
//     local draft save (user may still be editing).
//   - "block_save": the value is structurally wrong and we should never put it
//     in the local draft either (e.g. a 50-char tag). These also block sync.
//
// All validators here are pure. No fetch, no I/O.

export type ErrorSeverity = 'block_save' | 'block_sync';

export interface FieldError {
  field: string;
  severity: ErrorSeverity;
  message: string;
}

export interface EditableFieldsLite {
  title?: string;
  description?: string;
  tags?: string[];
  materials?: string[];
  price?: string | number;
  quantity?: number;
  who_made?: string;
  when_made?: string;
  is_supply?: boolean;
  taxonomy_id?: number | string | '';
  shipping_profile_id?: number | string | '';
}

// Etsy hard limits (from the Open API v3 reference)
export const ETSY_LIMITS = {
  TITLE_MAX: 140,
  DESCRIPTION_MAX: 13_000,
  TAG_MAX: 13,
  TAG_LEN_MAX: 20,
  MATERIAL_MAX: 13,
  MATERIAL_LEN_MAX: 45,
} as const;

// Title may not contain ^, $, `, % and a handful of other punctuation.
// Etsy is famously inconsistent here; this matches what their UI bounces.
const TITLE_FORBIDDEN_RE = /[\^$`%]/;

// Tag / material allowed characters: letters, numbers, spaces, hyphens, and
// straight apostrophes. Etsy rejects curly quotes, slashes, &, +, etc.
const TAG_INVALID_CHAR_RE = /[^a-zA-Z0-9À-ſ\s'-]/;

export const ETSY_WHO_MADE_VALUES = ['i_did', 'collective', 'someone_else'] as const;

export const ETSY_WHEN_MADE_VALUES = [
  'made_to_order',
  '2020_2025',
  '2010_2019',
  '2004_2009',
  'before_2004',
  '2000_2003',
  '1990s',
  '1980s',
  '1970s',
  '1960s',
] as const;

export function validateEtsyFields(fields: EditableFieldsLite): FieldError[] {
  const errors: FieldError[] = [];

  // -- Title --------------------------------------------------------------
  const title = (fields.title ?? '').trim();
  if (!title) {
    errors.push({ field: 'title', severity: 'block_sync', message: 'Başlık boş olamaz.' });
  } else if (title.length > ETSY_LIMITS.TITLE_MAX) {
    errors.push({
      field: 'title',
      severity: 'block_save',
      message: `Başlık ${ETSY_LIMITS.TITLE_MAX} karakteri aşamaz (şu an ${title.length}).`,
    });
  } else if (TITLE_FORBIDDEN_RE.test(title)) {
    errors.push({
      field: 'title',
      severity: 'block_sync',
      message: 'Başlıkta Etsy\'nin kabul etmediği karakterler var (^, $, `, %). Onları kaldır.',
    });
  }

  // -- Description --------------------------------------------------------
  const description = (fields.description ?? '').trim();
  if (!description) {
    errors.push({ field: 'description', severity: 'block_sync', message: 'Açıklama boş olamaz.' });
  } else if (description.length > ETSY_LIMITS.DESCRIPTION_MAX) {
    errors.push({
      field: 'description',
      severity: 'block_save',
      message: `Açıklama ${ETSY_LIMITS.DESCRIPTION_MAX.toLocaleString()} karakteri aşamaz.`,
    });
  }

  // -- Tags ---------------------------------------------------------------
  const tags = fields.tags ?? [];
  if (tags.length > ETSY_LIMITS.TAG_MAX) {
    errors.push({
      field: 'tags',
      severity: 'block_save',
      message: `En fazla ${ETSY_LIMITS.TAG_MAX} etiket olabilir (şu an ${tags.length}).`,
    });
  }
  for (const tag of tags) {
    const t = (tag ?? '').trim();
    if (!t) continue;
    if (t.length > ETSY_LIMITS.TAG_LEN_MAX) {
      errors.push({
        field: 'tags',
        severity: 'block_save',
        message: `"${t.slice(0, 28)}…" etiketi ${ETSY_LIMITS.TAG_LEN_MAX} karakteri aşıyor.`,
      });
      break; // one error per category is enough for the UI
    }
    if (TAG_INVALID_CHAR_RE.test(t)) {
      errors.push({
        field: 'tags',
        severity: 'block_sync',
        message: `"${t}" etiketinde Etsy'nin kabul etmediği karakter var. Sadece harf, rakam, boşluk ve tire kullan.`,
      });
      break;
    }
  }

  // -- Materials ----------------------------------------------------------
  const materials = fields.materials ?? [];
  if (materials.length > ETSY_LIMITS.MATERIAL_MAX) {
    errors.push({
      field: 'materials',
      severity: 'block_save',
      message: `En fazla ${ETSY_LIMITS.MATERIAL_MAX} malzeme olabilir (şu an ${materials.length}).`,
    });
  }
  for (const m of materials) {
    const v = (m ?? '').trim();
    if (!v) continue;
    if (v.length > ETSY_LIMITS.MATERIAL_LEN_MAX) {
      errors.push({
        field: 'materials',
        severity: 'block_save',
        message: `"${v.slice(0, 32)}…" malzeme adı ${ETSY_LIMITS.MATERIAL_LEN_MAX} karakteri aşıyor.`,
      });
      break;
    }
    if (TAG_INVALID_CHAR_RE.test(v)) {
      errors.push({
        field: 'materials',
        severity: 'block_sync',
        message: `"${v}" malzeme adında Etsy'nin kabul etmediği karakter var.`,
      });
      break;
    }
  }

  // -- Price --------------------------------------------------------------
  const priceNum =
    typeof fields.price === 'number'
      ? fields.price
      : parseFloat(String(fields.price ?? '').replace(',', '.'));
  if (fields.price !== undefined && fields.price !== '' && fields.price !== null) {
    if (Number.isNaN(priceNum) || priceNum <= 0) {
      errors.push({
        field: 'price',
        severity: 'block_sync',
        message: 'Fiyat 0\'dan büyük bir sayı olmalı.',
      });
    }
  } else {
    errors.push({ field: 'price', severity: 'block_sync', message: 'Fiyat zorunlu.' });
  }

  // -- Quantity -----------------------------------------------------------
  if (fields.quantity == null || !Number.isFinite(fields.quantity) || fields.quantity < 1) {
    errors.push({
      field: 'quantity',
      severity: 'block_sync',
      message: 'Adet en az 1 olmalı.',
    });
  }

  // -- The Etsy provenance trio ------------------------------------------
  // Etsy rejects partial updates of (who_made, when_made, is_supply). We
  // backfill from the live listing in syncDraft, but if all three are blank
  // there's nothing to backfill — surface that upfront.
  const who = fields.who_made;
  const when = fields.when_made;
  const isSupply = fields.is_supply;
  if (!who) {
    errors.push({ field: 'who_made', severity: 'block_sync', message: '"Kim yaptı?" seç.' });
  } else if (!(ETSY_WHO_MADE_VALUES as readonly string[]).includes(who)) {
    errors.push({ field: 'who_made', severity: 'block_sync', message: 'Geçersiz "kim yaptı?" değeri.' });
  }
  if (!when) {
    errors.push({ field: 'when_made', severity: 'block_sync', message: '"Ne zaman yapıldı?" seç.' });
  } else if (!(ETSY_WHEN_MADE_VALUES as readonly string[]).includes(when)) {
    errors.push({ field: 'when_made', severity: 'block_sync', message: 'Geçersiz "ne zaman yapıldı?" değeri.' });
  }
  if (isSupply == null) {
    errors.push({ field: 'is_supply', severity: 'block_sync', message: '"Malzeme mi?" işaretle.' });
  }

  // -- Taxonomy + shipping profile ---------------------------------------
  if (fields.taxonomy_id === '' || fields.taxonomy_id == null) {
    errors.push({ field: 'taxonomy_id', severity: 'block_sync', message: 'Kategori seç.' });
  }
  if (fields.shipping_profile_id === '' || fields.shipping_profile_id == null) {
    errors.push({
      field: 'shipping_profile_id',
      severity: 'block_sync',
      message: 'Kargo profili seç.',
    });
  }

  return errors;
}

export interface ValidationResult {
  errors: FieldError[];
  byField: Record<string, FieldError>;
  canSaveDraft: boolean;
  canSyncToEtsy: boolean;
  blockReason: string | null;
}

export function summarizeValidation(errors: FieldError[]): ValidationResult {
  const byField: Record<string, FieldError> = {};
  for (const err of errors) {
    if (!byField[err.field]) byField[err.field] = err;
  }
  const blockSave = errors.some((e) => e.severity === 'block_save');
  const blockSync = errors.length > 0;
  const first = errors[0];
  return {
    errors,
    byField,
    canSaveDraft: !blockSave,
    canSyncToEtsy: !blockSync,
    blockReason: first ? first.message : null,
  };
}

// Returns the set of Etsy mandatory fields — used to star labels even when
// they don't currently have an error (e.g. before user touches them).
export const ETSY_REQUIRED_FIELDS: ReadonlySet<string> = new Set([
  'title',
  'description',
  'tags',
  'price',
  'quantity',
  'who_made',
  'when_made',
  'is_supply',
  'taxonomy_id',
  'shipping_profile_id',
]);
