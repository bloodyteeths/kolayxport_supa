import React from 'react';
import Link from 'next/link';
import PublicLayout from '../components/PublicLayout';
import { NextSeo } from 'next-seo';
import { motion } from 'framer-motion';

// Placeholder blog posts data. Replace with real content or fetch from an API.
const posts = [
  {
    slug: 'kolayxport-nedir',
    title: 'KolayXport Nedir, Nasıl Kullanılır?',
    date: '2025-05-01',
    excerpt: 'KolayXport ile e-ticaret operasyonlarınızı nasıl merkezileştirebileceğinizi keşfedin. Temel işlevler, entegrasyonlar ve daha fazlası bu yazıda yer alıyor.',
  },
  {
    slug: 'trend-entegrasyonlari',
    title: 'Trend Entegrasyon Rehberleri',
    date: '2025-04-20',
    excerpt: 'Pazardaki popüler platformlarla entegrasyon adımlarını detaylı bir şekilde açıkladığımız seri yazımıza göz atın.',
  },
  {
    slug: 'kargo-yonetimi',
    title: 'Kargo Yönetimini Otomatikleştirmek',
    date: '2025-04-10',
    excerpt: 'KolayXport ve FedEx entegrasyonu sayesinde kargo süreçlerinizi nasıl hızlandırabileceğinizi öğrenin.',
  },
];

export default function BlogPage() {
  return (
    <PublicLayout title="Blog - KolayXport" description="KolayXport Blog: E-ticaret otomasyonu, entegrasyon rehberleri ve en iyi uygulamalar hakkında makaleler.">
      <NextSeo title="KolayXport Blog" />

      <motion.div
        className="container max-w-5xl mx-auto px-6 lg:px-8 py-20"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <h1 className="text-4xl font-bold text-slate-800 mb-12">KolayXport Blog</h1>

        <div className="space-y-16">
          {posts.map((post) => (
            <article key={post.slug} className="prose prose-slate lg:prose-lg">
              <h2 className="text-2xl font-semibold text-blue-600 hover:underline">
                <Link href={`/blog/${post.slug}`} legacyBehavior>
                  <a>{post.title}</a>
                </Link>
              </h2>
              <p className="text-sm text-slate-500">Yayın Tarihi: {post.date}</p>
              <p>{post.excerpt}</p>
              <p>
                <Link href={`/blog/${post.slug}`} legacyBehavior>
                  <a className="text-blue-600 hover:underline">Devamını Oku →</a>
                </Link>
              </p>
            </article>
          ))}
        </div>
      </motion.div>
    </PublicLayout>
  );
} 