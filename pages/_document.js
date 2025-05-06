import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="tr"> {/* You can set a default language if desired */}
      <Head>
        {/* Any global head tags can go here, e.g., custom fonts not handled by Tailwind/globals.css, preconnects, etc. */}
      </Head>
      <body style={{ scrollbarGutter: 'stable' }}>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
} 