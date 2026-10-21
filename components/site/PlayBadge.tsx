// Official "Get it on Google Play" badge (artwork from Google's badge generator, unmodified) linking to the
// Android app. Hidden inside the Play (TWA) app itself, where it would point at the app the user is already in.
import { useTranslations } from 'next-intl';
import type { SiteLocale } from '@/lib/site/routes';
import { usePlayClient } from '@/lib/billing/usePlayClient';
import { track } from '@/lib/tracking/events';

export const PLAY_STORE_ID = 'com.kolayxport.app';

/** Play listing URL; `placement` lands in the install referrer so Play Console can attribute installs. */
export function playStoreUrl(placement: string): string {
  const referrer = `utm_source=kolayxport_site&utm_medium=badge&utm_campaign=play_launch&utm_content=${placement}`;
  return `https://play.google.com/store/apps/details?id=${PLAY_STORE_ID}&referrer=${encodeURIComponent(referrer)}`;
}

export default function PlayBadge({ locale, placement, height = 56, className = '' }: { locale: SiteLocale; placement: string; height?: number; className?: string }) {
  const t = useTranslations('site.common');
  const play = usePlayClient();
  if (play) return null;
  const src = locale === 'en' ? '/brand/google-play/google-play-badge-en.png' : '/brand/google-play/google-play-badge-tr.png';
  // The artwork is 646×250 and includes Google's required clear space around the badge.
  const width = Math.round((height * 646) / 250);
  return (
    <a
      href={playStoreUrl(placement)}
      target="_blank"
      rel="noopener"
      className={`inline-block ${className}`}
      onClick={() => track('cta_click', { label: 'play_badge', placement })}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={t('playBadgeAlt')} width={width} height={height} loading="lazy" style={{ height, width: 'auto' }} />
    </a>
  );
}
