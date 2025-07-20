/**
 * Shippo API client for fetching and mapping orders for a specific user.
 * All functions require a user-supplied Shippo token (no process.env fallback).
 */
import fetch from 'node-fetch';
import { ShippoOrder, ShippoResponse } from '../types';

/**
 * Fetches orders from the Shippo API. Supports fetching all orders via pagination.
 * @param token Shippo API token
 * @param options Options like page number and results per page
 * @returns An array of Shippo orders
 */
export async function fetchShippoOrders(
  token: string,
  options: { page?: string; results?: string; object_created_gte?: string } = {}
): Promise<ShippoOrder[]> {
  const allOrders: ShippoOrder[] = [];
  let currentPage = parseInt(options.page || '1', 10);
  let hasMore = true;

  while (hasMore) {
    let url = `https://api.goshippo.com/orders/?page=${currentPage}&results=${options.results || '100'}`;
    
    // Add date filter if provided - try multiple possible parameter names
    if (options.object_created_gte) {
      // Try common date filter parameters for Shippo API
      url += `&object_created_gte=${encodeURIComponent(options.object_created_gte)}`;
      // Also try alternative parameter names that might work
      url += `&created_at_min=${encodeURIComponent(options.object_created_gte)}`;
      url += `&start_date=${encodeURIComponent(options.object_created_gte)}`;
    }
    
    // Debug log the URL being called
    console.log(`[SHIPPO DEBUG] Fetching URL: ${url}`);
    
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `ShippoToken ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Shippo API Error: ${response.status} ${await response.text()}`);
      }

      const data: ShippoResponse = await response.json();
      if (data.results && data.results.length > 0) {
        allOrders.push(...data.results);
        currentPage++;
      } else {
        hasMore = false;
      }
      
      // If we are not fetching all pages (i.e., a page was specified in options), break after the first loop.
      if (options.page) {
        hasMore = false;
      }

    } catch (error) {
      console.error('Failed to fetch Shippo orders:', error);
      hasMore = false; // Stop on any error
    }
  }

  return allOrders;
}

