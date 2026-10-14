// Etsy listing validators (shared by the browser editor and the server-side
// draft engine).
//
// These mirror the rules Etsy actually enforces on POST/PATCH /listings and the
// inventory / personalization endpoints (Open API v3 spec, checked 2026-10).
// Goal: catch the recurring "Etsy 400 ..." failures BEFORE we call Etsy.
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
// Every error carries:
//   - `message`: legacy Turkish text (kept for existing callers),
//   - `key` + `params`: next-intl key relative to the `etsy` namespace
//     (`etsy.validation.*`) — new UI should render `t(err.key, err.params)`.
//
// All validators here are pure. No fetch, no I/O.

export type ErrorSeverity = 'block_save' | 'block_sync';

export interface FieldError {
  field: string;
  severity: ErrorSeverity;
  message: string;
  /** i18n key relative to the `etsy` namespace, e.g. `validation.titleTooLong`. */
  key?: string;
  params?: Record<string, string | number>;
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
  PERSONALIZATION_INSTRUCTIONS_MAX: 120,
  PERSONALIZATION_QUESTION_MAX: 45,
} as const;

// Etsy spec: valid titles contain only letters, numbers, punctuation,
// mathematical symbols, whitespace, ™ © ®. `%`, `:`, `&`, `+` once each.
const TITLE_INVALID_RE = /[^\p{L}\p{Nd}\p{P}\p{Sm}\p{Zs}™©®]/u;
const TITLE_ONCE_CHARS = ['%', ':', '&', '+'] as const;
const TITLE_FIRST_CHAR_RE = /^[\p{L}\p{Nd}]/u;

// Etsy spec: tags — letters, numbers, whitespace, -, ', ™, ©, ®.
const TAG_INVALID_CHAR_RE = /[^\p{L}\p{Nd}\p{Zs}\-'™©®]/u;
// Etsy spec: materials — letters, numbers, whitespace only.
const MATERIAL_INVALID_CHAR_RE = /[^\p{L}\p{Nd}\p{Zs}]/u;

export const ETSY_WHO_MADE_VALUES = ['i_did', 'collective', 'someone_else'] as const;

// Etsy Open API v3 `when_made` enum (createDraftListing / updateListing,
// verified against the published OAS on 2026-10-14). Etsy shifts the recent
// buckets every year, so legacy values are normalised below.
export const ETSY_WHEN_MADE_VALUES = [
  'made_to_order',
  '2020_2026',
  '2010_2019',
  '2007_2009',
  'before_2007',
  '2000_2006',
  '1990s',
  '1980s',
  '1970s',
  '1960s',
  '1950s',
  '1940s',
  '1930s',
  '1920s',
  '1910s',
  '1900s',
  '1800s',
  '1700s',
  'before_1700',
] as const;

// Old bucket → current bucket, only where the mapping is a strict superset so
// we never misstate the era. `2004_2009` straddles two current buckets
// (2000_2006 / 2007_2009) and therefore must be re-picked by the user.
export const ETSY_WHEN_MADE_LEGACY_ALIASES: Record<string, string> = {
  '2020_2025': '2020_2026',
  '2020_2024': '2020_2026',
  '2020_2023': '2020_2026',
  '2000_2003': '2000_2006',
  '2000_2005': '2000_2006',
  before_2004: 'before_2007',
  before_2005: 'before_2007',
  before_2006: 'before_2007',
};

// Vintage = 20+ years old. Etsy only allows reselling finished goods made by
// someone else when they are vintage.
const VINTAGE_WHEN_MADE = new Set<string>([
  'before_2007', '2000_2006', '1990s', '1980s', '1970s', '1960s', '1950s', '1940s',
  '1930s', '1920s', '1910s', '1900s', '1800s', '1700s', 'before_1700',
]);

/**
 * The single source of truth for "When was it made?" pickers. `labelKey` is
 * relative to the `etsy.whenMade` i18n namespace, e.g.
 *   t(`whenMade.${opt.labelKey}`)   with useTranslations('etsy')
 *   tWhen(opt.labelKey)             with useTranslations('etsy.whenMade')
 */
export const WHEN_MADE_OPTIONS: ReadonlyArray<{ value: string; labelKey: string }> = ETSY_WHEN_MADE_VALUES.map((value) => ({
  value,
  labelKey: value === 'made_to_order' ? 'madeToOrder' : value,
}));

// Older buckets that still have translated labels (stored templates / drafts).
const LEGACY_WHEN_MADE_LABELS = new Set(['2020_2025', '2004_2009', 'before_2004', '2000_2003']);

/** i18n label key (relative to `etsy.whenMade`) for any stored when_made value, or null. */
export function whenMadeLabelKey(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value === 'made_to_order') return 'madeToOrder';
  if ((ETSY_WHEN_MADE_VALUES as readonly string[]).includes(value) || LEGACY_WHEN_MADE_LABELS.has(value)) return value;
  return null;
}

