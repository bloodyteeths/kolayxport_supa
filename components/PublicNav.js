import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import PropTypes from 'prop-types';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X } from 'lucide-react'; // Using lucide-react for icons

const navLinks = [
  { name: 'Kurumsal', href: '/kurumsal' },
  { name: 'Özellikler', href: '/ozellikler' },
  { name: 'Entegrasyonlar', href: '/entegrasyonlar' },
  { name: 'Nasıl Kullanırım', href: '/nasil-kullanirim' },
  { name: 'İletişim', href: '/iletisim' },
];

const navVariants = {
  hidden: { opacity: 0, y: -20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: 'easeInOut',
      staggerChildren: 0.08,
    },
  },
};

const linkVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } },
};

const mobileMenuVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.2, ease: 'easeOut' } },
  exit: { opacity: 0, scale: 0.95, transition: { duration: 0.15, ease: 'easeIn' } },
};

const PublicNav = ({ ctaLink = '/api/auth/signin' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const toggleMenu = () => setIsOpen(!isOpen);

  return (
    <>
      <motion.header
        initial="hidden"
        animate="visible"
        variants={navVariants}
        className={`fixed top-0 left-0 right-0 z-50 h-[72px] transition-colors duration-300 ease-in-out ${
          isScrolled ? 'bg-white/70 backdrop-blur-md shadow-sm' : 'bg-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full flex items-center justify-between">
          {/* Logo Placeholder */}
          <motion.div variants={linkVariants}>
            <Link href="/" legacyBehavior>
              <a className="text-2xl font-bold text-gray-800 hover:text-blue-600 transition-colors">
                KolayXport
              </a>
            </Link>
          </motion.div>

          {/* Desktop Nav Links */}
          <nav className="hidden md:flex items-center gap-x-6 lg:gap-x-8">
            {navLinks.map((link) => (
              <motion.div variants={linkVariants} key={link.name}>
                <Link href={link.href} legacyBehavior>
                  <a className="text-gray-600 hover:text-blue-600 transition-colors font-medium">
                    {link.name}
                  </a>
                </Link>
              </motion.div>
            ))}
            <motion.div variants={linkVariants}>
              <Link href={ctaLink} legacyBehavior>
                <a className="px-6 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full shadow-lg hover:scale-105 transform transition-transform duration-200 ease-out">
                  Ücretsiz Dene
                </a>
              </Link>
            </motion.div>
          </nav>

          {/* Mobile Menu Button */}
          <div className="md:hidden">
            <motion.button
              onClick={toggleMenu}
              className="p-2 rounded-md text-gray-600 hover:text-blue-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
              aria-label="Menüyü aç/kapat"
              aria-expanded={isOpen}
              variants={linkVariants}
            >
              {isOpen ? <X size={24} /> : <Menu size={24} />}
            </motion.button>
          </div>
        </div>
      </motion.header>

      {/* Mobile Menu Dialog */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={mobileMenuVariants}
            className="fixed inset-0 z-40 bg-white/90 backdrop-blur-sm md:hidden flex flex-col items-center justify-center p-6 pt-[72px]"
          >
            <nav className="flex flex-col items-center space-y-6 text-center">
              {navLinks.map((link) => (
                <motion.div variants={linkVariants} key={link.name}>
                  <Link href={link.href} legacyBehavior>
                    <a 
                      onClick={toggleMenu}
                      className="text-xl font-medium text-gray-700 hover:text-blue-600 transition-colors"
                    >
                      {link.name}
                    </a>
                  </Link>
                </motion.div>
              ))}
              <motion.div variants={linkVariants} className="mt-8">
                <Link href={ctaLink} legacyBehavior>
                  <a
                    onClick={toggleMenu}
                    className="px-8 py-3 text-lg font-semibold text-white bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full shadow-lg hover:scale-105 transform transition-transform duration-200 ease-out"
                  >
                    Ücretsiz Dene
                  </a>
                </Link>
              </motion.div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

PublicNav.propTypes = {
  ctaLink: PropTypes.string,
};

export default PublicNav; 