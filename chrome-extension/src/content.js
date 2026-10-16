/* Kolayxport Etsy Address Enrichment – v3.3
 * Multi-store support: Distinguishes between multiple Etsy stores per user
 * Extracts order number, shipping address, customization notes, and store info
 * Works with Veeqo data to enrich orders with missing address information
 * Complements existing Veeqo integration for complete order data
 */

const EXT_VERSION = (function() {
  try { return chrome.runtime.getManifest().version; } catch (e) { return ''; }
})();
const STORAGE_KEY = 'kx_synced_orders';
const EMAIL_SYNC_KEY = 'kx_synced_emails';
const MAX_STORED_IDS = 5000;

// Keys that may carry buyer PII or raw page markup — never persisted to kx_logs.
const PII_KEY_RE = /name|line1|line2|address|email|city|state|postal|zip|country|html|phone|tracking|notes|personali/i;

function redactForLog(value, depth) {
  depth = depth || 0;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 200 ? value.slice(0, 200) + '…' : value;
  if (typeof value !== 'object') return value;
  if (depth > 2) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 10).map(function(v) { return redactForLog(v, depth + 1); });
  var out = {};
  Object.keys(value).forEach(function(k) {
    out[k] = PII_KEY_RE.test(k) ? '[redacted]' : redactForLog(value[k], depth + 1);
  });
  return out;
}

// Local diagnostic log (chrome.storage.local, last 100 entries). Redacted: no
// addresses, emails, buyer names, tracking numbers or raw HTML are stored.
const log = {
  messages: [],
  add: function(level, message, data) {
    let safeData = null;
    if (data !== null && data !== undefined) {
      try {
        safeData = redactForLog(JSON.parse(JSON.stringify(data)));
      } catch (e) {
        safeData = null;
      }
    }
    this.messages.push({ timestamp: new Date().toISOString(), level: level, message: message, data: safeData });
    if (this.messages.length > 100) this.messages = this.messages.slice(-100);
    try {
      chrome.storage.local.set({ 'kx_logs': this.messages });
    } catch (e) {
      // storage unavailable (context invalidated)
    }
  },
  info: function(message, data) { this.add('info', message, data); },
  success: function(message, data) { this.add('success', message, data); },
  error: function(message, data) { this.add('error', message, data); },
  warn: function(message, data) { this.add('warn', message, data); }
};

// Safe wrapper for chrome.runtime.sendMessage — handles "context invalidated"
function safeSendMessage(msg) {
  try {
    if (!chrome.runtime || !chrome.runtime.id) {
      log.warn('Extension context invalidated');
      return Promise.resolve(null);
    }
    return chrome.runtime.sendMessage(msg).catch(function(e) {
      return null;
    });
  } catch (e) {
    return Promise.resolve(null);
  }
}

log.info('KolayXport Etsy order helper v' + EXT_VERSION + ' loading', { path: window.location.pathname });

// Extract store information from current page
function getEtsyStoreInfo() {
  const url = window.location.href;
  
  // Extract shop ID from URL patterns like:
  // https://www.etsy.com/your/shops/12345/orders
  // https://www.etsy.com/your/shops/12345/tools/listings/orders
  const shopIdMatch = url.match(/\/shops\/(\d+)\//);
  const shopId = shopIdMatch ? shopIdMatch[1] : null;
  
  // Try to get store name from sidebar Sales channels section
  let storeName = null;
  
  // Look for the Etsy store name in the sidebar
  const etsyChannelLink = document.querySelector('a[href*="/shop/"] [data-test-id="unsanitize"]');
  if (etsyChannelLink) {
    storeName = etsyChannelLink.textContent?.trim();
    log.info('Found store name from sidebar Etsy channel', { storeName });
  }
  
  // Fallback: try other selectors
  if (!storeName) {
    const storeNameSelectors = [
      '[data-test-id="shop-name"]',
      '.shop-name',
      'h1 a[href*="/shop/"]',
      '[aria-label*="shop"]'
    ];
    
    for (const selector of storeNameSelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent?.trim()) {
        storeName = element.textContent.trim();
        break;
      }
    }
  }
  
  // Final fallback: extract from URL or title
  if (!storeName) {
    // Try to extract from shop URL if present in href
    const shopLink = document.querySelector('a[href*="/shop/"]');
    if (shopLink) {
      const hrefMatch = shopLink.href.match(/\/shop\/([^/?]+)/);
      if (hrefMatch) {
        storeName = hrefMatch[1];
      }
    }
    
    // Last resort: use page title
    if (!storeName) {
      const title = document.title;
      const titleMatch = title.match(/^([^|]+)/);
      if (titleMatch) {
        storeName = titleMatch[1].trim();
      }
    }
  }
  
  log.info('Detected Etsy store info', { shopId, storeName });
  
  return { shopId, storeName };
}

// Utility – push in batches and dedupe with chrome.storage.local
const pushBatch = async batch => {
  if (!batch.length) {
    log.info('No orders to sync');
    return;
  }
  
  log.info(`Attempting to sync ${batch.length} orders`);
  
  try {
    log.info('Preparing to sync orders', { orderCount: batch.length });
    
    // Use background script to make the API call (avoids CORS issues)
    log.info('Sending sync request via background script');
    const response = await safeSendMessage({
      action: 'syncOrders',
      orders: batch,
      source: 'chrome-extension-v' + EXT_VERSION + '-multistore',
      timestamp: new Date().toISOString()
    });
    if (!response) {
      log.error('Sync failed: extension not connected. Visit kolayxport.com to re-authenticate.');
      return;
    }
    
    if (response.success) {
      const result = response.result;
      log.success(`Successfully synced ${batch.length} orders`);
      
      // Update synced orders storage with timestamp for TTL
      const syncedData = (await chrome.storage.local.get({ [STORAGE_KEY]: {} }))[STORAGE_KEY];
      // Migrate from old array format to object format {orderNumber: timestamp}
      var syncedMap = (typeof syncedData === 'object' && !Array.isArray(syncedData)) ? syncedData : {};
      var now = Date.now();
      batch.forEach(function(o) { if (o.orderNumber) syncedMap[o.orderNumber] = now; });
      // Prune entries older than 24 hours and keep max entries
      var pruned = {};
      var keys = Object.keys(syncedMap).slice(-MAX_STORED_IDS);
      keys.forEach(function(k) {
        if (now - syncedMap[k] < 24 * 60 * 60 * 1000) pruned[k] = syncedMap[k];
      });
      await chrome.storage.local.set({ [STORAGE_KEY]: pruned });
      
      // Notify background script
      safeSendMessage({
        action: 'syncComplete',
        count: batch.length,
        totalSynced: Object.keys(pruned).length
      });
      
    } else {
      log.error(`Sync failed via background script`, { error: response.error });
    }
  } catch (err) {
    log.error("Sync failed", { message: err.message });
  }
};

