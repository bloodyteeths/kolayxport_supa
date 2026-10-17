// Pure helper (no client import), so tests that mock the Shopify client keep it.

/**
 * Match a staged image id against the live images: the MediaImage id, or the legacy REST
 * ProductImage id (`legacy_image_id`) of drafts staged before the GraphQL migration.
 * Returns the MediaImage id, or null when the image is not on the product.
 */
export function resolveImageId(id: string, images: any[]): string | null {
  const s = String(id);
  for (const im of images) if (String(im?.id) === s) return s;
  for (const im of images) if (im?.legacy_image_id != null && String(im.legacy_image_id) === s) return String(im.id);
  return null;
}
