import React from 'react';
import Link from 'next/link';
import PublicLayout from '../components/PublicLayout';
import { useTranslations } from 'next-intl';
import { Briefcase, CheckCircle, TrendingUp, Users, Rocket, Bot } from 'lucide-react';

// Copy lives in messages/*.json under marketing.corporate; icon arrays are
// zipped by index with the corresponding message arrays.
const timelineIcons = [Rocket, CheckCircle, TrendingUp, Users, Bot, Briefcase];
const valueIcons = [Users, Rocket, CheckCircle, Users, Briefcase, TrendingUp];
const techIcons = [
  { icon: CheckCircle, bg: 'bg-green-100', color: 'text-green-600' },
  { icon: TrendingUp, bg: 'bg-blue-100', color: 'text-blue-600' },
  { icon: Rocket, bg: 'bg-purple-100', color: 'text-purple-600' },
];

export default function KurumsalPage() {
  const t = useTranslations('marketing.corporate');
  const timelineEvents = t.raw('timeline');
  const values = t.raw('values');
  const stats = t.raw('stats');
  const tech = t.raw('tech');

  return (
    <PublicLayout
      title={t('seo.title')}
      description={t('seo.description')}
      seo={{
        openGraph: {
          images: [
            {
              url: 'https://kolayxport.com/og-about.png',
              width: 1200,
              height: 630,
              alt: t('seo.ogAlt'),
            },
          ],
        },
      }}
    >
      <div className="w-full">
        {/* Hero Section */}
        <section className="relative py-20 md:py-32 lg:py-40 text-center px-6 lg:px-8 overflow-hidden bg-gradient-to-br from-slate-50 to-sky-100 animate-fadeIn">
          <div className="relative z-10">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-800 tracking-tight mb-6 animate-slideUp">
              {t('hero.title')}
            </h1>
            <p className="mt-4 max-w-2xl mx-auto text-lg sm:text-xl text-slate-600 animate-slideUp">
              {t('hero.subtitle')}
            </p>
          </div>
        </section>

        {/* Timeline Section */}
        <section className="py-16 md:py-24 bg-white">
          <div className="container max-w-4xl mx-auto px-6 lg:px-8">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 text-center mb-16">{t('timelineHeading')}</h2>
            <div className="relative">
              {/* The vertical line */}
              <div className="hidden sm:block absolute w-1 bg-sky-200 h-full left-1/2 transform -translate-x-1/2"></div>

              {timelineEvents.map((event, index) => {
                const Icon = timelineIcons[index] || Briefcase;
                return (
                  <div
                    key={event.year}
                    className={`mb-12 flex items-center w-full ${index % 2 === 0 ? 'sm:flex-row-reverse' : 'sm:flex-row'}`}
                  >
                    <div className="sm:w-1/2">
                      <div className={`p-6 rounded-xl shadow-lg ${index % 2 === 0 ? 'sm:mr-auto sm:text-right' : 'sm:ml-auto sm:text-left'} bg-white border border-slate-100`}>
                        <div className={`text-3xl font-bold text-sky-500 mb-2 ${index % 2 === 0 ? 'sm:justify-end' : 'sm:justify-start'} flex items-center`}>
                          <Icon className="w-8 h-8 mr-2 sm:mr-0 sm:ml-2" strokeWidth={1.5} />
                          {event.year}
                        </div>
                        <h3 className="text-xl font-semibold text-slate-700 mb-1">{event.title}</h3>
                        <p className="text-slate-500 text-sm leading-relaxed">{event.description}</p>
                      </div>
                    </div>
                    {/* Circle on the timeline */}
                    <div className="hidden sm:flex absolute w-6 h-6 bg-sky-500 rounded-full border-4 border-white left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 items-center justify-center">
                      <div className="w-2 h-2 bg-white rounded-full" />
                    </div>
                    <div className="sm:w-1/2" /> {/* Spacer */}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Mission & Vision */}
        <section className="py-16 md:py-24 bg-slate-50">
          <div className="container max-w-4xl mx-auto px-6 lg:px-8">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-16 text-center">{t('mvHeading')}</h2>

            <div className="grid md:grid-cols-2 gap-12 mb-16">
              <div className="bg-white p-8 rounded-2xl shadow-lg">
                <div className="flex items-center mb-6">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mr-4">
                    <TrendingUp className="w-6 h-6 text-blue-600" />
                  </div>
                  <h3 className="text-2xl font-bold text-slate-800">{t('missionTitle')}</h3>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  {t('missionText')}
                </p>
              </div>

              <div className="bg-white p-8 rounded-2xl shadow-lg">
                <div className="flex items-center mb-6">
                  <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center mr-4">
                    <Rocket className="w-6 h-6 text-indigo-600" />
                  </div>
                  <h3 className="text-2xl font-bold text-slate-800">{t('visionTitle')}</h3>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  {t('visionText')}
                </p>
              </div>
            </div>

            {/* Values */}
            <div className="bg-white p-8 rounded-2xl shadow-lg">
              <h3 className="text-2xl font-bold text-slate-800 mb-8 text-center">{t('valuesHeading')}</h3>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {values.map((value, index) => {
                  const Icon = valueIcons[index] || Users;
                  return (
                    <div key={index} className="text-center p-4">
                      <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Icon className="w-6 h-6 text-blue-600" />
                      </div>
                      <h4 className="font-semibold text-slate-800 mb-2">{value.title}</h4>
                      <p className="text-sm text-slate-600 leading-relaxed">{value.desc}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Statistics */}
        <section className="py-16 md:py-24 bg-white">
          <div className="container max-w-6xl mx-auto px-6 lg:px-8 text-center">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-16">{t('statsHeading')}</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              {stats.map((stat, index) => (
                <div key={index} className="p-6 bg-slate-50 rounded-xl">
                  <div className="text-3xl md:text-4xl font-bold text-blue-600 mb-2">{stat.number}</div>
                  <div className="text-lg font-semibold text-slate-800 mb-1">{stat.label}</div>
                  <div className="text-sm text-slate-600">{stat.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Technology Stack */}
        <section className="py-16 md:py-24 bg-slate-50">
          <div className="container max-w-6xl mx-auto px-6 lg:px-8">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-16 text-center">{t('techHeading')}</h2>
            <div className="grid md:grid-cols-3 gap-8">
              {tech.map((item, index) => {
                const { icon: Icon, bg, color } = techIcons[index] || techIcons[0];
                return (
                  <div key={index} className="bg-white p-8 rounded-2xl shadow-lg text-center">
                    <div className={`w-16 h-16 ${bg} rounded-full flex items-center justify-center mx-auto mb-6`}>
                      <Icon className={`w-8 h-8 ${color}`} />
                    </div>
                    <h3 className="text-xl font-bold text-slate-800 mb-4">{item.title}</h3>
                    <p className="text-slate-600 leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-20 md:py-28 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
          <div className="container max-w-4xl mx-auto px-6 lg:px-8 text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-6">
              {t('cta.heading')}
            </h2>
            <p className="max-w-xl mx-auto text-lg text-blue-100 mb-10">
              {t('cta.subtitle')}
            </p>
            <Link href="/kariyer" className="px-10 py-4 text-lg font-semibold text-blue-600 bg-white rounded-full shadow-lg hover:scale-105 hover:bg-slate-50 transform transition-all duration-200 ease-out">{t('cta.button')}</Link>
          </div>
        </section>
      </div>
    </PublicLayout>
  );
}
