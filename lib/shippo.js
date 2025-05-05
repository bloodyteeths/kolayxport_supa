import fetch from 'node-fetch';

const SHIPPO_API_URL = 'https://api.goshippo.com/v1/orders/';

/**
 * Fetch Shippo orders.
 * @param {object} params
 * @param {string} params.token - Shippo API token
 * @param {number} [params.pageSize=100]
 * @returns {Promise<object[]>}
 */
export async function fetchShippoOrders({ token, pageSize = 100 }) {
  if (!token) throw new Error('Missing Shippo token');
  const url = `${SHIPPO_API_URL}?limit=${pageSize}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `ShippoToken ${token}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shippo API ${res.status}: ${text}`);
  }
  const json = await res.json();
  return Array.isArray(json.results) ? json.results : [];
} 