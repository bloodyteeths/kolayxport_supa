import React from 'react';
import PublicNav from './PublicNav';
import PublicFooter from './PublicFooter';
import { NextSeo } from 'next-seo';
import { useRouter } from 'next/router';

/**
 * PublicLayout: For marketing/publicly accessible pages (e.g., homepage, /ozellikler, etc.)
 * Provides a public-facing layout without requiring authentication.
 */

const PublicLayout = ({ children, title, description, seo = {} }) => {
  const router = useRouter();
  const baseUrl = 'https://kolayxport.com';
  const canonicalUrl = `${baseUrl}${router.asPath.split('?')[0]}`;

  return (
    <>
      <NextSeo
        title={title}
        description={description}
        canonical={canonicalUrl}
        {...seo}
      />
      <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800">
        <PublicNav />
        {/* No entrance animation: content must paint with the HTML (LCP), not after hydration. */}
        <main className="flex-grow">
          {children}
        </main>
        <PublicFooter />
      </div>
    </>
  );
};

export default PublicLayout; 