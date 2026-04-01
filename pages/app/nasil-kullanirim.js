import React from 'react';
import AppLayout from '../../components/AppLayout';
import { NextSeo } from 'next-seo';
import { motion } from 'framer-motion';
import { HelpCircle, Settings, ExternalLink, Link as LinkIcon, ListChecks } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

const GuideSection = ({ title, icon: Icon, children, id }) => (
  <motion.section
    id={id}
    className="bg-white p-6 md:p-8 rounded-lg shadow-md mb-8"
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5 }}
  >
    <div className="flex items-center mb-6">
      {Icon && <Icon size={32} className="mr-3 text-blue-600" />}
      <h2 className="text-2xl font-bold text-slate-800">{title}</h2>
    </div>
    <div className="prose prose-slate max-w-none text-slate-700 leading-relaxed">
      {children}
    </div>
  </motion.section>
);

const Step = ({ number, title, children }) => (
  <div className="flex items-start mb-6">
    <div className="flex-shrink-0 w-10 h-10 bg-blue-500 text-white rounded-full flex items-center justify-center font-bold mr-4 text-lg">
      {number}
    </div>
    <div>
      <h3 className="text-lg font-semibold text-slate-800 mb-1">{title}</h3>
      <div className="text-slate-600">{children}</div>
    </div>
  </div>
);

export default function HowToUsePage() {
  const t = useTranslations('howToUse');

  return (
    <AppLayout title={t('title')}>
      <NextSeo noindex={true} nofollow={true} />

      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="bg-white p-6 rounded-lg shadow">
          <h1 className="text-3xl font-bold text-slate-800 flex items-center">
            <HelpCircle size={36} className="mr-3 text-blue-600" />
            {t('title')}
          </h1>
          <p className="mt-2 text-slate-600">
            {t('description')}
          </p>
        </div>
      </motion.div>

      <GuideSection title={t('veeqoTitle')} icon={LinkIcon} id="connect-veeqo">
        <p className="mb-4">
          {t('veeqoIntro')}
        </p>
        <Step number="1" title={t('veeqoStep1Title')}>
          <p>{t('veeqoStep1Desc')}</p>
          <p className="mt-1 text-sm text-slate-500">{t('veeqoStep1Note')}</p>
        </Step>
        <Step number="2" title={t('veeqoStep2Title')}>
          <p>{t('veeqoStep2Desc')}</p>
        </Step>
        <Step number="3" title={t('veeqoStep3Title')}>
          <p>{t('veeqoStep3Desc')}</p>
          <p className="mt-1 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-700">
            <Settings size={16} className="inline mr-1" /> {t('veeqoStep3Note')}
          </p>
        </Step>
        <Step number="4" title={t('veeqoStep4Title')}>
          <p>{t('veeqoStep4Desc')}</p>
        </Step>
        <p className="mt-4 text-sm text-slate-500">
          {t('veeqoWarning')}
        </p>
      </GuideSection>

      <GuideSection title={t('shippoTitle')} icon={LinkIcon} id="connect-shippo">
        <p className="mb-4">
          {t('shippoIntro')}
        </p>
        <Step number="1" title={t('shippoStep1Title')}>
          <p>{t('shippoStep1Desc')}</p>
          <p className="mt-1 text-sm text-slate-500">{t('shippoStep1Note')}</p>
        </Step>
        <Step number="2" title={t('shippoStep2Title')}>
          <p>{t('shippoStep2Desc')}</p>
        </Step>
        <Step number="3" title={t('shippoStep3Title')}>
          <p>{t('shippoStep3Desc')}</p>
          <p className="mt-1 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-700">
            <Settings size={16} className="inline mr-1" /> {t('shippoStep3Note')}
          </p>
        </Step>
        <Step number="4" title={t('shippoStep4Title')}>
          <p>{t('shippoStep4Desc')}</p>
        </Step>
        <p className="mt-4 text-sm text-slate-500">
          {t('shippoWarning')}
        </p>
      </GuideSection>

      <GuideSection title={t('otherGuidesTitle')} icon={ListChecks} id="other-guides">
        <p>
          {t('otherGuidesDesc')}
        </p>
        <p className="mt-2">
          {t('trendyolLink')}
        </p>
      </GuideSection>

    </AppLayout>
  );
}

HowToUsePage.getLayout = function getLayout(page) {
  return <AppLayout>{page}</AppLayout>;
};
