import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Menu, X } from 'lucide-react';
import { CASES, localePath, SIGNUP_HREF, type SiteLocale } from '@/lib/site/routes';

interface Props { locale: SiteLocale; path: string; hasTwin: boolean; tone: 'paper' | 'ink' }

export default function SiteHeader({ locale, path, hasTwin, tone }: Props) {
  const t = useTranslations('site');
  const [open, setOpen] = useState(false);
  const [solutions, setSolutions] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const href = (p: string) => localePath(locale, p);
  const other: SiteLocale = locale === 'tr' ? 'en' : 'tr';
  const switchHref = localePath(other, hasTwin ? path : '/');
  const dark = tone === 'ink';

  useEffect(() => {
    if (!solutions) return;
    const onDoc = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setSolutions(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSolutions(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [solutions]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const links = [
    { href: href('/entegrasyonlar'), label: t('nav.integrations') },
    { href: href('/fiyatlandirma'), label: t('nav.pricing') },
    { href: href('/nasil-kullanirim'), label: t('nav.help') },
    { href: href('/blog'), label: t('nav.blog') },
  ];

  const bar = dark ? 'bg-ink/95 text-paper border-paper/10' : 'bg-paper/90 text-ink border-line';

  return (
    <header className={`sticky top-0 z-50 border-b backdrop-blur supports-[backdrop-filter]:backdrop-blur ${bar}`} style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-5 md:h-[72px] md:px-8">
        <Link prefetch={false} href={href('/')} className="flex shrink-0 items-center" aria-label="KolayXport">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={dark ? '/brand/kolayxport-logo-dark.svg' : '/brand/kolayxport-logo.svg'} alt="KolayXport" width={146} height={36} className="h-8 w-auto md:h-9" />
        </Link>

        <nav className="hidden flex-1 items-center gap-1 lg:flex" aria-label={t('nav.menu')}>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-[15px] font-medium hover:bg-current/5"
              aria-expanded={solutions}
              aria-controls="site-solutions"
              onClick={() => setSolutions((v) => !v)}
            >
              {t('nav.solutions')} <ChevronDown size={16} aria-hidden className={`transition-transform ${solutions ? 'rotate-180' : ''}`} />
            </button>
            {solutions && (
              <div id="site-solutions" className="absolute left-0 top-full mt-2 w-[560px] rounded-2xl border border-line bg-paper p-3 text-ink shadow-[0_24px_48px_-24px_rgba(14,26,43,.35)]">
                <ul className="grid grid-cols-2 gap-1">
                  {CASES.map((slug) => (
                    <li key={slug}>
                      <Link prefetch={false} href={href(`/cozumler/${slug}`)} onClick={() => setSolutions(false)} className="block rounded-xl px-3 py-2.5 hover:bg-paper-2">
                        <span className="block font-semibold">{t(`cases.${slug}.label`)}</span>
                        <span className="block text-sm text-ink-mute">{t(`cases.${slug}.desc`)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link prefetch={false} href={href('/cozumler')} onClick={() => setSolutions(false)} className="mt-2 block rounded-xl px-3 py-2 text-sm font-semibold text-kx hover:bg-paper-2">
                  {t('nav.allSolutions')} →
                </Link>
              </div>
            )}
          </div>
          {links.map((l) => (
            <Link prefetch={false} key={l.href} href={l.href} className="rounded-full px-3 py-2 text-[15px] font-medium hover:bg-current/5">{l.label}</Link>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2 lg:flex">
          <Link prefetch={false} href={switchHref} hrefLang={other} className="rounded-full px-3 py-2 text-sm font-semibold opacity-80 hover:opacity-100" aria-label={t('nav.lang')}>
            {t('nav.langShort')}
          </Link>
          <Link prefetch={false} href="/login" className="rounded-full px-3 py-2 text-[15px] font-medium hover:bg-current/5">{t('nav.login')}</Link>
          <Link prefetch={false} href={SIGNUP_HREF} className="btn-kx !min-h-[42px] text-[15px]">{t('nav.cta')}</Link>
        </div>

        <button
          type="button"
          className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-full lg:hidden"
          aria-expanded={open}
          aria-controls="site-mobile-nav"
          aria-label={open ? t('nav.close') : t('nav.menu')}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={24} aria-hidden /> : <Menu size={24} aria-hidden />}
        </button>
      </div>

      {open && (
        <div id="site-mobile-nav" className="fixed inset-x-0 bottom-0 top-[calc(64px+env(safe-area-inset-top))] overflow-y-auto bg-paper px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-4 text-ink lg:hidden">
          <p className="site-tag">{t('nav.solutions')}</p>
          <ul className="mt-3 grid gap-1">
            {CASES.map((slug) => (
              <li key={slug}>
                <Link prefetch={false} href={href(`/cozumler/${slug}`)} onClick={() => setOpen(false)} className="block rounded-xl px-2 py-3">
                  <span className="block font-semibold">{t(`cases.${slug}.label`)}</span>
                  <span className="block text-sm text-ink-mute">{t(`cases.${slug}.desc`)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <ul className="mt-4 grid gap-1 border-t border-line pt-4">
            {links.map((l) => (
              <li key={l.href}><Link prefetch={false} href={l.href} onClick={() => setOpen(false)} className="block rounded-xl px-2 py-3 text-lg font-semibold">{l.label}</Link></li>
            ))}
            <li><Link prefetch={false} href={switchHref} hrefLang={other} onClick={() => setOpen(false)} className="block rounded-xl px-2 py-3 font-semibold text-ink-soft">{t('nav.lang')}</Link></li>
          </ul>
          <div className="mt-6 grid gap-3">
            <Link prefetch={false} href={SIGNUP_HREF} className="btn-kx w-full">{t('nav.cta')}</Link>
            <Link prefetch={false} href="/login" className="btn-ghost w-full">{t('nav.login')}</Link>
          </div>
          <p className="mt-4 text-center text-sm text-ink-mute">{t('common.trialLine')}</p>
        </div>
      )}
    </header>
  );
}
