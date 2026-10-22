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
  /** WhatsApp support (founder, 2026-10-22), E.164 without "+". NEXT_PUBLIC_WHATSAPP_NUMBER overrides it. */
  whatsapp: (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '905335010211').replace(/\D/g, '') || null,
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

/** "+90 533 501 02 11" for display. */
export function whatsappDisplay(): string | null {
  const n = COMPANY.whatsapp;
  if (!n) return null;
  const m = n.match(/^90(\d{3})(\d{3})(\d{2})(\d{2})$/);
  return m ? `+90 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : `+${n}`;
}

/** Click-to-chat link (wa.me) with an optional pre-filled first message; null when no number is configured. */
export function whatsappUrl(text?: string): string | null {
  if (!COMPANY.whatsapp) return null;
  return `https://wa.me/${COMPANY.whatsapp}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