/** Map a legacy when_made value onto Etsy's current enum (unknown values pass through). */
export function normalizeWhenMade(value: string | null | undefined): string | null | undefined {
  if (!value) return value;
  return ETSY_WHEN_MADE_LEGACY_ALIASES[value] || value;
}

function err(field: string, severity: ErrorSeverity, key: string, message: string, params?: Record<string, string | number>): FieldError {
  return { field, severity, key: `validation.${key}`, message, ...(params ? { params } : {}) };
}

// ---------------------------------------------------------------------------
// Per-field rules (shared by the full-form and the partial/patch validators)
// ---------------------------------------------------------------------------

function checkTitle(raw: unknown, required: boolean): FieldError[] {
  const title = String(raw ?? '').trim();
  if (!title) return required ? [err('title', 'block_sync', 'titleRequired', 'Başlık boş olamaz.')] : [];
  if (title.length > ETSY_LIMITS.TITLE_MAX) {
    return [err('title', 'block_save', 'titleTooLong',
      `Başlık ${ETSY_LIMITS.TITLE_MAX} karakteri aşamaz (şu an ${title.length}).`,
      { max: ETSY_LIMITS.TITLE_MAX, count: title.length })];
  }
  if (!TITLE_FIRST_CHAR_RE.test(title)) {
    return [err('title', 'block_sync', 'titleFirstChar', 'Başlık bir harf veya rakamla başlamalı.')];
  }
  const invalid = title.match(TITLE_INVALID_RE);
  if (invalid) {
    return [err('title', 'block_sync', 'titleInvalidChars',
      `Başlıkta Etsy'nin kabul etmediği karakter var (${invalid[0]}). Onu kaldır.`, { char: invalid[0] })];
  }
  for (const ch of TITLE_ONCE_CHARS) {
    if (title.split(ch).length - 1 > 1) {
      return [err('title', 'block_sync', 'titleCharOnce',
        `Başlıkta "${ch}" karakteri yalnızca bir kez kullanılabilir.`, { char: ch })];
    }
  }
  return [];
}

function checkDescription(raw: unknown, required: boolean): FieldError[] {
  const description = String(raw ?? '').trim();
  if (!description) return required ? [err('description', 'block_sync', 'descriptionRequired', 'Açıklama boş olamaz.')] : [];
  if (description.length > ETSY_LIMITS.DESCRIPTION_MAX) {
    return [err('description', 'block_save', 'descriptionTooLong',
      `Açıklama ${ETSY_LIMITS.DESCRIPTION_MAX.toLocaleString()} karakteri aşamaz.`, { max: ETSY_LIMITS.DESCRIPTION_MAX })];
  }
  return [];
}

