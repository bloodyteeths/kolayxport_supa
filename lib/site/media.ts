// Which marketing images exist at build time (server-only), with their real dimensions so the
// <img> reserves space (CLS 0). A missing photo falls back to a product screenshot, never a broken <img>.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import type { SiteLocale } from './routes';

export interface Asset { src: string; width: number; height: number; /** "url 800w, url 1200w, url 2400w" when variants exist */ srcSet?: string; /** 800px AVIF (phone captures) */ avif?: string }

const PUB = path.join(process.cwd(), 'public');

async function asset(rel: string): Promise<Asset | null> {
  const file = path.join(PUB, rel);
  if (!fs.existsSync(file)) return null;
  const meta = await sharp(file).metadata();
  if (!meta.width || !meta.height) return null;
  // Responsive variants made by `node scripts/brand/export-assets.mjs variants`.
  const vs = [800, 1200]
    .map((w) => ({ w, rel: rel.replace(/\.webp$/, `@${w}.webp`) }))
    .filter((v) => v.w < meta.width! && fs.existsSync(path.join(PUB, v.rel)));
  const srcSet = vs.length ? [...vs.map((v) => `${v.rel} ${v.w}w`), `${rel} ${meta.width}w`].join(', ') : undefined;
  const avifRel = rel.replace(/\.webp$/, '@800.avif');
  const avif = fs.existsSync(path.join(PUB, avifRel)) ? avifRel : undefined;
  return { src: rel, width: meta.width, height: meta.height, ...(srcSet ? { srcSet } : {}), ...(avif ? { avif } : {}) };
}

/** Lifestyle photo slot (public/marketing/<id>.webp), or null when not generated/approved yet. */
export async function photo(id: string | null | undefined): Promise<Asset | null> {
  if (!id) return null;
  for (const ext of ['webp', 'avif', 'jpg']) {
    const a = await asset(`/marketing/${id}.${ext}`);
    if (a) return a;
  }
  return null;
}

/** Product screenshot (public/marketing/screens[/en]/<id>.webp), English capture first on /en. */
export async function screen(id: string | null | undefined, locale: SiteLocale = 'tr'): Promise<Asset | null> {
  if (!id) return null;
  const rels = locale === 'en' ? [`/marketing/screens/en/${id}.webp`, `/marketing/screens/${id}.webp`] : [`/marketing/screens/${id}.webp`];
  for (const rel of rels) {
    const a = await asset(rel);
    if (a) return a;
  }
  return null;
}

/** Resolve many ids at once → { id: Asset | null } (JSON-serialisable for getStaticProps). */
export async function screens(ids: string[], locale: SiteLocale): Promise<Record<string, Asset | null>> {
  return Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await screen(id, locale)] as const)));
}
export async function photos(ids: string[]): Promise<Record<string, Asset | null>> {
  return Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await photo(id)] as const)));
}
