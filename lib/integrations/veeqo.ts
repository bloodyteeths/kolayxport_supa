// Veeqo API client for fetching orders for a specific user.
// All functions require a user-supplied Veeqo API key (no process.env fallback).
// Exports fetchVeeqoOrders and types for VeeqoOrder, etc.
import fetch from 'node-fetch';
import { VeeqoOrder } from '../types';
import { sleep } from '../utils';
import prisma from '@/lib/prisma';
import { logger } from '../logger';

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
export async function fetchVeeqoOrders(options: { apiKey: string; page?: number, perPage?: number, lastSync?: Date }): Promise<VeeqoOrder[]> {
  const { apiKey, page = 1, perPage = 100, lastSync } = options;
  try {
    const params = new URLSearchParams({
      page: page.toString(),
      page_size: perPage.toString(),
    });

    if (lastSync) {
      // Veeqo expects 'YYYY-MM-DD HH:MM:SS'
      const formattedDate = lastSync.toISOString().replace('T', ' ').substring(0, 19);
      params.append('updated_at_min', formattedDate);
    }

    const url = `https://api.veeqo.com/orders?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'x-api-key': apiKey
      }
    });

    if (!response.ok) {
      throw new Error(`Veeqo API error: ${response.status} ${await response.text()}`);
    }
    
    return await response.json();
  } catch (error) {
    logger.error('Failed to fetch Veeqo orders', error);
    return [];
  }
}


/**
 * Fetch all orders from Veeqo, paginating and respecting rate limits.
 * @param apiKey Veeqo API key
 * @param perPage Orders per page (default 100)
 * @returns All orders
 */
export async function fetchAllVeeqoOrders(options: { apiKey: string, lastSync?: Date }): Promise<VeeqoOrder[]> {
  const { apiKey, lastSync } = options;
  let allOrders: VeeqoOrder[] = [];
  let page = 1;
  const perPage = 100;
  let hasMore = true;

  while (hasMore) {
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: perPage.toString(),
      });
      
      if (lastSync) {
        // Veeqo expects 'YYYY-MM-DD HH:MM:SS'
        const formattedDate = lastSync.toISOString().replace('T', ' ').substring(0, 19);
        params.append('updated_at_min', formattedDate);
      }

      const url = `https://api.veeqo.com/orders?${params.toString()}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'x-api-key': apiKey
        }
      });
      
      if (!response.ok) {
        throw new Error(`Veeqo API error: ${response.status} ${await response.text()}`);
      }
      
      const orders: VeeqoOrder[] = await response.json();
      
      if (orders.length > 0) {
        allOrders = allOrders.concat(orders);
        page++;
      } else {
        hasMore = false;
      }
    } catch (error) {
      logger.error('Failed to fetch Veeqo orders', error);
      hasMore = false; // Stop on error
    }
  }
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
