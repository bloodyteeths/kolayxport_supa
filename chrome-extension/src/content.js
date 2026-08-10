/* Kolayxport Etsy Address Enrichment – v3.3
 * Multi-store support: Distinguishes between multiple Etsy stores per user
 * Extracts order number, shipping address, customization notes, and store info
 * Works with Veeqo data to enrich orders with missing address information
 * Complements existing Veeqo integration for complete order data
 */

// Determine API endpoint based on current domain
const getKolayxportAPI = () => {
  const hostname = window.location.hostname;
  if (hostname.includes('localhost') || hostname.includes('127.0.0.1')) {
    return 'http://localhost:3000/api/integrations/etsy/addresses';
  } else if (hostname.includes('staging') || hostname.includes('dev')) {
    return 'https://staging.kolayxport.com/api/integrations/etsy/addresses';
  }
  return 'https://kolayxport.com/api/integrations/etsy/addresses';
};

const API = getKolayxportAPI();
const STORAGE_KEY = 'kx_synced_orders';
const MAX_STORED_IDS = 5000;

// Logging system - since Etsy blocks console, we'll use extension storage and server logs
const log = {
  messages: [],
  add: function(level, message, data = null) {
    const timestamp = new Date().toISOString();
    // Sanitize data to ensure it's serializable (no DOM nodes, circular refs)
    let safeData = null;
    if (data !== null && data !== undefined) {
      try {
        safeData = JSON.parse(JSON.stringify(data));
      } catch (e) {
        safeData = String(data);
      }
    }
    const logEntry = { timestamp, level, message, data: safeData };
    this.messages.push(logEntry);

    if (this.messages.length > 100) {
      this.messages = this.messages.slice(-100);
    }

    try {
      chrome.storage.local.set({ 'kx_logs': this.messages });
    } catch (e) {
      // Silent fail if storage write fails
    }

    if (level === 'error' || level === 'success') {
      this.sendToServer(logEntry);
    }
  },
  info: function(message, data) { this.add('info', message, data); },
  success: function(message, data) { this.add('success', message, data); },
  error: function(message, data) { this.add('error', message, data); },
  warn: function(message, data) { this.add('warn', message, data); },
  sendToServer: async function(logEntry) {
    try {
      safeSendMessage({
        action: 'sendLog',
        log: logEntry
      });
    } catch (e) {
      // Silent fail for logging
    }
  }
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

log.info('🚀 Kolayxport Etsy Address Enrichment v5.4 Loading', { url: window.location.href });

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

// Get authentication token from background service worker
async function getAuthToken() {
  try {
    const response = await safeSendMessage({ action: 'getAuthStatus' });
    if (response?.authenticated && response.token) {
      log.info('Got auth token from background script');
      return response.token;
    }
  } catch (e) {
    log.warn('Could not get auth token from background', e.message);
  }
  return null;
}

// Utility – push in batches and dedupe with chrome.storage.local
const pushBatch = async batch => {
  if (!batch.length) {
    log.info('No orders to sync');
    return;
  }
  
  log.info(`Attempting to sync ${batch.length} orders`);
  
  try {
    log.info('Preparing to sync orders', { 
      url: API, 
      orderCount: batch.length,
      firstOrderId: batch[0]?.orderNumber
    });
    
    // Use background script to make the API call (avoids CORS issues)
    log.info('Sending sync request via background script');
    const response = await safeSendMessage({
      action: 'syncOrders',
      orders: batch,
      source: 'chrome-extension-v5.4-multistore',
      timestamp: new Date().toISOString()
    });
    if (!response) {
      log.error('Sync failed: extension not connected. Visit kolayxport.com to re-authenticate.');
      return;
    }
    
    if (response.success) {
      const result = response.result;
      log.success(`Successfully synced ${batch.length} orders`, result);
      
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
    log.error("Sync failed", { message: err.message, stack: err.stack });
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
async function extract() {
  log.info('Starting order extraction v5.4 with multi-selector fallback');

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
      url: window.location.href,
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
      if (syncedMap[orderId] && (syncNow - syncedMap[orderId] < 24 * 60 * 60 * 1000)) {
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
      log.info(`Order ${orderId}: Found buyer name: "${buyerName}"`);
      
      // Order number is the same receipt id we just resolved above.
      let orderNumber = orderId;
      log.info(`Order ${orderId}: Found order number: ${orderNumber}`);
      
      // Extract order total
      const priceSpan = row.querySelector('.display-inline-block .mr-xs-1');
      const orderTotal = priceSpan?.textContent?.replace(/[^0-9.]/g, '') || '';
      log.info(`Order ${orderId}: Found total: $${orderTotal}`);
      
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
        // Log raw address HTML for debugging
        log.info('Order ' + orderId + ': address container innerHTML', { html: addressContainer.innerHTML.substring(0, 500) });

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
          log.info('Order ' + orderId + ': Found structured address', shippingAddress);
        } else {
          // No structured fields — parse entire address as a text block
          // Etsy renders address as line-separated text: Name\nStreet\nCity, ST ZIP\nCountry
          var addressText = addressContainer.innerText || addressContainer.textContent || '';
          shippingAddress = parseAddressText(addressText.trim(), buyerName);
          log.info('Order ' + orderId + ': Parsed address from text block', shippingAddress);
        }

        // If country still empty, try to find it from the last line of the address text
        if (!shippingAddress.country) {
          var addrLines = (addressContainer.innerText || '').split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
          if (addrLines.length >= 3) {
            var lastLine = addrLines[addrLines.length - 1];
            // If last line looks like a country name (not a zip code or state)
            if (lastLine.length > 2 && !/^\d{5}/.test(lastLine) && !/^[A-Z]{2}\s+\d/.test(lastLine)) {
              shippingAddress.country = lastLine;
              log.info('Order ' + orderId + ': Extracted country from last line: ' + lastLine);
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
            log.info(`Order ${orderId}: Parsed collapsible address`, shippingAddress);
          }
        }
      }

      // Strategy 3: Collapsed summary text (e.g., "Adam Greco Rye Brook, NY")
      if (!shippingAddress.name && !shippingAddress.line1) {
        const collapsedAddress = row.querySelector('.break-word .text-body-smaller, [class*="ship-to"], [class*="destination"]');
        if (collapsedAddress) {
          const addressText = collapsedAddress.textContent.trim();
          shippingAddress = parseAddressText(addressText, buyerName);
          log.info(`Order ${orderId}: Parsed collapsed address fallback`, shippingAddress);
        }
      }
      
      // Extract customization notes from item details
      let notes = '';
      const customizationElements = row.querySelectorAll('.text-body-smaller, .personalization, .note, [data-test-id*="custom"]');
      customizationElements.forEach(el => {
        const text = el.textContent?.trim();
        if (text && !text.includes('Ordered') && !text.includes('$') && text.length > 10) {
          if (notes) notes += ' | ';
          notes += text;
        }
      });
      
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
          country: shippingAddress.country || ''
        },
        notes: notes || '',
        shipByDate: shipByDate || '',
        orderDate: orderDate || ''
      };
      
      // Only add if we have essential data
      if (orderData.orderNumber && orderData.shippingAddress.name) {
        batch.push(orderData);
        log.success(`Order ${orderNumber}: Successfully extracted address and notes`, orderData);
      } else {
        log.warn(`Order ${orderNumber}: Missing essential data, skipping`, orderData);
      }
      
    } catch (error) {
      log.error(`Row ${index}: Extraction failed`, { message: error.message, stack: error.stack });
    }
  });
  
  log.info(`Extraction complete: ${batch.length} new orders found`);
  
  if (batch.length > 0) {
    await pushBatch(batch);
  }
}

