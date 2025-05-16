import React from 'react';
import Link from 'next/link';
import PublicLayout from '../components/PublicLayout';
import { NextSeo } from 'next-seo';
import { motion } from 'framer-motion';
import { LifeBuoy, Mail, MessageSquare } from 'lucide-react';

export default function SupportPage() {
  return (
    <PublicLayout
      title="KolayXport | Destek"
      description="KolayXport destek merkezi. Sorularınız ve yardım talepleriniz için bize ulaşın."
    >
      <NextSeo
        title="KolayXport Destek Merkezi | Yardım ve İletişim"
        description="KolayXport kullanımıyla ilgili sorularınız mı var? Destek ekibimizle iletişime geçin veya SSS bölümümüzü ziyaret edin."
        openGraph={{
          url: 'https://kolayxport.com/support',
          title: 'KolayXport Destek Merkezi',
          description: 'Yardıma mı ihtiyacınız var? KolayXport destek ekibi sorularınızı yanıtlamak için burada.',
          images: [
            {
              url: 'https://kolayxport.com/og-support.png', // TODO: Create and place /public/og-support.png (1200x630)
              width: 1200,
              height: 630,
              alt: 'KolayXport Destek',
            },
          ],
        }}
      />
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="py-20 md:py-32 px-6 lg:px-8 bg-slate-50"
      >
        <div className="container max-w-4xl mx-auto text-center">
          <div className="flex justify-center mb-8">
            <LifeBuoy size={64} className="text-blue-500" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-slate-800 mb-6">
            KolayXport Destek Merkezi
          </h1>
          <p className="text-lg sm:text-xl text-slate-600 mb-10">
            Yardıma ihtiyacınız olduğunda buradayız! Aşağıdaki kanallardan bize ulaşabilir veya Sıkça Sorulan Sorular (yakında) bölümümüze göz atabilirsiniz.
          </p>
          
          <div className="grid md:grid-cols-2 gap-8 mb-12 text-left">
            <div className="bg-white p-8 rounded-lg shadow-lg">
              <div className="flex items-center text-blue-600 mb-3">
                <Mail size={24} className="mr-3" />
                <h3 className="text-2xl font-semibold">E-posta ile Destek</h3>
              </div>
              <p className="text-slate-600 mb-4">
                Genel sorularınız, teknik destek veya geri bildirimleriniz için bize e-posta gönderebilirsiniz.
              </p>
              <a href="mailto:kolayxport@gmail.com" className="font-medium text-blue-600 hover:text-blue-700 transition-colors">
                kolayxport@gmail.com
              </a>
            </div>
            <div className="bg-white p-8 rounded-lg shadow-lg">
              <div className="flex items-center text-blue-600 mb-3">
                <MessageSquare size={24} className="mr-3" />
                <h3 className="text-2xl font-semibold">İletişim Formu</h3>
              </div>
              <p className="text-slate-600 mb-4">
                Detaylı talepleriniz veya proje özelinde görüşmek için iletişim formumuzu doldurabilirsiniz.
              </p>
              <Link href="/iletisim" className="font-medium text-blue-600 hover:text-blue-700 transition-colors">İletişim Sayfasına Git</Link>
            </div>
          </div>

          <p className="text-slate-500">
            Size en kısa sürede yardımcı olmak için elimizden geleni yapacağız.
          </p>
        </div>
      </motion.section>
    </PublicLayout>
  );
} 