import React from 'react';
import Link from 'next/link';
import PublicLayout from '../components/PublicLayout';
import Breadcrumb from '../components/Breadcrumb';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import {
  Zap, Edit3, Package, Link2, Settings, ShieldCheck, Gift, ArrowLeftRight,
  Sparkles, Search, BarChart3, Layers, Camera, Chrome, MessageSquare,
} from 'lucide-react';

// Copy lives in messages/*.json under marketing.features; icons are zipped by
// index with the items array — keep both lists the same length and order.
const featureIcons = [
  Zap, Package, Edit3, Link2, Settings, Sparkles, Search, ArrowLeftRight,
  BarChart3, Layers, Camera, Chrome, MessageSquare, ShieldCheck, Gift,
];

const sectionVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' } },
};

export default function OzelliklerPage() {
  const t = useTranslations('marketing.features');
  const tPublic = useTranslations('public');
  const featureItems = t.raw('items');

  return (
    <PublicLayout
      title={t('seo.title')}
      description={t('seo.description')}
      seo={{
        openGraph: {
          url: 'https://kolayxport.com/ozellikler',
          title: t('seo.title'),
          description: t('seo.description'),
          images: [
            {
              url: 'https://kolayxport.com/og-ozellikler.png',
              width: 1200,
              height: 630,
              alt: t('seo.ogAlt'),
            },
          ],
        },
      }}
    >
      <Breadcrumb items={[
        { name: tPublic('features'), href: '/ozellikler' },
      ]} />

      {/* Hero Section */}
      <motion.section
        className="relative py-20 md:py-32 text-center px-6 lg:px-8 bg-gradient-to-br from-sky-50 to-blue-100"
        variants={sectionVariants}
        initial="hidden"
        animate="visible"
      >
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
        </div>
      </motion.section>

      {/* Features Grid */}
      <section className="py-16 md:py-24 bg-white">
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-10">
            {featureItems.map((feature, index) => {
              const Icon = featureIcons[index] || Zap;
              return (
                <motion.div
                  key={index}
                  className="bg-slate-50 rounded-xl p-8 shadow-lg hover:shadow-xl transition-shadow duration-300"
                  variants={sectionVariants}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, amount: 0.2 }}
                >
                  <div className="flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-full mb-6 shadow-md">
                    <Icon size={32} />
                  </div>
                  <h3 className="text-2xl font-bold text-slate-800 mb-3">{feature.title}</h3>
                  <p className="text-slate-600 leading-relaxed text-sm">{feature.description}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-gradient-to-r from-blue-600 to-indigo-700 py-20">
        <div className="container mx-auto px-6 text-center">
          <h2 className="text-3xl font-bold text-white mb-6">{t('cta.heading')}</h2>
          <p className="text-blue-100 text-lg mb-8 max-w-2xl mx-auto">
            {t('cta.subtitle')}
          </p>
          <Link href="/login" className="bg-white text-blue-600 font-semibold px-8 py-3 rounded-lg shadow-md hover:bg-blue-50 transition-colors text-lg">
            {t('cta.button')}
          </Link>
        </div>
      </section>
    </PublicLayout>
  );
}
