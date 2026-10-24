// Product videos on the how-to hub (/nasil-kullanirim, /en/nasil-kullanirim). Labels: messages site.help.videos.items.<key>.
// Self-hosted under /media/demos/<file>.mp4 (+ .jpg poster) until a YouTube id is set, then embedded via youtube-nocookie.
import type { SiteLocale } from './routes';

export interface HowtoVideo {
  key: string;
  /** Per-locale file in /public/media/demos (no extension). A locale without a file doesn't show the video. */
  file: Partial<Record<SiteLocale, string>>;
  /** Per-locale YouTube id; when set it replaces the local file. */
  youtube?: Partial<Record<SiteLocale, string>>;
  /** 'wide' = 16:9 demo, 'tall' = 9:16 short. */
  shape: 'wide' | 'tall';
  /** Related how-to guide slug (content/<locale>/guides), linked when it exists in that locale. */
  guide?: string;
}

export const HOWTO_VIDEOS: HowtoVideo[] = [
  { key: 'editorSixJobs', file: { tr: 'etsy-editor-6-jobs-tr', en: 'etsy-editor-6-jobs-en' }, shape: 'wide', guide: 'toplu-duzenleme' },
  { key: 'trendyolEstimates', file: { tr: 'ozellik-1-trendyol-tahmini-satis' }, shape: 'tall' },
  { key: 'etsyBulkShort', file: { tr: 'ozellik-2-etsy-toplu-duzenleme' }, shape: 'tall', guide: 'toplu-duzenleme' },
];
