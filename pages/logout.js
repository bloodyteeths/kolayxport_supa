import React, { useEffect } from 'react';
import { signOut } from 'next-auth/react';
import Layout from '@/components/Layout';

export default function Logout() {
  useEffect(() => {
    signOut({ callbackUrl: '/' });
  }, []);

  return (
    <Layout>
      <div className="flex items-center justify-center h-full p-8">
        <p>Logging out...</p>
      </div>
    </Layout>
  );
} 