import Dashboard from '../components/Dashboard';
import { useSession, getSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import Head from 'next/head';

// This could be a more sophisticated Layout component for authenticated users
const AuthenticatedLayout = ({ children }) => {
  // Placeholder for a layout that might include a sidebar, app-specific header, etc.
  // For now, it just renders children. You might want to integrate your existing Layout.js logic here or adapt it.
  return <>{children}</>;
};

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  if (status === 'loading') {
    return <p>Yükleniyor...</p>; // Or a proper loading spinner component
  }

  // If not authenticated, redirect to sign-in page
  // You might also handle this with a global Layout component that checks session status
  if (status === 'unauthenticated') {
    router.push('/auth/signin'); // Or your custom sign-in page
    return <p>Yönlendiriliyor...</p>;
  }

  return (
    <AuthenticatedLayout>
      <Head>
        <title>Kontrol Paneli - KolayXport</title>
      </Head>
      <Dashboard />
    </AuthenticatedLayout>
  );
}

// Optional: Server-side protection, though client-side check with useSession is often sufficient for UX
// export async function getServerSideProps(context) {
//   const session = await getSession(context);
//   if (!session) {
//     return {
//       redirect: {
//         destination: '/auth/signin', // Or your custom sign-in page
//         permanent: false,
//       },
//     };
//   }
//   return {
//     props: { session },
//   };
// } 