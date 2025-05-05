import fetch from 'node-fetch';

const API_BASE = 'https://api.veeqo.com';

/**
 * Fetch orders from Veeqo.
 * @param {object} options
 * @param {string} options.apiKey - Veeqo API key
 * @param {number} [options.page=1]
 * @param {number} [options.perPage=250]
 * @returns {Promise<object[]>} Array of order objects
 */
export async function fetchVeeqoOrders({ apiKey, page = 1, perPage = 250 }) {
  if (!apiKey) throw new Error('Missing Veeqo API key');
  const url = `${API_BASE}/orders?page=${page}&per_page=${perPage}&sort_direction=desc`;
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