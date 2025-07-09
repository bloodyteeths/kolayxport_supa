// Veeqo API client for fetching orders for a specific user.
// All functions require a user-supplied Veeqo API key (no process.env fallback).
// Exports fetchVeeqoOrders and types for VeeqoOrder, etc.
import fetch from 'node-fetch';
import { VeeqoOrder } from '../types';
import { sleep } from '../utils';

export type { VeeqoOrder };

const BATCH_SIZE = 10;
const BATCH_DELAY = 1000;
const TRANSACTION_TIMEOUT = 10000;

// --- Robust fetch config ---
const VEEQO_MAX_RETRIES = 7; // Allow more retries for large datasets
const VEEQO_MIN_DELAY = 1000; // ms between pages (normal)
const VEEQO_MAX_DELAY = 60000; // ms (max wait on repeated rate limits)


/**
 * Fetch a single page of orders from Veeqo for a user.
 * @param apiKey Veeqo API key (user-specific)
 * @param page Page number (default 1)
 * @param perPage Orders per page (default 100)
 */
export async function fetchVeeqoOrders({ apiKey, page = 1, perPage = 100 }: { apiKey: string; page?: number; perPage?: number }): Promise<VeeqoOrder[]> {
  if (!apiKey) throw new Error('Missing Veeqo API key');
  const url = `https://api.veeqo.com/orders?page=${page}&per_page=${perPage}&sort_direction=desc`;
  let retries = 0;
  let delay = VEEQO_MIN_DELAY;
  let lastError: any = null;

  while (retries < VEEQO_MAX_RETRIES) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'x-api-key': apiKey,
        },
      });
      if (res.status === 429) {
        // Rate limited, back off and retry
        delay = Math.min(VEEQO_MIN_DELAY * Math.pow(2, retries), VEEQO_MAX_DELAY);
        console.warn(`[Veeqo] Rate limited on page ${page}, retrying in ${delay / 1000}s (retry ${retries + 1}/${VEEQO_MAX_RETRIES})`);
        await sleep(delay);
        retries++;
        continue;
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Veeqo API ${res.status}: ${text}`);
      }
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (error) {
      lastError = error;
      delay = Math.min(VEEQO_MIN_DELAY * Math.pow(2, retries), VEEQO_MAX_DELAY);
      console.warn(`[Veeqo] Error fetching page ${page}: ${error?.message || error}. Retrying in ${delay / 1000}s (retry ${retries + 1}/${VEEQO_MAX_RETRIES})`);
      await sleep(delay);
      retries++;
    }
  }
  throw new Error(`Failed to fetch Veeqo orders for page ${page} after ${VEEQO_MAX_RETRIES} retries: ${lastError?.message || lastError}`);
}


/**
 * Fetch all orders from Veeqo, paginating and respecting rate limits.
 * @param apiKey Veeqo API key
 * @param perPage Orders per page (default 100)
 * @returns All orders
 */
export async function fetchAllVeeqoOrders({ apiKey, perPage = 10 }: { apiKey: string; perPage?: number }): Promise<VeeqoOrder[]> {
  let allOrders: VeeqoOrder[] = [];
  let page = 1;
  let totalPages = 0;
  while (true) {
    console.log(`[Veeqo] Fetching page ${page}...`);
    try {
      const orders = await fetchVeeqoOrders({ apiKey, page, perPage });
      if (!orders.length) break;
      if (page === 1) {
        // Log the first 2 raw orders for debugging
        console.log('[Veeqo] First 2 raw orders:', JSON.stringify(orders.slice(0, 2), null, 2));
      }
      allOrders = allOrders.concat(orders);
      if (orders.length < perPage) break; // Last page
      page++;
      await sleep(VEEQO_MIN_DELAY); // Normal delay between pages
    } catch (error) {
      console.error(`[Veeqo] Failed to fetch page ${page}: ${error?.message || error}`);
      // If one page fails after all retries, abort sync
      break;
    }
  }
  console.log(`[Veeqo] Fetched total ${allOrders.length} orders.`);
  return allOrders;
}


/**
 * Process orders in batches with proper error handling and retries
 */
export async function processOrdersInBatches(orders: VeeqoOrder[], processFn: (batch: VeeqoOrder[]) => Promise<void>): Promise<void> {
  const batches: VeeqoOrder[][] = [];
  for (let i = 0; i < orders.length; i += BATCH_SIZE) {
    batches.push(orders.slice(i, i + BATCH_SIZE));
  }

  console.log(`[Veeqo] Processing ${batches.length} batches of orders...`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`[Veeqo] Processing batch ${i + 1}/${batches.length} (${batch.length} orders)...`);
    
    let retries = 0;
    const maxRetries = 3;
    
    while (retries < maxRetries) {
      try {
        await processFn(batch);
        break;
      } catch (error) {
        retries++;
        if (retries >= maxRetries) {
          console.error(`[Veeqo] Failed to process batch ${i + 1} after ${maxRetries} retries:`, error);
          throw error;
        }
        console.warn(`[Veeqo] Error processing batch ${i + 1}, retrying (${retries}/${maxRetries})...`);
        await sleep(2000 * retries);
      }
    }
    
    if (i < batches.length - 1) {
      await sleep(BATCH_DELAY);
    }
  }
}
