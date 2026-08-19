import React, { Fragment, useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { loadStripe } from '@stripe/stripe-js';
import PublicLayout from '../components/PublicLayout';
import { motion } from 'framer-motion';
import { Disclosure, Transition } from '@headlessui/react';
import { CheckCircle, ChevronDown, ShieldCheck, Star, TrendingUp } from 'lucide-react';
import { NextSeo } from 'next-seo';
import { signIn as nextAuthSignIn } from 'next-auth/react';
import { useTranslations } from 'next-intl';

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

const sectionVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' } },
};

const cardHover = {
  translateY: -4,
  scale: 1.02,
  boxShadow: '0px 15px 30px rgba(0, 0, 0, 0.1)',
  transition: { type: 'spring', stiffness: 300 },
};

// Prices are data, not copy — they stay here and must match the Stripe price
// env vars (PRICE_STARTER_MONTH etc.). All human-readable strings come from
// messages/*.json under marketing.pricing.
const planPrices = {
  month: { starter: '₺449', growth: '₺999' },
  year: { starter: '₺4,490', growth: '₺9,990' },
};

export default function FiyatlandirmaPage() {
  const [billingInterval, setBillingInterval] = useState('month');
  const router = useRouter();
  const t = useTranslations('marketing.pricing');
  const comparison = t.raw('comparison');
  const faqItems = t.raw('faq');

  // Shopify-installed merchants are on the free Shopify tier — App Store rules
  // forbid showing them Stripe pricing. Redirect to /ayarlar so the reviewer (and
  // any real Shopify merchant) never sees the paid plans page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/user/settings', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (!cancelled && data?.subscription?.billingProvider === 'shopify_free') {
          router.replace('/ayarlar');
        }
      } catch { /* fail open — public visitors still see the page */ }
    })();
    return () => { cancelled = true; };
  }, [router]);

  const handleCheckout = async (plan, interval) => {
    try {
      if (!stripePromise) {
        throw new Error('Stripe publishable key is not configured. Please check NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY environment variable.');
      }

      const res = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ plan, interval }),
      });

      if (res.status === 401) {
        // Not authenticated, redirect to sign in
        await nextAuthSignIn('google', { callbackUrl: '/fiyatlandirma' });
        return;
      }

      // Shopify-installed merchants are on the free tier and can't checkout via Stripe.
      if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Shopify üzerinden yüklenen hesaplar ücretsiz Shopify katmanını kullanır.');
        return;
      }

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`API error: ${res.status} - ${errorText}`);
      }

      const data = await res.json();
      const { sessionId, error } = data;
      if (error) {
        throw new Error(error);
      }
      if (!sessionId) {
        throw new Error('Could not create checkout session');
      }

      const stripe = await stripePromise;
      const { error: redirectError } = await stripe.redirectToCheckout({ sessionId });

      if (redirectError) {
        throw redirectError;
      }
    } catch (error) {
      alert(`Bir hata oluştu: ${error.message}`);
    }
  };

  const frequency = billingInterval === 'month' ? '/ ay' : '/ yıl';
  const descKey = billingInterval === 'month' ? 'descMonth' : 'descYear';
  const plans = [
    {
      planKey: 'starter',
      id: `tier-starter-${billingInterval}`,
      name: t('plans.starter.name'),
      priceMonthly: planPrices[billingInterval].starter,
      frequency,
      description: t(`plans.starter.${descKey}`),
      features: t.raw('plans.starter.features'),
      highlight: false,
      icon: Star,
    },
    {
      planKey: 'growth',
      id: `tier-growth-${billingInterval}`,
      name: t('plans.growth.name'),
      priceMonthly: planPrices[billingInterval].growth,
      frequency,
      description: t(`plans.growth.${descKey}`),
      features: t.raw('plans.growth.features'),
      highlight: true,
      icon: TrendingUp,
    },
    {
      id: 'tier-enterprise',
      name: t('plans.enterprise.name'),
      priceMonthly: t('plans.enterprise.price'),
      frequency: '',
      description: t('plans.enterprise.description'),
      features: t.raw('plans.enterprise.features'),
      href_contact: '/iletisim?subject=Kurumsal%20Teklif%20Talebi',
      highlight: false,
      icon: ShieldCheck,
    },
  ];

  return (
    <PublicLayout
      title={t('seo.title')}
      description={t('seo.description')}
    >
      <NextSeo
        openGraph={{
          images: [
            {
              url: 'https://kolayxport.com/og-pricing.png',
              width: 1200,
              height: 630,
              alt: t('seo.ogAlt'),
            },
          ],
        }}
      />
      {/* Hero Section */}
      <motion.section
        className="relative py-20 md:py-32 lg:py-40 text-center px-6 lg:px-8 overflow-hidden bg-gradient-to-br from-sky-50 to-cyan-50 isolate"
        variants={sectionVariants}
        initial="hidden"
        animate="visible"
      >
        <div className="absolute inset-0 pointer-events-none">
            <div
                className="absolute inset-0 animate-slow-spin opacity-30 md:opacity-40"
                style={{
                    background: `
                        radial-gradient(circle at 30% 70%, #a5f3fc 0%, transparent 30%),
                        radial-gradient(circle at 70% 30%, #bae6fd 0%, transparent 30%)
                    `,
                }}
            />
        </div>
        <div className="relative z-10">
          <motion.h1
            className="text-4xl sm:text-5xl md:text-6xl font-black text-slate-900 tracking-tight"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            {t('hero.titlePrefix')} <span className="text-blue-600">{t('hero.titleHighlight')}</span> {t('hero.titleSuffix')}
          </motion.h1>
          <motion.p
            className="mt-6 max-w-2xl mx-auto text-lg sm:text-xl text-slate-600"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            {t('hero.subtitle')}
          </motion.p>
          <motion.div
            className="mt-10 flex flex-col sm:flex-row justify-center items-center gap-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.6 }}
          >
            <Link href="/api/auth/signin" className="px-8 py-3.5 text-lg font-semibold text-white bg-gradient-to-r from-blue-500 to-indigo-500 rounded-lg shadow-lg hover:scale-105 transform transition-transform duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-400">
                {t('hero.ctaStart')}
            </Link>
            <Link href="/iletisim?subject=Telefonla%20Bilgi%20Almak%20İstiyorum" className="px-8 py-3.5 text-lg font-semibold text-blue-600 bg-white rounded-lg shadow-lg hover:scale-105 hover:bg-slate-50 transform transition-all duration-200 ease-out border border-slate-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-400">
                {t('hero.ctaCall')}
            </Link>
          </motion.div>
        </div>
      </motion.section>

      {/* Plans Grid Section */}
      <motion.section
        className="py-16 md:py-24 bg-slate-50"
        variants={sectionVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.1 }}
      >
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">{t('plansHeading')}</h2>
            <p className="max-w-xl mx-auto text-lg text-slate-600">
              {t('plansSubheading')}
            </p>
          </div>

          {/* English pricing summary — ensures the pricing scheme is clear and
              transparent to non-Turkish readers (e.g. marketplace app reviewers).
              Intentionally hardcoded English regardless of locale. */}
          <div className="max-w-3xl mx-auto mb-12 rounded-2xl border border-slate-200 bg-white p-6 md:p-8 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-800 mb-3">Pricing (English)</h3>
            <ul className="space-y-2 text-slate-600 text-sm md:text-base">
              <li><span className="font-semibold text-slate-800">Starter:</span> ₺449 / month (₺4,490 / year) — 200 orders &amp; 100 shipping labels per month, 1 user.</li>
              <li><span className="font-semibold text-slate-800">Growth:</span> ₺999 / month (₺9,990 / year) — 2,000 orders &amp; 500 shipping labels per month, 5 users.</li>
              <li><span className="font-semibold text-slate-800">Enterprise:</span> custom quote — unlimited usage; request a quote via our <Link href="/iletisim?subject=Enterprise%20Quote%20Request" className="text-blue-600 hover:underline">contact form</Link>.</li>
            </ul>
            <p className="mt-4 text-sm text-slate-500">
              All plans include a 30-day free trial and every marketplace &amp; shipping integration. Prices are in Turkish Lira (₺). There are no hidden or additional service fees.
            </p>
          </div>

          <div className="flex justify-center mb-8">
            <button
              onClick={() => setBillingInterval('month')}
              className={`px-6 py-2 text-lg font-semibold rounded-l-full transition-colors duration-300 ${billingInterval === 'month' ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-slate-600 border border-r-0 border-slate-300'}`}
            >
              {t('billing.monthly')}
            </button>
            <button
              onClick={() => setBillingInterval('year')}
              className={`px-6 py-2 text-lg font-semibold rounded-r-full transition-colors duration-300 relative ${billingInterval === 'year' ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-slate-600 border border-slate-300'}`}
            >
              {t('billing.yearly')}
              <span className="absolute -top-2 -right-3 bg-green-500 text-white text-xs font-bold px-2 py-0.5 rounded-full transform rotate-12">
                {t('billing.discount')}
              </span>
            </button>
          </div>
          <div className="grid lg:grid-cols-3 gap-8 items-stretch">
            {plans.map((plan, index) => (
              <motion.div
                key={plan.name}
                className={`flex flex-col bg-white rounded-3xl shadow-xl ${plan.highlight ? 'border-2 border-blue-500 shadow-blue-500/30' : 'border border-slate-100'} p-8 transition-all duration-300 ease-out`}
                variants={{ hidden: { opacity: 0, y: 50 }, visible: { opacity: 1, y: 0 } }}
                initial="hidden"
                whileInView="visible"
                whileHover={cardHover}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ delay: index * 0.1, duration: 0.5 }}
              >
                <div className="flex-grow">
                  <div className="flex items-center mb-4">
                     {React.createElement(plan.icon, { className: `w-8 h-8 mr-3 ${plan.highlight ? 'text-blue-500' : 'text-slate-400' }` })}
                    <h3 className="text-2xl font-bold text-slate-800">{plan.name}</h3>
                  </div>
                  <p className={`text-4xl font-black text-slate-900 mb-1 ${plan.highlight ? 'text-blue-600' : ''}`}>
                    {plan.priceMonthly}
                    {plan.frequency && <span className="text-xl font-semibold text-slate-500">{plan.frequency}</span>}
                  </p>
                  <p className="text-sm text-slate-500 mb-6 h-12">{plan.description}</p>
                  <ul className="space-y-3 mb-8">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-start">
                        <CheckCircle size={18} className={`mr-2 mt-0.5 ${plan.highlight ? 'text-blue-500' : 'text-green-500'} flex-shrink-0`} />
                        <span className="text-sm text-slate-700">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                {plan.href_contact ? (
                  <Link href={plan.href_contact} aria-describedby={plan.id} className={`w-full block text-center px-6 py-3.5 text-base font-semibold rounded-lg shadow-md transform transition-all duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-offset-2 cursor-pointer ${plan.highlight ? 'text-white bg-gradient-to-r from-orange-500 to-red-500 hover:scale-[1.03]' : 'text-slate-700 bg-slate-100 hover:bg-slate-200 hover:scale-[1.03]'} ${plan.highlight ? 'focus:ring-orange-400' : 'focus:ring-slate-300'}`}>
                      {t('plans.enterprise.cta')}
                  </Link>
                ) : (
                  <button
                    onClick={() => handleCheckout(plan.planKey, billingInterval)}
                    aria-describedby={plan.id}
                    className={`w-full block text-center px-6 py-3.5 text-base font-semibold rounded-lg shadow-md transform transition-all duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-offset-2 cursor-pointer
                      ${plan.highlight
                        ? 'text-white bg-gradient-to-r from-blue-500 to-indigo-500 hover:scale-[1.03]'
                        : 'text-blue-600 bg-blue-50 hover:bg-blue-100 hover:scale-[1.03]'
                      } ${plan.highlight ? 'focus:ring-blue-400' : 'focus:ring-blue-300'}
                    `}>
                    {t('trialButton')}
                  </button>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* Comparison Table Section */}
      <motion.section
        className="py-16 md:py-24 bg-white"
        variants={sectionVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.1 }}
      >
        <div className="container max-w-6xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">{comparison.heading}</h2>
            <p className="max-w-xl mx-auto text-lg text-slate-600">
              {comparison.subheading}
            </p>
          </div>
          <div className="overflow-x-auto lg:overflow-visible rounded-xl shadow-xl shadow-slate-900/[.07] ring-1 ring-slate-200">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  {comparison.headers.map((header, index) => (
                    <th
                      key={header}
                      scope="col"
                      className={`px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap
                        ${index === 0 ? 'text-left sticky left-0 bg-slate-50 z-10' : 'text-center'}`}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {comparison.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="hover:bg-slate-50/50 transition-colors">
                    {row.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        className={`px-6 py-4 whitespace-nowrap text-sm
                          ${cellIndex === 0 ? 'font-medium text-slate-800 text-left sticky left-0 bg-white group-hover:bg-slate-50/50 z-10' : 'text-center'}
                          ${cell === '✓' ? 'text-green-600 font-bold text-base' : ''}
                          ${cell === '—' ? 'text-slate-300' : 'text-slate-600'}`
                        }
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </motion.section>

      {/* FAQ Section */}
      <motion.section
        className="py-16 md:py-24 bg-slate-50"
        variants={sectionVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.1 }}
      >
        <div className="container max-w-3xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">{t('faqHeading')}</h2>
          </div>
          <div className="space-y-4">
            {faqItems.map((item, i) => (
              <Disclosure as="div" key={i} className="bg-white rounded-lg shadow-md">
                {({ open }) => (
                  <>
                    <Disclosure.Button className="flex justify-between items-center w-full px-6 py-4 text-left text-lg font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring focus-visible:ring-blue-500 focus-visible:ring-opacity-75 rounded-lg">
                      <span>{item.question}</span>
                      <ChevronDown
                        size={24}
                        className={`transform transition-transform duration-200 ${open ? '-rotate-180' : ''} text-slate-500`}
                      />
                    </Disclosure.Button>
                    <Transition
                      as={Fragment}
                      enter="transition duration-100 ease-out"
                      enterFrom="transform scale-95 opacity-0"
                      enterTo="transform scale-100 opacity-100"
                      leave="transition duration-75 ease-out"
                      leaveFrom="transform scale-100 opacity-100"
                      leaveTo="transform scale-95 opacity-0"
                    >
                      <Disclosure.Panel className="px-6 pt-2 pb-6 text-sm text-slate-600 leading-relaxed">
                        {item.answer}
                      </Disclosure.Panel>
                    </Transition>
                  </>
                )}
              </Disclosure>
            ))}
          </div>
        </div>
      </motion.section>

      <div className="mt-16 text-center">
        <h3 className="text-2xl font-semibold text-slate-800 mb-4">{t('custom.heading')}</h3>
        <p className="text-slate-600 mb-8">{t('custom.text')}</p>
        <Link href="/iletisim" className="inline-block px-8 py-3 text-lg font-semibold text-white bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg shadow-lg hover:scale-105 transform transition-transform duration-200 ease-out">
            {t('custom.button')}
        </Link>
      </div>

    </PublicLayout>
  );
}
