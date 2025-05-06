import React, { Fragment } from 'react';
import Link from 'next/link';
import PublicLayout from '../components/PublicLayout';
import { motion } from 'framer-motion';
import { NextSeo } from 'next-seo';
import { MapPin, Briefcase, Clock, Coffee, Rocket, Gift, MessageCircle, Globe, Users, Zap, Palette, Brain, MessageSquare } from 'lucide-react';

const sectionVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' } },
};

// Aurora SVG component (simplified for brevity)
const Aurora = () => (
  <svg viewBox="0 0 1440 500" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full opacity-20 md:opacity-30 pointer-events-none">
    <defs>
      <radialGradient id="aurora-gradient-1" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
        <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.6" />
        <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="aurora-gradient-2" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
        <stop offset="0%" stopColor="#818cf8" stopOpacity="0.5" />
        <stop offset="100%" stopColor="#818cf8" stopOpacity="0" />
      </radialGradient>
       <radialGradient id="aurora-gradient-3" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
        <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.4" />
        <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
      </radialGradient>
    </defs>
    <motion.rect 
        x="0" y="0" width="1440" height="500" 
        fill="url(#aurora-gradient-1)" 
        animate={{ y: [-20, 20, -20], scale: [1, 1.1, 1], opacity: [0.3, 0.6, 0.3]}} 
        transition={{ duration: 15, repeat: Infinity, ease: "easeInOut", delay: 0 }}
    />
    <motion.rect 
        x="0" y="0" width="1440" height="500" 
        fill="url(#aurora-gradient-2)" 
        animate={{ y: [20, -20, 20], scale: [1.1, 1, 1.1], opacity: [0.2, 0.5, 0.2] }} 
        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut", delay: 5 }}
    />
     <motion.rect 
        x="0" y="0" width="1440" height="500" 
        fill="url(#aurora-gradient-3)" 
        animate={{ x: [-20, 20, -20], scale: [1, 1.1, 1], opacity: [0.1, 0.4, 0.1]}} 
        transition={{ duration: 25, repeat: Infinity, ease: "easeInOut", delay: 10 }}
    />
  </svg>
);

const cultureCards = [
  {
    title: 'Remote-First Yaklaşım',
    description: 'Dünyanın neresinde olursan ol, ekibimizin bir parçası olabilirsin. Esnek çalışma saatleri ve özgür bir ortam sunuyoruz.',
    icon: Globe,
  },
  {
    title: 'Açık Kaynak Kültürü',
    description: 'Şeffaflığa ve toplulukla birlikte gelişmeye inanıyoruz. Kodlarımızın bir kısmı GitHub\'da, katkılarını bekliyoruz!',
    icon: Zap, // Replaced Users with Zap for open source vibe
  },
  {
    title: 'Continuous Shipment',
    description: 'Hızlı iterasyonlar ve sürekli teslimat ile kullanıcılarımıza en iyi deneyimi sunmak için çalışıyoruz. Bürokrasiden uzak, çevik bir yapıdayız.',
    icon: Rocket,
  },
];

