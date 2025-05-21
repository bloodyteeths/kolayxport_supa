// Veeqo API client for fetching orders for a specific user.
// All functions require a user-supplied Veeqo API key (no process.env fallback).
// Exports fetchVeeqoOrders and types for VeeqoOrder, etc.
import fetch from 'node-fetch';

export interface VeeqoOrder {
  id: string | number;
  deliver_to?: { first_name?: string; last_name?: string };
  currency_code?: string;
  total_price?: number;
  [key: string]: any;
}

/**
 * Fetch orders from Veeqo for a user.
 * @param apiKey Veeqo API key (user-specific)
 * @param page Page number (default 1)
 * @param perPage Orders per page (default 250)
 */
export async function fetchVeeqoOrders({ apiKey, page = 1, perPage = 250 }: { apiKey: string; page?: number; perPage?: number }): Promise<VeeqoOrder[]> {
  if (!apiKey) throw new Error('Missing Veeqo API key');
  const url = `https://api.veeqo.com/orders?page=${page}&per_page=${perPage}&sort_direction=desc`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'x-api-key': apiKey,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Veeqo API ${res.status}: ${text}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}
