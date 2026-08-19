import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../messages/en.json';
import HomeContent from '../components/marketing/HomeContent';

// Route-locked English homepage — same sections as / via HomeContent.
export default function HomePageEN() {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Europe/Istanbul">
      <HomeContent locale="en" />
    </NextIntlClientProvider>
  );
}
