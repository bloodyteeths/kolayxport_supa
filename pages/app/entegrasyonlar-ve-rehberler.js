import React, { useState } from 'react';
import AppLayout from '../../components/AppLayout';
import { NextSeo } from 'next-seo';
import { motion } from 'framer-motion';
import { Zap, Info, Settings, HelpCircle, CheckCircle, ExternalLink, ShoppingCart, Briefcase, Truck, ChevronDown, ChevronUp, BookOpen, Download, Chrome, Globe } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

const Section = ({ title, icon: Icon, children, id }) => (
  <motion.div
    id={id}
    className="bg-white p-3 sm:p-4 md:p-5 rounded-lg shadow-md mb-4 overflow-hidden max-w-full"
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5 }}
  >
    <div className="flex items-center mb-3 min-w-0">
      {Icon && <Icon size={28} className="mr-2 sm:mr-3 text-blue-600 flex-shrink-0" />}
      <h2 className="text-lg sm:text-2xl font-bold text-slate-800 break-words min-w-0">{title}</h2>
    </div>
    <div className="prose prose-slate max-w-none text-slate-700 leading-relaxed overflow-hidden" style={{ wordBreak: 'break-word' }}>
      {children}
    </div>
  </motion.div>
);

const Step = ({ number, title, children }) => (
  <div className="flex items-start mb-4">
    <div className="flex-shrink-0 w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center font-bold mr-3 sm:mr-4">
      {number}
    </div>
    <div className="min-w-0 flex-1 overflow-hidden">
      <h4 className="font-semibold text-slate-800 mb-1 break-words">{title}</h4>
      <div className="text-sm text-slate-600 overflow-hidden" style={{ wordBreak: 'break-word' }}>{children}</div>
    </div>
  </div>
);

const PlatformList = ({ platforms }) => (
  <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
    {platforms.map(platform => (
      <li key={platform} className="bg-slate-100 p-3 rounded-md text-sm text-slate-700 font-medium text-center shadow-sm">
        {platform}
      </li>
    ))}
  </ul>
);

