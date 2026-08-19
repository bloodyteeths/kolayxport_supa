import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import trMessages from '../messages/tr.json';
import HomeContent from '../components/marketing/HomeContent';

// Route-locked Turkish homepage. The nested provider overrides the app-level
// locale (which follows localStorage) so `/` always prerenders and renders
// Turkish, including PublicNav/PublicFooter. English lives at /en.
export default function HomePage() {
  return (
    <NextIntlClientProvider locale="tr" messages={trMessages} timeZone="Europe/Istanbul">
      <HomeContent locale="tr" />
    </NextIntlClientProvider>
  );
}
