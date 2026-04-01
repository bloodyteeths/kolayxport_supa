/**
 * KolayXport Research — Cache Module
 * chrome.storage.local with TTL, LRU eviction, stale-while-revalidate
 */

const CACHE_PREFIX = 'kx_cache_';
const CACHE_INDEX_KEY = 'kx_cache_index';
const MAX_CACHE_SIZE = 5 * 1024 * 1024; // 5MB budget

// TTL values in milliseconds
const TTL = {
  search: 30 * 60 * 1000,     // 30 minutes
  listing: 60 * 60 * 1000,     // 1 hour
  shop: 24 * 60 * 60 * 1000,   // 24 hours
  trends: 6 * 60 * 60 * 1000,  // 6 hours
};

// ---------------------------------------------------------------------------
// Core cache operations
// ---------------------------------------------------------------------------

async function getCacheIndex() {
  const result = await chrome.storage.local.get(CACHE_INDEX_KEY);
  return result[CACHE_INDEX_KEY] || {};
}

async function setCacheIndex(index) {
  await chrome.storage.local.set({ [CACHE_INDEX_KEY]: index });
}

/**
 * Get cached data. Returns { data, stale } or null.
 * stale=true means data exists but TTL expired (usable for stale-while-revalidate).
 */
async function cacheGet(key) {
  const fullKey = CACHE_PREFIX + key;
  const result = await chrome.storage.local.get(fullKey);
  const entry = result[fullKey];

  if (!entry) return null;

  const now = Date.now();
  const stale = now > entry.expiresAt;

  // Update access time for LRU
  const index = await getCacheIndex();
  if (index[key]) {
    index[key].lastAccess = now;
    await setCacheIndex(index);
  }

  return { data: entry.data, stale };
}

/**
 * Set cached data with TTL.
 * @param {string} key - Cache key (e.g., "search:baby blanket")
 * @param {any} data - Data to cache
 * @param {string} type - TTL type: 'search', 'listing', 'shop', 'trends'
 */
async function cacheSet(key, data, type = 'search') {
  const fullKey = CACHE_PREFIX + key;
  const ttl = TTL[type] || TTL.search;
  const now = Date.now();

  const entry = {
    data,
    createdAt: now,
    expiresAt: now + ttl,
  };

  // Estimate size
  const size = JSON.stringify(entry).length;

  // Update index
  const index = await getCacheIndex();
  index[key] = { fullKey, size, lastAccess: now, type };
  await setCacheIndex(index);

  // Store
  await chrome.storage.local.set({ [fullKey]: entry });

  // Check total size and evict if needed
  await evictIfNeeded(index);
}

/**
 * Remove a cache entry
 */
async function cacheRemove(key) {
  const fullKey = CACHE_PREFIX + key;
  await chrome.storage.local.remove(fullKey);
  const index = await getCacheIndex();
  delete index[key];
  await setCacheIndex(index);
}

/**
 * Clear all research cache
 */
async function cacheClear() {
  const index = await getCacheIndex();
  const keys = Object.values(index).map(e => e.fullKey);
  if (keys.length > 0) {
    await chrome.storage.local.remove(keys);
  }
  await chrome.storage.local.remove(CACHE_INDEX_KEY);
}

// ---------------------------------------------------------------------------
// LRU Eviction
// ---------------------------------------------------------------------------

async function evictIfNeeded(index) {
  const totalSize = Object.values(index).reduce((sum, e) => sum + (e.size || 0), 0);

  if (totalSize <= MAX_CACHE_SIZE) return;

  // Sort by last access (oldest first)
  const entries = Object.entries(index).sort(([, a], [, b]) => a.lastAccess - b.lastAccess);

  let currentSize = totalSize;
  const toRemove = [];

  for (const [key, entry] of entries) {
    if (currentSize <= MAX_CACHE_SIZE * 0.8) break; // Evict to 80% capacity
    toRemove.push(entry.fullKey);
    delete index[key];
    currentSize -= entry.size || 0;
  }

  if (toRemove.length > 0) {
    await chrome.storage.local.remove(toRemove);
    await setCacheIndex(index);
    console.log(`[KX Cache] Evicted ${toRemove.length} entries, freed ${totalSize - currentSize} bytes`);
  }
}

// ---------------------------------------------------------------------------
// Prune expired entries (called periodically)
// ---------------------------------------------------------------------------

async function pruneExpired() {
  const index = await getCacheIndex();
  const now = Date.now();
  const toRemove = [];

  for (const [key, entry] of Object.entries(index)) {
    const result = await chrome.storage.local.get(entry.fullKey);
    const cached = result[entry.fullKey];
    if (!cached || now > cached.expiresAt + 3600000) { // 1 hour grace period
      toRemove.push(entry.fullKey);
      delete index[key];
    }
  }

  if (toRemove.length > 0) {
    await chrome.storage.local.remove(toRemove);
    await setCacheIndex(index);
  }
}

// ---------------------------------------------------------------------------
// Stale-while-revalidate helper
// ---------------------------------------------------------------------------

/**
 * Get data from cache or fetch. If stale, returns stale data and refreshes in background.
 * @param {string} key - Cache key
 * @param {string} type - Cache type for TTL
 * @param {Function} fetcher - Async function to fetch fresh data
 * @returns {Promise<any>} - Data (possibly stale)
 */
async function getOrFetch(key, type, fetcher) {
  const cached = await cacheGet(key);

  if (cached && !cached.stale) {
    return cached.data;
  }

  if (cached && cached.stale) {
    // Return stale data immediately, refresh in background
    fetcher().then(freshData => {
      if (freshData) cacheSet(key, freshData, type);
    }).catch(() => {}); // Silently fail background refresh
    return cached.data;
  }

  // No cache — must fetch
  const data = await fetcher();
  if (data) await cacheSet(key, data, type);
  return data;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
window.__KX_CACHE = {
  get: cacheGet,
  set: cacheSet,
  remove: cacheRemove,
  clear: cacheClear,
  pruneExpired,
  getOrFetch,
  TTL,
};