// Parse address from a text block (handles multi-line or comma-separated addresses)
function parseAddressText(text, fallbackName = '') {
  const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
  const addr = { name: '', line1: '', line2: '', city: '', state: '', postalCode: '', country: '' };

  if (lines.length >= 4) {
    addr.name = lines[0];
    addr.line1 = lines[1];
    // Last line is usually country, second-to-last is "City, ST ZIP"
    const lastLine = lines[lines.length - 1];
    const cityLine = lines[lines.length - 2] || '';
    if (lines.length > 4) addr.line2 = lines[2];

    // US: "City, ST 12345" or "City, ST 12345-6789"
    // Canada: "City, ON A1B 2C3"
    // Other: "City, Province PostalCode"
    var cityMatch = cityLine.match(/^(.+?),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/) ||
                    cityLine.match(/^(.+?),?\s+([A-Z]{2})\s+([A-Z]\d[A-Z]\s?\d[A-Z]\d)$/) ||
                    cityLine.match(/^(.+?),?\s+([A-Z]{2,3})\s+(.+)$/);
    if (cityMatch) {
      addr.city = cityMatch[1];
      addr.state = cityMatch[2];
      addr.postalCode = cityMatch[3];
    } else {
      addr.city = cityLine;
    }
    addr.country = lastLine;
  } else if (lines.length >= 2) {
    // "Name City, ST" format
    const parts = text.split(/,\s*/);
    if (parts.length >= 2) {
      addr.name = parts[0].trim();
      const locParts = parts[1].trim().split(/\s+/);
      addr.state = locParts[locParts.length - 1] || '';
      addr.city = locParts.slice(0, -1).join(' ');
    }
  } else {
    addr.name = text;
  }

  if (!addr.name) addr.name = fallbackName;
  return addr;
}

// Fallback: derive order row containers from order links
function extractOrderRowsFromLinks(orderLinks) {
  const containers = new Set();
  orderLinks.forEach(link => {
    // Walk up from the link to find a meaningful container
    let el = link;
    for (let i = 0; i < 8; i++) {
      el = el.parentElement;
      if (!el || el === document.body) break;
      // A good container has multiple children and is reasonably sized
      if (el.children.length >= 3 && el.offsetHeight > 50) {
        containers.add(el);
        break;
      }
    }
  });
  return [...containers];
}

function extractOrderIdFromHref(href) {
  if (!href) return null;
  return href.match(/order_id=(\d+)/)?.[1] ||
         href.match(/receipt_id=(\d+)/)?.[1] ||
         href.match(/\/shop-manager\/[^/]+\/orders\/(\d+)/)?.[1] ||
         href.match(/\/orders\/sold\/(\d+)/)?.[1] ||
         href.match(/\/orders\/(\d+)/)?.[1] ||
         null;
}

function getOrderLinkSelector() {
  return 'a[href*="order_id="], a[href*="receipt_id="], a[href*="/orders/"], a[href*="/shop-manager/"][href*="/orders"]';
}

function rowLooksLikeOrderContainer(node) {
  if (!node || node.nodeType !== 1) return false;
  const rowSelector = '.panel-body-row, [data-order-id], [data-receipt-id], tr[data-order-id], .order-card, [class*="order-row"], [class*="OrderRow"], [data-test-id="order-row"], [data-test-id*="order"]';
  return node.matches?.(rowSelector) || !!node.querySelector?.(rowSelector + ', ' + getOrderLinkSelector());
}

// Helper function to expand address sections if collapsed
function expandAddressSections() {
  const toggleSelectors = [
    '[data-content-toggle][aria-expanded="false"]',
    '[aria-expanded="false"][class*="address"]',
  ];

  let expandedCount = 0;

  for (const sel of toggleSelectors) {
    const collapsedButtons = document.querySelectorAll(sel);
    collapsedButtons.forEach(button => {
      const buttonText = button.textContent?.toLowerCase() || '';
      const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
      if (buttonText.includes('ship') || buttonText.includes('address') ||
          ariaLabel.includes('ship') || ariaLabel.includes('address')) {
        try {
          button.click();
          expandedCount++;
          log.info('Expanded address section');
        } catch (e) {
          log.warn('Failed to expand address section', e.message);
        }
      }
    });
  }

  return expandedCount;
}