const openRoles = [
  {
    title: 'Frontend Geliştirici (React/Next.js)',
    commitment: 'Haftada 5-10 saat (gönüllü)',
    perks: [
      { emoji: '☕', text: 'Sınırsız sanal kahve ve keyifli sohbetler' },
      { emoji: '🚀', text: 'Kendi side-project\'lerine zaman ve destek' },
      { emoji: '💸', text: 'Gelecekteki başarıdan pay (Token Vested)' },
      { emoji: '🧠', text: 'Yeni teknolojiler öğrenme ve deneyimleme fırsatı' },
    ],
    applyLink: 'mailto:kariyer@kolayxport.com?subject=Frontend%20Geliştirici%20Başvurusu',
    icon: Palette,
  },
  {
    title: 'Backend Geliştirici (Node.js/Prisma)',
    commitment: 'Haftada 5-10 saat (gönüllü)',
    perks: [
      { emoji: '☕', text: 'Bolca algoritma ve veri tabanı muhabbeti' },
      { emoji: '🚀', text: 'Ölçeklenebilir sistemler tasarlama deneyimi' },
      { emoji: '💸', text: 'Vested token opsiyonu ile ortaklık' },
      { emoji: '🛠️', text: 'Mikroservisler ve sunucusuz mimarilerle çalışma' },
    ],
    applyLink: 'mailto:kariyer@kolayxport.com?subject=Backend%20Geliştirici%20Başvurusu',
    icon: Brain,
  },
  {
    title: 'Topluluk Yöneticisi (Discord/Forum)',
    commitment: 'Haftada 3-5 saat (gönüllü)',
    perks: [
      { emoji: '☕', text: 'Eğlenceli ve yardımsever bir topluluk' },
      { emoji: '🚀', text: 'Marka bilinirliğini artırma ve etki yaratma' },
      { emoji: '💸', text: 'Projenin bir parçası olma ve token payı' },
      { emoji: '🎉', text: 'Online etkinlikler ve yarışmalar düzenleme' },
    ],
    applyLink: 'mailto:kariyer@kolayxport.com?subject=Topluluk%20Yöneticisi%20Başvurusu',
    icon: MessageSquare,
  },
];

const timelineEvents = [
  { year: '2023', title: 'MVP Lansmanı', description: 'İlk prototip ve temel özellikler yayında.', icon: Rocket },
  { year: '2024', title: 'İlk 50 Satıcı', description: 'Platformumuz ilk kullanıcılarıyla buluştu ve değerli geri bildirimler toplandı.', icon: Users },
  { year: '2025', title: 'Global Pazar Açılımı', description: 'Uluslararası pazarlara açılarak daha geniş bir kitleye ulaşma hedefi.', icon: Globe },
];

const RoleCard = ({ title, commitment, perks, applyLink, icon: Icon }) => (
  <motion.div 
    className="bg-slate-800/50 p-6 rounded-xl shadow-lg border border-slate-700 hover:border-sky-500/70 transition-colors duration-300 group"
    whileHover={{ y: -5, boxShadow: "0px 10px 20px rgba(0, 180, 255, 0.1)" }}
  >
    <div className="flex items-center mb-4">
      <Icon className="w-8 h-8 mr-3 text-sky-400 group-hover:text-sky-300 transition-colors" />
      <h3 className="text-xl font-semibold text-slate-100 group-hover:text-sky-300 transition-colors">{title}</h3>
    </div>
    <p className="text-xs text-slate-400 mb-1 flex items-center"><Clock size={14} className="mr-1.5" /> {commitment}</p>
    <ul className="space-y-1.5 my-4">
      {perks.map(perk => (
        <li key={perk.text} className="flex items-center text-sm text-slate-300">
          <span className="mr-2 text-lg">{perk.emoji}</span>
          {perk.text}
        </li>
      ))}
    </ul>
    <a 
      href={applyLink}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block mt-2 w-full text-center px-5 py-2.5 text-sm font-medium text-white bg-sky-500/80 hover:bg-sky-500 rounded-lg shadow-md transition-colors duration-200 group-hover:shadow-sky-500/30"
    >
      Başvur
    </a>
  </motion.div>
);

