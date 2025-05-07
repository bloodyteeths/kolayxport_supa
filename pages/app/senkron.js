import React from 'react';
import AppLayout from '../../components/AppLayout';
import { NextSeo } from 'next-seo';
import { motion } from 'framer-motion';
import { ShoppingCart } from 'lucide-react';

const SenkronPage = () => {
  return (
    <AppLayout title="Senkron – Order & Inventory Sync">
      <NextSeo title="Senkron – KolayXport" />
      <motion.section
        className="py-20 md:py-32 text-center px-6 lg:px-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-center mb-8">
            <ShoppingCart size={40} className="text-blue-600" />
          </div>
          <h1 className="text-4xl font-bold text-slate-800 mb-4">Order & Inventory Sync</h1>
          <p className="text-lg text-slate-600 mb-12">
            This section will display Google Cards-style widgets for quick insights and manual sync actions.
            Development in progress.
          </p>
          <div className="grid gap-8 md:grid-cols-2">
            <div className="bg-white shadow-lg rounded-lg p-8">
              <h2 className="text-xl font-semibold text-slate-800 mb-2">Orders Today</h2>
              <p className="text-3xl font-bold text-blue-600">—</p>
            </div>
            <div className="bg-white shadow-lg rounded-lg p-8">
              <h2 className="text-xl font-semibold text-slate-800 mb-2">Low Stock Alerts</h2>
              <p className="text-3xl font-bold text-orange-500">—</p>
            </div>
          </div>
        </div>
      </motion.section>
    </AppLayout>
  );
};

export default SenkronPage; 