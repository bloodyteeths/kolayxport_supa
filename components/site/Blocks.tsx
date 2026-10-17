import Link from 'next/link';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Minus, X as XIcon, ArrowRight, Quote } from 'lucide-react';
import { SIGNUP_HREF } from '@/lib/site/routes';

export function Section({ children, className = '', id, tone = 'paper' }: { children: ReactNode; className?: string; id?: string; tone?: 'paper' | 'paper-2' | 'ink' | 'white' }) {
  const bg = { paper: 'bg-paper', 'paper-2': 'bg-paper-2', ink: 'bg-ink text-paper site-rules-dark', white: 'bg-white' }[tone];
  return (
    <section id={id} className={`${bg} scroll-mt-20 ${className}`}>
      <div className="mx-auto max-w-[1200px] px-5 py-[72px] md:px-8 md:py-[112px]">{children}</div>
    </section>
  );
}

export function Heading({ eyebrow, title, lead, align = 'left', as = 'h2', dark = false }: { eyebrow?: string; title: string; lead?: string; align?: 'left' | 'center'; as?: 'h1' | 'h2'; dark?: boolean }) {
  const H = as;
  return (
    <div className={align === 'center' ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl'}>
      {eyebrow ? <p className={`site-tag ${dark ? '!bg-paper/10 !text-paper !border-paper/20' : ''}`}>{eyebrow}</p> : null}
      <H className={`display mt-4 ${as === 'h1' ? 'text-[40px] md:text-[64px]' : 'text-[30px] md:text-[46px]'} ${dark ? 'text-paper' : 'text-ink'}`}>{title}</H>
      {lead ? <p className={`mt-5 text-lg md:text-[20px] leading-relaxed ${dark ? 'text-paper/75' : 'text-ink-soft'}`}>{lead}</p> : null}
    </div>
  );
}

export function TrialCta({ dark = false, secondary }: { dark?: boolean; secondary?: { href: string; label: string } }) {
  const t = useTranslations('site.common');
  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Link prefetch={false} href={SIGNUP_HREF} className="btn-kx text-[16px]">{t('ctaTrial')} <ArrowRight size={18} aria-hidden /></Link>
        {secondary ? <Link prefetch={false} href={secondary.href} className={`btn-ghost ${dark ? 'btn-ghost-dark' : ''}`}>{secondary.label}</Link> : null}
      </div>
      <p className={`mt-3 text-sm ${dark ? 'text-paper/65' : 'text-ink-mute'}`}>{t('trialLine')}</p>
    </div>
  );
}

export function PainQuotes({ items, sourceLabel }: { items: { quote: string; source?: string }[]; sourceLabel: string }) {
  return (
    <ul className="grid gap-4 md:grid-cols-3">
      {items.map((p) => (
        <li key={p.quote} className="relative rounded-2xl border border-line bg-white p-6">
          <Quote size={22} className="text-kraft" aria-hidden />
          <blockquote className="display mt-3 text-[21px] leading-snug text-ink" style={{ fontWeight: 500 }}>&ldquo;{p.quote}&rdquo;</blockquote>
          {p.source ? <p className="mt-4 text-xs font-medium uppercase tracking-[.12em] text-ink-mute">{sourceLabel}: {p.source}</p> : null}
        </li>
      ))}
    </ul>
  );
}

export function Steps({ items }: { items: { title: string; text: string }[] }) {
  return (
    <ol className="grid gap-6 md:grid-cols-3">
      {items.map((s, i) => (
        <li key={`${i}-${s.title}`} className="relative rounded-2xl border border-line bg-white p-6 md:p-7">
          <span className="display block text-[56px] leading-none text-kx" aria-hidden>{String(i + 1).padStart(2, '0')}</span>
          {s.title ? <h3 className="mt-4 text-xl font-semibold text-ink">{s.title}</h3> : null}
          <p className={s.title ? 'mt-2 text-ink-soft' : 'mt-4 text-[17px] text-ink'}>{s.text}</p>
        </li>
      ))}
    </ol>
  );
}

