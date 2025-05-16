import React, { useState } from 'react';
import PublicLayout from '../components/PublicLayout';
import { UserPlus, ShoppingBag, Truck, Send, FileText, PlayCircle, CheckSquare } from 'lucide-react';
import Link from 'next/link';

const steps = [
  {
    id: 1,
    name: 'Hesap Oluştur',
    description: 'Sadece birkaç temel bilgi ile KolayXport hesabınızı saniyeler içinde oluşturun. Kredi kartı gerekmez.',
    icon: UserPlus,
    details: [
      'Ad Soyad ve E-posta adresinizle kaydolun.',
      'Şirket bilgilerinizi (opsiyonel) girin.',
      'Gelen kutunuzdaki onay e-postasını tıklayın.'
    ],
    image: '/screenshots/hesap-olustur.png' // Placeholder screenshot
  },
  {
    id: 2,
    name: 'Mağazanı Bağla',
    description: 'Trendyol, Hepsiburada, Amazon, Shopify ve daha birçok pazar yerini kolayca entegre edin.',
    icon: ShoppingBag,
    details: [
      'Entegrasyonlar sayfasından pazar yerinizi seçin.',
      'Gerekli API anahtarlarını veya yetkilendirmeleri sağlayın.',
      'Mağazanızın otomatik olarak senkronize olmasını izleyin.'
    ],
    image: '/screenshots/magaza-bagla.png' // Placeholder screenshot
  },
  {
    id: 3,
    name: 'Kargonu Seç',
    description: 'Anlaşmalı kargo firmalarınızı bağlayın veya KolayXport\'un avantajlı fiyatlarından yararlanın.',
    icon: Truck,
    details: [
      'Desteklenen kargo firmalarından birini seçin.',
      'Kendi anlaşma bilgilerinizi girin veya standart fiyatları kullanın.',
      'Otomatik kargo etiketi ve takip numarası oluşturmayı etkinleştirin.'
    ],
    image: '/screenshots/kargo-sec.png' // Placeholder screenshot
  },
  {
    id: 4,
    name: 'Gönder!',
    description: 'Siparişleriniz otomatik olarak alınır, kargo etiketleri basılır ve müşterileriniz bilgilendirilir.',
    icon: Send,
    details: [
      'Yeni siparişler panelinize otomatik düşer.',
      'Tek tıkla kargo etiketlerini yazdırın.',
      'Gönderi durumu müşterilerinize otomatik bildirilir.'
    ],
    image: '/screenshots/gonder.png' // Placeholder screenshot
  },
];

