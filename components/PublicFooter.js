import React from 'react';
import Link from 'next/link';
import { Twitter, Linkedin, Youtube } from 'lucide-react'; // Using lucide-react for icons
import { useTranslations } from 'next-intl';

const getProductLinks = (t) => [
  { name: t('shipping'), href: '/features/shipping' },
  { name: t('automation'), href: '/features/automation' },
];

const getResourceLinks = (t) => [
  { name: t('blog'), href: '/blog' },
  { name: t('support'), href: '/iletisim' },
  // Legal Links
  { name: t('privacyPolicyEN'), href: '/privacy' },
  { name: t('termsOfServiceEN'), href: '/terms' },
  { name: t('privacyPolicy'), href: '/privacy-tr' },
  { name: t('termsOfService'), href: '/terms-tr' },
];

const socialLinks = [
  { name: 'Twitter', href: 'https://twitter.com/kolayxport', icon: Twitter },
  { name: 'LinkedIn', href: 'https://linkedin.com/company/kolayxport', icon: Linkedin },
  { name: 'YouTube', href: 'https://youtube.com/kolayxport', icon: Youtube },
];

const ListItem = ({ href, children }) => (
  <li>
    <Link
      href={href}
      className="text-slate-300 hover:text-white hover:translate-x-1 inline-block transition-all duration-200 ease-out">
      {children}
    </Link>
  </li>
);

const PublicFooter = () => {
  const brandName = 'KolayXport'; // Defined once
  const t = useTranslations('public');
  const productLinks = getProductLinks(t);
  const resourceLinks = getResourceLinks(t);

  return (
    <footer className="bg-gradient-to-br from-[#111111] to-[#1f2937] text-slate-300 py-12 md:py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">
          {/* Column 1: Brand & Social */}
          <div className="space-y-4">
            <Link
              href="/"
              className="text-3xl font-bold text-white hover:opacity-80 transition-opacity">
                {brandName}
            </Link>
            <p className="text-sm text-slate-400">
              {t('tagline')}
            </p>
            <p className="text-sm text-slate-400">
              <a href="mailto:destek@kolayxport.com" className="text-slate-300 hover:text-white transition-colors">destek@kolayxport.com</a>
            </p>
            <div className="flex space-x-4">
              {socialLinks.map((social) => (
                <Link
                  href={social.href}
                  key={social.name}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-400 hover:text-white transition-colors">
                  <span>
                    <social.icon size={22} />
                    <span className="sr-only">{social.name}</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>

          {/* Column 2: Çözümlerimiz */}
          <div>
            <h3 className="text-lg font-semibold text-white mb-4">{t('ourSolutions')}</h3>
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
            <h3 className="text-lg font-semibold text-white mb-4">{t('resources')}</h3>
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
            &copy; {new Date().getFullYear()} {brandName}. {t('allRightsReserved')}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            The term &ldquo;Etsy&rdquo; is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default PublicFooter; 