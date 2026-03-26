import Head from 'next/head';

export default function OfflinePage() {
  return (
    <>
      <Head>
        <title>Cevrimdisi - KolayXport</title>
      </Head>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '2rem',
          textAlign: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#f8fafc',
        }}
      >
        <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
        </div>
        <h1 style={{ fontSize: '1.5rem', color: '#1e293b', marginBottom: '0.5rem' }}>
          Cevrimdisi
        </h1>
        <p style={{ color: '#64748b', maxWidth: '400px', lineHeight: 1.6 }}>
          Internet baglantiniz yok. Lutfen baglantiyi kontrol edip tekrar deneyin.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: '1.5rem',
            padding: '0.75rem 2rem',
            background: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '0.5rem',
            fontSize: '1rem',
            cursor: 'pointer',
          }}
        >
          Tekrar Dene
        </button>
      </div>
    </>
  );
}
