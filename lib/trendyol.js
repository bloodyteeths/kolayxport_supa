import fetch from 'node-fetch';

const BASE_URL = 'https://apigw.trendyol.com/integration/order/sellers';

/**
 * Fetch Trendyol orders by status.
 * @param {object} params
 * @param {string} params.supplierId
 * @param {string} params.apiKey
 * @param {string} params.apiSecret
 * @param {string} params.status - 'Created' or undefined for shipments
 * @param {number} params.startDateMs - timestamp in ms
 * @param {number} params.endDateMs - timestamp in ms
 * @param {number} [params.pageSize=200]
 * @returns {Promise<object[]>}
 */
async function fetchTrendyolOrders({ supplierId, apiKey, apiSecret, status, startDateMs, endDateMs, pageSize = 200 }) {
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

/**
 * Fetch newly created orders from Trendyol.
 */
export function fetchCreatedOrders(params) {
  return fetchTrendyolOrders({ ...params, status: 'Created' });
}

/**
 * Fetch order shipment updates from Trendyol.
 */
export function fetchShipmentUpdates(params) {
  return fetchTrendyolOrders({ ...params, status: undefined });
} 