// Core extractor using REAL Etsy DOM structure with fallback selectors
async function extract(opts) {
  const force = !!(opts && opts.force);
  log.info('Starting order extraction');

  // First, try to expand any collapsed address sections
  const expandedCount = expandAddressSections();
  if (expandedCount > 0) {
    log.info(`Expanded ${expandedCount} address sections, waiting for DOM update`);
    await new Promise(r => setTimeout(r, 1000));
  }

  // Load synced orders map {orderNumber: timestamp} — orders re-sync after 24h
  var syncedRaw = (await chrome.storage.local.get({ [STORAGE_KEY]: {} }))[STORAGE_KEY];
  var syncedMap = (typeof syncedRaw === 'object' && !Array.isArray(syncedRaw)) ? syncedRaw : {};
  var syncNow = Date.now();

  // Try multiple selectors for order rows — Etsy changes their DOM frequently
  const orderRowSelectors = [
    '.panel-body-row',
    '[data-order-id]',
    '[data-receipt-id]',
    'tr[data-order-id]',
    '.order-card',
    '[class*="order-row"]',
    '[class*="OrderRow"]',
    '[data-test-id="order-row"]',
    '[data-test-id*="order"]',
    '.wt-grid__item-xs-12[class*="panel"]',
  ];

  let orderRows = null;
  let usedSelector = '';
  for (const sel of orderRowSelectors) {
    const rows = document.querySelectorAll(sel);
    if (rows.length > 0) {
      orderRows = rows;
      usedSelector = sel;
      break;
    }
  }

  log.info(`Order row detection: selector="${usedSelector}", found=${orderRows ? orderRows.length : 0}`);

  // Diagnostic: if no rows found, log page structure for debugging
  if (!orderRows || orderRows.length === 0) {
    const bodyClasses = document.body.className;
    const mainContent = document.querySelector('main, [role="main"], #content, .content-container');
    const allDivs = document.querySelectorAll('div[class]');
    const classNames = new Set();
    allDivs.forEach(d => d.className.split(/\s+/).forEach(c => { if (c.length > 3) classNames.add(c); }));
    const topClasses = [...classNames].slice(0, 30).join(', ');

    // Check if page has order-related links (proves we're on orders page)
    const orderLinks = document.querySelectorAll(getOrderLinkSelector());

    log.error('No order rows found with any selector', {
      path: window.location.pathname,
      bodyClasses,
      hasMainContent: !!mainContent,
      orderLinksCount: orderLinks.length,
      topClasses,
      pageTitle: document.title,
    });

    // Last resort: if we see order links, try to extract from their parent containers
    if (orderLinks.length > 0) {
      log.info(`Found ${orderLinks.length} order links, attempting parent-based extraction`);
      orderRows = extractOrderRowsFromLinks(orderLinks);
      usedSelector = 'link-parent-fallback';
      if (orderRows && orderRows.length > 0) {
        log.info(`Fallback found ${orderRows.length} order containers`);
      } else {
        log.warn('Link-parent fallback also failed');
        return;
      }
    } else {
      return;
    }
  }
  
  const batch = [];
  
  orderRows.forEach((row, index) => {
    try {
      // Extract order ID from checkbox or data attributes or links
      let orderId = null;
      const checkbox = row.querySelector('input[type="checkbox"][name]');
      orderId = checkbox?.getAttribute('name');
      if (!orderId) orderId = row.getAttribute('data-order-id') || row.getAttribute('data-receipt-id');
      if (!orderId) {
        // Scan EVERY link in the row — Etsy renders a buyer link
        // (/your/orders/sold?buyer_id=…) BEFORE the order link
        // (/your/orders/sold?order_id=…), so querySelector's first match has no
        // order id. Try each candidate and keep the first that yields an id.
        const links = row.querySelectorAll('a[href]');
        for (const a of links) {
          const id = extractOrderIdFromHref(a.getAttribute('href'));
          if (id) { orderId = id; break; }
        }
      }
      if (!orderId) {
        // Last resort: Etsy prints the order number as "#<digits>" text in each row.
        const hashMatch = (row.innerText || '').match(/#(\d{6,})/);
        if (hashMatch) orderId = hashMatch[1];
      }

      if (!orderId) {
        log.warn(`Row ${index}: No order ID found via any method`);
        return;
      }
      
      // Skip if synced within last 24 hours
      if (!force && syncedMap[orderId] && (syncNow - syncedMap[orderId] < 24 * 60 * 60 * 1000)) {
        return; // Recently synced, skip
      }
      
      log.info(`Row ${index}: Processing order ${orderId}`);
      
      // Extract buyer name with fallbacks
      let buyerName = '';
      const buyerSelectors = [
        '[data-dropdown-button="true"] [data-test-id="unsanitize"]',
        '[data-test-id="buyer-name"]',
        '[data-test-id="unsanitize"]',
        '.buyer-name',
        '[class*="buyer"]',
        '[class*="customer"]',
      ];
      for (const sel of buyerSelectors) {
        const el = row.querySelector(sel);
        if (el?.textContent?.trim()) {
          buyerName = el.textContent.trim();
          break;
        }
      }
      log.info(`Order ${orderId}: buyer name ${buyerName ? 'found' : 'missing'}`);
      
      // Order number is the same receipt id we just resolved above.
      let orderNumber = orderId;
      
      // Extract order total
      const priceSpan = row.querySelector('.display-inline-block .mr-xs-1');
      const orderTotal = priceSpan?.textContent?.replace(/[^0-9.]/g, '') || '';
      
      // Extract order date - look for text with "Ordered" prefix
      let orderDate = '';
      const dateElements = row.querySelectorAll('.text-body-smaller');
      for (const element of dateElements) {
        const text = element.textContent?.trim() || '';
        if (text.startsWith('Ordered ')) {
          orderDate = text.replace('Ordered ', '').trim();
          break;
        }
      }
      
      // Fallback: look for date pattern (e.g., "Dec 25, 2024")
      if (!orderDate) {
        const textNodes = row.querySelectorAll('*');
        for (const node of textNodes) {
          const text = node.textContent?.trim() || '';
          // Match date patterns like "Dec 25, 2024" or "December 25, 2024"
          const dateMatch = text.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}$/);
          if (dateMatch) {
            orderDate = dateMatch[0];
            break;
          }
        }
      }
      
      log.info(`Order ${orderId}: Found date: ${orderDate}`);
      
      // Extract ship by date from the shipping section
      let shipByDate = '';
      const shipByElements = row.querySelectorAll('.text-body.strong, .wt-tooltip__trigger');
      for (const element of shipByElements) {
        const text = element.textContent?.trim();
        if (text && text.toLowerCase().includes('ship by')) {
          shipByDate = text;
          log.info(`Order ${orderId}: Found ship by: ${shipByDate}`);
          break;
        }
      }
      
      // Alternative selector for ship by date
      if (!shipByDate) {
        const shipByAlt = row.querySelector('[data-clg-id="WtTooltip"] .wt-tooltip__trigger div div');
        if (shipByAlt && shipByAlt.textContent?.toLowerCase().includes('ship by')) {
          shipByDate = shipByAlt.textContent.trim();
          log.info(`Order ${orderId}: Found ship by (alt): ${shipByDate}`);
        }
      }
      
      // Extract shipping address with multiple fallback strategies
      let shippingAddress = {};

      // Strategy 1: Structured address with class-based selectors
      const addressContainerSelectors = [
        'address',
        '.address.break-word',
        '.address',
        '[class*="address"]',
        '[data-test-id*="address"]',
        '[data-test-id*="shipping"]',
      ];

      let addressContainer = null;
      for (const sel of addressContainerSelectors) {
        addressContainer = row.querySelector(sel);
        if (addressContainer) break;
      }

      if (addressContainer) {
        // Try structured fields first — Etsy uses class names like .name, .first-line, etc.
        const nameSpan = addressContainer.querySelector('.name');
        const firstLineSpan = addressContainer.querySelector('.first-line');
        const citySpan = addressContainer.querySelector('.city');
        const stateSpan = addressContainer.querySelector('.state');
        const zipSpan = addressContainer.querySelector('.zip');
        const countrySpan = addressContainer.querySelector('.country-name');

        if (nameSpan || firstLineSpan || citySpan) {
          shippingAddress = {
            name: nameSpan?.textContent?.trim() || '',
            line1: firstLineSpan?.textContent?.trim() || '',
            line2: '',
            city: citySpan?.textContent?.trim() || '',
            state: stateSpan?.textContent?.trim() || '',
            postalCode: zipSpan?.textContent?.trim() || '',
            country: countrySpan?.textContent?.trim() || ''
          };
          log.info('Order ' + orderId + ': Found structured address');
        } else {
          // No structured fields — parse entire address as a text block
          // Etsy renders address as line-separated text: Name\nStreet\nCity, ST ZIP\nCountry
          var addressText = addressContainer.innerText || addressContainer.textContent || '';
          shippingAddress = parseAddressText(addressText.trim(), buyerName);
          log.info('Order ' + orderId + ': Parsed address from text block');
        }

        // If country still empty, try to find it from the last line of the address text
        if (!shippingAddress.country) {
          var addrLines = (addressContainer.innerText || '').split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
          if (addrLines.length >= 3) {
            var lastLine = addrLines[addrLines.length - 1];
            // If last line looks like a country name (not a zip code or state)
            if (lastLine.length > 2 && !/^\d{5}/.test(lastLine) && !/^[A-Z]{2}\s+\d/.test(lastLine)) {
              shippingAddress.country = lastLine;
              log.info('Order ' + orderId + ': Extracted country from last line');
            }
          }
        }
      }

      // Strategy 2: Collapsible address section
      if (!shippingAddress.name && !shippingAddress.line1) {
        const shipToButton = row.querySelector('[data-content-toggle]');
        if (shipToButton) {
          const addressContent = row.querySelector('.address, [class*="address"]');
          if (addressContent) {
            const addressText = addressContent.textContent.trim();
            shippingAddress = parseAddressText(addressText, buyerName);
            log.info(`Order ${orderId}: Parsed collapsible address`);
          }
        }
      }

      // Strategy 3: Collapsed summary text (e.g., "Adam Greco Rye Brook, NY")
      if (!shippingAddress.name && !shippingAddress.line1) {
        const collapsedAddress = row.querySelector('.break-word .text-body-smaller, [class*="ship-to"], [class*="destination"]');
        if (collapsedAddress) {
          const addressText = collapsedAddress.textContent.trim();
          shippingAddress = parseAddressText(addressText, buyerName);
          log.info(`Order ${orderId}: Parsed collapsed address fallback`);
        }
      }
      
      // Buyer email — Etsy's API returns buyer_email=null for third-party apps
      // (case-by-case PII approval), so the dashboard is the only source. A
      // mailto: link only exists in the row when the buyer dropdown/detail has
      // been rendered; the detail-panel watcher below covers the rest.
      let buyerEmail = '';
      const rowMailto = row.querySelector('a[href^="mailto:"]');
      if (rowMailto) {
        buyerEmail = decodeURIComponent((rowMailto.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0]).trim();
        if (buyerEmail) log.info(`Order ${orderId}: Found buyer email in row`);
      }

      // Personalization / buyer notes are intentionally NOT scraped here. The old
      // approach grabbed every `.text-body-smaller` in the row — which is the whole
      // order card (SKU, coupon, item title, size, colour, shipping, address) — and
      // mislabeled it as personalization, producing junk on orders where the buyer
      // left none. Personalization comes reliably from the Etsy API
      // (message_from_buyer / transaction personalization) in etsyOrderSync, so the
      // extension only needs to supply the buyer address the API no longer returns.
      let notes = '';
      
      // Get store information for multi-store support
      const storeInfo = getEtsyStoreInfo();
      
      // Simplified data structure - only order number, address, notes, store info, and ship by date
      const orderData = {
        orderNumber,
        etsyStoreId: storeInfo.shopId,
        etsyStoreName: storeInfo.storeName,
        shippingAddress: {
          name: shippingAddress.name || buyerName || '',
          line1: shippingAddress.line1 || '',
          line2: shippingAddress.line2 || '',
          city: shippingAddress.city || '',
          state: shippingAddress.state || '',
          postalCode: shippingAddress.postalCode || '',
          country: shippingAddress.country || '',
          email: buyerEmail || ''
        },
        notes: notes || '',
        shipByDate: shipByDate || '',
        orderDate: orderDate || ''
      };
      
      // Only add if we have essential data
      if (orderData.orderNumber && orderData.shippingAddress.name) {
        batch.push(orderData);
        log.success(`Order ${orderNumber}: address extracted`);
      } else {
        log.warn(`Order ${orderNumber}: Missing essential data, skipping`);
      }
      
    } catch (error) {
      log.error(`Row ${index}: Extraction failed`, { message: error.message });
    }
  });
  
  log.info(`Extraction complete: ${batch.length} new orders found`);
  
  if (batch.length > 0) {
    await pushBatch(batch);
  }
  return batch.length;
}