export function FeatureList({ items }: { items: { title: string; text: string }[] }) {
  return (
    <ul className="grid gap-x-10 gap-y-8 md:grid-cols-2">
      {items.map((f) => (
        <li key={f.title} className="border-t-2 border-ink pt-5">
          <h3 className="text-lg font-semibold text-ink">{f.title}</h3>
          <p className="mt-2 text-ink-soft">{f.text}</p>
        </li>
      ))}
    </ul>
  );
}

export function Bullets({ items, dark = false }: { items: string[]; dark?: boolean }) {
  return (
    <ul className="mt-6 grid gap-3">
      {items.map((b) => (
        <li key={b} className="flex gap-3">
          <span className={`mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full ${dark ? 'bg-kx-soft/20 text-kx-soft' : 'bg-kx-wash text-kx'}`}><Check size={13} strokeWidth={3} aria-hidden /></span>
          <span className={dark ? 'text-paper/85' : 'text-ink'}>{b}</span>
        </li>
      ))}
    </ul>
  );
}

export function Faq({ items, title }: { items: { q: string; a: string }[]; title: string }) {
  if (!items?.length) return null;
  return (
    <div className="grid gap-10 md:grid-cols-[1fr_2fr]">
      <h2 className="display text-[30px] md:text-[40px]">{title}</h2>
      <div className="divide-y divide-line border-y border-line">
        {items.map((f) => (
          <details key={f.q} className="group py-5">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-6 text-[17px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
              {f.q}
              <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line text-ink-soft transition-transform group-open:rotate-45" aria-hidden>+</span>
            </summary>
            <p className="mt-3 max-w-[64ch] text-ink-soft">{f.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}

export function StatusMark({ status }: { status: 'yes' | 'partial' | 'no' | string }) {
  const t = useTranslations('site.common.status');
  if (status === 'yes') return <span className="inline-flex items-center gap-1.5 font-semibold text-[#0F7A4A]"><Check size={16} strokeWidth={3} aria-hidden />{t('yes')}</span>;
  if (status === 'partial') return <span className="inline-flex items-center gap-1.5 font-semibold text-[#9A6400]"><Minus size={16} strokeWidth={3} aria-hidden />{t('partial')}</span>;
  if (status === 'no') return <span className="inline-flex items-center gap-1.5 font-semibold text-ink-mute"><XIcon size={16} strokeWidth={3} aria-hidden />{t('no')}</span>;
  return <span className="text-ink">{status}</span>;
}

export function Breadcrumbs({ items }: { items: { href: string; label: string }[] }) {
  return (
    <nav aria-label="breadcrumb" className="text-sm text-ink-mute">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((it, i) => (
          <li key={it.href} className="flex items-center gap-1.5">
            {i > 0 ? <span aria-hidden>/</span> : null}
            {i < items.length - 1 ? <Link prefetch={false} href={it.href} className="hover:text-ink hover:underline">{it.label}</Link> : <span aria-current="page" className="text-ink-soft">{it.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function CtaBand({ title, text }: { title: string; text: string }) {
  return (
    <section className="site-rules-dark relative overflow-hidden bg-ink text-paper">
      <div className="pointer-events-none absolute -right-24 -top-24 h-[420px] w-[420px] rounded-full border-2 border-dashed border-kx-soft/30" aria-hidden />
      <div className="pointer-events-none absolute -right-6 -top-6 h-[280px] w-[280px] rounded-full border border-kx-soft/25" aria-hidden />
      <div className="relative mx-auto max-w-[1200px] px-5 py-20 md:px-8 md:py-28">
        <h2 className="display max-w-3xl text-[34px] text-paper md:text-[54px]">{title}</h2>
        <p className="mt-5 max-w-2xl text-lg text-paper/75">{text}</p>
        <div className="mt-8"><TrialCta dark /></div>
      </div>
    </section>
  );
}

export function Prose({ html }: { html: string }) {
  return <div className="prose-site" dangerouslySetInnerHTML={{ __html: html }} />;
}
