import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { COMPANY, addressLine } from '@/lib/site/company';
import { CASES, localePath, type SiteLocale } from '@/lib/site/routes';
import { openCookiePreferences } from './cookieConsent';
import { usePlayClient } from '@/lib/billing/usePlayClient';

export default function SiteFooter({ locale }: { locale: SiteLocale }) {
  const t = useTranslations('site');
  const href = (p: string) => localePath(locale, p);
  const play = usePlayClient();
  const social = Object.entries(COMPANY.social).filter(([, url]) => !!url) as [string, string][];

  const cols: { title: string; links: { href: string; label: string }[] }[] = [
    { title: t('footer.solutions'), links: CASES.map((s) => ({ href: href(`/cozumler/${s}`), label: t(`cases.${s}.label`) })) },
    {
      title: t('footer.product'),
      links: [
        { href: href('/ozellikler'), label: t('footer.features') },
        { href: href('/entegrasyonlar'), label: t('footer.integrations') },
        ...(play ? [] : [{ href: href('/fiyatlandirma'), label: t('footer.pricing') }]),
        { href: href('/nasil-kullanirim'), label: t('footer.help') },
        { href: href('/blog'), label: t('footer.blog') },
        { href: href('/karsilastirma'), label: t('footer.compare') },
      ],
    },
    {
      title: t('footer.company'),
      links: [
        { href: href('/kurumsal'), label: t('footer.about') },
        { href: href('/iletisim'), label: t('footer.contact') },
      ],
    },
    {
      title: t('footer.legal'),
      links: [
        { href: href('/kvkk-aydinlatma-metni'), label: t('footer.kvkk') },
        { href: href('/cerez-politikasi'), label: t('footer.cookies') },
        { href: href('/gizlilik-politikasi'), label: t('footer.privacy') },
        { href: href('/kullanim-sartlari'), label: t('footer.terms') },
        { href: href('/mesafeli-satis-sozlesmesi'), label: t('footer.distance') },
        { href: href('/on-bilgilendirme-formu'), label: t('footer.preinfo') },
      ],
    },
  ];

  return (
    <footer className="site-rules-dark bg-ink text-paper" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="mx-auto max-w-[1200px] px-5 py-16 md:px-8">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_2fr]">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/kolayxport-logo-dark.svg" alt="KolayXport" width={162} height={40} className="h-10 w-auto" loading="lazy" />
            <p className="display mt-4 text-2xl text-paper">{t('footer.tagline')}</p>
            <p className="mt-4 text-sm">
              <a href={`mailto:${COMPANY.email}`} className="underline underline-offset-4 hover:text-kx-soft">{COMPANY.email}</a>
            </p>
            {social.length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-3 text-sm">
                {social.map(([name, url]) => (
                  <li key={name}><a href={url} rel="me noopener" target="_blank" className="capitalize text-paper/80 hover:text-paper">{name}</a></li>
                ))}
              </ul>
            )}
          </div>
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            {cols.map((c) => (
              <nav key={c.title} aria-label={c.title}>
                <h2 className="text-xs font-semibold uppercase tracking-[.14em] text-kx-soft">{c.title}</h2>
                <ul className="mt-4 grid gap-2.5 text-[15px]">
                  {c.links.map((l) => (
                    <li key={l.href}><Link prefetch={false} href={l.href} className="text-paper/80 hover:text-paper">{l.label}</Link></li>
                  ))}
                  {c.title === t('footer.legal') && (
                    <li><button type="button" onClick={openCookiePreferences} className="text-left text-paper/80 hover:text-paper">{t('footer.cookiePrefs')}</button></li>
                  )}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-14 grid gap-6 border-t border-paper/15 pt-8 text-[13px] leading-relaxed text-paper/65 md:grid-cols-2">
          <address className="not-italic">
            <strong className="font-semibold text-paper/85">{COMPANY.legalName}</strong><br />
            {addressLine()}<br />
            {t('footer.taxNo')}: {COMPANY.taxNumber}{COMPANY.taxOffice ? ` · ${t('footer.taxOffice')}: ${COMPANY.taxOffice}` : ''}<br />
            {t('footer.registry')}: {COMPANY.tradeRegistry}
            {COMPANY.mersis ? <><br />{t('footer.mersis')}: {COMPANY.mersis}</> : null}
            {COMPANY.kep ? <><br />{t('footer.kep')}: {COMPANY.kep}</> : null}
          </address>
          <div>
            <p>{t('footer.etsyNotice')}</p>
            <p className="mt-2">{t('footer.marks')}</p>
            <p className="mt-4">{t('footer.rights', { year: new Date().getFullYear() })}</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