function checkTags(raw: unknown): FieldError[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return [err('tags', 'block_save', 'tagsNotList', 'Etiketler liste olmalı.')];
  const tags = raw.map((t) => String(t ?? '').trim()).filter(Boolean);
  if (tags.length > ETSY_LIMITS.TAG_MAX) {
    return [err('tags', 'block_save', 'tooManyTags',
      `En fazla ${ETSY_LIMITS.TAG_MAX} etiket olabilir (şu an ${tags.length}).`, { max: ETSY_LIMITS.TAG_MAX, count: tags.length })];
  }
  const seen = new Set<string>();
  for (const t of tags) {
    if (t.length > ETSY_LIMITS.TAG_LEN_MAX) {
      return [err('tags', 'block_save', 'tagTooLong',
        `"${t.slice(0, 28)}…" etiketi ${ETSY_LIMITS.TAG_LEN_MAX} karakteri aşıyor.`, { tag: t.slice(0, 28), max: ETSY_LIMITS.TAG_LEN_MAX })];
    }
    if (TAG_INVALID_CHAR_RE.test(t)) {
      return [err('tags', 'block_sync', 'tagInvalidChars',
        `"${t}" etiketinde Etsy'nin kabul etmediği karakter var. Sadece harf, rakam, boşluk, tire ve kesme işareti kullan.`, { tag: t })];
    }
    const norm = t.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(norm)) {
      return [err('tags', 'block_sync', 'tagDuplicate', `"${t}" etiketi birden fazla kez eklenmiş.`, { tag: t })];
    }
    seen.add(norm);
  }
  return [];
}

function checkMaterials(raw: unknown): FieldError[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return [err('materials', 'block_save', 'materialsNotList', 'Malzemeler liste olmalı.')];
  const materials = raw.map((m) => String(m ?? '').trim()).filter(Boolean);
  if (materials.length > ETSY_LIMITS.MATERIAL_MAX) {
    return [err('materials', 'block_save', 'tooManyMaterials',
      `En fazla ${ETSY_LIMITS.MATERIAL_MAX} malzeme olabilir (şu an ${materials.length}).`, { max: ETSY_LIMITS.MATERIAL_MAX, count: materials.length })];
  }
  for (const v of materials) {
    if (v.length > ETSY_LIMITS.MATERIAL_LEN_MAX) {
      return [err('materials', 'block_save', 'materialTooLong',
        `"${v.slice(0, 32)}…" malzeme adı ${ETSY_LIMITS.MATERIAL_LEN_MAX} karakteri aşıyor.`, { material: v.slice(0, 32), max: ETSY_LIMITS.MATERIAL_LEN_MAX })];
    }
    if (MATERIAL_INVALID_CHAR_RE.test(v)) {
      return [err('materials', 'block_sync', 'materialInvalidChars',
        `"${v}" malzeme adında Etsy'nin kabul etmediği karakter var. Sadece harf, rakam ve boşluk kullan.`, { material: v })];
    }
  }
  return [];
}

function checkPrice(raw: unknown, required: boolean): FieldError[] {
  if (raw === undefined || raw === '' || raw === null) {
    return required ? [err('price', 'block_sync', 'priceRequired', 'Fiyat zorunlu.')] : [];
  }
  const priceNum = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(',', '.'));
  if (Number.isNaN(priceNum) || priceNum <= 0) {
    return [err('price', 'block_sync', 'pricePositive', 'Fiyat 0\'dan büyük bir sayı olmalı.')];
  }
  return [];
}

function checkQuantity(raw: unknown, required: boolean): FieldError[] {
  if (raw === undefined && !required) return [];
  const q = typeof raw === 'number' ? raw : Number(raw);
  if (raw == null || raw === '' || !Number.isFinite(q) || q < 1) {
    return [err('quantity', 'block_sync', 'quantityMin', 'Adet en az 1 olmalı.')];
  }
  return [];
}

/**
 * Provenance trio. `required` = all three must be set (full form); otherwise
 * only the values present are checked.
 */
