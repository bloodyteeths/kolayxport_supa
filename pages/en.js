import React, { Fragment } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import PublicLayout from '../components/PublicLayout';
import { motion } from 'framer-motion';
import { ChevronDown, Star, Truck, BarChart3, Box, ShoppingBag, Search, Tag, Brain, TrendingUp, Layers, Zap } from 'lucide-react';
import { Disclosure, Transition } from '@headlessui/react';

const trustLogos = [
  { name: 'Etsy', src: '/logos/etsy.svg', width: 80, height: 40 },
  { name: 'Amazon', src: '/logos/amazon.svg', width: 120, height: 40 },
  { name: 'Trendyol', src: '/logos/trendyol.png', width: 120, height: 40 },
  { name: 'Hepsiburada', src: '/logos/hepsiburada.png', width: 120, height: 40 },
  { name: 'n11', src: '/logos/n11.png', width: 120, height: 40 },
  { name: 'Shopify', src: '/logos/shopify.jpg', width: 120, height: 40 },
  { name: 'WooCommerce', src: '/logos/woocommerce.svg', width: 140, height: 40 },
];

const features = [
  {
    icon: Brain,
    title: 'AI Listing Assistant',
    description: 'AI-powered title optimization, description generation, pricing suggestions, and listing analysis. Multiply your sales with AI.',
  },
  {
    icon: Search,
    title: 'Market Research',
    description: 'Competitor analysis, niche discovery, keyword intelligence, and trend tracking. Make data-driven decisions to grow sales.',
  },
  {
    icon: ShoppingBag,
    title: 'Listing Management',
    description: 'Create, edit, copy, and bulk-manage your Etsy and eBay listings from one dashboard. Variants, images, and shipping profiles included.',
  },
  {
    icon: Truck,
    title: 'Automatic Shipping Labels',
    description: 'FedEx, UPS, and more — our system selects the cheapest option and generates your labels automatically.',
  },
  {
    icon: TrendingUp,
    title: 'Financial Intelligence',
    description: 'Profit margin calculator, commission analysis, revenue reports, and seller performance tracking.',
  },
  {
    icon: Layers,
    title: 'Multi-Channel Sync',
    description: 'Orders, inventory, and tracking synced in real-time across all marketplaces. Prevent overselling and stock errors.',
  },
];

const includedFeatures = [
  'AI Title & Description Optimization',
  'Competitor Analysis & Seller Tracking',
  'Niche Discovery & Trend Analysis',
  'Keyword Intelligence',
  'Bulk Listing Management',
  'Profit Margin & Commission Calculator',
  'Automatic Shipping Labels (FedEx, UPS)',
  'Multi-Marketplace Sync',
  'Real-Time Inventory Tracking',
  'Order & Tracking Management',
  'SSL Encrypted Connections',
  'Multi-Carrier Support',
];

const testimonials = [
  {
    quote: 'KolayXport reduced our operational workload by 70%! Now we can focus on growing our business.',
    name: 'Ayse Y.',
    company: 'Multi-marketplace Seller',
    stars: 5,
  },
  {
    quote: 'Inventory management used to be a nightmare. With KolayXport, all our channels stay synchronized in real-time.',
    name: 'Mehmet O.',
    company: 'E-commerce Business Owner',
    stars: 5,
  },
  {
    quote: 'Instead of dealing with multiple shipping carriers, getting the best label with one click is an incredible convenience.',
    name: 'Zeynep K.',
    company: 'Etsy & Amazon Seller',
    stars: 5,
  },
];

