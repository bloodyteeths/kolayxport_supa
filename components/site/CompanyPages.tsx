import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Mail, MessageCircle, ArrowRight } from 'lucide-react';
import { COMPANY, addressLine, whatsappUrl } from '@/lib/site/company';
import { localePath, type SiteLocale } from '@/lib/site/routes';
import type { InventoryRow } from '@/lib/site/inventory';
import { track } from '@/lib/tracking/events';
import SiteLayout from './SiteLayout';
import { Section, Heading, CtaBand } from './Blocks';

/* ───────────────────────── Kurumsal ───────────────────────── */

export function AboutPage({ locale }: { locale: SiteLocale }) {
  return (
    <SiteLayout locale={locale} seo={{ title: locale === 'tr' ? 'Kurumsal — KolayXport' : 'About — KolayXport', description: locale === 'tr' ? "KolayXport'u geliştiren Modsons Yazılım hakkında: hikâye, ilkeler ve şirket bilgileri." : 'About Modsons Yazılım, the company behind KolayXport: story, principles and company details.', path: '/kurumsal', hasTwin: true }}>
      <AboutBody locale={locale} />
    </SiteLayout>
  );
}

function CompanyFacts() {
  const t = useTranslations('site');
  const rows: [string, string | null][] = [
    [t('about.legalName'), COMPANY.legalName],
    [t('about.address'), addressLine()],
    [t('footer.taxNo'), COMPANY.taxNumber],
    [t('footer.taxOffice'), COMPANY.taxOffice],
    [t('footer.registry'), COMPANY.tradeRegistry],
    [t('footer.mersis'), COMPANY.mersis],
    [t('footer.kep'), COMPANY.kep],
    [t('contact.email'), COMPANY.email],
  ];
  return (
    <dl className="divide-y divide-line rounded-2xl border border-line bg-white">
      {rows.filter(([, v]) => !!v).map(([k, v]) => (
        <div key={k} className="grid gap-1 px-5 py-4 sm:grid-cols-[180px_1fr]">
          <dt className="text-sm text-ink-mute">{k}</dt>
          <dd className="text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function AboutBody({ locale }: { locale: SiteLocale }) {
  const t = useTranslations('site.about');
  const f = useTranslations('site.home.final');
  return (
    <>
      <Section>
        <Heading as="h1" eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')} />
      </Section>
      <Section tone="white">
        <h2 className="display text-[30px] md:text-[40px]">{t('principlesTitle')}</h2>
        <ul className="mt-10 grid gap-8 md:grid-cols-3">
          {(t.raw('principles') as { title: string; text: string }[]).map((p) => (
            <li key={p.title} className="border-t-2 border-ink pt-5">
              <h3 className="text-lg font-semibold">{p.title}</h3>
              <p className="mt-2 text-ink-soft">{p.text}</p>
            </li>
          ))}
        </ul>
      </Section>
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 className="display text-[30px] md:text-[40px]">{t('companyTitle')}</h2>
            <Link prefetch={false} href={localePath(locale, '/iletisim')} className="btn-ghost mt-8">{t('contactCta')} <ArrowRight size={18} aria-hidden /></Link>
          </div>
          <CompanyFacts />
        </div>
      </Section>
      <CtaBand title={f('title')} text={f('text')} />
    </>
  );
}

/* ───────────────────────── İletişim ───────────────────────── */

export function ContactPage({ locale }: { locale: SiteLocale }) {
  return (
    <SiteLayout locale={locale} seo={{ title: locale === 'tr' ? 'İletişim — KolayXport' : 'Contact — KolayXport', description: locale === 'tr' ? 'KolayXport ekibine e-posta, WhatsApp veya form ile ulaşın. Kurumsal plan ve iş birliği talepleri.' : 'Reach the KolayXport team by email, WhatsApp or the form. Enterprise plans and partnerships.', path: '/iletisim', hasTwin: true }}>
      <ContactBody locale={locale} />
    </SiteLayout>
  );
}

function ContactBody({ locale }: { locale: SiteLocale }) {
  const t = useTranslations('site.contact');
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  useEffect(() => {
    const key = Array.isArray(router.query.subject) ? router.query.subject[0] : router.query.subject;
    if (router.isReady && (key === 'enterprise' || key === 'partner')) setForm((f) => ({ ...f, subject: t(`presets.${key}`) }));
  }, [router.isReady, router.query.subject, t]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = t('required');
    if (!/^\S+@\S+\.\S+$/.test(form.email)) e.email = t('invalidEmail');
    if (!form.subject.trim()) e.subject = t('required');
    if (form.message.trim().length < 10) e.message = t('tooShort');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setState('sending');
    try {
      const res = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!res.ok) throw new Error(String(res.status));
      track('contact_submit', { location: 'iletisim' });
      setState('sent');
      setForm({ name: '', email: '', subject: '', message: '' });
    } catch {
      setState('error');
    }
  };

  const field = (name: keyof typeof form, label: string, type = 'text', textarea = false) => (
    <label className="block">
      <span className="text-sm font-semibold text-ink">{label}</span>
      {textarea ? (
        <textarea name={name} rows={6} value={form[name]} onChange={(e) => setForm({ ...form, [name]: e.target.value })} aria-invalid={!!errors[name]} aria-describedby={errors[name] ? `${name}-err` : undefined} className="mt-2 w-full rounded-xl border border-line bg-white px-4 py-3 text-[16px] outline-none focus:border-kx" />
      ) : (
        <input name={name} type={type} value={form[name]} onChange={(e) => setForm({ ...form, [name]: e.target.value })} aria-invalid={!!errors[name]} aria-describedby={errors[name] ? `${name}-err` : undefined} autoComplete={name === 'email' ? 'email' : name === 'name' ? 'name' : 'off'} className="mt-2 min-h-[48px] w-full rounded-xl border border-line bg-white px-4 text-[16px] outline-none focus:border-kx" />
      )}
      {errors[name] ? <span id={`${name}-err`} className="mt-1 block text-sm text-[#B42318]">{errors[name]}</span> : null}
    </label>
  );

  const wa = whatsappUrl(t('whatsappText'));

  return (
    <Section>
      <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <Heading as="h1" eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')} />
          <div className="mt-10 grid gap-4">
            {wa ? (
              <a href={wa} target="_blank" rel="noopener noreferrer" onClick={() => track('cta_click', { location: 'whatsapp' })} className="flex items-center gap-4 rounded-2xl border border-line bg-white p-5 hover:border-ink">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-[#E7F7EE] text-[#0F7A4A]"><MessageCircle size={22} aria-hidden /></span>
                <span className="font-semibold">{t('whatsapp')}</span>
              </a>
            ) : null}
            <a href={`mailto:${COMPANY.email}`} className="flex items-center gap-4 rounded-2xl border border-line bg-white p-5 hover:border-ink">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-kx-wash text-kx"><Mail size={22} aria-hidden /></span>
              <span><span className="block text-sm text-ink-mute">{t('email')}</span><span className="font-semibold">{COMPANY.email}</span></span>
            </a>
          </div>
        </div>
        <form onSubmit={submit} noValidate className="rounded-[24px] border border-line bg-white p-6 md:p-8">
          <h2 className="display text-[26px]">{t('formTitle')}</h2>
          <div className="mt-6 grid gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              {field('name', t('name'))}
              {field('email', t('emailField'), 'email')}
            </div>
            {field('subject', t('subject'))}
            {field('message', t('message'), 'text', true)}
          </div>
          <p className="mt-4 text-xs text-ink-mute">
            {t('consent')} <Link prefetch={false} href={localePath(locale, '/kvkk-aydinlatma-metni')} className="underline">KVKK</Link>
          </p>
          <button type="submit" disabled={state === 'sending'} className="btn-kx mt-6 w-full sm:w-auto">{state === 'sending' ? t('sending') : t('send')}</button>
          <p role="status" aria-live="polite" className={`mt-4 text-sm ${state === 'error' ? 'text-[#B42318]' : 'text-[#0F7A4A]'}`}>
            {state === 'sent' ? t('sent') : state === 'error' ? t('error') : ''}
          </p>
        </form>
      </div>
    </Section>
  );
}

/* ───────────────────────── Özellikler ───────────────────────── */

const AREA_TR: Record<string, string> = {
  'Orders & fulfillment': 'Sipariş yönetimi',
  'Shipping labels & customs': 'Kargo etiketi ve gümrük',
  'Micro-export / ETGB / e-invoice': 'Mikro ihracat, ETGB, e-Arşiv',
  'Listing management per marketplace': 'İlan yönetimi',
  'AI tools (Gemini)': 'Yapay zekâ araçları',
  'Research & arbitrage': 'Araştırma ve arbitraj',
  'Stock sync': 'Stok senkronizasyonu',
  'Finance & reports': 'Finans ve raporlar',
  'Messaging': 'Mesajlar',
  'Notifications': 'Bildirimler',
  'Chrome extension': 'Chrome eklentisi',
};

export function FeaturesPage({ locale, rows }: { locale: SiteLocale; rows: InventoryRow[] }) {
  return (
    <SiteLayout locale={locale} seo={{ title: locale === 'tr' ? 'Özellikler — KolayXport' : 'Features — KolayXport', description: locale === 'tr' ? "KolayXport'un tüm özellikleri ve durumları: yapay zekâ ile ilan, toplu düzenleme, araştırma, sipariş, kargo etiketi, ETGB, stok ve kâr raporu." : 'Every KolayXport feature with its status: AI listings, bulk editing, research, orders, labels, ETGB, stock sync and profit reports.', path: '/ozellikler', hasTwin: true }}>
      <FeaturesBody locale={locale} rows={rows} />
    </SiteLayout>
  );
}

function FeaturesBody({ locale, rows }: { locale: SiteLocale; rows: InventoryRow[] }) {
  const t = useTranslations('site.features');
  const c = useTranslations('site.common');
  const f = useTranslations('site.home.final');
  const areas = Array.from(new Set(rows.map((r) => r.area)));
  return (
    <>
      <Section>
        <Heading as="h1" eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')} />
        <div className="mt-14 grid gap-14">
          {areas.map((area) => (
            <div key={area}>
              <h2 className="display text-[26px] md:text-[32px]">{locale === 'tr' ? AREA_TR[area] || area : area}</h2>
              <ul className="mt-5 grid gap-3 md:grid-cols-2">
                {rows.filter((r) => r.area === area).map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-4 rounded-xl border border-line bg-white px-4 py-3">
                    <span>
                      <span className="block font-medium text-ink">{locale === 'tr' ? r.tr : r.en}</span>
                      <span className="block text-sm text-ink-mute">{r.where.replace(/\*/g, '')}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${r.level === 'production' ? 'bg-[#E7F7EE] text-[#0F7A4A]' : 'bg-[#FFF4DB] text-[#7A5418]'}`}>{c(`maturity.${r.level === 'production' ? 'production' : r.level === 'beta' ? 'beta' : 'partial'}` as any)}</span>
                      {/pro/i.test(r.plan) ? <span className="text-xs font-semibold text-kx">Pro</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>
      <CtaBand title={f('title')} text={f('text')} />
    </>
  );
}
