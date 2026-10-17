// Company identity shown on the site, legal pages and in structured data.
// Source and status of every field: docs/gtm/company.md. `null` = not verified yet → not rendered.
export const COMPANY = {
  brand: 'KolayXport',
  legalName: 'MODSONS YAZILIM E-TİCARET İTHALAT İHRACAT LİMİTED ŞİRKETİ',
  shortName: 'Modsons Yazılım E-Ticaret İthalat İhracat Ltd. Şti.',
  address: {
    street: 'Beyazevler Mah. 80053 Sok. Tanrıkulu Apt. No:8 İç Kapı No:02',
    district: 'Çukurova',
    city: 'Adana',
    postalCode: '01170',
    country: 'TR',
  },
  taxNumber: '6222605496',
  taxOffice: null as string | null, // TODO(owner): vergi dairesi
  tradeRegistry: 'Adana Ticaret Odası, sicil no 100129',
  mersis: null as string | null, // TODO(owner): MERSİS no
  kep: null as string | null, // TODO(owner): KEP adresi
  foundingDate: '2025-09-09',
  email: 'destek@kolayxport.com',
  /** WhatsApp Business, E.164 without "+". NEXT_PUBLIC_WHATSAPP_NUMBER overrides it. */
  whatsapp: (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '905425683362').replace(/\D/g, '') || null,
  phone: null as string | null,
  /** Only accounts that exist. Empty = nothing rendered (no dead social links). */
  social: {
    instagram: process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM || null,
    x: process.env.NEXT_PUBLIC_SOCIAL_X || null,
    youtube: process.env.NEXT_PUBLIC_SOCIAL_YOUTUBE || null,
    linkedin: process.env.NEXT_PUBLIC_SOCIAL_LINKEDIN || null,
    facebook: process.env.NEXT_PUBLIC_SOCIAL_FACEBOOK || null,
    tiktok: process.env.NEXT_PUBLIC_SOCIAL_TIKTOK || null,
  },
} as const;

export const SITE_URL = 'https://kolayxport.com';

export function addressLine(): string {
  const a = COMPANY.address;
  return `${a.street}, ${a.postalCode} ${a.district} / ${a.city}`;
}
