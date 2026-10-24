// lib/ai/referenceImages.ts — how many of the listing's photos an AI photo generation may take as references.
// Shared by the server (pages/api/ai/generate-image.ts) and the photo dialogs (eBay / Etsy ImageManager,
// listing editor) so "use every photo of the product" means the same number everywhere.

/** Reference photos sent to the image model (Gemini 3 image models accept up to 14 inputs). */
export const AI_MAX_REFERENCE_IMAGES = 8;

/**
 * What an uploaded reference is for (the AI photo dialog's role picker). Uploads are sent inline with the one
 * generation request and never stored (not on the listing, not on the server).
 *   product → the exact item to show (the listing's own photos are always this)
 *   style   → copy only the look: light, colours, mood, composition
 *   person  → the seller's model: show the product worn / used by this person
 *   scene   → the setting / background to place the product in
 */
export const AI_REFERENCE_ROLES = ['product', 'style', 'person', 'scene'] as const;
export type AiReferenceRole = (typeof AI_REFERENCE_ROLES)[number];

/** Uploaded references per generation (on top of the listing's own photos, within AI_MAX_REFERENCE_IMAGES). */
export const AI_MAX_UPLOADED_REFERENCES = 4;

export function asReferenceRole(v: unknown): AiReferenceRole {
  return typeof v === 'string' && (AI_REFERENCE_ROLES as readonly string[]).includes(v) ? (v as AiReferenceRole) : 'product';
}

const ROLE_LABEL: Record<AiReferenceRole, string> = {
  product: 'PRODUCT reference: the exact product to show. Keep its shape, colours, materials, details and any printed text.',
  style: 'STYLE reference: copy only its visual style (lighting, colour grading, mood, camera angle, composition). Do not copy any object, product or person from it.',
  person: 'MODEL reference: show the product worn or used by this same person. Keep their appearance and face unchanged; do not add other people.',
  scene: 'SCENE reference: place the product in this setting / background, matching its light and perspective. Do not copy other products from it.',
};

/** The text placed right before reference image `n` (1-based) when roles are in use (pure). */
export function referenceLabel(role: AiReferenceRole, n: number): string {
  return `Reference image ${n} — ${ROLE_LABEL[role]}`;
}

/** True when any reference is not a plain product reference (labels + role-aware instructions are used). */
export function usesReferenceRoles(roles: readonly AiReferenceRole[]): boolean {
  return roles.some((r) => r !== 'product');
}

/** The instruction sentence that opens the prompt for these references (pure). */
export function referenceInstruction(roles: readonly AiReferenceRole[]): string {
  if (!roles.length) return '';
  if (!usesReferenceRoles(roles)) {
    return roles.length > 1
      ? `Use the ${roles.length} reference images above: keep the exact same product (shape, colours, materials, details, any printed text) and change only what the instructions ask.`
      : 'Use the reference image above: keep the exact same product (shape, colours, materials, details, any printed text) and change only what the instructions ask.';
  }
  const has = (r: AiReferenceRole) => roles.includes(r);
  return [
    'The reference images above are labelled by role. Follow each label.',
    has('product') ? 'Show exactly the product from the PRODUCT references.' : 'Show the product described in the instructions.',
    has('person') ? 'The product is worn or used by the person from the MODEL reference.' : '',
    has('scene') ? 'Use the setting from the SCENE reference.' : '',
    has('style') ? 'Match the look of the STYLE reference.' : '',
  ].filter(Boolean).join(' ');
}