// Message listener for popup communication
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  log.info('Received message', { action: request && request.action });
  
  switch (request.action) {
    case 'scrapeNow':
      log.info('Manual sync triggered from popup');
      
      // Force extraction even if recently done
      lastExtractionTime = 0;
      isExtracting = false;
      
      extract().then(() => {
        sendResponse({ 
          status: 'completed', 
          url: window.location.href, 
          title: document.title 
        });
      }).catch(error => {
        log.error('Manual sync failed', { message: error && error.message });
        sendResponse({ 
          status: 'error', 
          error: error.message,
          url: window.location.href, 
          title: document.title 
        });
      });
      break;
      
    case 'fullImport':
      log.info('Full import triggered');
      // Manual import from the popup re-sends every order on the page (ignores
      // the 24h "already sent" cache) and reports how many it sent.
      performFullImport({ force: true }).then((sent) => {
        sendResponse({ status: 'completed', sent: sent || 0 });
      }).catch((error) => {
        sendResponse({ status: 'error', error: error && error.message });
      });
      break;
      
    case 'getStatus':
      chrome.storage.local.get([STORAGE_KEY, 'kx_logs']).then(result => {
        const syncedData = result[STORAGE_KEY] || {};
        const syncedCount = typeof syncedData === 'object' && !Array.isArray(syncedData) ? Object.keys(syncedData).length : (Array.isArray(syncedData) ? syncedData.length : 0);
        const totalOrdersOnPage = document.querySelectorAll('.panel-body-row, [data-order-id], [data-receipt-id], [data-test-id="order-row"], [data-test-id*="order"]').length || document.querySelectorAll(getOrderLinkSelector()).length;
        const pendingCount = Math.max(0, totalOrdersOnPage - syncedCount);

        const status = {
          syncedCount: syncedCount,
          pendingCount: pendingCount,
          totalOrdersOnPage: totalOrdersOnPage,
          url: window.location.href,
          scriptLoaded: true,
          version: EXT_VERSION,
          isExtracting: isExtracting,
          lastExtractionTime: lastExtractionTime,
          logs: (result.kx_logs || []).slice(-10) // Last 10 logs
        };
        log.info('Status requested');
        sendResponse(status);
      });
      break;
      
    case 'getLogs':
      chrome.storage.local.get(['kx_logs']).then(result => {
        sendResponse({ logs: result.kx_logs || [] });
      });
      break;
      
    default:
      log.warn('Unknown action', request.action);
  }
  
  return true; // Keep message channel open for async response
});

// Bulk import function
async function performFullImport(opts) {
  log.info('Starting full import - scrolling to load all orders');
  
  // Scroll to load more orders
  for (let i = 0; i < 5; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(r => setTimeout(r, 900));
    log.info(`Scroll ${i + 1}/5 completed`);
  }
  
  // Wait a bit more for content to load
  await new Promise(r => setTimeout(r, 2000));
  
  // Extract all loaded orders
  const sent = await extract(opts);
  
  log.success('Full import completed');
  return sent;
}

// Initialize
log.info('Setting up observers and initial extraction');

// Track last extraction to prevent duplicates
let lastExtractionTime = 0;
let isExtracting = false;

// Enhanced debounced extraction
function debouncedExtract() {
  if (isExtracting) {
    log.info('Extraction already in progress, skipping');
    return;
  }
  
  const now = Date.now();
  const timeSinceLastExtraction = now - lastExtractionTime;
  
  // Don't extract more than once every 10 seconds
  if (timeSinceLastExtraction < 10000) {
    log.info(`Skipping extraction, only ${timeSinceLastExtraction}ms since last extraction`);
    return;
  }
  
  // Clear any pending timeout
  clearTimeout(window.extractTimeout);
  
  // Set timeout for actual extraction
  window.extractTimeout = setTimeout(async () => {
    if (isExtracting) return;
    
    isExtracting = true;
    lastExtractionTime = Date.now();
    
    try {
      await extract();
    } finally {
      isExtracting = false;
    }
  }, 2000); // 2 second delay to allow for DOM settling
}

