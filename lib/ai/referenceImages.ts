// lib/ai/referenceImages.ts — how many of the listing's photos an AI photo generation may take as references.
// Shared by the server (pages/api/ai/generate-image.ts) and the photo dialogs (eBay / Etsy ImageManager,
// listing editor) so "use every photo of the product" means the same number everywhere.

/** Reference photos sent to the image model (Gemini 3 image models accept up to 14 inputs). */
export const AI_MAX_REFERENCE_IMAGES = 8;