const faqItems = [
  {
    question: 'How long does KolayXport setup take?',
    answer: 'For the average user, basic integrations and setup can be completed in 30 minutes to 1 hour. Our support team is available to help with detailed configuration.',
  },
  {
    question: 'Which marketplaces and carriers are supported?',
    answer: 'We support Etsy, eBay, Trendyol, Hepsiburada, Amazon, n11, Shopify, WooCommerce, and other popular marketplaces, along with FedEx, UPS, and other leading shipping carriers. Our integration list is constantly expanding.',
  },
  {
    question: 'How do the AI tools work?',
    answer: 'KolayXport\'s AI assistant can optimize titles, generate descriptions, suggest pricing, and analyze your Etsy and eBay listings. It analyzes market data to provide actionable recommendations that increase your sales.',
  },
  {
    question: 'What do the market research tools offer?',
    answer: 'Competitor analysis, seller tracking, niche discovery, keyword intelligence, trend analysis, and profit margin calculators help you make data-driven selling decisions. It\'s a built-in alternative to paid tools like eRank and Terapeak.',
  },
  {
    question: 'How is my data secured?',
    answer: 'Data security is our top priority. All connections are SSL encrypted, sensitive data (API keys, etc.) is stored encrypted in our database, and we use enterprise-grade cloud infrastructure.',
  },
  {
    question: 'Is there a free trial?',
    answer: 'Yes, you can try KolayXport with a free trial that includes all features. Visit our pricing page for details.',
  },
  {
    question: 'How does KolayXport use the Etsy API?',
    answer: 'We use Etsy\'s official Open API v3 with OAuth 2.0 authentication to securely access your shop data, orders, and listings. We only request the permissions necessary for each feature and comply fully with Etsy\'s API Terms of Use. We do not scrape Etsy — all data is obtained exclusively through the official API.',
  },
];

const sectionVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' } },
};

const cardHover = {
  translateY: -4,
  scale: 1.02,
  transition: { type: 'spring', stiffness: 300 },
};

const StarRating = ({ rating }) => (
  <div className="flex items-center">
    {[...Array(5)].map((_, i) => (
      <Star
        key={i}
        size={20}
        className={i < rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}
      />
    ))}
  </div>
);

const HeroSection = () => (
  <motion.section className="relative isolate overflow-hidden bg-gradient-to-br from-white via-sky-50 to-indigo-50">
    <div aria-hidden className="absolute inset-0 -z-10 bg-[url('/noise.png')] opacity-10" />
    <div className="mx-auto max-w-7xl px-6 pt-28 pb-20 sm:pt-36 sm:pb-24 text-center">
      <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-slate-900">
        AI-Powered <span className="text-primary">E-Commerce Command Center</span>
      </h1>
      <p className="mt-6 mx-auto max-w-2xl text-lg text-slate-600">
        Market research, AI listing optimization, competitor analysis, order management & shipping — everything you need for Etsy & eBay, in one dashboard.
      </p>

      <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-x-6">
        <Link href="/login" className="btn-primary">
          Start Free Trial
        </Link>
        <Link href="/ozellikler" className="btn-secondary">Features <span aria-hidden="true">&rarr;</span></Link>
      </div>

      <Image
        src="/images/hero-macbook.jpg"
        width={1600}
        height={1100}
        alt="KolayXport dashboard preview"
        className="mx-auto mt-16 w-full max-w-4xl drop-shadow-2xl rounded-xl"
        priority
      />
    </div>
  </motion.section>
);

