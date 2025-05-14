import React, { useState } from 'react';
import AppLayout from '../../components/AppLayout';
import { NextSeo } from 'next-seo';
import { motion } from 'framer-motion';
import { ShoppingCart, Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';

const SenkronPage = () => {
  const [loading, setLoading] = useState(false);
  const [successCount, setSuccessCount] = useState(null);
  const [error, setError] = useState(null);

  const handleSync = async () => {
    setLoading(true);
    setError(null);
    setSuccessCount(null);
    try {
      const res = await fetch('/api/orders/sync', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      setSuccessCount(data.syncedCount || data.count || data.successCount || 0);
      setError(null);
    } catch (err) {
      setError(err.message || 'Unknown error');
      setSuccessCount(null);
    } finally {
      setLoading(false);
    }
  };

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
          <div className="max-w-xl mx-auto mt-20 p-8 bg-white rounded-lg shadow text-center">
            <Button onClick={handleSync} disabled={loading} className="inline-flex items-center justify-center">
              {loading && <Loader className="animate-spin mr-2 w-5 h-5" />}
              Sync Orders
            </Button>
            {successCount !== null && !error && (
              <div className="mt-6 text-green-700 font-semibold">Synced {successCount} orders</div>
            )}
            {error && (
              <div className="mt-6 bg-red-100 text-red-700 p-3 rounded">{error}</div>
            )}
          </div>
        </div>
      </motion.section>
    </AppLayout>
  );
};

export default SenkronPage; 