// Server-only loader for content/<locale>/<type>/<slug>.md (see content/README.md).
// Import it from getStaticProps / getStaticPaths only.
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { Marked } from 'marked';
import type { SiteLocale } from './routes';

export type ContentType = 'cases' | 'integrations' | 'compare' | 'guides' | 'blog' | 'legal';

export interface ContentDoc {
  slug: string;
  locale: SiteLocale;
  type: ContentType;
  /** Frontmatter, JSON-serialisable (dates become YYYY-MM-DD strings). */
  meta: Record<string, any>;
  /** Rendered Markdown body. */
  html: string;
  /** H2 headings for a table of contents. */
  toc: { id: string; text: string }[];
  /** true when the other locale has the twin file: the same slug, or the slug named in `twin:` frontmatter. */
  hasTwin: boolean;
  /** Slug of the twin page in the other locale (null when there is none). Differs from `slug` only via `twin:`. */
  twinSlug: string | null;
}

const ROOT = path.join(process.cwd(), 'content');

function dir(locale: SiteLocale, type: ContentType) {
  return path.join(ROOT, locale, type);
}

function normalise(v: any): any {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.map(normalise);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalise(x)]));
  return v === undefined ? null : v;
}

export function slugify(text: string): string {
  return text
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function parse(src: string): { meta: Record<string, any>; body: string } {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: src };
  return { meta: normalise(yaml.load(m[1]) || {}), body: m[2] };
}

function render(body: string): { html: string; toc: { id: string; text: string }[] } {
  const toc: { id: string; text: string }[] = [];
  const used = new Set<string>();
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const plain = text.replace(/<[^>]+>/g, '');
        let id = slugify(plain) || 'bolum';
        while (used.has(id)) id += '-2';
        used.add(id);
        if (depth === 2) toc.push({ id, text: plain });
        return `<h${depth} id="${id}">${text}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const external = /^https?:\/\//.test(href) && !href.startsWith('https://kolayxport.com');
        const t = title ? ` title="${title}"` : '';
        return external
          ? `<a href="${href}"${t} target="_blank" rel="noopener noreferrer">${text}</a>`
          : `<a href="${href}"${t}>${text}</a>`;
      },
      table(token) {
        // Wrap tables so they scroll on phones instead of widening the page.
        const head = token.header.map((c: any) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join('');
        const rows = token.rows.map((r: any) => `<tr>${r.map((c: any) => `<td>${this.parser.parseInline(c.tokens)}</td>`).join('')}</tr>`).join('');
        return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>\n`;
      },
      image({ href, title, text }) {
        return `<img src="${href}" alt="${text}"${title ? ` title="${title}"` : ''} loading="lazy" decoding="async">`;
      },
    },
  });
  const html = marked.parse(body) as string;
  return { html, toc };
}

function load(locale: SiteLocale, type: ContentType, slug: string): ContentDoc | null {
  const file = path.join(dir(locale, type), `${slug}.md`);
  if (!fs.existsSync(file)) return null;
  const { meta, body } = parse(fs.readFileSync(file, 'utf8'));
  const { html, toc } = render(body);
  const other: SiteLocale = locale === 'tr' ? 'en' : 'tr';
  // `twin: <slug>` pairs pages whose slugs differ per language (e.g. TR etsy-toplu-ilan-duzenleme ↔ EN etsy-bulk-listing-editor).
  const twin = typeof meta.twin === 'string' && /^[a-z0-9-]+$/.test(meta.twin) ? meta.twin : slug;
  const hasTwin = fs.existsSync(path.join(dir(other, type), `${twin}.md`));
  return { slug, locale, type, meta, html, toc, hasTwin, twinSlug: hasTwin ? twin : null };
}

/** Published docs of a type (draft: true is skipped), newest first for blog, file order otherwise. */
export function listContent(locale: SiteLocale, type: ContentType): ContentDoc[] {
  const d = dir(locale, type);
  if (!fs.existsSync(d)) return [];
  const docs = fs.readdirSync(d)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .map((f) => load(locale, type, f.replace(/\.md$/, '')))
    .filter((x): x is ContentDoc => !!x && !x.meta.draft);
  if (type === 'blog') docs.sort((a, b) => String(b.meta.date || '').localeCompare(String(a.meta.date || '')));
  else docs.sort((a, b) => (Number(a.meta.order ?? 99) - Number(b.meta.order ?? 99)) || a.slug.localeCompare(b.slug));
  return docs;
}

export function getContent(locale: SiteLocale, type: ContentType, slug: string): ContentDoc | null {
  const doc = load(locale, type, slug);
  return doc && !doc.meta.draft ? doc : null;
}

export function contentSlugs(locale: SiteLocale, type: ContentType): string[] {
  return listContent(locale, type).map((d) => d.slug);
}

/** Card data only (no html) for index pages. */
export function contentCards(locale: SiteLocale, type: ContentType) {
  return listContent(locale, type).map(({ slug, meta }) => ({ slug, meta }));
}
