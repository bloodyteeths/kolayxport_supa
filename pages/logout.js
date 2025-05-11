import React, { useEffect } from 'react';
// import { signOut } from 'next-auth/react'; // REMOVED
import { useAuth } from '@/lib/auth-context'; // ADDED
import { useRouter } from 'next/router'; // ADDED
import Layout from '@/components/Layout';

export default function Logout() {
  const { signOut: supabaseSignOut, user } = useAuth(); // ADDED
  const router = useRouter(); // ADDED

  useEffect(() => {
    // signOut({ callbackUrl: '/' }); // REMOVED
    const performSignOut = async () => {
      if (user) { // Only attempt sign out if there is a user
        await supabaseSignOut();
      }
      router.push('/'); // Redirect to home page
    };
    performSignOut();
  }, [supabaseSignOut, router, user]); // ADDED dependencies

  return (
    <Layout>
      <div className="flex items-center justify-center h-full p-8">
        <p>Logging out...</p>
      </div>
    </Layout>
  );
} 