export default function HomePageEN() {
  return (
    <PublicLayout
      title="KolayXport – AI-Powered E-Commerce Command Center | Etsy & eBay Tools"
      description="AI listing optimization, market research, competitor analysis, order management & shipping — everything Etsy & eBay sellers need in one dashboard."
      seo={{
        openGraph: {
          images: [
            {
              url: 'https://kolayxport.com/og-public.png',
              width: 1200,
              height: 630,
              alt: 'KolayXport Overview',
            },
          ],
        },
      }}
    >
      <HeroSection />

      {/* TRUST BADGES */}
      <motion.section
        className="py-16 bg-white"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <div className="container max-w-5xl mx-auto px-6 lg:px-8">
          <h3 className="text-center text-sm font-semibold text-slate-500 uppercase tracking-wider mb-10">
            TRUSTED INTEGRATIONS USED BY THOUSANDS OF SELLERS
          </h3>
          <div className="flex flex-wrap justify-center items-center gap-x-8 gap-y-6 md:gap-x-12 lg:gap-x-16">
            {trustLogos.map((logo) => (
              <motion.div key={logo.name} whileHover={{ scale: 1.05 }}>
                <Image
                  src={logo.src}
                  alt={`${logo.name} marketplace integration`}
                  width={logo.width}
                  height={logo.height}
                  className="h-8 md:h-10 w-auto max-w-[120px] md:max-w-[140px] object-contain filter grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all duration-300 ease-in-out"
                  loading="lazy"
                />
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* FEATURES */}
      <motion.section
        className="py-20 md:py-28 bg-slate-50"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        variants={sectionVariants}
      >
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">All Your Selling Tools in One Place</h2>
            <p className="max-w-2xl mx-auto text-lg text-slate-600">
              Research, listing, optimization, orders & shipping — KolayXport covers every stage of e-commerce.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature) => (
              <motion.div
                key={feature.title}
                className="bg-white p-8 rounded-3xl shadow-xl shadow-slate-900/[.07] transition-all duration-300 ease-out"
                variants={sectionVariants}
                whileHover={cardHover}
              >
                <div className="flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-2xl mb-6 shadow-lg">
                  <feature.icon size={32} />
                </div>
                <h3 className="text-xl font-semibold text-slate-800 mb-3">{feature.title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* MARKETPLACE POWER TOOLS */}
      <motion.section
        className="py-20 md:py-28 bg-white"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        variants={sectionVariants}
      >
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">Powerful Tools for Etsy & eBay</h2>
            <p className="max-w-2xl mx-auto text-lg text-slate-600">
              Not just order management — manage the entire journey from research to sale
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-10">
            <motion.div
              className="relative bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-100 rounded-3xl p-8 md:p-10"
              whileHover={{ scale: 1.01 }}
            >
              <div className="flex items-center gap-3 mb-6">
                <Image src="/logos/etsy.svg" alt="Etsy" width={60} height={24} className="h-6 w-auto" />
                <span className="text-xs font-semibold text-orange-600 bg-orange-100 px-2.5 py-1 rounded-full uppercase tracking-wider">Full Integration</span>
              </div>
              <ul className="space-y-3">
                {[
                  'Market research & trend analysis',
                  'AI title and description optimization',
                  'Create, edit, copy & bulk-manage listings',
                  'Variant & inventory management',
                  'Image and video uploads',
                  'Shipping profiles & return policies',
                  'Order tracking & customer messaging',
                  'Personalization settings',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-slate-700">
                    <Zap size={16} className="text-orange-500 mt-0.5 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </motion.div>
            <motion.div
              className="relative bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-3xl p-8 md:p-10"
              whileHover={{ scale: 1.01 }}
            >
              <div className="flex items-center gap-3 mb-6">
                <span className="text-2xl font-bold text-blue-600 tracking-tight">eBay</span>
                <span className="text-xs font-semibold text-blue-600 bg-blue-100 px-2.5 py-1 rounded-full uppercase tracking-wider">Full Integration</span>
              </div>
              <ul className="space-y-3">
                {[
                  'Competitor analysis & seller tracking',
                  'AI title optimization & pricing suggestions',
                  'Niche analysis & product database',
                  'Keyword intelligence',
                  'Create listings & bulk editing',
                  'Category & item specifics guidance',
                  'Financial intelligence & profit analysis',
                  'Order management & shipping tracking',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-slate-700">
                    <Zap size={16} className="text-blue-500 mt-0.5 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>
        </div>
      </motion.section>

      {/* WHAT'S INCLUDED */}
      <motion.section
        className="py-20 md:py-28 bg-white"
        initial={{ opacity: 0, y: 50 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
      >
        <div className="container max-w-5xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">Included in Every Plan</h2>
            <p className="max-w-xl mx-auto text-lg text-slate-600">
              From research to sales, all tools at your fingertips
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {includedFeatures.map((feature) => (
              <div key={feature} className="flex items-center gap-3 bg-slate-50 rounded-xl px-5 py-4">
                <svg className="w-6 h-6 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm font-medium text-slate-700">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* TESTIMONIALS */}
      <motion.section
        className="py-20 md:py-28 bg-slate-50 overflow-hidden"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        variants={sectionVariants}
      >
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">What Our Customers Say</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map((testimonial, i) => (
              <motion.div
                key={i}
                className="bg-white p-8 rounded-2xl shadow-lg"
                variants={sectionVariants}
              >
                <div className="flex items-center mb-4">
                  <div className="w-14 h-14 rounded-full mr-4 bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xl">
                    {testimonial.name[0]}
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-800">{testimonial.name}</h4>
                    <p className="text-sm text-slate-500">{testimonial.company}</p>
                  </div>
                </div>
                <StarRating rating={testimonial.stars} />
                <blockquote className="mt-4 text-slate-600 italic relative pl-5">
                  <span className="absolute left-0 -top-2 text-5xl text-slate-200 font-serif">&ldquo;</span>
                  {testimonial.quote}
                </blockquote>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* CTA */}
      <motion.section
        className="py-20 md:py-28 bg-gradient-to-r from-blue-600 to-indigo-600 text-white"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: 0.6 }}
      >
        <div className="container max-w-4xl mx-auto px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            Research, List, Sell — All From One Place.
          </h2>
          <p className="max-w-xl mx-auto text-lg text-blue-100 mb-10">
            Grow your Etsy and eBay sales with AI-powered tools. Start your free trial today.
          </p>
          <div className="mt-8">
            <Link href="/login" className="inline-block px-12 py-4 text-xl font-semibold text-white bg-gradient-to-r from-green-500 to-emerald-600 rounded-full shadow-lg hover:scale-105 transform transition-transform duration-200 ease-out">
              Sign Up Free
            </Link>
            <p className="mt-6 text-sm text-blue-200">
              Have questions? <Link href="/iletisim" className="text-white underline hover:text-blue-100">Contact Us</Link>.
            </p>
          </div>
        </div>
      </motion.section>

      {/* FAQ */}
      <motion.section
        className="py-20 md:py-28 bg-white"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        variants={sectionVariants}
      >
        <div className="container max-w-3xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">Frequently Asked Questions</h2>
          </div>
          <div className="space-y-4">
            {faqItems.map((item, i) => (
              <Disclosure as="div" key={i} className="bg-slate-50 rounded-lg shadow-sm">
                {({ open }) => (
                  <>
                    <Disclosure.Button className="flex justify-between items-center w-full px-6 py-4 text-left text-lg font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring focus-visible:ring-blue-500 focus-visible:ring-opacity-75 rounded-lg">
                      <span>{item.question}</span>
                      <ChevronDown
                        size={24}
                        className={`transform transition-transform duration-200 ${
                          open ? '-rotate-180' : ''
                        } text-slate-500`}
                      />
                    </Disclosure.Button>
                    <Transition
                      as={Fragment}
                      enter="transition duration-100 ease-out"
                      enterFrom="transform scale-95 opacity-0"
                      enterTo="transform scale-100 opacity-100"
                      leave="transition duration-75 ease-out"
                      leaveFrom="transform scale-100 opacity-100"
                      leaveTo="transform scale-95 opacity-0"
                    >
                      <Disclosure.Panel className="px-6 pt-2 pb-4 text-sm text-slate-600 leading-relaxed">
                        {item.answer}
                      </Disclosure.Panel>
                    </Transition>
                  </>
                )}
              </Disclosure>
            ))}
          </div>
        </div>
      </motion.section>

      {/* ETSY DISCLAIMER */}
      <section className="py-4 bg-slate-100 text-center">
        <p className="text-xs text-slate-500 max-w-3xl mx-auto px-4">
          The term &ldquo;Etsy&rdquo; is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy.
          All other trademarks are the property of their respective owners. | <Link href="/privacy" className="underline hover:text-slate-700">Privacy Policy</Link> | <Link href="/terms" className="underline hover:text-slate-700">Terms of Service</Link> | Contact: <a href="mailto:destek@kolayxport.com" className="underline hover:text-slate-700">destek@kolayxport.com</a>
        </p>
      </section>
    </PublicLayout>
  );
}
