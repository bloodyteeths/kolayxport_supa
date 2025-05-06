import React from 'react';
import Link from 'next/link';
import { Twitter, Linkedin, Youtube } from 'lucide-react'; // Using lucide-react for icons

const productLinks = [
  { name: 'Gönderim', href: '/features/shipping' },
  { name: 'Envanter', href: '/features/inventory' },
  { name: 'Otomasyon', href: '/features/automation' },
  { name: 'Fiyatlandırma', href: '/features/pricing' },
];

const resourceLinks = [
  { name: 'Blog', href: '/blog' },
  { name: 'Başarı Hikayeleri', href: '/case-studies' },
  { name: 'API Dokümanları', href: '/docs/api' },
  { name: 'Destek', href: '/support' },
];

const socialLinks = [
  { name: 'Twitter', href: 'https://twitter.com/kolayxport', icon: Twitter },
  { name: 'LinkedIn', href: 'https://linkedin.com/company/kolayxport', icon: Linkedin },
  { name: 'YouTube', href: 'https://youtube.com/kolayxport', icon: Youtube },
];

const ListItem = ({ href, children }) => (
  <li>
    <Link href={href} legacyBehavior>
      <a className="text-slate-300 hover:text-white hover:translate-x-1 inline-block transition-all duration-200 ease-out">
        {children}
      </a>
    </Link>
  </li>
);

const PublicFooter = () => {
  const brandName = 'KolayXport'; // Defined once

  return (
    <footer className="bg-gradient-to-br from-[#111111] to-[#1f2937] text-slate-300 py-12 md:py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">
          {/* Column 1: Brand & Social */}
          <div className="space-y-4">
            <Link href="/" legacyBehavior>
              <a className="text-3xl font-bold text-white hover:opacity-80 transition-opacity">
                {brandName}
              </a>
            </Link>
            <p className="text-sm text-slate-400">
              Tek panelde e-ticaret entegrasyonu
            </p>
            <div className="flex space-x-4">
              {socialLinks.map((social) => (
                <Link href={social.href} key={social.name} legacyBehavior>
                  <a target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">
                    <social.icon size={22} />
                    <span className="sr-only">{social.name}</span>
                  </a>
                </Link>
              ))}
            </div>
          </div>

          {/* Column 2: Ürün */}
          <div>
            <h3 className="text-lg font-semibold text-white mb-4">Ürün</h3>
            <ul className="space-y-2.5">
              {productLinks.map((link) => (
                <ListItem key={link.name} href={link.href}>
                  {link.name}
                </ListItem>
              ))}
            </ul>
          </div>

          {/* Column 3: Kaynaklar */}
          <div>
            <h3 className="text-lg font-semibold text-white mb-4">Kaynaklar</h3>
            <ul className="space-y-2.5">
              {resourceLinks.map((link) => (
                <ListItem key={link.name} href={link.href}>
                  {link.name}
                </ListItem>
              ))}
            </ul>
          </div>
        </div>

        <div className="border-t border-slate-700 pt-8 text-center text-sm">
          <p>
            &copy; {new Date().getFullYear()} {brandName}. Tüm hakları saklıdır.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default PublicFooter; 