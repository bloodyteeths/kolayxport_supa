// ---------------------------------------------------------------------------
// MNG Kargo (DHL eCommerce Turkey) — Configuration & Options
// ---------------------------------------------------------------------------

export interface MngOption {
  value: number | string;
  label: string;
}

// ─── API Endpoints ──────────────────────────────────────────────────────────

export const MNG_ENDPOINTS = {
  production: {
    base: 'https://api.mngkargo.com.tr/mngapi/api',
    token: 'https://api.mngkargo.com.tr/mngapi/api/token',
  },
  test: {
    base: 'https://testapi.mngkargo.com.tr/mngapi/api',
    token: 'https://testapi.mngkargo.com.tr/mngapi/api/token',
  },
} as const;

export function getMngEndpoints(environment: 'test' | 'production' = 'test') {
  return MNG_ENDPOINTS[environment];
}

// ─── Shipment Service Types ─────────────────────────────────────────────────

export const MNG_SERVICE_TYPES: MngOption[] = [
  { value: 1, label: 'Standart Teslimat' },
  { value: 2, label: 'Ekspres Teslimat' },
  { value: 3, label: 'Aynı Gün Teslimat' },
];

// ─── Payment Types ──────────────────────────────────────────────────────────

export const MNG_PAYMENT_TYPES: MngOption[] = [
  { value: 1, label: 'Gönderici Öder' },
  { value: 2, label: 'Alıcı Öder' },
];

// ─── Delivery Types ─────────────────────────────────────────────────────────

export const MNG_DELIVERY_TYPES: MngOption[] = [
  { value: 1, label: 'Adrese Teslim' },
  { value: 2, label: 'Şubeye Teslim' },
];

// ─── Packaging Types ────────────────────────────────────────────────────────

export const MNG_PACKAGING_TYPES: MngOption[] = [
  { value: 1, label: 'Koli / Paket' },
  { value: 2, label: 'Zarf / Dosya' },
  { value: 3, label: 'Mi' },
];

// ─── All Options Export ─────────────────────────────────────────────────────

export const mngOptionsData = {
  serviceTypes: MNG_SERVICE_TYPES,
  paymentTypes: MNG_PAYMENT_TYPES,
  deliveryTypes: MNG_DELIVERY_TYPES,
  packagingTypes: MNG_PACKAGING_TYPES,
};
