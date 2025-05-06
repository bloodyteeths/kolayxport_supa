import { getProviders, signIn } from "next-auth/react";
// import Head from "next/head"; // Will be handled by PublicLayout
import PublicLayout from "../../components/PublicLayout"; // Adjusted path

export default function SignIn({ providers }) {
  return (
    // Pass a specific title for the sign-in page
    <PublicLayout title="Giriş Yap">
      {/* <Head> // Removed, PublicLayout handles title
        <title>Sign In - KolayXport</title>
      </Head> */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 72px - 0px)', backgroundColor: '#f3f4f6', paddingTop: '0' }}> {/* Adjust minHeight considering nav, padding already handled by PublicLayout */}
        {/* Logo can be part of PublicNav or added here if specific to this page */}
        {/* <img src="/kolayxport-logo.png" alt="KolayXport Logo" style={{ marginBottom: '2rem', width: '150px' }} /> */}
        
        <div style={{ backgroundColor: 'white', padding: '2rem', borderRadius: '0.5rem', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: '600', textAlign: 'center', marginBottom: '1.5rem' }}>
            KolayXport'a Giriş Yapın
          </h1>
          {Object.values(providers).map((provider) => (
            <div key={provider.name}>
              <button 
                onClick={() => signIn(provider.id, { callbackUrl: '/app' })} // Changed callbackUrl to /app
                style={{
                  backgroundColor: '#4285F4', // Google's blue
                  color: 'white',
                  fontWeight: '500',
                  padding: '0.75rem 1.5rem',
                  border: 'none',
                  borderRadius: '0.375rem',
                  cursor: 'pointer',
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem'
                }}
              >
                {/* You can add a Google icon here */}
                <span>Sign in with {provider.name}</span>
              </button>
            </div>
          ))}
        </div>
        <p style={{ marginTop: '2rem', fontSize: '0.875rem', color: '#6b7280', position: 'absolute', bottom: '1rem' }}>
          &copy; {new Date().getFullYear()} Tamsar Tekstil Dış Tic. Ltd. Şti.
        </p>
      </div>
    </PublicLayout>
  );
}

export async function getServerSideProps(context) {
  const providers = await getProviders();
  return {
    props: { providers },
  };
} 