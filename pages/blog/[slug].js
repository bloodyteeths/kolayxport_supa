import React from 'react';
import { useRouter } from 'next/router';
import Image from 'next/image';
import Link from 'next/link';
import PublicLayout from '../../components/PublicLayout';
import { ArticleJsonLd } from 'next-seo';
import { motion } from 'framer-motion';

// Same placeholder data – in a real app fetch from CMS or markdown
const posts = [
  {
    title: "KolayXport'u Kullanarak Sipariş Yönetimini Otomatikleştirme",
    date: '2025-05-01',
    excerpt: 'KolayXport ile manuel sipariş girişine son verip, tüm işlemlerinizi nasıl otomatik hale getirebileceğinizi keşfedin.',
    image: '/images/blog-post-1.png',
    slug: 'otomatik-siparis-yonetimi',
    content: `\nKolayXport sayesinde sipariş yönetimini tamamen otomatikleştirebilirsiniz.\n\n1. Tüm pazar yerlerinizi bağlayın.\n2. Otomatik kurallarla kargolama sürecini hızlandırın.\n3. Tek panelden sipariş durumlarını takip edin.\n\n> **İpucu:** Entegrasyon rehberimizdeki adımları takip ederek dakikalar içinde kurulumu tamamlayabilirsiniz.`,
  },
  {
    title: 'Envanter Senkronizasyonu İpuçları',
    date: '2025-04-20',
    excerpt: 'Çok kanallı envanter yönetiminde dikkat etmeniz gereken püf noktalar ve KolayXport nasıl yardımcı olur.',
    image: '/images/blog-post-2.png',
    slug: 'envanter-senkronizasyonu-ipuclari',
    content: `Çok kanallıda stok takibi zordur. KolayXport gerçek zamanlı API bağlantıları sayesinde stokların anlık güncellenmesini sağlar.\n\n- Stok eşitleme periyodunuzu ayarlayın.\n- Düşük stok bildirimlerini aktif edin.`,
  },
  {
    title: 'Başarılı E-ticaret Operasyonları İçin 5 Öneri',
    date: '2025-04-05',
    excerpt: 'E-ticaret iş akışınızı iyileştirmek için uygulayabileceğiniz beş temel strateji.',
    image: '/images/blog-post-3.png',
    slug: 'basarili-eticaret-operasyonlari',
    content: `E-ticarette başarı için:\n\n1. Otomasyon kullanın.\n2. Doğru kargo partneri seçin.\n3. Stok yönetimine özen gösterin.\n4. Müşteri hizmetlerini iyileştirin.\n5. Verileri analiz edin.`,
  },
];

export default function BlogPostPage() {
  const router = useRouter();
  const { slug } = router.query;
  const post = posts.find((p) => p.slug === slug);

  if (!post) {
    return (
      <PublicLayout title="Yazı Bulunamadı">
        <div className="py-32 text-center">
          <h1 className="text-3xl font-bold mb-4">Yazı bulunamadı</h1>
          <Link href="/blog" className="text-blue-600 hover:underline">Blog anasayfasına dön</Link>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout title={`${post.title} - KolayXport Blog`} description={post.excerpt} seo={{
      openGraph: {
        title: post.title,
        description: post.excerpt,
        type: 'article',
        images: [
          {
            url: `https://kolayxport.com${post.image}`,
            width: 1200,
            height: 630,
            alt: post.title,
          },
        ],
      },
    }}>
      <ArticleJsonLd
        url={`https://kolayxport.com/blog/${post.slug}`}
        title={post.title}
        images={[`https://kolayxport.com${post.image}`]}
        datePublished={post.date}
        authorName="KolayXport Team"
        description={post.excerpt}
      />

      <motion.section
        className="bg-white py-16 px-6 lg:px-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <article className="max-w-3xl mx-auto">
          <h1 className="text-4xl font-bold text-slate-800 mb-4 text-center">{post.title}</h1>
          <p className="text-center text-slate-500 mb-8">{post.date}</p>
          <Image
            src={post.image}
            alt={post.title}
            width={800}
            height={450}
            className="w-full h-auto rounded-lg mb-8 object-cover"
          />
          <div className="prose prose-slate lg:prose-lg max-w-none" dangerouslySetInnerHTML={{ __html: post.content.replace(/\n/g, '<br/>') }} />
        </article>
      </motion.section>
    </PublicLayout>
  );
}

BlogPostPage.getLayout = function getLayout(page) {
  return <PublicLayout>{page}</PublicLayout>;
}; 