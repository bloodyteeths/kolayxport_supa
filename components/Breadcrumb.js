import React from 'react';
import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';
import { BreadcrumbJsonLd } from 'next-seo';

const Breadcrumb = ({ items = [] }) => {
  if (!items.length) return null;

  // Always include Home as first item
  const allItems = [
    { name: 'Ana Sayfa', href: '/' },
    ...items
  ];

  // Generate structured data for SEO
  const itemListElements = allItems.map((item, index) => ({
    "@type": "ListItem",
    "position": index + 1,
    "name": item.name,
    "item": `https://kolayxport.com${item.href}`
  }));

  return (
    <>
      <BreadcrumbJsonLd
        itemListElements={itemListElements}
      />
      <nav aria-label="Breadcrumb" className="bg-slate-50 py-3 border-b border-slate-200">
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <ol className="flex items-center space-x-2 text-sm">
            {allItems.map((item, index) => (
              <li key={item.href} className="flex items-center">
                {index > 0 && (
                  <ChevronRight size={16} className="text-slate-400 mx-2" />
                )}
                {index === 0 ? (
                  <Link 
                    href={item.href}
                    className="flex items-center text-slate-600 hover:text-blue-600 transition-colors"
                  >
                    <Home size={16} className="mr-1" />
                    {item.name}
                  </Link>
                ) : index === allItems.length - 1 ? (
                  <span className="text-slate-900 font-medium" aria-current="page">
                    {item.name}
                  </span>
                ) : (
                  <Link 
                    href={item.href}
                    className="text-slate-600 hover:text-blue-600 transition-colors"
                  >
                    {item.name}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </div>
      </nav>
    </>
  );
};

export default Breadcrumb;