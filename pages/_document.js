import { Html, Head, Main, NextScript } from 'next/document';
import Document from 'next/document';

const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID || '';

// Google Consent Mode v2: everything non-essential is denied until the visitor chooses
// (components/CookieConsent.tsx → lib/tracking/consent.ts). A stored choice is re-applied here,
// before GTM loads, so returning visitors are measured from the first page view.
const CONSENT_DEFAULTS = `
window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;
gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',functionality_storage:'granted',security_storage:'granted',wait_for_update:500});
gtag('set','ads_data_redaction',true);gtag('set','url_passthrough',false);
try{var c=JSON.parse(localStorage.getItem('kx-consent')||'null');if(c&&c.v===1){gtag('consent','update',{analytics_storage:c.analytics?'granted':'denied',ad_storage:c.marketing?'granted':'denied',ad_user_data:c.marketing?'granted':'denied',ad_personalization:c.marketing?'granted':'denied'});}}catch(e){}
`;

const GTM_LOADER = (id) => `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${id}');`;

export default function MyDocument({ lang, tracking }) {
  // No GTM/GA4 on the MCP OAuth consent screens (/oauth/*): they stay free of third-party scripts.
  const gtm = GTM_ID && tracking !== false;
  return (
    // Marketing pages under /en render English; everything else starts Turkish and
    // pages/_app.tsx syncs <html lang> to the client UI locale.
    <Html lang={lang || 'tr'}>
      <Head>
        <meta charSet="utf-8" />
        <link rel="icon" href="/favicon.ico" sizes="48x48" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="theme-color" content="#0B1220" />
        {process.env.NEXT_PUBLIC_GSC_VERIFICATION ? <meta name="google-site-verification" content={process.env.NEXT_PUBLIC_GSC_VERIFICATION} /> : null}
        {process.env.NEXT_PUBLIC_BING_VERIFICATION ? <meta name="msvalidate.01" content={process.env.NEXT_PUBLIC_BING_VERIFICATION} /> : null}

        <script dangerouslySetInnerHTML={{ __html: CONSENT_DEFAULTS }} />
        {gtm ? <script dangerouslySetInnerHTML={{ __html: GTM_LOADER(GTM_ID) }} /> : null}

        {/* PWA meta tags */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        {/* Opaque status bar, not black-translucent: iOS 26 lays a translucent home-screen app out one status-bar
            height short of the screen (WebKit 301108), which left a dead band under the tab bar where taps failed.
            iOS reads this when the app is added to the home screen; globals.css covers apps added before. */}
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="KolayXport" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="application-name" content="KolayXport" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </Head>
      <body>
        {gtm ? (
          <noscript>
            <iframe src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`} height="0" width="0" style={{ display: 'none', visibility: 'hidden' }} title="gtm" />
          </noscript>
        ) : null}
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}

MyDocument.getInitialProps = async (ctx) => {
  const initial = await Document.getInitialProps(ctx);
  const path = ctx.pathname || '';
  return { ...initial, lang: path === '/en' || path.startsWith('/en/') ? 'en' : 'tr', tracking: !(path === '/oauth' || path.startsWith('/oauth/')) };
};
