import React, { Fragment } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import PublicLayout from '../PublicLayout';
import { motion } from 'framer-motion';
import {
  ChevronDown, Star, Truck, Search, TrendingUp, ShoppingBag, Layers, Brain,
  Zap, ArrowLeftRight, DollarSign, Camera, MessageSquare, Chrome, CheckCircle,
} from 'lucide-react';
import { Disclosure, Transition } from '@headlessui/react';
import { FAQPageJsonLd } from 'next-seo';
import { useTranslations } from 'next-intl';

// Single source of truth for the public homepage. Rendered by both / (tr) and
// /en under a route-locked NextIntlClientProvider so the two locales can never
// drift apart again. Only brand names, icons and asset paths live here — all
// human-readable copy comes from messages/*.json under marketing.home.

const trustLogos = [
  { name: 'Etsy', src: '/logos/etsy.svg', width: 80, height: 40 },
  { name: 'eBay', text: 'eBay', className: 'text-2xl font-bold text-blue-600 tracking-tight' },
  { name: 'Amazon', src: '/logos/amazon.svg', width: 120, height: 40 },
  { name: 'Trendyol', src: '/logos/trendyol.png', width: 120, height: 40 },
  { name: 'Wix', text: 'WIX', className: 'text-2xl font-extrabold text-slate-800 tracking-widest' },
  { name: 'Shopify', src: '/logos/shopify.jpg', width: 120, height: 40 },
];

const featureIcons = [Brain, Search, ShoppingBag, Camera, Truck, ArrowLeftRight, TrendingUp, MessageSquare, Layers];

const powerToolCards = [
  { key: 'etsy', logo: '/logos/etsy.svg', wrap: 'from-orange-50 to-amber-50 border-orange-100', badge: 'text-orange-600 bg-orange-100', bullet: 'text-orange-500' },
  { key: 'ebay', text: 'eBay', textClass: 'text-2xl font-bold text-blue-600 tracking-tight', wrap: 'from-blue-50 to-indigo-50 border-blue-100', badge: 'text-blue-600 bg-blue-100', bullet: 'text-blue-500' },
  { key: 'amazon', logo: '/logos/amazon.svg', wrap: 'from-slate-50 to-yellow-50 border-yellow-100', badge: 'text-yellow-700 bg-yellow-100', bullet: 'text-yellow-600' },
  { key: 'trendyol', logo: '/logos/trendyol.png', wrap: 'from-rose-50 to-orange-50 border-rose-100', badge: 'text-rose-600 bg-rose-100', bullet: 'text-rose-500' },
];

const sectionVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' } },
};

const cardHover = {
  translateY: -4,
  scale: 1.02,
  transition: { type: 'spring', stiffness: 300 },
};

const StarRating = ({ rating }) => (
  <div className="flex items-center">
    {[...Array(5)].map((_, i) => (
      <Star
        key={i}
        size={20}
        className={i < rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}
      />
    ))}
  </div>
);