function checkProvenance(who: unknown, whenRaw: unknown, isSupply: unknown, required: boolean): FieldError[] {
  const errors: FieldError[] = [];
  const when = normalizeWhenMade(whenRaw as string | undefined);
  if (!who) {
    if (required) errors.push(err('who_made', 'block_sync', 'whoMadeRequired', '"Kim yaptı?" seç.'));
  } else if (!(ETSY_WHO_MADE_VALUES as readonly string[]).includes(String(who))) {
    errors.push(err('who_made', 'block_sync', 'whoMadeInvalid', 'Geçersiz "kim yaptı?" değeri.'));
  }
  if (!when) {
    if (required) errors.push(err('when_made', 'block_sync', 'whenMadeRequired', '"Ne zaman yapıldı?" seç.'));
  } else if (!(ETSY_WHEN_MADE_VALUES as readonly string[]).includes(String(when))) {
    errors.push(err('when_made', 'block_sync', 'whenMadeInvalid',
      `Geçersiz "ne zaman yapıldı?" değeri (${String(whenRaw)}). Listeden yeniden seç.`, { value: String(whenRaw) }));
  }
  if (isSupply == null) {
    if (required) errors.push(err('is_supply', 'block_sync', 'isSupplyRequired', '"Malzeme mi?" işaretle.'));
  }
  // Invalid combinations (Etsy listing rules):
  //  - a finished product made by someone else may only be sold as vintage;
  //  - "made to order" means *you* make it, so it can't be someone_else's.
  if (who === 'someone_else' && when && errors.every((e) => e.field !== 'when_made')) {
    if (when === 'made_to_order') {
      errors.push(err('when_made', 'block_sync', 'madeToOrderNeedsMaker',
        '"Siparişe göre üretim" seçiliyse "kim yaptı?" sen veya ekibin olmalı.'));
    } else if (isSupply === false && !VINTAGE_WHEN_MADE.has(String(when))) {
      errors.push(err('when_made', 'block_sync', 'someoneElseMustBeVintage',
        'Başkasının yaptığı bitmiş ürünler yalnızca vintage (20+ yıllık) olarak satılabilir.'));
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Full-form validator (editor drawer)
// ---------------------------------------------------------------------------

export function validateEtsyFields(fields: EditableFieldsLite): FieldError[] {
  const errors: FieldError[] = [];
  errors.push(...checkTitle(fields.title, true));
  errors.push(...checkDescription(fields.description, true));
  errors.push(...checkTags(fields.tags ?? []));
  errors.push(...checkMaterials(fields.materials ?? []));
  errors.push(...checkPrice(fields.price, true));
  errors.push(...checkQuantity(fields.quantity, true));
  errors.push(...checkProvenance(fields.who_made, fields.when_made, fields.is_supply, true));

  // -- Taxonomy + shipping profile ---------------------------------------
  if (fields.taxonomy_id === '' || fields.taxonomy_id == null) {
    errors.push(err('taxonomy_id', 'block_sync', 'taxonomyRequired', 'Kategori seç.'));
  }
  if (fields.shipping_profile_id === '' || fields.shipping_profile_id == null) {
    errors.push(err('shipping_profile_id', 'block_sync', 'shippingProfileRequired', 'Kargo profili seç.'));
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Partial validators (server-side draft engine)
// ---------------------------------------------------------------------------

/** Validate only the keys present in a staged field patch. */
export function validateEtsyFieldPatch(patch: Record<string, any> | null | undefined): FieldError[] {
  if (!patch || typeof patch !== 'object') return [];
  const errors: FieldError[] = [];
  const has = (k: string) => Object.prototype.hasOwnProperty.call(patch, k);
  if (has('title')) errors.push(...checkTitle(patch.title, true));
  if (has('description')) errors.push(...checkDescription(patch.description, true));
  if (has('tags')) errors.push(...checkTags(patch.tags));
  if (has('materials')) errors.push(...checkMaterials(patch.materials));
  if (has('price')) errors.push(...checkPrice(patch.price, true));
  if (has('quantity')) errors.push(...checkQuantity(patch.quantity, true));
  if (has('who_made') || has('when_made') || has('is_supply')) {
    errors.push(...checkProvenance(patch.who_made, patch.when_made, patch.is_supply, false));
  }
  if (has('processing_min') || has('processing_max')) {
    const min = patch.processing_min == null || patch.processing_min === '' ? null : Number(patch.processing_min);
    const max = patch.processing_max == null || patch.processing_max === '' ? null : Number(patch.processing_max);
    if ((min != null && (!Number.isFinite(min) || min < 0)) || (max != null && (!Number.isFinite(max) || max < 0))) {
      errors.push(err('processing_min', 'block_save', 'processingInvalid', 'Hazırlık süresi geçerli bir gün sayısı olmalı.'));
    } else if (min != null && max != null && min > max) {
      errors.push(err('processing_min', 'block_save', 'processingMinGreaterThanMax', 'En az hazırlık süresi en fazladan büyük olamaz.'));
    }
  }
  return errors;
}

/** Personalization questions (POST /listings/{id}/personalization). */
export function validateEtsyPersonalization(personalization: any): FieldError[] {
  if (!personalization || personalization.remove) return [];
  const questions = Array.isArray(personalization.personalization_questions) ? personalization.personalization_questions : [];
  const errors: FieldError[] = [];
  questions.forEach((q: any, idx: number) => {
    const n = idx + 1;
    const text = String(q?.question_text ?? '').trim();
    if (!text) {
      errors.push(err('personalization', 'block_sync', 'personalizationQuestionRequired', `${n}. kişiselleştirme sorusunun metni boş.`, { index: n }));
    } else if (text.length > ETSY_LIMITS.PERSONALIZATION_QUESTION_MAX) {
      errors.push(err('personalization', 'block_save', 'personalizationQuestionTooLong',
        `${n}. kişiselleştirme sorusu ${ETSY_LIMITS.PERSONALIZATION_QUESTION_MAX} karakteri aşamaz (şu an ${text.length}).`,
        { index: n, max: ETSY_LIMITS.PERSONALIZATION_QUESTION_MAX, count: text.length }));
    }
    const instructions = q?.instructions == null ? '' : String(q.instructions);
    if (instructions.length > ETSY_LIMITS.PERSONALIZATION_INSTRUCTIONS_MAX) {
      errors.push(err('personalization', 'block_save', 'personalizationInstructionsTooLong',
        `${n}. kişiselleştirme talimatı ${ETSY_LIMITS.PERSONALIZATION_INSTRUCTIONS_MAX} karakteri aşamaz (şu an ${instructions.length}).`,
        { index: n, max: ETSY_LIMITS.PERSONALIZATION_INSTRUCTIONS_MAX, count: instructions.length }));
    }
    if (instructions && q?.question_type === 'dropdown') {
      errors.push(err('personalization', 'block_sync', 'personalizationDropdownNoInstructions',
        `${n}. soru açılır liste olduğu için talimat içeremez.`, { index: n }));
    }
  });
  return errors;
}

function offeringPrice(offering: any): number {
  const p = offering?.price;
  if (p && typeof p === 'object') return Number(p.amount) / (Number(p.divisor) || 100);
  return Number(p);
}

// Same identity the Cartesian auto-fill uses (first value string), with the
// value id only as a fallback when no display value is present.
function pvValue(pv: any): string {
  const v = Array.isArray(pv?.values) ? pv.values[0] : null;
  if (v != null && String(v) !== '') return `v:${String(v)}`;
  if (Array.isArray(pv?.value_ids) && pv.value_ids.length) return `id:${pv.value_ids[0]}`;
  return 'v:';
}

/**
 * Inventory payload (PUT /listings/{id}/inventory). Run on the *sanitized*
 * payload (after dedupe + Cartesian fill) so it reports only what Etsy would
 * still reject.
 */
export function validateEtsyInventory(inventory: any): FieldError[] {
  const products = Array.isArray(inventory?.products) ? inventory.products.filter((p: any) => !p?.is_deleted) : [];
  if (products.length === 0) return [];
  const errors: FieldError[] = [];

  // Every product must carry the same set of variation properties.
  const axisSig = (p: any) => (Array.isArray(p?.property_values) ? p.property_values : [])
    .map((pv: any) => String(pv?.property_id)).sort().join(',');
  const firstSig = axisSig(products[0]);
  if (products.some((p: any) => axisSig(p) !== firstSig)) {
    errors.push(err('inventory', 'block_sync', 'inventoryInconsistentProperties',
      'Varyasyonların hepsi aynı özellikleri (ör. Beden + Renk) içermeli.'));
    return errors;
  }

  // Every combination of property values must be present (Etsy: "All
  // combinations of property values must be supplied.").
  const axes = firstSig ? firstSig.split(',') : [];
  if (axes.length > 0) {
    const valuesPerAxis = axes.map((axis) => new Set(products.map((p: any) => pvValue(p.property_values.find((pv: any) => String(pv.property_id) === axis)))));
    const expected = valuesPerAxis.reduce((acc, s) => acc * Math.max(1, s.size), 1);
    const combos = new Set(products.map((p: any) => axes.map((axis) => pvValue(p.property_values.find((pv: any) => String(pv.property_id) === axis))).join('|')));
    if (combos.size < expected) {
      errors.push(err('inventory', 'block_sync', 'inventoryMissingCombinations',
        `Tüm varyasyon kombinasyonları girilmeli (${combos.size}/${expected}).`, { count: combos.size, expected }));
    }
  }

  for (const p of products) {
    const offerings = Array.isArray(p?.offerings) ? p.offerings.filter((o: any) => !o?.is_deleted) : [];
    if (offerings.length === 0) {
      errors.push(err('inventory', 'block_sync', 'inventoryMissingOffering', 'Her varyasyonun fiyat/adet bilgisi olmalı.'));
      break;
    }
    const bad = offerings.find((o: any) => !(offeringPrice(o) > 0));
    if (bad) {
      errors.push(err('inventory', 'block_sync', 'inventoryPricePositive', 'Tüm varyasyon fiyatları 0\'dan büyük olmalı.'));
      break;
    }
    const badQty = offerings.find((o: any) => o?.is_enabled !== false && !(Number(o?.quantity) >= 0));
    if (badQty) {
      errors.push(err('inventory', 'block_sync', 'inventoryQuantityInvalid', 'Varyasyon adetleri geçerli bir sayı olmalı.'));
      break;
    }
  }

  // "price must be consistent across linked products": when price does not
  // vary on a property, products sharing the other values must have one price.
  if (axes.length > 0 && errors.length === 0) {
    const priceOn: string[] = Array.isArray(inventory?.price_on_property) ? inventory.price_on_property.map(String) : [];
    if (priceOn.length < axes.length) {
      const groups = new Map<string, Set<number>>();
      for (const p of products) {
        const key = priceOn.map((axis) => pvValue(p.property_values.find((pv: any) => String(pv.property_id) === axis))).join('|');
        const price = offeringPrice((p.offerings || [])[0]);
        if (!groups.has(key)) groups.set(key, new Set());
        groups.get(key)!.add(Math.round(price * 100));
      }
      if (Array.from(groups.values()).some((s) => s.size > 1)) {
        errors.push(err('inventory', 'block_sync', 'inventoryPriceInconsistent',
          'Fiyat bir varyasyona bağlı değilse tüm ilgili varyasyonların fiyatı aynı olmalı. "Fiyat varyasyona göre değişir" seçeneğini aç ya da fiyatları eşitle.'));
      }
    }
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
  for (const e of errors) {
    if (!byField[e.field]) byField[e.field] = e;
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
