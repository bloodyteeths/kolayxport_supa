// Real customer testimonials (content/testimonials/*.json) — only entries with recorded written consent.
import fs from 'fs';
import path from 'path';
import type { SiteLocale } from './routes';

export interface Testimonial { quote: string; name: string; shop?: string; since?: string }

export function testimonials(locale: SiteLocale): Testimonial[] {
  const dir = path.join(process.cwd(), 'content/testimonials');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } })
    .filter((t) => t && t.consent === true && typeof t.consentRef === 'string' && t.consentRef.trim() && t.locale === locale && t.quote && t.name)
    .map(({ quote, name, shop, since }) => ({ quote, name, shop: shop || null, since: since || null }));
}
