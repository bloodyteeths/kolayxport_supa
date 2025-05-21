/**
 * Trendyol API client for fetching orders for a specific user.
 * All functions require user-supplied credentials (no process.env fallback).
 * Exports fetchCreatedOrders and fetchShipmentUpdates.
 */
import fetch from 'node-fetch';

const BASE_URL = 'https://apigw.trendyol.com/integration/order/sellers';

interface TrendyolOrder {
  [key: string]: any;
}

interface FetchTrendyolOrdersParams {
  supplierId: string;
  apiKey: string;
  apiSecret: string;
  status?: string;
  startDateMs: number;
  endDateMs: number;
  pageSize?: number;
}

async function fetchTrendyolOrders({ supplierId, apiKey, apiSecret, status, startDateMs, endDateMs, pageSize = 200 }: FetchTrendyolOrdersParams): Promise<TrendyolOrder[]> {
  if (!supplierId || !apiKey || !apiSecret) {
    throw new Error('Missing Trendyol credentials');
  }
  const auth = 'Basic ' + Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  let url = `${BASE_URL}/${supplierId}/orders?`;
  if (status) url += `status=${encodeURIComponent(status)}&`;
  url += `startDate=${startDateMs}&endDate=${endDateMs}`;
  url += `&orderByField=${status === 'Created' ? 'createdDate' : 'PackageLastModifiedDate'}`;
  url += `&orderByDirection=DESC&size=${pageSize}`;

  const res = await fetch(url, { headers: { Authorization: auth }, method: 'GET' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Trendyol API ${res.status}: ${text}`);
  }
  const json = await res.json();
  return Array.isArray(json.content) ? json.content : [];
}

export function fetchCreatedOrders(params: FetchTrendyolOrdersParams) {
  return fetchTrendyolOrders({ ...params, status: 'Created' });
}

export function fetchShipmentUpdates(params: FetchTrendyolOrdersParams) {
  return fetchTrendyolOrders({ ...params, status: undefined });
} 