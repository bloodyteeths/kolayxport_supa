import React from 'react';
import Link from 'next/link';
import PublicLayout from '../components/PublicLayout';
import { NextSeo } from 'next-seo';
import { motion } from 'framer-motion';
import { PenTool } from 'lucide-react';

export default function BlogPage() {
  return (
    <PublicLayout
      title="KolayXport | Blog"
      description="KolayXport blog - E-ticaret ipuçları, otomasyon stratejileri ve güncellemeler."
    >
      <NextSeo
        title="KolayXport Blog | E-Ticaret Haberleri ve İpuçları"
        description="E-ticaret dünyasındaki son gelişmeler, otomasyon taktikleri ve KolayXport yenilikleri hakkında bilgi edinin."
        openGraph={{
          url: 'https://kolayxport.com/blog',
          title: 'KolayXport Blog',
          description: 'E-ticaret uzmanlarından ipuçları, sektör analizleri ve KolayXport güncellemeleri.',
          images: [
            {
              url: 'https://kolayxport.com/og-blog.png', // TODO: Create and place /public/og-blog.png (1200x630)
              width: 1200,
              height: 630,
              alt: 'KolayXport Blog',
            },
          ],
        }}
      />
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="py-20 md:py-32 text-center px-6 lg:px-8 bg-slate-50"
      >
        <div className="container max-w-3xl mx-auto">
          <div className="flex justify-center mb-8">
            <PenTool size={64} className="text-blue-500" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-slate-800 mb-6">
            Blog Sayfamız Yakında Sizlerle!
          </h1>
          <p className="text-lg sm:text-xl text-slate-600 mb-10">
            E-ticaret dünyasındaki en son trendler, otomasyon stratejileri, başarı hikayeleri ve KolayXport hakkındaki güncellemeler için bizi takip etmeye devam edin.
          </p>
          <Link href="/" legacyBehavior>
            <a className="inline-block px-8 py-3 text-base font-semibold text-white bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg shadow-lg hover:scale-105 transform transition-transform duration-200 ease-out">
              Anasayfaya Dön
            </a>
          </Link>
        </div>
      </motion.section>
    </PublicLayout>
  );
} 