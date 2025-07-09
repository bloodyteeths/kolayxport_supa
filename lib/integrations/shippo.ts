/**
 * Shippo API client for fetching and mapping orders for a specific user.
 * All functions require a user-supplied Shippo token (no process.env fallback).
 * Exports fetchShippoOrders and types for ShippoOrder, ShippoAddress, etc.
 */
import fetch from 'node-fetch';
import { sleep } from '../utils'; // Fix: Import sleep utility as in veeqo.ts

// --- Robust fetch config ---
const SHIPPO_MAX_RETRIES = 7; // Allow more retries for large datasets
const SHIPPO_MIN_DELAY = 1000; // ms between pages (normal)
const SHIPPO_MAX_DELAY = 60000; // ms (max wait on repeated rate limits)


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
  let page = 1;
  while (nextUrl) {
    let retries = 0;
    let delay = SHIPPO_MIN_DELAY;
    let lastError: any = null;
    while (retries < SHIPPO_MAX_RETRIES) {
      try {
        // Fix: nextUrl is always a string here; the while condition ensures it
        const res = await fetch(nextUrl as string, { headers });
        if (res.status === 429) {
          delay = Math.min(SHIPPO_MIN_DELAY * Math.pow(2, retries), SHIPPO_MAX_DELAY);
          console.warn(`[Shippo] Rate limited on page ${page}, retrying in ${delay / 1000}s (retry ${retries + 1}/${SHIPPO_MAX_RETRIES})`);
          await sleep(delay);
          retries++;
          continue;
        }
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Shippo fetch error HTTP ${res.status}: ${text}`);
        }
        const json = (await res.json()) as ShippoResponse;
        all.push(...json.results);
        nextUrl = json.next || null;
        break; // Success, break retry loop
      } catch (error) {
        lastError = error;
        delay = Math.min(SHIPPO_MIN_DELAY * Math.pow(2, retries), SHIPPO_MAX_DELAY);
        console.warn(`[Shippo] Error fetching page ${page}: ${error?.message || error}. Retrying in ${delay / 1000}s (retry ${retries + 1}/${SHIPPO_MAX_RETRIES})`);
        await sleep(delay);
        retries++;
        if (retries >= SHIPPO_MAX_RETRIES) {
          console.error(`[Shippo] Failed to fetch page ${page} after ${SHIPPO_MAX_RETRIES} retries: ${lastError?.message || lastError}`);
          // Give up on this page, abort sync
          nextUrl = null;
        }
      }
    }
    page++;
  }
  return all;
}