// Message listener for popup communication
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  log.info('Received message from background', request);
  
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
        log.error('Manual sync failed', error);
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
      performFullImport().then(() => {
        sendResponse({ status: 'importing' });
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
          version: '5.4',
          isExtracting: isExtracting,
          lastExtractionTime: lastExtractionTime,
          logs: (result.kx_logs || []).slice(-10) // Last 10 logs
        };
        log.info('Status requested', status);
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
async function performFullImport() {
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
  await extract();
  
  log.success('Full import completed');
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

log.info('Content script v5.4 initialization complete');

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

// Type text character by character with random delays
async function humanType(input, text) {
  input.focus();
  input.value = '';
  input.dispatchEvent(new Event('focus', { bubbles: true }));

  for (const char of text) {
    input.value += char;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    await randomDelay(50, 180);
  }

  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// Wait for an element to appear in DOM
function waitForElement(selector, parent = document, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const existing = parent.querySelector(selector);
    if (existing) return resolve(existing);

    const obs = new MutationObserver(() => {
      const el = parent.querySelector(selector);
      if (el) { obs.disconnect(); resolve(el); }
    });
    obs.observe(parent, { childList: true, subtree: true });

    setTimeout(() => { obs.disconnect(); reject(new Error(`Element "${selector}" not found within ${timeoutMs}ms`)); }, timeoutMs);
  });
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

// Create floating banner UI
function createTrackingBanner(data) {
  // Remove existing banner if any
  const existing = document.getElementById('kx-tracking-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'kx-tracking-banner';
  banner.style.cssText = `
    position: fixed !important;
    bottom: 20px !important;
    right: 20px !important;
    background: #1a1a2e !important;
    color: #fff !important;
    padding: 16px 20px !important;
    border-radius: 12px !important;
    z-index: 999999 !important;
    font-size: 13px !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3) !important;
    max-width: 360px !important;
    line-height: 1.5 !important;
  `;

  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <img src="${chrome.runtime.getURL('icons/icon-16.png')}" width="16" height="16" style="border-radius:2px;">
      <strong style="color:#e0e0ff;">KolayXport Tracking</strong>
      <span id="kx-banner-close" style="margin-left:auto;cursor:pointer;opacity:0.6;font-size:16px;">✕</span>
    </div>
    <div style="margin-bottom:10px;">
      <div style="color:#a0a0d0;font-size:11px;">Kargo Takip No</div>
      <div style="font-weight:600;font-size:14px;color:#fff;">${data.trackingNumber}</div>
      <div style="color:#a0a0d0;font-size:11px;margin-top:4px;">Kargo: ${data.carrierName}</div>
    </div>
    <button id="kx-push-tracking-btn" style="
      background: #4CAF50 !important;
      color: #fff !important;
      border: none !important;
      padding: 8px 16px !important;
      border-radius: 6px !important;
      cursor: pointer !important;
      font-size: 13px !important;
      font-weight: 600 !important;
      width: 100% !important;
    ">Takip No Gir</button>
    <div id="kx-tracking-status" style="margin-top:8px;font-size:11px;color:#a0a0d0;display:none;"></div>
  `;

  document.body.appendChild(banner);

  document.getElementById('kx-banner-close').addEventListener('click', () => banner.remove());
  document.getElementById('kx-push-tracking-btn').addEventListener('click', () => {
    pushTrackingToEtsy(data);
  });

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

// Main DOM automation: fill tracking into Etsy order page
async function pushTrackingToEtsy(data) {
  if (trackingPushActive) {
    log.warn('Tracking push already in progress');
    return;
  }
  trackingPushActive = true;

  const btn = document.getElementById('kx-push-tracking-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'İşleniyor...';
    btn.style.opacity = '0.6';
  }

  try {
    updateBannerStatus('Kargo bilgisi formu aranıyor...');
    await randomDelay(1000, 2000);

    // Step 1: Find and click "Mark as complete" / "Add tracking" / "Complete order" button
    // Etsy uses various button texts depending on order state
    const actionSelectors = [
      'button[data-tracking-trigger]',
      'button[data-action="add-tracking"]',
      '[data-region="shipping-actions"] button',
      'button.btn-transaction-action',
    ];

    // Texts that open the tracking form — order matters, most specific first
    const actionTexts = [
      'complete order', 'mark as complete', 'mark as shipped',
      'add tracking', 'complete',
      'siparişi tamamla', 'gönderildi olarak işaretle', 'kargo bilgisi ekle',
    ];

    // Texts to AVOID clicking (these are NOT the tracking form opener)
    const avoidTexts = [
      'create a shipping label', 'buy shipping label', 'purchase label',
      'get shipping label', 'kargo etiketi',
    ];

    let actionButton = null;

    // Try selectors first
    for (const sel of actionSelectors) {
      actionButton = document.querySelector(sel);
      if (actionButton) break;
    }

    // Fallback: search by button text, but skip "create shipping label" buttons
    if (!actionButton) {
      const allButtons = document.querySelectorAll('button, a.btn, [role="button"]');
      for (const b of allButtons) {
        var text = (b.textContent || '').toLowerCase().trim();
        if (avoidTexts.some(function(t) { return text.includes(t); })) continue;
        if (actionTexts.some(function(t) { return text.includes(t); })) {
          actionButton = b;
          break;
        }
      }
    }

    if (!actionButton) {
      // Maybe the tracking form is already visible
      const existingForm = document.querySelector('input[name="tracking_code"], input[id*="tracking"], input[placeholder*="tracking"], input[aria-label*="tracking"]');
      if (!existingForm) {
        throw new Error('Kargo bilgisi butonu bulunamadı. Sipariş detay sayfasında olduğunuzdan emin olun.');
      }
      log.info('Tracking form already visible, skipping button click');
    } else {
      updateBannerStatus('Kargo formu açılıyor...');
      actionButton.click();
      await randomDelay(2000, 3500);
    }

    // Step 2: Find carrier dropdown and select carrier
    updateBannerStatus('Kargo firması seçiliyor...');
    await randomDelay(800, 1500);

    const carrierValue = mapCarrierToEtsy(data.carrierName);
    const carrierSelectors = [
      'select[name="carrier_name"]',
      'select[id*="carrier"]',
      'select[aria-label*="carrier"]',
      'select[data-test-id*="carrier"]',
    ];

    let carrierSelect = null;
    for (const sel of carrierSelectors) {
      carrierSelect = document.querySelector(sel);
      if (carrierSelect) break;
    }

    if (carrierSelect) {
      // Try to find matching option — prefer exact match over partial
      const options = carrierSelect.querySelectorAll('option');
      let matched = false;
      var exactMatch = null;
      var partialMatch = null;
      for (const opt of options) {
        const val = (opt.value || '').toLowerCase().trim();
        const text = (opt.textContent || '').toLowerCase().trim();
        // Exact match: value or text equals carrier name exactly
        if (val === carrierValue || text === carrierValue || text === data.carrierName.toLowerCase()) {
          exactMatch = opt;
          break;
        }
        // Partial match: value or text contains carrier name (but not preferred)
        if (!partialMatch && (val.includes(carrierValue) || text.includes(carrierValue))) {
          partialMatch = opt;
        }
      }
      var bestMatch = exactMatch || partialMatch;
      if (bestMatch) {
        carrierSelect.value = bestMatch.value;
        carrierSelect.dispatchEvent(new Event('change', { bubbles: true }));
        matched = true;
        log.info('Selected carrier: ' + bestMatch.textContent + (exactMatch ? ' (exact)' : ' (partial)'));
      }
      if (!matched) {
        // Default to "Other" if no match
        for (const opt of options) {
          if ((opt.value || '').toLowerCase() === 'other' || (opt.textContent || '').toLowerCase() === 'other') {
            carrierSelect.value = opt.value;
            carrierSelect.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
        log.warn(`Carrier "${data.carrierName}" not found, selected Other`);
      }
      await randomDelay(1000, 2000);
    } else {
      log.warn('Carrier dropdown not found, proceeding with tracking number only');
    }

    // Step 3: Find tracking number input and type it
    updateBannerStatus('Takip numarası giriliyor...');
    await randomDelay(800, 1500);

    const trackingSelectors = [
      'input[name="tracking_code"]',
      'input[id*="tracking"]',
      'input[placeholder*="tracking"]',
      'input[aria-label*="tracking"]',
      'input[data-test-id*="tracking"]',
      'input[name*="tracking"]',
    ];

    let trackingInput = null;
    for (const sel of trackingSelectors) {
      trackingInput = document.querySelector(sel);
      if (trackingInput) break;
    }

    if (!trackingInput) {
      throw new Error('Takip numarası alanı bulunamadı.');
    }

    await humanType(trackingInput, data.trackingNumber);
    log.info('Tracking number typed successfully');

    await randomDelay(1500, 3000);

    // Step 4: Find and click submit/save button
    updateBannerStatus('Gönderiliyor...');

    const submitTexts = [
      'submit', 'save', 'kaydet', 'gönder', 'tamamla',
      'mark as complete', 'confirm', 'complete order',
    ];

    // Texts to NEVER click as submit
    const avoidSubmitTexts = [
      'create a shipping label', 'buy shipping label', 'purchase label',
      'get shipping label', 'kargo etiketi', 'cancel', 'iptal',
    ];

    // Look for submit button within the tracking form area
    const formArea = trackingInput.closest('form') || trackingInput.closest('[role="dialog"]') || trackingInput.closest('.overlay-body') || document.body;
    const submitButtons = formArea.querySelectorAll('button[type="submit"], input[type="submit"]');

    let submitButton = null;

    // First try type="submit" buttons, filtering out bad ones
    for (const sb of submitButtons) {
      var sbText = (sb.textContent || '').toLowerCase().trim();
      if (!avoidSubmitTexts.some(function(t) { return sbText.includes(t); })) {
        submitButton = sb;
        break;
      }
    }

    // Fallback: search by text, skip dangerous buttons
    if (!submitButton) {
      const allBtns = formArea.querySelectorAll('button, input[type="submit"]');
      for (const b of allBtns) {
        var btnText = (b.textContent || '').toLowerCase().trim();
        if (avoidSubmitTexts.some(function(t) { return btnText.includes(t); })) continue;
        if (submitTexts.some(function(t) { return btnText.includes(t); })) {
          submitButton = b;
          break;
        }
      }
    }

    if (!submitButton) {
      updateBannerStatus('Takip no girildi. Lütfen kaydet butonuna manuel tıklayın.', false);
      // Still confirm as submitted since the number was entered
      await confirmSubmission(data.submissionId, 'submitted');
      return;
    }

    await randomDelay(2000, 3500);
    submitButton.click();
    log.info('Submit button clicked');

    // Step 5: Wait for success confirmation
    await randomDelay(3000, 5000);

    // Check for error messages
    const errorEl = document.querySelector('.error-message, .alert-error, [role="alert"][class*="error"]');
    if (errorEl && errorEl.textContent.trim()) {
      throw new Error(`Etsy hata: ${errorEl.textContent.trim()}`);
    }

    // Success!
    updateBannerStatus('Takip numarası başarıyla girildi!');
    await confirmSubmission(data.submissionId, 'submitted');

    // Update button to show success
    if (btn) {
      btn.textContent = '✓ Tamamlandı';
      btn.style.background = '#2e7d32';
    }

    log.success('Tracking pushed to Etsy successfully', {
      receiptId: data.receiptId,
      trackingNumber: data.trackingNumber,
    });

  } catch (error) {
    log.error('Tracking push failed', { message: error.message });
    updateBannerStatus(error.message, true);
    await confirmSubmission(data.submissionId, 'failed', error.message);

    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Tekrar Dene';
      btn.style.opacity = '1';
    }
  } finally {
    trackingPushActive = false;
  }
}

// Confirm submission status back to KolayXport
async function confirmSubmission(submissionId, status, errorMsg) {
  try {
    const storeInfo = getEtsyStoreInfo();
    await safeSendMessage({
      action: 'confirmTrackingSubmission',
      submissionId,
      status,
      error: errorMsg,
      shopName: storeInfo.storeName,
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
      log.info('Found pending tracking for this order', match);
      pendingTrackingData = match;
      createTrackingBanner(match);
    } else {
      log.info('No pending tracking for receipt ' + receiptId, {
        pendingReceipts: response.pending.map(p => p.receiptId),
      });
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

// Add visual indicator (removed after 3 seconds)
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
indicator.textContent = '✅ Kolayxport v5.4 - Kargo Takip Push!';
document.body.appendChild(indicator);
setTimeout(() => indicator.remove(), 5000);