export default function EntegrasyonlarVeRehberlerPage() {
  const t = useTranslations('integrations');
  const [isVeeqoGuideOpen, setIsVeeqoGuideOpen] = useState(false);
  const [isEtsyGuideOpen, setIsEtsyGuideOpen] = useState(false);

  const veeqoEcommercePlatforms = ['Shopify', 'Shopify Plus', 'Magento', 'BigCommerce', 'WooCommerce', 'Wix'];
  const veeqoMarketplaces = ['Amazon', 'eBay', 'Etsy', 'Walmart'];

  const shippoEcommercePlatforms = ['Shopify', 'WooCommerce', 'BigCommerce', 'Wix', 'Squarespace', 'Magento 2', 'Ecwid by Lightspeed'];
  const shippoMarketplaces = ['Etsy', 'Amazon', 'eBay', 'Walmart', 'Mercari'];

  return (
    <AppLayout title={t('pageTitle')}>
      <NextSeo noindex={true} nofollow={true} />

      <motion.div
        className="mb-6 sm:mb-8 overflow-hidden max-w-full"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow overflow-hidden">
          <h1 className="text-xl sm:text-3xl font-bold text-slate-800 flex items-center min-w-0">
            <Zap size={28} className="mr-2 sm:mr-3 text-blue-600 flex-shrink-0" />
            <span className="break-words min-w-0">{t('title')}</span>
          </h1>
          <p className="mt-2 text-sm sm:text-base text-slate-600" style={{ wordBreak: 'break-word' }}>
            {t('subtitle')}
          </p>
        </div>
      </motion.div>

      <Section title={t('generalApproach')} icon={Info}>
        <p>
          {t('generalApproachP1')}
        </p>
        <p className="mt-2">
          {t('generalApproachP2')}
        </p>
        <p className="mt-2">
          {t('generalApproachP3')}
        </p>
        <p className="mt-3">
          {t.rich('generalApproachP4', {
            settingsLink: (chunks) => <Link href="/app/settings" className="text-blue-600 hover:underline">{chunks}</Link>
          })}
        </p>
      </Section>

      <Section title={t('directIntegrations')} icon={ShoppingCart}>
        <p className="mb-4">{t('directIntegrationsDesc')}</p>
        <div className="space-y-6">
          <div>
            <h3 className="text-xl font-semibold text-slate-700 mb-2 flex items-center">
              <Chrome size={20} className="mr-2 text-green-600" />
              {t('etsyChromeTitle')}
            </h3>
            <p className="mb-3">{t('etsyChromeDesc')} <Link href="#etsy-guide" className="text-blue-600 hover:underline">{t('etsyChromeGuideLink')}</Link>.</p>
          </div>
          <div>
            <h3 className="text-xl font-semibold text-slate-700 mb-2">{t('trendyolTitle')}</h3>
            <p className="mb-3">{t.rich('trendyolDesc', {
              link: (chunks) => <Link href="#trendyol-guide" className="text-blue-600 hover:underline">{chunks}</Link>
            })}</p>
          </div>
          <div>
            <h3 className="text-xl font-semibold text-slate-700 mb-2">{t('hepsiburadaTitle')}</h3>
            <p>{t('hepsiburadaDesc')}</p>
          </div>
        </div>
      </Section>

      <Section title={t('veeqoPlatforms')} icon={Briefcase}>
        <p className="mb-4">
          {t('veeqoPlatformsDesc')}
        </p>
        <h4 className="text-lg font-semibold text-slate-700 mt-4 mb-2">{t('ecommercePlatforms')}</h4>
        <PlatformList platforms={veeqoEcommercePlatforms} />
        <h4 className="text-lg font-semibold text-slate-700 mt-6 mb-2">{t('marketplaces')}</h4>
        <PlatformList platforms={veeqoMarketplaces} />
        <p className="mt-4 text-sm text-slate-500">
          {t('veeqoPlatformsNote')}
        </p>

        <div className="mt-6">
          <button
            onClick={() => setIsVeeqoGuideOpen(!isVeeqoGuideOpen)}
            className="flex items-center justify-between w-full p-4 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors duration-200"
          >
            <div className="flex items-center">
              <BookOpen size={20} className="mr-2 text-blue-600" />
              <span className="text-lg font-semibold text-blue-800">{t('veeqoGuide')}</span>
            </div>
            {isVeeqoGuideOpen ? (
              <ChevronUp size={24} className="text-blue-600" />
            ) : (
              <ChevronDown size={24} className="text-blue-600" />
            )}
          </button>

          {isVeeqoGuideOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              className="mt-4 p-6 bg-gray-50 rounded-lg border border-gray-200"
            >
              <div className="space-y-6">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <p className="text-amber-800 font-semibold mb-2">{t('importantNote')}</p>
                  <p className="text-sm text-amber-700">
                    {t('veeqoImportantNoteDesc')}
                  </p>
                </div>

                <div className="space-y-6">
                  <h3 className="text-xl font-bold text-slate-800">{t('veeqoSteps')}</h3>

                  <div className="space-y-6">
                    <Step number="1" title={t('veeqoStep1Title')}>
                      <p>
                        {t('veeqoStep1Desc')}
                      </p>
                      <img
                        src="/images/veeqo-guide/veeqo-signup.png"
                        alt="Veeqo signup"
                        className="mt-3 rounded-lg shadow-md border border-gray-200 max-w-full"
                      />
                    </Step>

                    <Step number="2" title={t('veeqoStep2Title')}>
                      <p>{t('veeqoStep2Desc')}</p>
                      <div className="mt-2 p-3 bg-gray-100 rounded text-sm">
                        <p className="font-semibold mb-1">{t('veeqoStep2Example')}</p>
                        <ul className="space-y-1 text-gray-700">
                          <li><strong>Company name:</strong> {t('veeqoStep2CompanyName')}</li>
                          <li><strong>Orders per month:</strong> {t('veeqoStep2Orders')}</li>
                          <li><strong>Country:</strong> {t('veeqoStep2Country')}</li>
                          <li><strong>Phone number:</strong> {t('veeqoStep2Phone')}</li>
                          <li><strong>Referral code:</strong> {t('veeqoStep2Referral')}</li>
                        </ul>
                      </div>
                      <img
                        src="/images/veeqo-guide/veeqo-company-info.png"
                        alt="Veeqo company info"
                        className="mt-3 rounded-lg shadow-md border border-gray-200 max-w-full"
                      />
                      <p className="mt-3 text-sm text-gray-600">
                        {t('veeqoStep2ConnectStore')}
                      </p>
                    </Step>

                    <Step number="3" title={t('veeqoStep3Title')}>
                      <p>
                        {t('veeqoStep3Desc')}
                      </p>
                      <img
                        src="/images/veeqo-guide/veeqo-connect-store.png"
                        alt="Veeqo connect store"
                        className="mt-3 rounded-lg shadow-md border border-gray-200 max-w-full"
                      />
                      <p className="mt-3">
                        {t('veeqoStep3Instructions')}
                      </p>
                      <img
                        src="/images/veeqo-guide/veeqo-etsy-auth.png"
                        alt="Etsy auth"
                        className="mt-3 rounded-lg shadow-md border border-gray-200 max-w-full"
                      />
                      <p className="mt-3">
                        {t('veeqoStep3EtsyAuth')}
                      </p>
                      <img
                        src="/images/veeqo-guide/veeqo-etsy-login.png"
                        alt="Etsy login"
                        className="mt-3 rounded-lg shadow-md border border-gray-200 max-w-full"
                      />
                    </Step>

                    <Step number="4" title={t('veeqoStep4Title')}>
                      <p>
                        {t('veeqoStep4Desc')}
                      </p>
                      <img
                        src="/images/veeqo-guide/veeqo-dashboard.png"
                        alt="Veeqo dashboard"
                        className="mt-3 rounded-lg shadow-md border border-gray-200 max-w-full"
                      />
                    </Step>

                    <Step number="5" title={t('veeqoStep5Title')}>
                      <p>
                        {t('veeqoStep5Desc')}
                      </p>
                      <img
                        src="/images/veeqo-guide/veeqo-support-chat.png"
                        alt="Veeqo support"
                        className="mt-3 rounded-lg shadow-md border border-gray-200 max-w-full"
                      />
                      <div className="mt-3 p-3 bg-blue-50 rounded">
                        <p className="text-sm font-semibold text-blue-800">{t('veeqoStep5SupportMessage')}</p>
                        <p className="text-sm text-blue-700 italic mt-1">
                          {t('veeqoStep5SupportText')}
                        </p>
                      </div>
                      <p className="mt-3 text-sm text-gray-600">
                        {t('veeqoStep5WaitTime')}
                      </p>
                      <img
                        src="/images/veeqo-guide/veeqo-email-notification.png"
                        alt="Veeqo email"
                        className="mt-3 rounded-lg shadow-md border border-gray-200 max-w-full"
                      />
                    </Step>

                    <Step number="6" title={t('veeqoStep6Title')}>
                      <p>{t('veeqoStep6Desc')}</p>
                      <ul className="list-disc list-inside ml-4 mt-2 space-y-1 text-sm">
                        <li>{t('veeqoStep6Instructions1')}</li>
                        <li>{t('veeqoStep6Instructions2')}</li>
                      </ul>
                      <img
                        src="/images/veeqo-guide/veeqo-settings-users.png"
                        alt="Veeqo settings"
                        className="mt-3 rounded-lg shadow-md border border-gray-200 max-w-full"
                      />
                      <p className="mt-3">
                        {t('veeqoStep6ActionsDesc')}
                      </p>
                      <img
                        src="/images/veeqo-guide/veeqo-api-key.png"
                        alt="Veeqo API key"
                        className="mt-3 rounded-lg shadow-md border border-gray-200 max-w-full"
                      />
                      <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded">
                        <p className="text-sm text-red-700">
                          <strong>{t('importantNote').toUpperCase()}:</strong> {t('apiKeyWarning')}
                        </p>
                      </div>
                    </Step>

                    <Step number="7" title={t('veeqoStep7Title')}>
                      <p>
                        {t.rich('veeqoStep7Desc', {
                          settingsLink: (chunks) => <Link href="/app/settings" className="text-blue-600 hover:underline">{chunks}</Link>
                        })}
                      </p>
                      <img
                        src="/images/veeqo-guide/veeqo-kolayxport-settings.png"
                        alt="KolayXport settings"
                        className="mt-3 rounded-lg shadow-md border border-gray-200 max-w-full"
                      />
                      <p className="mt-3 text-sm text-gray-600">
                        {t('veeqoStep7CaseSensitive')}
                      </p>
                    </Step>
                  </div>
                </div>

                <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-start">
                    <CheckCircle size={20} className="text-green-600 mr-2 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-green-800 font-semibold">{t('veeqoCongrats')}</p>
                      <p className="text-sm text-green-700 mt-1">
                        {t('veeqoCongratsDesc')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </Section>

      <Section title={t('shippoPlatforms')} icon={Briefcase}>
        <p className="mb-4">
          {t('shippoPlatformsDesc')}
        </p>
        <h4 className="text-lg font-semibold text-slate-700 mt-4 mb-2">{t('ecommercePlatforms')}</h4>
        <PlatformList platforms={shippoEcommercePlatforms} />
        <h4 className="text-lg font-semibold text-slate-700 mt-6 mb-2">{t('marketplaces')}</h4>
        <PlatformList platforms={shippoMarketplaces} />
        <p className="mt-4 text-sm text-slate-500">
          {t('shippoPlatformsNote')}
        </p>
      </Section>

      <Section title={t('shippingIntegration')} icon={Truck}>
        <p>{t('shippingIntegrationDesc')}</p>
        <p className="mt-2 text-sm text-slate-500">
          {t.rich('shippingIntegrationNote', {
            settingsLink: (chunks) => <Link href="/app/settings" className="text-blue-600 hover:underline">{chunks}</Link>
          })}
        </p>
      </Section>

      <Section title={t('etsyIntegration')} icon={Chrome} id="etsy-guide">
        <p className="mb-4">
          {t('etsyIntegrationDesc')}
        </p>

        <div className="mb-6">
          <button
            onClick={() => setIsEtsyGuideOpen(!isEtsyGuideOpen)}
            className="flex items-center justify-between w-full p-4 bg-green-50 hover:bg-green-100 rounded-lg transition-colors duration-200"
          >
            <div className="flex items-center">
              <Download size={20} className="mr-2 text-green-600" />
              <span className="text-lg font-semibold text-green-800">{t('etsyChromeGuide')}</span>
            </div>
            {isEtsyGuideOpen ? (
              <ChevronUp size={24} className="text-green-600" />
            ) : (
              <ChevronDown size={24} className="text-green-600" />
            )}
          </button>

          {isEtsyGuideOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              className="mt-4 p-6 bg-gray-50 rounded-lg border border-gray-200"
            >
              <div className="space-y-6">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-green-800 font-semibold mb-2">{t('securityAdvantages')}</p>
                  <ul className="text-sm text-green-700 space-y-1">
                    <li>• {t('securityNoApi')}</li>
                    <li>• {t('securityReadOnly')}</li>
                    <li>• {t('securityAutoSync')}</li>
                    <li>• {t('securityNoRisk')}</li>
                  </ul>
                </div>

                <div className="space-y-6">
                  <h3 className="text-xl font-bold text-slate-800">{t('chromeSteps')}</h3>

                  <div className="space-y-6">
                    <Step number="1" title={t('chromeStep1Title')}>
                      <p>
                        {t('chromeStep1Desc')}
                      </p>
                      <div className="mt-3 space-y-3">
                        <a
                          href="/downloads/kolayxport-etsy-extension-v5.3-multistore.zip"
                          download="kolayxport-etsy-extension-v5.3-multistore.zip"
                          className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                        >
                          <Download size={18} className="mr-2" />
                          {t('chromeStep1Download')}
                        </a>
                        <p className="text-sm text-gray-600">
                          <strong>{t('fileSize')}:</strong> {t('chromeStep1FileInfo')} | <strong>{t('version')}:</strong> {t('chromeStep1Version')} | <strong>{t('content')}:</strong> {t('chromeStep1Content')}
                        </p>
                      </div>
                      <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-sm text-blue-800">
                          <strong>{t('alternative')}:</strong> {t('chromeStep1Alt')} <br />
                          <a
                            href="https://chrome.google.com/webstore/detail/kolayxport-etsy-sync"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline inline-flex items-center"
                          >
                            Chrome Web Store
                            <ExternalLink size={12} className="ml-1" />
                          </a>
                          <span className="text-xs text-blue-600 ml-2">{t('chromeStep1NotAvailable')}</span>
                        </p>
                      </div>
                    </Step>

                    <Step number="2" title={t('chromeStep2Title')}>
                      <p>{t('chromeStep2Desc')}</p>
                      <ol className="list-decimal list-inside space-y-2 text-sm mt-3">
                        <li>{t('chromeStep2Item1')}</li>
                        <li>{t('chromeStep2Item2')}</li>
                        <li>{t('chromeStep2Item3')}</li>
                        <li>{t('chromeStep2Item4')}</li>
                        <li>{t('chromeStep2Item5')}</li>
                        <li>{t('chromeStep2Item6')}</li>
                      </ol>
                      <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                        <p className="text-sm text-green-700">
                          <strong>{t('tip')}:</strong> {t('chromeStep2Tip')}
                        </p>
                      </div>
                    </Step>

                    <Step number="3" title={t('chromeStep3Title')}>
                      <p>
                        <Link href="/app" className="text-blue-600 hover:underline">
                          KolayXport
                        </Link> — {t('chromeStep3Desc')}
                      </p>
                      <p className="mt-2 text-sm text-gray-600">
                        {t('chromeStep3AutoAuth')}
                      </p>
                    </Step>

                    <Step number="4" title={t('chromeStep4Title')}>
                      <p>
                        {t('chromeStep4Desc')}{' '}
                        <a
                          href="https://www.etsy.com/your/orders/sold"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          Shop Manager → Orders
                          <ExternalLink size={12} className="ml-1 inline" />
                        </a>
                      </p>
                      <p className="mt-2 text-sm text-gray-600">
                        {t('chromeStep4AutoDetect')}
                      </p>
                    </Step>

                    <Step number="5" title={t('chromeStep5Title')}>
                      <p>
                        {t('chromeStep5Desc')}
                      </p>
                      <ul className="list-disc list-inside ml-4 mt-2 space-y-1 text-sm">
                        <li><strong>{t('greenIcon')}:</strong> {t('chromeStep5Green')}</li>
                        <li><strong>{t('redIcon')}:</strong> {t('chromeStep5Red')}</li>
                        <li><strong>{t('yellowIcon')}:</strong> {t('chromeStep5Yellow')}</li>
                      </ul>
                    </Step>

                    <Step number="6" title={t('chromeStep6Title')}>
                      <p>
                        {t('chromeStep6Desc')}
                      </p>
                      <ol className="list-decimal list-inside ml-4 mt-2 space-y-1 text-sm">
                        <li>{t('chromeStep6Item1')}</li>
                        <li>{t('chromeStep6Item2')}</li>
                        <li>{t('chromeStep6Item3')}</li>
                      </ol>
                      <p className="mt-2 text-sm text-red-600">
                        <strong>{t('note')}:</strong> {t('chromeStep6Note')}
                      </p>
                    </Step>
                  </div>
                </div>

                <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-start">
                    <Globe size={20} className="text-blue-600 mr-2 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-blue-800 font-semibold">{t('autoSync')}</p>
                      <p className="text-sm text-blue-700 mt-1">
                        {t('autoSyncDesc')}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-6 space-y-3">
                  <h4 className="text-lg font-semibold text-slate-800">{t('troubleshooting')}</h4>
                  <div className="space-y-2 text-sm text-slate-600">
                    <p><strong>{t('troubleshootNoOrdersTitle')}</strong> {t('troubleshootNoOrders')}</p>
                    <p><strong>{t('troubleshootAuthErrorTitle')}</strong> {t('troubleshootAuthError')}</p>
                    <p><strong>{t('troubleshootMissingOrdersTitle')}</strong> {t('troubleshootMissingOrders')}</p>
                  </div>
                  <p className="text-sm text-slate-500">
                    {t.rich('troubleshootMoreHelp', {
                      contactLink: (chunks) => <Link href="/iletisim" className="text-blue-600 hover:underline">{chunks}</Link>
                    })}
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </Section>

      <Section title={t('trendyolGuide')} icon={HelpCircle} id="trendyol-guide">
        <p className="mb-4">
          {t('trendyolGuideDesc')}
        </p>
        <Step number="1" title={t('trendyolStep1Title')}>
          <p><a href="https://partner.trendyol.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{t('trendyolStep1Title')}</a> — {t('trendyolStep1Desc')}</p>
        </Step>
        <Step number="2" title={t('trendyolStep2Title')}>
          <p>{t('trendyolStep2Desc')}</p>
          <p className="mt-1">{t('trendyolStep2InfoLabel')}</p>
          <ul className="list-disc list-inside ml-4 mt-1 text-xs">
            <li><strong>{t('supplierIdLabel')}:</strong> {t('trendyolStep2SupplierId')}</li>
            <li><strong>{t('apiKeyLabel')}:</strong> {t('trendyolStep2ApiKey')}</li>
            <li><strong>{t('apiSecretLabel')}:</strong> {t('trendyolStep2ApiSecret')}</li>
          </ul>
          <p className="mt-1 text-xs text-slate-500">{t('trendyolStep2Note')}</p>
        </Step>
        <Step number="3" title={t('trendyolStep3Title')}>
          <p>{t.rich('trendyolStep3Desc', {
            settingsLink: (chunks) => <Link href="/app/settings" className="text-blue-600 hover:underline">{chunks}</Link>
          })}</p>
          <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-700">
            <p><Settings size={16} className="inline mr-1"/> {t('trendyolStep3Tip')}</p>
          </div>
        </Step>
        <Step number="4" title={t('trendyolStep4Title')}>
          <p>{t('trendyolStep4Desc')}</p>
          <p className="mt-1 text-xs text-slate-500">{t.rich('trendyolStep4Note', {
            supportLink: (chunks) => <Link href="/destek" className="text-blue-600 hover:underline">{chunks}</Link>
          })}</p>
        </Step>
      </Section>

    </AppLayout>
  );
}

EntegrasyonlarVeRehberlerPage.getLayout = function getLayout(page) {
  return <AppLayout>{page}</AppLayout>;
};
