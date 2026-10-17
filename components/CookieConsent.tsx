import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { applyConsent, OPEN_EVENT, readConsent, saveConsent } from '@/lib/tracking/consent';

/**
 * KVKK cookie banner with equal-weight "accept all" / "necessary only" and per-category preferences.
 * Nothing non-essential runs before a choice (Consent Mode v2 defaults to denied in _document).
 */
export default function CookieConsent() {
  const t = useTranslations('site.cookies');
  const [visible, setVisible] = useState(false);
  const [custom, setCustom] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    const existing = readConsent();
    if (existing) {
      applyConsent(existing);
      setAnalytics(existing.analytics);
      setMarketing(existing.marketing);
    } else {
      setVisible(true);
    }
    const open = () => {
      const c = readConsent();
      setAnalytics(!!c?.analytics);
      setMarketing(!!c?.marketing);
      setCustom(true);
      setVisible(true);
    };
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, []);

  if (!visible) return null;

  const decide = (a: boolean, m: boolean) => {
    saveConsent({ analytics: a, marketing: m });
    setVisible(false);
    setCustom(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="kx-cookie-title"
      className="[font-family:ui-sans-serif,system-ui,-apple-system,'Segoe_UI',Roboto,sans-serif] fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-[560px] rounded-2xl border border-slate-200 bg-white p-4 text-slate-800 shadow-[0_20px_50px_-20px_rgba(11,18,32,.45)] sm:inset-x-auto sm:right-4 sm:bottom-4"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      <p id="kx-cookie-title" className="text-sm font-semibold text-slate-900">{t('title')}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
        {t('text')}{' '}
        <Link href="/cerez-politikasi" className="font-medium text-[#2F5BFF] underline underline-offset-2">{t('policy')}</Link>
      </p>

      {custom && (
        <fieldset className="mt-3 grid gap-2 text-[13px]">
          <label className="flex items-start gap-3 rounded-xl bg-slate-50 p-2.5">
            <input type="checkbox" checked disabled className="mt-0.5 h-4 w-4" />
            <span><strong className="block text-slate-900">{t('necessary')}</strong>{t('necessaryDesc')}</span>
          </label>
          <label className="flex items-start gap-3 rounded-xl bg-slate-50 p-2.5">
            <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} className="mt-0.5 h-4 w-4" />
            <span><strong className="block text-slate-900">{t('analytics')}</strong>{t('analyticsDesc')}</span>
          </label>
          <label className="flex items-start gap-3 rounded-xl bg-slate-50 p-2.5">
            <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="mt-0.5 h-4 w-4" />
            <span><strong className="block text-slate-900">{t('marketing')}</strong>{t('marketingDesc')}</span>
          </label>
        </fieldset>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {custom ? (
          <button type="button" onClick={() => decide(analytics, marketing)} className="min-h-[40px] flex-1 rounded-full bg-[#0B1220] px-4 text-sm font-semibold text-white">{t('save')}</button>
        ) : (
          <button type="button" onClick={() => setCustom(true)} className="min-h-[40px] rounded-full px-3 text-sm font-semibold text-slate-700 underline underline-offset-2">{t('customize')}</button>
        )}
        <button type="button" onClick={() => decide(false, false)} className="min-h-[40px] flex-1 rounded-full border border-[#0B1220] px-4 text-sm font-semibold text-[#0B1220]">{t('rejectAll')}</button>
        <button type="button" onClick={() => decide(true, true)} className="min-h-[40px] flex-1 rounded-full bg-[#2F5BFF] px-4 text-sm font-semibold text-white">{t('acceptAll')}</button>
      </div>
    </div>
  );
}
