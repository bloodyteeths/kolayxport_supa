import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import PublicLayout from '../components/PublicLayout';
import { NextSeo } from 'next-seo';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';

const posts = [
  {
    slug: 'e-ticaret-otomasyon-rehberi-2025',
    title: 'E-Ticaret Otomasyon Rehberi 2025: Siparişten Teslimat\'a Tam Kontrol',
    date: '2025-01-15',
    excerpt: 'E-ticaret otomasyonunun temellerini öğrenin. Sipariş yönetiminden kargo süreçlerine kadar tüm operasyonlarınızı nasıl otomatikleştirebileceğinizi detaylı şekilde açıklıyoruz.',
    readTime: '8 dk',
    category: 'Rehber',
    author: 'KolayXport Ekibi',
    tags: ['otomasyon', 'e-ticaret', 'sipariş yönetimi']
  },
  {
    slug: 'trendyol-entegrasyonu-adim-adim',
    title: 'Trendyol Entegrasyonu: Adım Adım Kurulum Rehberi',
    date: '2025-01-10',
    excerpt: 'Trendyol mağazanızı KolayXport ile entegre etmenin tüm aşamalarını öğrenin. API anahtarı alımından otomatik sipariş çekimine kadar detaylı anlatım.',
    readTime: '12 dk',
    category: 'Entegrasyon',
    author: 'Ahmet Yılmaz',
    tags: ['trendyol', 'entegrasyon', 'api', 'kurulum']
  },
  {
    slug: 'fedex-ups-kargo-karsilastirmasi',
    title: 'FedEx vs UPS: Hangi Kargo Şirketi E-Ticaret İçin Daha Uygun?',
    date: '2025-01-05',
    excerpt: 'FedEx ve UPS kargo hizmetlerini detaylı karşılaştırıyoruz. Fiyat, hız, güvenilirlik ve entegrasyon kolaylığı açısından hangi seçeneğin sizin için daha uygun olduğunu keşfedin.',
    readTime: '10 dk',
    category: 'Karşılaştırma',
    author: 'Zeynep Kaya',
    tags: ['fedex', 'ups', 'kargo', 'lojistik']
  },
  {
    slug: 'envanter-yonetimi-en-iyi-uygulamalar',
    title: 'Multi-Channel Envanter Yönetimi: En İyi Uygulamalar ve Püf Noktaları',
    date: '2024-12-28',
    excerpt: 'Çoklu satış kanallarında envanter yönetiminin zorluklarını ve çözümlerini keşfedin. Stok eksikliği yaşamadan nasıl verimli yönetim yapabileceğinizi öğrenin.',
    readTime: '15 dk',
    category: 'Envanter',
    author: 'Mehmet Özkan',
    tags: ['envanter', 'stok yönetimi', 'multi-channel']
  },
  {
    slug: 'hepsiburada-amazon-siparis-optimizasyonu',
    title: 'Hepsiburada ve Amazon Sipariş Optimizasyonu: Satış Artırma Stratejileri',
    date: '2024-12-20',
    excerpt: 'Hepsiburada ve Amazon\'da sipariş hacminizi artırmak için kanıtlanmış stratejiler. SEO optimizasyonundan fiyat yönetimine kadar pratik ipuçları.',
    readTime: '11 dk',
    category: 'Optimizasyon',
    author: 'Ayşe Demir',
    tags: ['hepsiburada', 'amazon', 'sipariş optimizasyonu', 'seo']
  },
  {
    slug: 'kargo-maliyet-optimizasyonu',
    title: 'Kargo Maliyetlerini %30 Azaltmanın 7 Yolu',
    date: '2024-12-15',
    excerpt: 'E-ticaret işletmenizin kargo maliyetlerini önemli ölçüde azaltabileceğiniz kanıtlanmış yöntemler. Hacim anlaşmalarından akıllı paketlemeye kadar tüm detaylar.',
    readTime: '9 dk',
    category: 'Maliyet',
    author: 'Emre Şahin',
    tags: ['kargo maliyeti', 'optimizasyon', 'lojistik', 'tasarruf']
  },
  {
    slug: 'black-friday-hazirlik-rehberi',
    title: 'Black Friday\'e Hazırlık: E-Ticaret Sistem Kontrolü ve Optimizasyon',
    date: '2024-11-01',
    excerpt: 'Black Friday gibi yoğun dönemlere nasıl hazırlanacağınızı öğrenin. Sistem kapasitesi artırımından envanter planlamasına kadar kritik adımlar.',
    readTime: '13 dk',
    category: 'Kampanya',
    author: 'KolayXport Ekibi',
    tags: ['black friday', 'kampanya', 'sistem optimizasyonu']
  },
  {
    slug: 'api-entegrasyon-hatalari-cozumleri',
    title: 'E-Ticaret API Entegrasyonlarında Sık Karşılaşılan 10 Hata ve Çözümleri',
    date: '2024-10-25',
    excerpt: 'API entegrasyonlarında yaşanan teknik sorunları ve çözüm yollarını detaylı şekilde inceliyoruz. Geliştiriciler için pratik troubleshooting rehberi.',
    readTime: '14 dk',
    category: 'Teknik',
    author: 'Burak Yıldız',
    tags: ['api', 'entegrasyon', 'hata çözümü', 'development']
  }
];