// Find the buyer's email in the open order's detail panel. Only mailto: links
// that sit inside the panel for THIS order (an ancestor whose text contains the
// order id) count — a page-wide scan could pick up the seller's own address.
// Returns '' unless exactly one distinct candidate is found.
function findBuyerEmailInOrderPanel(orderId) {
  const candidates = new Set();
  document.querySelectorAll('a[href^="mailto:"]').forEach(function(a) {
    if (a.closest('header, nav, footer, #kx-tracking-banner')) return;
    let email = '';
    try { email = decodeURIComponent((a.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0]).trim(); } catch (e) { return; }
    if (!/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(email)) return;
    const low = email.toLowerCase();
    if (low.endsWith('@etsy.com') || low.includes('kolayxport')) return;
    let el = a.parentElement;
    for (let i = 0; i < 12 && el && el !== document.body; i++) {
      if ((el.textContent || '').indexOf(orderId) !== -1) {
        candidates.add(low);
        return;
      }
      el = el.parentElement;
    }
  });
  if (candidates.size === 1) return [...candidates][0];
  if (candidates.size > 1) log.warn('Multiple buyer email candidates in order panel, skipping', { orderId, count: candidates.size });
  return '';
}

// ── Buyer email watcher ──────────────────────────────────────────────────
// When the seller opens an order (URL gains order_id=), Etsy renders the
// buyer's email in the detail panel. Scrape it and push an email-only update;
// the server merges it into the stored address without clobbering anything.
async function extractDetailEmail() {
  try {
    const url = new URL(window.location.href);
    const orderId = url.searchParams.get('order_id') || url.searchParams.get('receipt_id');
    if (!orderId) return;

    const store = await chrome.storage.local.get({ [EMAIL_SYNC_KEY]: {} });
    const syncedEmails = (typeof store[EMAIL_SYNC_KEY] === 'object' && !Array.isArray(store[EMAIL_SYNC_KEY])) ? store[EMAIL_SYNC_KEY] : {};
    if (syncedEmails[orderId]) return;

    const email = findBuyerEmailInOrderPanel(orderId);
    if (!email || !email.includes('@')) return;

    const storeInfo = getEtsyStoreInfo();
    log.info(`Order ${orderId}: Found buyer email on detail view, pushing`);
    const response = await safeSendMessage({
      action: 'syncOrders',
      orders: [{
        orderNumber: orderId,
        etsyStoreId: storeInfo.shopId,
        etsyStoreName: storeInfo.storeName,
        shippingAddress: { email: email },
        emailOnly: true
      }],
      source: 'chrome-extension-v' + EXT_VERSION + '-email',
      timestamp: new Date().toISOString()
    });
    if (response && response.success) {
      syncedEmails[orderId] = Date.now();
      // Prune entries older than 7 days
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      Object.keys(syncedEmails).forEach(function(k) { if (syncedEmails[k] < cutoff) delete syncedEmails[k]; });
      await chrome.storage.local.set({ [EMAIL_SYNC_KEY]: syncedEmails });
      log.success(`Order ${orderId}: Buyer email synced`);
    }
  } catch (e) {
    log.error('Email watcher failed', { message: e.message });
  }
}
// The detail panel doesn't look like an order row to the MutationObserver, so
// poll cheaply — no-ops unless the URL carries an order_id.
setInterval(extractDetailEmail, 3000);

// Initial extraction with delay
setTimeout(debouncedExtract, 3000);

// Observe for dynamic content updates with more restrictive filtering
const observer = new MutationObserver((mutations) => {
  // Only trigger on meaningful changes
  const hasRelevantChanges = mutations.some(mutation => {
    // Only care about added nodes that might be order rows
    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      return Array.from(mutation.addedNodes).some(rowLooksLikeOrderContainer);
    }
    return false;
  });
  
  if (hasRelevantChanges) {
    log.info('Relevant DOM changes detected, scheduling extraction');
    debouncedExtract();
  }
});

observer.observe(document.body, { 
  childList: true, 
  subtree: true 
});

log.info('Content script initialization complete');

// ─── Tracking Push Feature ─────────────────────────────────────────
// When user navigates to an Etsy order detail page, check if KolayXport
// has a pending tracking number and offer to fill it via DOM automation.

let trackingPushActive = false;
let pendingTrackingData = null;

// Detect if we're on an order detail page
function getReceiptIdFromUrl() {
  const url = window.location.href;
  const match = url.match(/\/your\/orders\/(\d+)/) ||
                url.match(/order_id=(\d+)/) ||
                url.match(/receipt_id=(\d+)/) ||
                url.match(/\/shop-manager\/[^/]+\/orders\/(\d+)/) ||
                url.match(/\/orders\/sold\/(\d+)/);
  return match ? match[1] : null;
}

// Random delay helper (human-like)
function randomDelay(minMs, maxMs) {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise(r => setTimeout(r, delay));
}

// Set an input's value in a way React-controlled inputs pick up.
function setNativeValue(input, value) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) desc.set.call(input, value);
  else input.value = value;
}

// Type text character by character with random delays
async function humanType(input, text) {
  input.focus();
  input.dispatchEvent(new Event('focus', { bubbles: true }));
  setNativeValue(input, '');
  input.dispatchEvent(new Event('input', { bubbles: true }));

  let current = '';
  for (const char of text) {
    current += char;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    setNativeValue(input, current);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    await randomDelay(50, 180);
  }

  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));
}

function isVisible(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

// Map KolayXport carrier names to Etsy carrier dropdown values
function mapCarrierToEtsy(carrierName) {
  const name = (carrierName || '').toLowerCase();
  const mapping = {
    'fedex': 'fedex',
    'ups': 'ups',
    'usps': 'usps',
    'dhl': 'dhl',
    'dhl express': 'dhl',
    'royal mail': 'royal-mail',
    'canada post': 'canada-post',
    'australia post': 'australia-post',
    'yurtici': 'yurtici-kargo',
    'yurtiçi': 'yurtici-kargo',
    'yurtiçi kargo': 'yurtici-kargo',
    'aras': 'aras-kargo',
    'aras kargo': 'aras-kargo',
    'mng': 'mng-kargo',
    'mng kargo': 'mng-kargo',
    'ptt': 'ptt',
    'sürat': 'surat-kargo',
    'sürat kargo': 'surat-kargo',
    'trendyol express': 'other',
    'other': 'other',
  };
  return mapping[name] || 'other';
}

const TRACKING_INPUT_SELECTORS = [
  'input[name="tracking_code"]',
  'input[name*="tracking"]',
  'input[id*="tracking"]',
  'input[placeholder*="tracking" i]',
  'input[aria-label*="tracking" i]',
  'input[data-test-id*="tracking"]',
  'input[placeholder*="takip" i]',
  'input[aria-label*="takip" i]',
];

function findTrackingInput(scope) {
  for (const sel of TRACKING_INPUT_SELECTORS) {
    const list = scope.querySelectorAll(sel);
    for (const el of list) {
      if (isVisible(el) && !el.closest('#kx-tracking-banner')) return el;
    }
  }
  return null;
}

// The order-detail container for THIS receipt. All button/input lookups are scoped
// to it so we never click something on a different order or elsewhere on the page.
function findOrderDetailContainer(receiptId) {
  const direct = document.querySelector(
    '[data-order-id="' + receiptId + '"], [data-receipt-id="' + receiptId + '"]'
  );
  if (direct) return direct;

  // Dialog / side panel showing this order
  const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"], aside');
  for (const d of dialogs) {
    if (d.closest('#kx-tracking-banner')) continue;
    if (isVisible(d) && (d.textContent || '').indexOf(receiptId) !== -1) return d;
  }

  // Smallest reasonably-sized ancestor of the element that prints the order number
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: function(n) {
      return (n.nodeValue || '').indexOf(receiptId) !== -1 && !n.parentElement.closest('#kx-tracking-banner')
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    }
  });
  const textNode = walker.nextNode();
  if (!textNode) return null;
  let el = textNode.parentElement;
  for (let i = 0; i < 10 && el && el !== document.body; i++) {
    if (el.offsetHeight > 250 && el.querySelector('button')) return el;
    el = el.parentElement;
  }
  return null;
}

