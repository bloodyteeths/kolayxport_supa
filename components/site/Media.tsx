import type { Asset } from '@/lib/site/media';

/** A real product screenshot in the brand frame. Renders nothing when the capture doesn't exist. */
export function Shot({ asset, mobile, alt, priority = false, className = '' }: { asset: Asset | null | undefined; mobile?: Asset | null; alt: string; priority?: boolean; className?: string }) {
  if (!asset) return null;
  return (
    <figure className={`site-shot ${className}`}>
      <picture>
      {/* Phone-sized capture (scripts/gtm/capture-screens.ts → <id>-mobile.webp) below 640px. */}
      {mobile ? <source media="(max-width: 640px)" srcSet={mobile.src} width={mobile.width} height={mobile.height} /> : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={asset.src}
        alt={alt}
        width={asset.width}
        height={asset.height}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        // @ts-expect-error fetchpriority is valid HTML, React 18 types lag behind
        fetchpriority={priority ? 'high' : 'auto'}
        className="block h-auto w-full"
      />
      </picture>
    </figure>
  );
}

/** Editorial photo (AI illustration, docs/brand.md §6). Labelled as illustrative for screen readers. */
export function Photo({ asset, alt, label, className = '', priority = false }: { asset: Asset | null | undefined; alt: string; label: string; className?: string; priority?: boolean }) {
  if (!asset) return null;
  return (
    <figure className={`relative overflow-hidden rounded-[24px] ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset.src} alt={`${alt} (${label})`} width={asset.width} height={asset.height} loading={priority ? 'eager' : 'lazy'} decoding="async" className="block h-full w-full object-cover" />
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