export default function HomeContent({ locale = 'tr' }) {
  const t = useTranslations('marketing.home');
  const featureItems = t.raw('features.items');
  const faqItems = t.raw('faq.items');
  const includedItems = t.raw('included.items');
  const testimonialItems = t.raw('testimonials.items');
  const arbitrageItems = t.raw('arbitrage.items');
  const extensionItems = t.raw('extension.items');

  const privacyHref = locale === 'en' ? '/privacy' : '/privacy-tr';
  const termsHref = locale === 'en' ? '/terms' : '/terms-tr';

  return (
    <PublicLayout
      title={t('seo.title')}
      description={t('seo.description')}
      seo={{
        languageAlternates: [
          { hrefLang: 'tr', href: 'https://kolayxport.com/' },
          { hrefLang: 'en', href: 'https://kolayxport.com/en' },
          { hrefLang: 'x-default', href: 'https://kolayxport.com/' },
        ],
        openGraph: {
          images: [
            {
              url: 'https://kolayxport.com/og-public.png',
              width: 1200,
              height: 630,
              alt: t('seo.ogAlt'),
            },
          ],
        },
      }}
    >
      <FAQPageJsonLd
        mainEntity={faqItems.map(item => ({
          questionName: item.question,
          acceptedAnswerText: item.answer,
        }))}
      />

      {/* HERO */}
      <motion.section className="relative isolate overflow-hidden bg-gradient-to-br from-white via-sky-50 to-indigo-50">
        <div className="mx-auto max-w-7xl px-6 pt-28 pb-20 sm:pt-36 sm:pb-24 text-center">
          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-slate-900">
            {t('hero.titlePrefix')} <span className="text-primary">{t('hero.titleHighlight')}</span>
          </h1>
          <p className="mt-6 mx-auto max-w-2xl text-lg text-slate-600">
            {t('hero.subtitle')}
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-x-6">
            <Link href="/login" className="btn-primary">
              {t('hero.ctaPrimary')}
            </Link>
            <Link href="/ozellikler" className="btn-secondary">{t('hero.ctaSecondary')} <span aria-hidden="true">→</span></Link>
          </div>
          <Image
            src="/images/hero-workspace.png"
            width={1600}
            height={1100}
            alt={t('hero.imageAlt')}
            className="mx-auto mt-16 w-full max-w-4xl drop-shadow-2xl rounded-xl"
            priority
          />
        </div>
      </motion.section>

      {/* TRUST LOGOS */}
      <motion.section
        className="py-16 bg-white"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <div className="container max-w-5xl mx-auto px-6 lg:px-8">
          <h3 className="text-center text-sm font-semibold text-slate-500 uppercase tracking-wider mb-10">
            {t('trust.heading')}
          </h3>
          <div className="flex flex-wrap justify-center items-center gap-x-8 gap-y-6 md:gap-x-12 lg:gap-x-16">
            {trustLogos.map((logo) => (
              <motion.div key={logo.name} whileHover={{ scale: 1.05 }}>
                {logo.src ? (
                  <Image
                    src={logo.src}
                    alt={logo.name}
                    width={logo.width}
                    height={logo.height}
                    className="h-8 md:h-10 w-auto max-w-[120px] md:max-w-[140px] object-contain filter grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all duration-300 ease-in-out"
                    loading="lazy"
                  />
                ) : (
                  <span className={`${logo.className} opacity-60 hover:opacity-100 transition-opacity duration-300`}>{logo.text}</span>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* FEATURES */}
      <motion.section
        className="py-20 md:py-28 bg-slate-50"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        variants={sectionVariants}
      >
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">{t('features.heading')}</h2>
            <p className="max-w-2xl mx-auto text-lg text-slate-600">
              {t('features.subheading')}{' '}
              <Link href="/entegrasyonlar" className="text-blue-600 hover:underline">{t('features.integrationsLinkText')}</Link>
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {featureItems.map((feature, i) => {
              const Icon = featureIcons[i] || Zap;
              return (
                <motion.div
                  key={feature.title}
                  className="bg-white p-8 rounded-3xl shadow-xl shadow-slate-900/[.07] transition-all duration-300 ease-out"
                  variants={sectionVariants}
                  whileHover={cardHover}
                >
                  <div className="flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-2xl mb-6 shadow-lg">
                    <Icon size={32} />
                  </div>
                  <h3 className="text-xl font-semibold text-slate-800 mb-3">{feature.title}</h3>
                  <p className="text-slate-600 text-sm leading-relaxed">{feature.description}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </motion.section>

      {/* MARKETPLACE POWER TOOLS */}
      <motion.section
        className="py-20 md:py-28 bg-white"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        variants={sectionVariants}
      >
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">{t('powerTools.heading')}</h2>
            <p className="max-w-2xl mx-auto text-lg text-slate-600">
              {t('powerTools.subheading')}
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-10">
            {powerToolCards.map((card) => (
              <motion.div
                key={card.key}
                className={`relative bg-gradient-to-br ${card.wrap} border rounded-3xl p-8 md:p-10`}
                whileHover={{ scale: 1.01 }}
              >
                <div className="flex items-center gap-3 mb-6">
                  {card.logo ? (
                    <Image src={card.logo} alt={card.key} width={80} height={28} className="h-7 w-auto" />
                  ) : (
                    <span className={card.textClass}>{card.text}</span>
                  )}
                  <span className={`text-xs font-semibold ${card.badge} px-2.5 py-1 rounded-full uppercase tracking-wider`}>
                    {t('powerTools.fullIntegration')}
                  </span>
                </div>
                <ul className="space-y-3">
                  {t.raw(`powerTools.${card.key}`).map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-slate-700">
                      <Zap size={16} className={`${card.bullet} mt-0.5 flex-shrink-0`} />
                      {item}
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* ARBITRAGE SCANNER */}
      <motion.section
        className="py-20 md:py-28 bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        variants={sectionVariants}
      >
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <span className="text-xs font-semibold text-emerald-600 bg-emerald-100 px-3 py-1 rounded-full uppercase tracking-wider">{t('arbitrage.badge')}</span>
              <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mt-4 mb-4">
                {t('arbitrage.heading')}
              </h2>
              <p className="text-lg text-slate-600 mb-8">
                {t('arbitrage.description')}
              </p>
              <ul className="space-y-3">
                {arbitrageItems.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-slate-700">
                    <DollarSign size={16} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                <Link href="/login" className="inline-block px-8 py-3 text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-600 rounded-full shadow-lg hover:scale-105 transform transition-transform duration-200 ease-out">
                  {t('arbitrage.cta')}
                </Link>
              </div>
            </div>
            <motion.div
              className="bg-white rounded-3xl shadow-2xl p-8 border border-emerald-100"
              whileHover={{ scale: 1.01 }}
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between bg-emerald-50 rounded-xl px-5 py-4">
                  <div>
                    <p className="text-xs text-slate-500 mb-1">{t('arbitrage.trendyolPrice')}</p>
                    <p className="text-lg font-bold text-slate-800">₺459</p>
                  </div>
                  <ArrowLeftRight size={24} className="text-emerald-500" />
                  <div className="text-right">
                    <p className="text-xs text-slate-500 mb-1">{t('arbitrage.ebayMedian')}</p>
                    <p className="text-lg font-bold text-slate-800">$38.50</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-green-50 rounded-lg py-3">
                    <p className="text-xs text-slate-500">{t('arbitrage.profit')}</p>
                    <p className="text-lg font-bold text-green-600">$12.40</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg py-3">
                    <p className="text-xs text-slate-500">{t('arbitrage.roi')}</p>
                    <p className="text-lg font-bold text-blue-600">+95%</p>
                  </div>
                  <div className="bg-purple-50 rounded-lg py-3">
                    <p className="text-xs text-slate-500">{t('arbitrage.score')}</p>
                    <p className="text-lg font-bold text-purple-600">78/100</p>
                  </div>
                </div>
                <div className="bg-slate-50 rounded-xl px-5 py-3">
                  <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>{t('arbitrage.productCost')}</span><span>$13.02</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>{t('arbitrage.shipping')}</span><span>$8.00</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>{t('arbitrage.ebayFee')}</span><span>$5.10</span>
                  </div>
                  <div className="flex justify-between text-sm font-semibold text-slate-800 pt-2 border-t border-slate-200 mt-1">
                    <span>{t('arbitrage.netProfit')}</span><span className="text-green-600">$12.40</span>
                  </div>
                </div>
                <p className="text-center text-xs text-slate-400">
                  {t('arbitrage.exampleNote')}
                </p>
              </div>
            </motion.div>
          </div>
        </div>
      </motion.section>

      {/* CHROME EXTENSION */}
      <motion.section
        className="py-20 md:py-28 bg-slate-50"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        variants={sectionVariants}
      >
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <motion.div
              className="order-2 md:order-1 bg-white rounded-3xl shadow-2xl p-8 border border-slate-100"
              whileHover={{ scale: 1.01 }}
            >
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3 mb-4">
                <span className="w-3 h-3 rounded-full bg-red-400" />
                <span className="w-3 h-3 rounded-full bg-yellow-400" />
                <span className="w-3 h-3 rounded-full bg-green-400" />
                <span className="ml-3 text-xs text-slate-400 truncate">etsy.com/listing/…</span>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between bg-indigo-50 rounded-xl px-5 py-4">
                  <div className="flex items-center gap-2">
                    <Chrome size={20} className="text-indigo-500" />
                    <span className="text-sm font-semibold text-slate-800">KolayXport</span>
                  </div>
                  <span className="text-xs font-semibold text-indigo-600 bg-indigo-100 px-2.5 py-1 rounded-full">SEO 86/100</span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-slate-50 rounded-lg py-3">
                    <p className="text-lg font-bold text-slate-800">~142</p>
                    <p className="text-[11px] text-slate-500">{t('extension.mock.salesPerMonth')}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg py-3">
                    <p className="text-lg font-bold text-slate-800">$18.4K</p>
                    <p className="text-[11px] text-slate-500">{t('extension.mock.revenue')}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg py-3">
                    <p className="text-lg font-bold text-slate-800">4.9★</p>
                    <p className="text-[11px] text-slate-500">{t('extension.mock.rating')}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-green-50 rounded-xl px-5 py-3">
                  <CheckCircle size={16} className="text-green-500" />
                  <span className="text-xs text-slate-600">{extensionItems[3]}</span>
                </div>
              </div>
            </motion.div>
            <div className="order-1 md:order-2">
              <span className="text-xs font-semibold text-indigo-600 bg-indigo-100 px-3 py-1 rounded-full uppercase tracking-wider">{t('extension.badge')}</span>
              <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mt-4 mb-4">
                {t('extension.heading')}
              </h2>
              <p className="text-lg text-slate-600 mb-8">
                {t('extension.description')}
              </p>
              <ul className="space-y-3">
                {extensionItems.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-slate-700">
                    <Chrome size={16} className="text-indigo-500 mt-0.5 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                <Link href="/login" className="inline-block px-8 py-3 text-sm font-semibold text-white bg-gradient-to-r from-indigo-500 to-blue-600 rounded-full shadow-lg hover:scale-105 transform transition-transform duration-200 ease-out">
                  {t('extension.cta')}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      {/* WHAT'S INCLUDED */}
      <motion.section
        className="py-20 md:py-28 bg-white"
        initial={{ opacity: 0, y: 50 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
      >
        <div className="container max-w-5xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">{t('included.heading')}</h2>
            <p className="max-w-xl mx-auto text-lg text-slate-600">
              {t('included.subheading')}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {includedItems.map((feature) => (
              <div key={feature} className="flex items-center gap-3 bg-slate-50 rounded-xl px-5 py-4">
                <svg className="w-6 h-6 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm font-medium text-slate-700">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* TESTIMONIALS */}
      <motion.section
        className="py-20 md:py-28 bg-slate-50 overflow-hidden"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        variants={sectionVariants}
      >
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">{t('testimonials.heading')}</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonialItems.map((testimonial, i) => (
              <motion.div
                key={i}
                className="bg-white p-8 rounded-2xl shadow-lg"
                variants={sectionVariants}
              >
                <div className="flex items-center mb-4">
                  <div className="w-14 h-14 rounded-full mr-4 bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xl font-bold flex-shrink-0">
                    {testimonial.name.charAt(0)}
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-800">{testimonial.name}</h4>
                  </div>
                </div>
                <StarRating rating={5} />
                <blockquote className="mt-4 text-slate-600 italic relative pl-5">
                  <span className="absolute left-0 -top-2 text-5xl text-slate-200 font-serif">"</span>
                  {testimonial.quote}
                </blockquote>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* CTA BANNER */}
      <motion.section
        className="py-20 md:py-28 bg-gradient-to-r from-blue-600 to-indigo-600 text-white"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: 0.6 }}
      >
        <div className="container max-w-4xl mx-auto px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            {t('cta.heading')}
          </h2>
          <p className="max-w-xl mx-auto text-lg text-blue-100 mb-10">
            {t('cta.subtitle')} <Link href="/fiyatlandirma" className="text-blue-100 hover:text-white underline">{t('cta.pricingLinkText')}</Link>
          </p>
          <div className="mt-8">
            <Link href="/login" className="inline-block px-12 py-4 text-xl font-semibold text-white bg-gradient-to-r from-green-500 to-emerald-600 rounded-full shadow-lg hover:scale-105 transform transition-transform duration-200 ease-out">
              {t('cta.button')}
            </Link>
            <p className="mt-6 text-sm text-blue-200">
              {t('cta.contactPrompt')} <Link href="/iletisim" className="text-white underline hover:text-blue-100">{t('cta.contactLinkText')}</Link>
            </p>
          </div>
        </div>
      </motion.section>

      {/* FAQ */}
      <motion.section
        className="py-20 md:py-28 bg-white"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        variants={sectionVariants}
      >
        <div className="container max-w-3xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">{t('faq.heading')}</h2>
          </div>
          <div className="space-y-4">
            {faqItems.map((item, i) => (
              <Disclosure as="div" key={i} className="bg-slate-50 rounded-lg shadow-sm">
                {({ open }) => (
                  <>
                    <Disclosure.Button className="flex justify-between items-center w-full px-6 py-4 text-left text-lg font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring focus-visible:ring-blue-500 focus-visible:ring-opacity-75 rounded-lg">
                      <span>{item.question}</span>
                      <ChevronDown
                        size={24}
                        className={`transform transition-transform duration-200 ${
                          open ? '-rotate-180' : ''
                        } text-slate-500`}
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
                      <Disclosure.Panel className="px-6 pt-2 pb-4 text-sm text-slate-600 leading-relaxed">
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

      {/* ETSY DISCLAIMER */}
      <section className="py-4 bg-slate-100 text-center">
        <p className="text-xs text-slate-500 max-w-3xl mx-auto px-4">
          {t('disclaimer')}{' '}
          | <Link href={privacyHref} className="underline hover:text-slate-700">Privacy Policy</Link>
          {' '}| <Link href={termsHref} className="underline hover:text-slate-700">Terms of Service</Link>
          {' '}| <a href="mailto:destek@kolayxport.com" className="underline hover:text-slate-700">destek@kolayxport.com</a>
        </p>
      </section>
    </PublicLayout>
  );
}