// Where the tracking form lives after opening it: a dialog that contains a tracking
// input, otherwise the order container itself.
function findTrackingFormScope(container) {
  const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');
  for (const d of dialogs) {
    if (d.closest('#kx-tracking-banner')) continue;
    if (isVisible(d) && findTrackingInput(d)) return d;
  }
  if (container && container.isConnected && findTrackingInput(container)) return container;
  return null;
}

// Positive confirmation: the tracking number is rendered as plain text (not inside
// an input, not in our banner) inside the order container, and no tracking input
// still holds it — i.e. Etsy saved it and re-rendered the order.
function trackingConfirmedOnPage(receiptId, trackingNumber) {
  const container = findOrderDetailContainer(receiptId);
  if (!container) return false;
  const needle = String(trackingNumber).replace(/\s+/g, '');
  if (!needle) return false;

  const openInput = findTrackingInput(document.body);
  if (openInput && (openInput.value || '').replace(/\s+/g, '') === needle) return false;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: function(n) {
      const p = n.parentElement;
      if (!p || p.closest('#kx-tracking-banner, input, textarea, script, style')) return NodeFilter.FILTER_SKIP;
      return (n.nodeValue || '').replace(/\s+/g, '').indexOf(needle) !== -1 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    }
  });
  return !!walker.nextNode();
}

function waitForTrackingConfirmation(receiptId, trackingNumber, timeoutMs) {
  return new Promise(function(resolve) {
    const started = Date.now();
    (function poll() {
      if (trackingConfirmedOnPage(receiptId, trackingNumber)) return resolve(true);
      if (Date.now() - started > timeoutMs) return resolve(false);
      setTimeout(poll, 1000);
    })();
  });
}

// Banner text (TR/EN, same approach as the research overlays)
const _bannerLang = (function() {
  try { return chrome.i18n.getUILanguage().startsWith('tr') ? 'tr' : 'en'; }
  catch (e) { return (navigator.language || '').startsWith('tr') ? 'tr' : 'en'; }
})();
const _bannerText = {
  tr: {
    title: 'KolayXport Kargo Takip', trackingNo: 'Kargo Takip No', carrier: 'Kargo',
    push: 'Takip No Gir', working: 'İşleniyor...', retry: 'Tekrar Dene', done: '✓ Onaylandı',
    searching: 'Sipariş paneli aranıyor...', opening: 'Kargo formu açılıyor...',
    selectingCarrier: 'Kargo firması seçiliyor...', typing: 'Takip numarası giriliyor...',
    submitting: 'Gönderiliyor...', verifying: 'Etsy onayı bekleniyor...',
    confirmed: 'Etsy takip numarasını kaydetti.',
    noPanel: 'Bu siparişin detay paneli bulunamadı. Sipariş detayını açıp tekrar deneyin.',
    noForm: 'Takip numarası alanı bulunamadı. Etsy\'de "Siparişi tamamla" formunu açıp tekrar deneyin.',
    manual: 'Takip no girildi ama kaydet butonu bulunamadı. Lütfen Etsy\'de kaydet butonuna tıklayın — kaydedildiğinde otomatik onaylanacak.',
    unconfirmed: 'Etsy kaydı onaylanamadı. Siparişte takip numarasını kontrol edin.',
    lateConfirmed: 'Etsy takip numarasını kaydetti (manuel kayıt algılandı).',
    etsyError: 'Etsy hata: ',
  },
  en: {
    title: 'KolayXport Tracking', trackingNo: 'Tracking number', carrier: 'Carrier',
    push: 'Fill tracking', working: 'Working...', retry: 'Retry', done: '✓ Confirmed',
    searching: 'Looking for the order panel...', opening: 'Opening the tracking form...',
    selectingCarrier: 'Selecting carrier...', typing: 'Entering tracking number...',
    submitting: 'Submitting...', verifying: 'Waiting for Etsy to confirm...',
    confirmed: 'Etsy saved the tracking number.',
    noPanel: 'Could not find this order\'s detail panel. Open the order and try again.',
    noForm: 'Tracking number field not found. Open Etsy\'s "Complete order" form and try again.',
    manual: 'Tracking number entered but no save button was found. Please click save on Etsy — it will be confirmed automatically once saved.',
    unconfirmed: 'Could not confirm Etsy saved it. Check the tracking number on the order.',
    lateConfirmed: 'Etsy saved the tracking number (manual save detected).',
    etsyError: 'Etsy error: ',
  },
};
function bt(key) { return (_bannerText[_bannerLang] && _bannerText[_bannerLang][key]) || _bannerText.en[key] || key; }

