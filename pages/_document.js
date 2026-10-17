import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    // lang="tr" is the SSR default; pages/_app.tsx syncs <html lang> to the client UI locale.
    <Html lang="tr">
      <Head>
        <meta charSet="utf-8" />
        <link rel="icon" href="/favicon.ico" sizes="48x48" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="theme-color" content="#0E1A2B" />

        {/* PWA meta tags */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="KolayXport" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="application-name" content="KolayXport" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