const allCategories = ['Tümü', ...Array.from(new Set(posts.map((p) => p.category)))];

export default function BlogPage() {
  const [activeCategory, setActiveCategory] = useState('Tümü');
  const [email, setEmail] = useState('');

  const filteredPosts = useMemo(() => {
    if (activeCategory === 'Tümü') return posts;
    return posts.filter((p) => p.category === activeCategory);
  }, [activeCategory]);

  const handleSubscribe = (e) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      toast.error('Lütfen geçerli bir e-posta adresi girin.');
      return;
    }
    toast.success('Başarıyla abone oldunuz!');
    setEmail('');
  };

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

        {/* Category Filter */}
        <div className="flex flex-wrap gap-3 mb-12 justify-center">
          {allCategories.map((category) => (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className={`px-4 py-2 rounded-full transition-colors text-sm font-medium ${
                activeCategory === category
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-blue-100 hover:text-blue-700'
              }`}
            >
              {category}
            </button>
          ))}
        </div>

        <div className="grid gap-8 md:gap-12">
          {filteredPosts.map((post, index) => (
            <motion.article
              key={post.slug}
              className="bg-white rounded-2xl shadow-lg overflow-hidden hover:shadow-xl transition-shadow duration-300"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <div className="p-8">
                <div className="flex items-center gap-4 mb-4 text-sm text-slate-500">
                  <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full font-medium">{post.category}</span>
                  <span>{post.date}</span>
                  <span>• {post.readTime}</span>
                  <span>• {post.author}</span>
                </div>

                <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4 hover:text-blue-600 transition-colors">
                  <Link href={`/blog/${post.slug}`}>{post.title}</Link>
                </h2>

                <p className="text-slate-600 text-lg leading-relaxed mb-6">{post.excerpt}</p>

                <div className="flex items-center justify-between">
                  <div className="flex flex-wrap gap-2">
                    {post.tags.map((tag) => (
                      <span key={tag} className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded">
                        #{tag}
                      </span>
                    ))}
                  </div>

                  <Link
                    href={`/blog/${post.slug}`}
                    className="inline-flex items-center text-blue-600 hover:text-blue-700 font-semibold transition-colors"
                  >
                    Devamını Oku
                    <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                </div>
              </div>
            </motion.article>
          ))}
        </div>

        {filteredPosts.length === 0 && (
          <div className="text-center py-16 text-slate-500">
            <p className="text-lg">Bu kategoride henüz yazı bulunmuyor.</p>
          </div>
        )}

        {/* Newsletter Subscription */}
        <form onSubmit={handleSubscribe} className="mt-16 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-8 text-center text-white">
          <h3 className="text-2xl font-bold mb-4">E-Ticaret İçgörülerini Kaçırmayın</h3>
          <p className="text-blue-100 mb-6 max-w-2xl mx-auto">
            Yeni blog yazılarımız, e-ticaret trendleri ve KolayXport güncellemeleri hakkında ilk siz haberdar olun.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 max-w-md mx-auto">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="E-posta adresiniz"
              className="flex-1 px-4 py-3 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-white"
            />
            <button type="submit" className="px-6 py-3 bg-white text-blue-600 rounded-lg font-semibold hover:bg-blue-50 transition-colors">
              Abone Ol
            </button>
          </div>
        </form>
      </motion.div>
    </PublicLayout>
  );
}

// Ensure Next.js doesn't wrap this page with the auth Layout
BlogPage.getLayout = (page) => page; 