function el(tag, styles, text) {
  const node = document.createElement(tag);
  if (styles) node.style.cssText = styles;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

// Create floating banner UI (DOM-built; server values only ever go into textContent)
function createTrackingBanner(data) {
  const existing = document.getElementById('kx-tracking-banner');
  if (existing) existing.remove();

  const banner = el('div', `
    position: fixed !important; bottom: 20px !important; right: 20px !important;
    background: #1a1a2e !important; color: #fff !important; padding: 16px 20px !important;
    border-radius: 12px !important; z-index: 999999 !important; font-size: 13px !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3) !important; max-width: 360px !important; line-height: 1.5 !important;
  `);
  banner.id = 'kx-tracking-banner';

  const head = el('div', 'display:flex;align-items:center;gap:8px;margin-bottom:8px;');
  const icon = el('img', 'border-radius:2px;');
  icon.src = chrome.runtime.getURL('icons/icon-16.png');
  icon.width = 16; icon.height = 16; icon.alt = '';
  const close = el('span', 'margin-left:auto;cursor:pointer;opacity:0.6;font-size:16px;', '✕');
  close.setAttribute('role', 'button');
  close.setAttribute('aria-label', 'Close');
  head.append(icon, el('strong', 'color:#e0e0ff;', bt('title')), close);

  const body = el('div', 'margin-bottom:10px;');
  body.append(
    el('div', 'color:#a0a0d0;font-size:11px;', bt('trackingNo')),
    el('div', 'font-weight:600;font-size:14px;color:#fff;', data.trackingNumber),
    el('div', 'color:#a0a0d0;font-size:11px;margin-top:4px;', bt('carrier') + ': ' + (data.carrierName || ''))
  );

  const btn = el('button', `
    background: #4CAF50 !important; color: #fff !important; border: none !important;
    padding: 8px 16px !important; border-radius: 6px !important; cursor: pointer !important;
    font-size: 13px !important; font-weight: 600 !important; width: 100% !important;
  `, bt('push'));
  btn.id = 'kx-push-tracking-btn';

  const status = el('div', 'margin-top:8px;font-size:11px;color:#a0a0d0;display:none;');
  status.id = 'kx-tracking-status';

  banner.append(head, body, btn, status);
  document.body.appendChild(banner);

  close.addEventListener('click', () => banner.remove());
  btn.addEventListener('click', () => pushTrackingToEtsy(data));
  return banner;
}

// Update banner status
function updateBannerStatus(message, isError = false) {
  const statusEl = document.getElementById('kx-tracking-status');
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.style.color = isError ? '#ff6b6b' : '#90ee90';
    statusEl.textContent = message;
  }
}

function setBannerButton(state) {
  const btn = document.getElementById('kx-push-tracking-btn');
  if (!btn) return;
  if (state === 'working') {
    btn.disabled = true; btn.textContent = bt('working'); btn.style.opacity = '0.6';
  } else if (state === 'done') {
    btn.disabled = true; btn.textContent = bt('done'); btn.style.opacity = '1'; btn.style.background = '#2e7d32';
  } else {
    btn.disabled = false; btn.textContent = bt('retry'); btn.style.opacity = '1';
  }
}

// After a non-success report, keep watching for a while: if the seller saves the
// form manually (or Etsy was just slow) and the number shows up on the order,
// upgrade the submission to 'submitted'.
let _lateConfirmWatch = null;
function watchForLateConfirmation(data, receiptId) {
  if (_lateConfirmWatch) clearInterval(_lateConfirmWatch);
  const started = Date.now();
  _lateConfirmWatch = setInterval(async function() {
    if (Date.now() - started > 5 * 60 * 1000 || getReceiptIdFromUrl() !== receiptId) {
      clearInterval(_lateConfirmWatch);
      _lateConfirmWatch = null;
      return;
    }
    if (trackingConfirmedOnPage(receiptId, data.trackingNumber)) {
      clearInterval(_lateConfirmWatch);
      _lateConfirmWatch = null;
      await confirmSubmission(data.submissionId, 'submitted');
      updateBannerStatus(bt('lateConfirmed'));
      setBannerButton('done');
      log.success('Tracking confirmed on page after manual save');
    }
  }, 2000);
}