export default function NasilKullanirimPage() {
  const [activeStep, setActiveStep] = useState(steps[0].id);
  const currentStepData = steps.find(s => s.id === activeStep);

  return (
    <PublicLayout 
      title="KolayXport Nasıl Kullanılır? Adım Adım Rehber"
      description="KolayXport ile e-ticaret operasyonlarınızı nasıl kolayca yöneteceğinizi öğrenin. Hesap oluşturma, mağaza bağlama, kargo seçimi ve gönderim süreçleri."
    >
      <div className="w-full">
        {/* Hero Section */}
        <section className="relative py-20 md:py-32 text-center px-6 lg:px-8 overflow-hidden bg-gradient-to-br from-slate-50 to-sky-100 animate-fadeIn">
          <div className="absolute inset-0 bg-[url('/noise.png')] opacity-[0.03] mix-blend-multiply pointer-events-none" />
          <div className="relative z-10">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-800 tracking-tight mb-6 animate-slideUp">
              KolayXport Nasıl Çalışır?
            </h1>
            <p className="mt-4 max-w-2xl mx-auto text-lg sm:text-xl text-slate-600 animate-slideUp">
              Sadece 4 basit adımda e-ticaret operasyonlarınızı otomatikleştirin ve işinizi büyütmeye odaklanın.
            </p>
          </div>
        </section>

        {/* Stepper Section */}
        <section className="py-16 md:py-24 bg-white">
          <div className="container max-w-5xl mx-auto px-6 lg:px-8">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-12">
              {steps.map((step, index) => (
                <button
                  key={step.id}
                  onClick={() => setActiveStep(step.id)}
                  className={`p-4 rounded-lg text-left transition-all duration-200 ease-out group hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
                    ${activeStep === step.id 
                      ? 'bg-blue-600 text-white shadow-lg' 
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-700'}`}
                >
                  <div className="flex items-center mb-2">
                    <div 
                      className={`p-2 rounded-full mr-3 transform transition-transform duration-200 ${activeStep === step.id ? 'bg-white/20 scale-110' : 'bg-blue-100 group-hover:bg-blue-200'}`}
                    >
                      <step.icon size={20} className={`${activeStep === step.id ? 'text-white' : 'text-blue-500'}`} />
                    </div>
                    <span className="font-semibold text-sm md:text-base">{index + 1}. {step.name}</span>
                  </div>
                  <p className={`text-xs md:text-sm ${activeStep === step.id ? 'text-blue-100' : 'text-slate-500 group-hover:text-slate-600'}`}>
                    {step.description.substring(0, 50)}...
                  </p>
                </button>
              ))}
            </div>

            <div
              key={activeStep}
              className="bg-slate-50 p-6 sm:p-8 rounded-xl shadow-lg border border-slate-100 grid grid-cols-1 lg:grid-cols-2 gap-8 items-center animate-fadeIn"
            >
              <div className="prose prose-sm sm:prose-base prose-slate max-w-none">
                <h3 className="text-2xl font-semibold text-blue-600 mb-4 flex items-center">
                  <currentStepData.icon size={28} className="mr-3" />
                  {currentStepData.name}
                </h3>
                <p className="mb-4">{currentStepData.description}</p>
                <ul className="space-y-2 pl-0">
                  {currentStepData.details.map((detail, i) => (
                    <li key={i} className="flex items-start">
                      <CheckSquare size={18} className="mr-2 mt-0.5 text-green-500 flex-shrink-0" />
                      <span>{detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="aspect-video bg-slate-200 rounded-lg overflow-hidden relative group">
                <div className="w-full h-full animate-slideUp">
                  <img 
                    src={currentStepData.image || 'https://via.placeholder.com/1280x720.png?text=Adım+Görseli'} 
                    alt={`${currentStepData.name} görseli`} 
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                    <PlayCircle size={64} className="text-white/80"/>
                  </div>
                  <span className="absolute bottom-2 right-3 text-xs bg-black/50 text-white px-2 py-1 rounded">
                    Örnek Ekran Görüntüsü
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Loom Video Section */}
        <section className="py-16 md:py-24 bg-slate-50">
          <div className="container max-w-3xl mx-auto px-6 lg:px-8 text-center">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-6">Detaylı İnceleyin</h2>
            <p className="text-lg text-slate-600 mb-8 max-w-xl mx-auto">
              KolayXport'un temel özelliklerini ve kullanım kolaylığını aşağıdaki videomuzda keşfedin.
            </p>
            <div className="aspect-video bg-slate-200 rounded-xl shadow-xl overflow-hidden relative group cursor-pointer hover:shadow-2xl transition-shadow">
              {/* Placeholder for Loom Video Embed */}
              <div className="absolute inset-0 flex items-center justify-center">
                  <PlayCircle size={80} className="text-blue-500 opacity-70 group-hover:opacity-100 transition-opacity"/>
              </div>
              <img src="https://via.placeholder.com/1280x720/E2E8F0/94A3B8?text=Loom+Video+Burada" alt="KolayXport Tanıtım Videosu" className="w-full h-full object-cover"/>
              <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-50 group-hover:opacity-20 transition-opacity"></div>
              <p className="absolute bottom-4 left-4 text-white text-sm font-medium bg-black/50 px-2 py-1 rounded">
                Loom Video (Yer Tutucu)
              </p>
            </div>
            <p className="mt-4 text-sm text-slate-500">
              Videoyu izleyemiyor musunuz? <a href="#" onClick={(e) => e.preventDefault()} className="text-blue-600 hover:underline">Alternatif link</a>.
            </p>
          </div>
        </section>

        {/* CTA to Docs Section */}
        <section className="py-20 md:py-28 bg-white">
          <div className="container max-w-4xl mx-auto px-6 lg:px-8 text-center">
            <FileText size={48} className="mx-auto text-blue-500 mb-6" />
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-6">
              Daha Fazla Bilgi mi Arıyorsunuz?
            </h2>
            <p className="max-w-xl mx-auto text-lg text-slate-600 mb-10">
              Detaylı kullanım kılavuzlarımız, API referanslarımız ve sıkça sorulan sorular bölümümüzle KolayXport'u derinlemesine keşfedin.
            </p>
            <Link href="/docs" className="px-10 py-4 text-lg font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 rounded-full shadow-lg hover:scale-105 transform transition-transform duration-200 ease-out">Belgeleri Oku</Link>
          </div>
        </section>

        {/* Markdown-style body stub - Example Usage */}
        <section className="py-16 md:py-24 bg-slate-50">
          <div className="container max-w-3xl mx-auto px-6 lg:px-8 prose prose-slate lg:prose-xl">
            <h2>Ek Bilgiler ve İpuçları</h2>
            <p>
              KolayXport platformunu en verimli şekilde kullanmanız için bazı ipuçları ve ek bilgiler aşağıda sunulmuştur. Platformumuz sürekli gelişmekte olup, yeni özellikler ve iyileştirmeler düzenli olarak eklenmektedir.
            </p>
            <h3>Toplu İşlemler</h3>
            <p>
              Çok sayıda siparişi yönetirken veya ürün bilgisi güncellerken toplu işlem özelliklerimizi kullanabilirsiniz. Bu, size önemli ölçüde zaman kazandıracaktır. Ürünlerinizi CSV dosyası ile içeri veya dışarı aktarabilir, sipariş durumlarını toplu olarak güncelleyebilirsiniz.
            </p>
            <h3>Otomasyon Kuralları</h3>
            <p>
              Belirli koşullara göre otomatik eylemler tanımlayabilirsiniz. Örneğin, belirli bir tutarın üzerindeki siparişlere otomatik olarak sigorta ekleyebilir veya belirli bir bölgeden gelen siparişleri farklı bir kargo firmasına yönlendirebilirsiniz. Bu kurallar, iş akışlarınızı kişiselleştirmenize olanak tanır.
            </p>
            <h3>Raporlama ve Analitik</h3>
            <p>
              Detaylı satış raporları, envanter hareketleri ve müşteri analizleri ile işinizin performansını yakından takip edin. Hangi ürünlerin daha çok sattığını, hangi kanalların daha karlı olduğunu ve müşteri davranışlarını anlamak için gelişmiş raporlama araçlarımızı kullanın.
            </p>
            <p>
              Daha fazla bilgi ve destek için <Link href="/iletisim">iletişim sayfamızdan</Link> bize ulaşabilirsiniz veya <Link href="/docs">belgelerimizi</Link> inceleyebilirsiniz.
            </p>
          </div>
        </section>
      </div>
    </PublicLayout>
  );
}

NasilKullanirimPage.getLayout = (page)=>page; 