export default function KariyerPage() {
  return (
    <PublicLayout
      title="Kariyer - KolayXport'a Katıl!"
      description="E-ticaretin geleceğini şekillendirecek bir ekibe katılın. Uzaktan çalışma, açık kaynak ve sürekli gelişim felsefesiyle KolayXport'ta yerinizi alın."
    >
      <NextSeo
        openGraph={{
          images: [
            {
              url: 'https://kolayxport.com/og-kariyer.png', // Ensure this image exists
              width: 1200,
              height: 630,
              alt: 'KolayXport Kariyer Fırsatları',
            },
          ],
        }}
      />
      {/* Hero Section */}
      <motion.section
        className="relative py-24 md:py-40 lg:py-48 text-center px-6 lg:px-8 overflow-hidden bg-gradient-to-br from-slate-900 to-slate-800 isolate"
        variants={sectionVariants}
        initial="hidden"
        animate="visible"
      >
        <Aurora />
        <div className="relative z-10">
          <motion.h1
            className="text-4xl sm:text-5xl md:text-6xl font-black text-slate-100 tracking-tight"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            Vibe Coding Seviyorsan, E-İhracata İz Bırak!
          </motion.h1>
          <motion.p
            className="mt-6 max-w-2xl mx-auto text-lg sm:text-xl text-slate-300"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            Monorepo, taze kahve, mem'ler ve TypeScript. KolayXport, gönüllü-odaklı ekibine yeni yoldaşlar arıyor.
          </motion.p>
          <motion.div
            className="mt-10 flex flex-col sm:flex-row justify-center items-center gap-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.6 }}
          >
            <a href="https://discord.gg/YOUR_DISCORD_INVITE" target="_blank" rel="noopener noreferrer" className="px-8 py-3.5 text-lg font-semibold text-white bg-gradient-to-r from-sky-500 to-cyan-500 rounded-lg shadow-lg hover:scale-105 transform transition-transform duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-400 focus:ring-offset-slate-900">
              Discord'a Katıl
            </a>
            <Link href="#open-roles" legacyBehavior>
              <a className="px-8 py-3.5 text-lg font-semibold text-sky-300 bg-slate-700/50 hover:bg-slate-600/70 rounded-lg shadow-lg hover:scale-105 transform transition-all duration-200 ease-out border border-slate-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-500 focus:ring-offset-slate-900">
                Açık Pozisyonlar
              </a>
            </Link>
          </motion.div>
        </div>
      </motion.section>

      {/* Culture Section */}
      <motion.section
        className="py-16 md:py-24 bg-slate-800"
        variants={sectionVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.1 }}
      >
        <div className="container max-w-5xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-100 mb-4">Ekip Kültürümüz</h2>
            <p className="max-w-xl mx-auto text-lg text-slate-400">
              Özgür, yenilikçi ve sürekli öğrenen bir ortamda harika işler çıkarıyoruz.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {cultureCards.map((card, index) => (
              <motion.div
                key={card.title}
                className="bg-slate-700/50 p-8 rounded-2xl shadow-xl border border-slate-600/50 group [perspective:1000px]"
                variants={{ hidden: { opacity:0, y:30 }, visible: { opacity:1, y:0, transition: {delay: index * 0.15}} }}
              >
                <motion.div 
                    className="transition-transform duration-500 ease-in-out group-hover:[transform:rotateY(6deg)] [transform-style:preserve-3d]"
                >
                    <div className="flex items-center justify-center w-16 h-16 bg-gradient-to-br from-sky-500 to-cyan-400 text-white rounded-2xl mb-6 shadow-lg">
                        <card.icon size={32} />
                    </div>
                    <h3 className="text-xl font-semibold text-slate-100 mb-3">{card.title}</h3>
                    <p className="text-slate-300 text-sm leading-relaxed">{card.description}</p>
                </motion.div>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* Open Roles Section */}
      <motion.section 
        id="open-roles"
        className="py-16 md:py-24 bg-slate-900"
        variants={sectionVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.1 }}
      >
        <div className="container max-w-4xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-100 mb-4">Açık Pozisyonlar (Gönüllü)</h2>
            <p className="max-w-xl mx-auto text-lg text-slate-400">
              E-ticaret dünyasında fark yaratacak bir projede yer almak ister misin? Bize katıl!
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-8">
            {openRoles.map((role) => (
              <RoleCard key={role.title} {...role} />
            ))}
          </div>
           <p className="text-center mt-12 text-slate-400">
            Yukarıdaki pozisyonlar gönüllülük esasına dayanmaktadır. Projemiz büyüdükçe ve gelir elde etmeye başladıkça, ekibimize tam zamanlı ve ücretli pozisyonlar eklemeyi hedefliyoruz.
          </p>
        </div>
      </motion.section>

      {/* Timeline Section */}
      <motion.section 
        className="py-16 md:py-24 bg-slate-800"
        variants={sectionVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.1 }}
      >
        <div className="container max-w-4xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-100 mb-4">Yol Haritamız</h2>
          </div>
          <div className="relative">
            <div className="hidden sm:block absolute w-1 bg-sky-700/50 h-full left-1/2 transform -translate-x-1/2"></div>
            {timelineEvents.map((event, index) => (
              <motion.div 
                key={event.year}
                className={`mb-12 flex items-center w-full ${index % 2 === 0 ? 'sm:flex-row-reverse' : 'sm:flex-row'}`}
                initial={{ opacity: 0, x: index % 2 === 0 ? 50 : -50 }}
                whileInView={{ opacity: 1, x: 0}}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.6, delay: index * 0.15, type: 'spring', stiffness: 100}}
              >
                <div className="sm:w-1/2">
                  <div className={`p-6 rounded-xl shadow-lg ${index % 2 === 0 ? 'sm:mr-auto sm:text-right' : 'sm:ml-auto sm:text-left'} bg-slate-700/60 border border-slate-600`}>
                    <div className={`text-3xl font-bold text-sky-400 mb-2 ${index % 2 === 0 ? 'sm:justify-end' : 'sm:justify-start'} flex items-center`}>
                      <event.icon className="w-8 h-8 mr-2 sm:mr-0 sm:ml-2 text-sky-400" strokeWidth={1.5} />
                      {event.year}
                    </div>
                    <h3 className="text-xl font-semibold text-slate-100 mb-1">{event.title}</h3>
                    <p className="text-slate-300 text-sm leading-relaxed">{event.description}</p>
                  </div>
                </div>
                <div className="hidden sm:flex absolute w-6 h-6 bg-sky-500 rounded-full border-4 border-slate-800 left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 items-center justify-center shadow-md">
                  <div className="w-2 h-2 bg-white rounded-full"></div>
                </div>
                <div className="sm:w-1/2"></div>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* CTA Banner Section */}
      <motion.section
        className="py-20 md:py-28 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900"
        variants={sectionVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.3 }}
      >
        <div className="container max-w-4xl mx-auto px-6 lg:px-8 text-center">
          <motion.h2 
            className="text-3xl md:text-4xl lg:text-5xl font-black text-slate-100 mb-10"
            style={{
                textShadow: `
                    0 0 5px #fff, 
                    0 0 10px #fff, 
                    0 0 15px #0ea5e9, 
                    0 0 20px #0ea5e9, 
                    0 0 25px #0ea5e9, 
                    0 0 30px #0ea5e9, 
                    0 0 35px #0ea5e9`,
            }}
            initial={{ opacity: 0, scale: 0.8 }}
            whileInView={{ opacity: 1, scale: 1}}
            transition={{ duration: 0.7, ease: 'backOut'}}
            viewport={{ once: true, amount: 0.5 }}
          >
            Sen de gel, commit mesafesinde fark yarat.
          </motion.h2>
          <Link href="https://discord.gg/YOUR_DISCORD_INVITE" target="_blank" rel="noopener noreferrer" legacyBehavior>
            <a className="px-10 py-4 text-lg font-semibold text-slate-900 bg-sky-400 hover:bg-sky-300 rounded-lg shadow-lg shadow-sky-500/30 hover:shadow-sky-400/40 transform transition-all duration-200 ease-out hover:scale-105">
              Topluluğa Katıl ve Başvur!
            </a>
          </Link>
        </div>
      </motion.section>

    </PublicLayout>
  );
} 