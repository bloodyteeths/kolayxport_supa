import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="tr"> {/* You can set a default language if desired */}
      <Head>
        {/* Any global head tags can go here, e.g., custom fonts not handled by Tailwind/globals.css, preconnects, etc. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="true" />
        {/* The Inter font import is in styles/globals.css, but preconnects are good here */}
      </Head>
      <body style={{ scrollbarGutter: 'stable' }}>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
} 