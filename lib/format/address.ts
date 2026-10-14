/**
 * Address formatting for "copy address" actions.
 *
 * Accepts every address shape that exists in the app:
 *  - UIOrder.to_address (lib/types.ts): name, phone, street1, street2, city, state, postal, country
 *  - OrderShipping (prisma): firstName, lastName, company, street1, street2, city, state, postalCode, countryCode, phone
 *  - Order.shippingAddress Json (prisma): recipient* fields, zip/postcode/province, or { fullAddress }
 *  - Trendyol shipmentAddress: fullName, address1, address2, neighborhood, district, city, postalCode, countryCode
 *  - Etsy address display: line1, line2, city, state, postalCode
 * Also accepts a plain string (returned trimmed) or a JSON string of any of the above.
 */

export interface CopyableAddress {
  name?: string | null;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  recipientFirstName?: string | null;
  recipientLastName?: string | null;
  company?: string | null;
  street1?: string | null;
  street2?: string | null;
  address1?: string | null;
  address2?: string | null;
  line1?: string | null;
  line2?: string | null;
  recipientStreet1?: string | null;
  recipientStreet2?: string | null;
  neighborhood?: string | null;
  district?: string | null;
  city?: string | null;
  recipientCity?: string | null;
  state?: string | null;
  stateName?: string | null;
  province?: string | null;
  recipientState?: string | null;
  postal?: string | null;
  postalCode?: string | null;
  zip?: string | null;
  postcode?: string | null;
  recipientPostal?: string | null;
  country?: string | null;
  countryCode?: string | null;
  recipientCountry?: string | null;
  phone?: string | null;
  recipientPhone?: string | null;
  email?: string | null;
  fullAddress?: string | null;
  [key: string]: unknown;
}

export interface NormalizedAddress {
  name: string;
  company: string;
  street1: string;
  street2: string;
  neighborhood: string;
  district: string;
  city: string;
  state: string;
  postal: string;
  country: string;
  phone: string;
  email: string;
  fullAddress: string;
}

export type AddressCopyStyle = 'intl' | 'tr';

export interface FormatAddressOptions {
  /** Append the phone number as the last line. Default false. */
  includePhone?: boolean;
  /** Append the email as the last line. Default false. */
  includeEmail?: boolean;
  /** Override the name line (e.g. order.customerName when the address has none). */
  name?: string | null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const first = (...vals: unknown[]): string => {
  for (const v of vals) {
    const s = str(v);
    if (s) return s;
  }
  return '';
};

export function normalizeAddress(input: CopyableAddress | string | null | undefined): NormalizedAddress {
  let a: CopyableAddress = {};
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith('{')) {
      try {
        a = JSON.parse(trimmed) || {};
      } catch {
        a = { fullAddress: trimmed };
      }
    } else {
      a = { fullAddress: trimmed };
    }
  } else if (input && typeof input === 'object') {
    a = input;
  }

  const joinedName = [first(a.firstName, a.recipientFirstName), first(a.lastName, a.recipientLastName)]
    .filter(Boolean)
    .join(' ');

  return {
    name: first(a.name, a.fullName, joinedName),
    company: first(a.company),
    street1: first(a.street1, a.address1, a.line1, a.recipientStreet1),
    street2: first(a.street2, a.address2, a.line2, a.recipientStreet2),
    neighborhood: first(a.neighborhood),
    district: first(a.district),
    city: first(a.city, a.recipientCity),
    state: first(a.state, a.stateName, a.province, a.recipientState),
    postal: first(a.postal, a.postalCode, a.zip, a.postcode, a.recipientPostal),
    country: first(a.country, a.countryCode, a.recipientCountry),
    phone: first(a.phone, a.recipientPhone),
    email: first(a.email),
    fullAddress: first(a.fullAddress),
  };
}

const isTurkey = (country: string) => /^(tr|tur|turkey|türkiye|turkiye)$/i.test(country.trim());

/** Avoid "Kadıköy / Kadıköy" when the state field just repeats the city. */
const sameText = (x: string, y: string) => x.localeCompare(y, 'tr', { sensitivity: 'base' }) === 0;

/**
 * Format an address as multi-line text for the clipboard.
 *
 * intl:
 *   Name
 *   Company
 *   Street 1
 *   Street 2
 *   City, State Zip
 *   Country
 *
 * tr:
 *   Ad Soyad
 *   Firma
 *   Mahalle Sokak / cadde, no
 *   Adres satırı 2
 *   İlçe / İl
 *   Posta kodu
 *   Ülke (only when not Türkiye)
 */
export function formatAddressForCopy(
  address: CopyableAddress | string | null | undefined,
  style: AddressCopyStyle = 'intl',
  options: FormatAddressOptions = {}
): string {
  const n = normalizeAddress(address);
  const name = first(options.name, n.name);

  // Nothing structured but a free-text address — use it as-is.
  if (!n.street1 && !n.city && n.fullAddress) {
    return [name && !n.fullAddress.includes(name) ? name : '', n.fullAddress, ...tail(n, options)]
      .filter(Boolean)
      .join('\n');
  }

  const lines: string[] = [];
  if (style === 'tr') {
    const street = [n.neighborhood, n.street1].filter(Boolean);
    // Trendyol's address1 often already contains the neighborhood.
    const streetLine =
      n.neighborhood && n.street1.toLocaleLowerCase('tr').includes(n.neighborhood.toLocaleLowerCase('tr'))
        ? n.street1
        : street.join(' ');
    const ilce = n.district || (n.state && n.city && !sameText(n.state, n.city) ? n.state : '');
    lines.push(
      name,
      n.company,
      streetLine,
      n.street2,
      [ilce, n.city].filter(Boolean).join(' / '),
      n.postal,
      n.country && !isTurkey(n.country) ? n.country : ''
    );
  } else {
    const cityLine = [n.city, [n.state, n.postal].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    lines.push(name, n.company, n.street1, n.street2, cityLine, n.country);
  }
  return [...lines, ...tail(n, options)].filter(Boolean).join('\n');
}

function tail(n: NormalizedAddress, options: FormatAddressOptions): string[] {
  return [options.includePhone ? n.phone : '', options.includeEmail ? n.email : ''];
}

/** Pick the copy style for an address: 'tr' for Turkish addresses, 'intl' otherwise. */
export function defaultAddressStyle(address: CopyableAddress | string | null | undefined): AddressCopyStyle {
  const n = normalizeAddress(address);
  return n.country && isTurkey(n.country) ? 'tr' : 'intl';
}