// Main DOM automation: fill tracking into the Etsy order page.
// 'submitted' is reported ONLY after the tracking number is positively seen on
// the saved order. Unconfirmed saves report 'needs_manual' (retryable); errors report 'failed'.
async function pushTrackingToEtsy(data) {
  if (trackingPushActive) {
    log.warn('Tracking push already in progress');
    return;
  }
  trackingPushActive = true;
  setBannerButton('working');

  const receiptId = String(data.receiptId || data.marketplaceKey || getReceiptIdFromUrl() || '');

  try {
    updateBannerStatus(bt('searching'));
    await randomDelay(800, 1500);

    if (trackingConfirmedOnPage(receiptId, data.trackingNumber)) {
      // Already on the order (e.g. entered earlier) — nothing to type.
      await confirmSubmission(data.submissionId, 'submitted');
      updateBannerStatus(bt('confirmed'));
      setBannerButton('done');
      return;
    }

    const container = findOrderDetailContainer(receiptId);
    if (!container) throw Object.assign(new Error(bt('noPanel')), { code: 'ORDER_PANEL_NOT_FOUND' });

    // Step 1: open the tracking form unless it's already open.
    let formScope = findTrackingFormScope(container);
    if (!formScope) {
      const actionSelectors = [
        'button[data-tracking-trigger]',
        'button[data-action="add-tracking"]',
        '[data-region="shipping-actions"] button',
        'button.btn-transaction-action',
      ];
      // Specific phrases only — no bare "complete" match.
      const actionTexts = [
        'complete order', 'mark as complete', 'mark as shipped', 'add tracking',
        'siparişi tamamla', 'gönderildi olarak işaretle', 'kargo bilgisi ekle', 'takip numarası ekle',
      ];
      const avoidTexts = [
        'shipping label', 'purchase label', 'kargo etiketi', 'cancel', 'iptal', 'refund', 'iade',
      ];
      let actionButton = null;
      for (const sel of actionSelectors) {
        const b = container.querySelector(sel);
        if (b && isVisible(b)) { actionButton = b; break; }
      }
      if (!actionButton) {
        for (const b of container.querySelectorAll('button, [role="button"]')) {
          const text = (b.textContent || '').toLowerCase().trim();
          if (!isVisible(b) || avoidTexts.some(t => text.includes(t))) continue;
          if (actionTexts.some(t => text.includes(t))) { actionButton = b; break; }
        }
      }
      if (!actionButton) throw Object.assign(new Error(bt('noForm')), { code: 'TRACKING_FORM_NOT_FOUND' });

      updateBannerStatus(bt('opening'));
      actionButton.click();
      await randomDelay(2000, 3500);
      formScope = findTrackingFormScope(container);
    }

    // Step 2: the tracking input must exist before anything else is touched.
    const trackingInput = formScope ? findTrackingInput(formScope) : null;
    if (!trackingInput) throw Object.assign(new Error(bt('noForm')), { code: 'TRACKING_INPUT_NOT_FOUND' });

    // Step 3: carrier (inside the same form scope)
    updateBannerStatus(bt('selectingCarrier'));
    await randomDelay(800, 1500);
    const carrierValue = mapCarrierToEtsy(data.carrierName);
    const carrierSelect = formScope.querySelector(
      'select[name="carrier_name"], select[id*="carrier"], select[aria-label*="carrier" i], select[data-test-id*="carrier"]'
    );
    if (carrierSelect) {
      let exactMatch = null;
      let partialMatch = null;
      let otherOpt = null;
      const wanted = (data.carrierName || '').toLowerCase();
      for (const opt of carrierSelect.querySelectorAll('option')) {
        const val = (opt.value || '').toLowerCase().trim();
        const text = (opt.textContent || '').toLowerCase().trim();
        if (val === carrierValue || text === carrierValue || (wanted && text === wanted)) { exactMatch = opt; break; }
        if (!partialMatch && carrierValue !== 'other' && (val.includes(carrierValue) || text.includes(carrierValue))) partialMatch = opt;
        if (!otherOpt && (val === 'other' || text === 'other' || text === 'diğer')) otherOpt = opt;
      }
      const choice = exactMatch || partialMatch || otherOpt;
      if (choice) {
        carrierSelect.value = choice.value;
        carrierSelect.dispatchEvent(new Event('change', { bubbles: true }));
        log.info('Selected carrier option' + (exactMatch ? ' (exact)' : partialMatch ? ' (partial)' : ' (other)'));
      }
      await randomDelay(1000, 2000);
    } else {
      log.warn('Carrier dropdown not found, proceeding with tracking number only');
    }

    // Step 4: type the tracking number and verify it stuck
    updateBannerStatus(bt('typing'));
    await randomDelay(600, 1200);
    await humanType(trackingInput, data.trackingNumber);
    if ((trackingInput.value || '').trim() !== String(data.trackingNumber).trim()) {
      throw Object.assign(new Error(bt('noForm')), { code: 'TRACKING_INPUT_REJECTED' });
    }
    await randomDelay(1200, 2500);

    // Step 5: submit button — only inside the tracking form scope
    updateBannerStatus(bt('submitting'));
    const submitScope = trackingInput.closest('form') || formScope;
    const avoidSubmitTexts = [
      'shipping label', 'purchase label', 'kargo etiketi', 'cancel', 'iptal', 'refund', 'iade', 'back', 'geri',
    ];
    const submitTexts = [
      'complete order', 'mark as complete', 'save', 'submit', 'confirm',
      'siparişi tamamla', 'kaydet', 'gönder', 'onayla',
    ];
    let submitButton = null;
    for (const sb of submitScope.querySelectorAll('button[type="submit"], input[type="submit"]')) {
      const t = (sb.textContent || sb.value || '').toLowerCase().trim();
      if (isVisible(sb) && !avoidSubmitTexts.some(x => t.includes(x))) { submitButton = sb; break; }
    }
    if (!submitButton) {
      for (const b of submitScope.querySelectorAll('button')) {
        const t = (b.textContent || '').toLowerCase().trim();
        if (!isVisible(b) || avoidSubmitTexts.some(x => t.includes(x))) continue;
        if (submitTexts.some(x => t.includes(x))) { submitButton = b; break; }
      }
    }

    if (!submitButton) {
      // Not a success: the number is typed but nothing was saved yet.
      updateBannerStatus(bt('manual'), true);
      await confirmSubmission(data.submissionId, 'needs_manual', 'MANUAL_SUBMIT_REQUIRED: tracking typed, no submit button found');
      setBannerButton('retry');
      watchForLateConfirmation(data, receiptId);
      return;
    }

    await randomDelay(1500, 3000);
    submitButton.click();
    log.info('Submit button clicked');

    // Step 6: positive confirmation required
    updateBannerStatus(bt('verifying'));
    await randomDelay(1500, 2500);
    const errorEl = (submitScope.isConnected ? submitScope : container).querySelector(
      '.error-message, .alert-error, [role="alert"][class*="error"], [aria-invalid="true"] ~ [class*="error"]'
    );
    if (errorEl && errorEl.textContent.trim()) {
      throw Object.assign(new Error(bt('etsyError') + errorEl.textContent.trim().slice(0, 200)), { code: 'ETSY_ERROR' });
    }

    const confirmed = await waitForTrackingConfirmation(receiptId, data.trackingNumber, 20000);
    if (!confirmed) {
      updateBannerStatus(bt('unconfirmed'), true);
      await confirmSubmission(data.submissionId, 'needs_manual', 'UNCONFIRMED: submit clicked but tracking number not visible on the order');
      setBannerButton('retry');
      watchForLateConfirmation(data, receiptId);
      return;
    }

    await confirmSubmission(data.submissionId, 'submitted');
    updateBannerStatus(bt('confirmed'));
    setBannerButton('done');
    log.success('Tracking pushed to Etsy and confirmed on page', { receiptId: receiptId });
  } catch (error) {
    const code = error && error.code ? error.code : 'ERROR';
    log.error('Tracking push failed', { code: code, message: error.message });
    updateBannerStatus(error.message, true);
    await confirmSubmission(data.submissionId, 'failed', code + ': ' + error.message);
    setBannerButton('retry');
  } finally {
    trackingPushActive = false;
  }
}

// Confirm submission status back to KolayXport ('submitted' | 'needs_manual' | 'failed')
async function confirmSubmission(submissionId, status, errorMsg) {
  try {
    await safeSendMessage({
      action: 'confirmTrackingSubmission',
      submissionId,
      status,
      error: errorMsg,
    });
  } catch (e) {
    log.error('Failed to confirm tracking submission', { error: e.message });
  }
}

// Check for pending tracking when on order detail page
async function checkPendingTracking() {
  const receiptId = getReceiptIdFromUrl();
  if (!receiptId) return;

  log.info('On order detail page, checking for pending tracking', { receiptId });

  try {
    const storeInfo = getEtsyStoreInfo();
    const response = await safeSendMessage({
      action: 'fetchPendingTracking',
      shopName: storeInfo.storeName,
    });
    if (!response) {
      log.warn('Cannot check tracking: extension not connected');
      return;
    }

    log.info('fetchPendingTracking response', { success: response?.success, count: response?.count, pendingLength: response?.pending?.length, error: response?.error });

    if (!response?.success || !response.pending?.length) {
      log.info('No pending tracking found');
      return;
    }

    // Find tracking for this specific receipt
    const match = response.pending.find(
      p => p.receiptId === receiptId || p.marketplaceKey === receiptId
    );

    if (match) {
      log.info('Found pending tracking for this order', { receiptId: receiptId });
      pendingTrackingData = match;
      createTrackingBanner(match);
    } else {
      log.info('No pending tracking for receipt ' + receiptId, { pendingCount: response.pending.length });
    }
  } catch (e) {
    log.error('Failed to check pending tracking', { error: e.message });
  }
}

// Run tracking check after a delay (let the page load)
setTimeout(checkPendingTracking, 4000);

// Also listen for URL changes (Etsy is SPA-like)
let lastUrl = window.location.href;
const urlObserver = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    // Remove old banner
    const old = document.getElementById('kx-tracking-banner');
    if (old) old.remove();
    // Check new page
    setTimeout(checkPendingTracking, 3000);
  }
});
urlObserver.observe(document.body, { childList: true, subtree: true });

// Add visual indicator (removed after 5 seconds)
const indicator = document.createElement('div');
indicator.style.cssText = `
  position: fixed !important;
  top: 10px !important;
  right: 10px !important;
  background: #4CAF50 !important;
  color: white !important;
  padding: 8px 12px !important;
  border-radius: 6px !important;
  z-index: 999999 !important;
  font-size: 12px !important;
  font-family: Arial, sans-serif !important;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2) !important;
`;
indicator.textContent = '✅ KolayXport v' + EXT_VERSION;
document.body.appendChild(indicator);
setTimeout(() => indicator.remove(), 5000);
