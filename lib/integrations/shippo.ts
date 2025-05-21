/**
 * Shippo API client for fetching and mapping orders for a specific user.
 * All functions require a user-supplied Shippo token (no process.env fallback).
 * Exports fetchShippoOrders and types for ShippoOrder, ShippoAddress, etc.
 */
import fetch from 'node-fetch';

export interface ShippoAddress {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string | null;
  email: string | null;
}

export interface ShippoLineItem {
  object_id: string;
  title: string;
  quantity: number;
  total_price: string;
  currency: string;
  weight: string;
  sku: string | null;
}

export interface ShippoOrder {
  object_id: string;
  order_status: string;
  placed_at: string;
  total_price: string;
  currency: string;
  shipping_address: ShippoAddress;
  billing_address: ShippoAddress;
  line_items: ShippoLineItem[];
  metadata?: { notes?: string };
  order_number?: string;
  [key: string]: any;
}

interface ShippoResponse {
  results: ShippoOrder[];
  count: number;
  has_more: boolean;
  next?: string | null;
}

/**
 * Fetch all Shippo orders for a user, handling pagination.
 * @param token Shippo API token (user-specific)
 * @param params Optional query params
 */
export async function fetchShippoOrders(
  token: string,
  params: Record<string, string> = {}
): Promise<ShippoOrder[]> {
  if (!token) throw new Error('Missing Shippo token');
  const base = new URL('https://api.goshippo.com/v1/orders/');
  Object.entries(params).forEach(([k, v]) => base.searchParams.append(k, v));
  const headers = { Authorization: `ShippoToken ${token}` };
  const all: ShippoOrder[] = [];
  let nextUrl: string | null = base.toString();
  while (nextUrl) {
    const res = await fetch(nextUrl, { headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shippo fetch error HTTP ${res.status}: ${text}`);
    }
    const json = (await res.json()) as ShippoResponse;
    all.push(...json.results);
    nextUrl = json.next || null;
  }
  return all;
}
