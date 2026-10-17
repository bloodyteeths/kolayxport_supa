import Head from 'next/head';
import { useTranslations } from 'next-intl';
import type { Asset } from '@/lib/site/media';

/** A real product screenshot in the brand frame. Renders nothing when the capture doesn't exist. */
export function Shot({ asset, mobile, alt, priority = false, className = '', sizes = '(max-width: 1024px) 100vw, 600px' }: { asset: Asset | null | undefined; mobile?: Asset | null; alt: string; priority?: boolean; className?: string; sizes?: string }) {
  const t = useTranslations('site.common');
  if (!asset) return null;
  // Phones get the 800px variant of the phone capture (enough for 2x, a fraction of the bytes).
  const mobileSrc = mobile ? (mobile.srcSet?.split(',')[0]?.trim().split(' ')[0] || mobile.src) : null;
  const mobileAvif = mobile?.avif ?? null;
  return (
    <div className={className}>
    {priority ? (
      <Head>
        {mobileSrc ? <link rel="preload" as="image" href={mobileAvif || mobileSrc} type={mobileAvif ? 'image/avif' : undefined} media="(max-width: 640px)" fetchPriority="high" /> : null}
        <link rel="preload" as="image" href={asset.src} imageSrcSet={asset.srcSet} imageSizes={asset.srcSet ? sizes : undefined} media={mobileSrc ? '(min-width: 641px)' : undefined} fetchPriority="high" />
      </Head>
    ) : null}
    <figure className={`site-shot ${mobile ? 'max-sm:aspect-[4/5]' : ''}`}>
      <picture className={mobile ? 'block max-sm:h-full' : undefined}>
      {/* Phone-sized capture (scripts/gtm/capture-screens.ts → <id>-mobile.webp) below 640px, cropped to 4:5. */}
      {mobileSrc && mobileAvif ? <source media="(max-width: 640px)" type="image/avif" srcSet={mobileAvif} width={mobile!.width} height={mobile!.height} /> : null}
      {mobileSrc ? <source media="(max-width: 640px)" srcSet={mobileSrc} width={mobile!.width} height={mobile!.height} /> : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={asset.src}
        srcSet={asset.srcSet}
        sizes={asset.srcSet ? sizes : undefined}
        alt={alt}
        width={asset.width}
        height={asset.height}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        // @ts-expect-error fetchpriority is valid HTML, React 18 types lag behind
        fetchpriority={priority ? 'high' : 'auto'}
        className={`block w-full ${mobile ? 'max-sm:h-full max-sm:object-cover max-sm:object-top' : 'h-auto'}`}
      />
      </picture>
    </figure>
    {/* Screens come from the seeded demo account (scripts/demo): say so, numbers are not a customer's results. */}
    <p className="mt-2 text-right text-[11px] text-ink-mute">{t('demoData')}</p>
    </div>
  );
}

/** Editorial photo (AI illustration, docs/brand.md §6). Labelled as illustrative for screen readers. */
export function Photo({ asset, alt, label, className = '', priority = false }: { asset: Asset | null | undefined; alt: string; label: string; className?: string; priority?: boolean }) {
  if (!asset) return null;
  return (
    <figure className={`relative overflow-hidden rounded-[24px] ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset.src} srcSet={asset.srcSet} sizes={asset.srcSet ? '(max-width: 1024px) 100vw, 600px' : undefined} alt={`${alt} (${label})`} width={asset.width} height={asset.height} loading={priority ? 'eager' : 'lazy'} decoding="async" className="block h-full w-full object-cover" />
    </figure>
  );
}

/**
 * Shown when neither a screenshot nor a photo exists yet: a "shipping manifest" card made of
 * type and rules only — no fake app UI, no invented numbers.
 */
export function ManifestCard({ lines, stamp, className = '' }: { lines: string[]; stamp: string; className?: string }) {
  return (
    <div className={`site-rules relative overflow-hidden rounded-[24px] border border-line bg-white p-6 md:p-8 ${className}`} aria-hidden>
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[.16em] text-ink-mute">
        <span>KolayXport</span><span>№ 0001</span>
      </div>
      <ul className="mt-6 grid gap-3">
        {lines.map((l, i) => (
          <li key={l} className="flex items-center gap-3 border-b border-dashed border-line pb-3 text-[15px] text-ink">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-kx-wash text-[12px] font-bold text-kx">{i + 1}</span>
            {l}
          </li>
        ))}
      </ul>
      <div className="pointer-events-none absolute -bottom-6 -right-6 grid h-36 w-36 rotate-[-12deg] place-items-center rounded-full border-[3px] border-dashed border-kx/60 text-center text-[13px] font-bold uppercase tracking-[.14em] text-kx/80">
        <span className="px-6 leading-tight">{stamp}</span>
      </div>
    </div>
  );
}
