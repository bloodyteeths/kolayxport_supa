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
  return 'https://app.kolayxport.com/api/integrations/etsy/addresses';
};

const API = getKolayxportAPI();
const STORAGE_KEY = 'kx_synced_orders';
const MAX_STORED_IDS = 5000;

// Logging system - since Etsy blocks console, we'll use extension storage and server logs
const log = {
  messages: [],
  add: function(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, level, message, data };
    this.messages.push(logEntry);
    
    // Keep only last 100 log entries
    if (this.messages.length > 100) {
      this.messages = this.messages.slice(-100);
    }
    
    // Store in extension storage for popup to display
    chrome.storage.local.set({ 'kx_logs': this.messages });
    
    // Also send critical logs to server
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
      await fetch(API.replace('/orders', '/logs'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'chrome-extension', log: logEntry })
      });
    } catch (e) {
      // Silent fail for logging
    }
  }
};

log.info('🚀 Kolayxport Etsy Address Enrichment v3.2 Loading', { url: window.location.href });

// Extract store information from current page
function getEtsyStoreInfo() {
  const url = window.location.href;
  
  // Extract shop ID from URL patterns like:
  // https://www.etsy.com/your/shops/12345/orders
  // https://www.etsy.com/your/shops/12345/tools/listings/orders
  const shopIdMatch = url.match(/\/shops\/(\d+)\//);
  const shopId = shopIdMatch ? shopIdMatch[1] : null;
  
  // Try to get store name from page elements
  let storeName = null;
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
  
  // Fallback: extract from URL breadcrumb or title
  if (!storeName) {
    const title = document.title;
    const titleMatch = title.match(/^([^|]+)/);
    if (titleMatch) {
      storeName = titleMatch[1].trim();
    }
  }
  
  log.info('Detected Etsy store info', { shopId, storeName });
  
  return { shopId, storeName };
}

// Get authentication token - try multiple sources
async function getAuthToken() {
  // Try localStorage first (common for SPAs)
  let token = localStorage.getItem("kxJwt") || localStorage.getItem("authToken");
  
  if (!token) {
    // Try getting from background script
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getAuthStatus' });
      token = response.token;
    } catch (e) {
      log.warn('Could not get auth token from background', e.message);
    }
  }
  
  if (!token) {
    // Try cookies via background script
    try {
      const cookies = await chrome.runtime.sendMessage({ 
        action: 'getCookies',
        domain: 'app.kolayxport.com'
      });
      
      // Look for auth cookies
      for (const [name, value] of Object.entries(cookies || {})) {
        if (name.includes('sb-') && name.includes('access-token')) {
          token = value;
          break;
        } else if (name === 'next-auth.session-token' || name === '__Secure-next-auth.session-token') {
          token = value;
          break;
        }
      }
    } catch (e) {
      log.warn('Could not get cookies', e.message);
    }
  }
  
  return token;
}

// Utility – push in batches and dedupe with chrome.storage.local
const pushBatch = async batch => {
  if (!batch.length) {
    log.info('No orders to sync');
    return;
  }
  
  log.info(`Attempting to sync ${batch.length} orders`);
  
  try {
    const token = await getAuthToken();
    if (!token) {
      log.error('No auth token available');
      return;
    }
    
    const headers = {
      'Content-Type': 'application/json',
      'X-Extension-Version': chrome.runtime.getManifest().version
    };
    
    // Add appropriate auth header based on token type
    if (token.includes('sb-')) {
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      headers['Cookie'] = `next-auth.session-token=${token}`;
    }
    
    log.info('Sending request to server', { 
      url: API, 
      orderCount: batch.length,
      firstOrderId: batch[0]?.orderId 
    });
    
    const response = await fetch(API, {
      method: "POST",
      headers,
      credentials: 'include',
      body: JSON.stringify({ 
        orders: batch,
        source: 'chrome-extension-v3.3-multistore',
        timestamp: new Date().toISOString()
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      log.success(`Successfully synced ${batch.length} orders`, result);
      
      // Update synced orders storage
      const synced = (await chrome.storage.local.get({ [STORAGE_KEY]: [] }))[STORAGE_KEY];
      const newSynced = [...synced, ...batch.map(o => o.orderId)].slice(-MAX_STORED_IDS);
      await chrome.storage.local.set({ [STORAGE_KEY]: newSynced });
      
      // Notify background script
      chrome.runtime.sendMessage({
        action: 'syncComplete',
        count: batch.length,
        totalSynced: newSynced.length
      });
      
    } else {
      const errorText = await response.text();
      log.error(`Server responded with ${response.status}`, { status: response.status, error: errorText });
    }
  } catch (err) {
    log.error("Sync failed", { message: err.message, stack: err.stack });
  }
};

// Core extractor using REAL Etsy DOM structure
async function extract() {
  log.info('Starting order extraction with v3.1 selectors and fixed data format');
  
  const synced = (await chrome.storage.local.get({ [STORAGE_KEY]: [] }))[STORAGE_KEY];
  
  // CORRECT SELECTOR: Look for order rows in Etsy's actual structure
  const orderRows = document.querySelectorAll('.panel-body-row');
  log.info(`Found ${orderRows.length} order rows using .panel-body-row`);
  
  if (orderRows.length === 0) {
    log.warn('No order rows found with .panel-body-row selector');
    return;
  }
  
  const batch = [];
  
  orderRows.forEach((row, index) => {
    try {
      // CORRECT: Extract order ID from checkbox name attribute
      const checkbox = row.querySelector('input[type="checkbox"][name]');
      const orderId = checkbox?.getAttribute('name');
      
      if (!orderId) {
        log.warn(`Row ${index}: No order ID found in checkbox`);
        return;
      }
      
      if (synced.includes(orderId)) {
        log.info(`Row ${index}: Order ${orderId} already synced, skipping`);
        return;
      }
      
      log.info(`Row ${index}: Processing order ${orderId}`);
      
      // Extract buyer name from dropdown button
      const buyerButton = row.querySelector('[data-dropdown-button="true"] [data-test-id="unsanitize"]');
      const buyerName = buyerButton?.textContent?.trim() || '';
      log.info(`Order ${orderId}: Found buyer name: "${buyerName}"`);
      
      // Extract order number from link
      const orderLink = row.querySelector('a[href*="order_id="]');
      const orderNumber = orderLink?.href?.match(/order_id=([^&]+)/)?.[1] || orderId;
      log.info(`Order ${orderId}: Found order number: ${orderNumber}`);
      
      // Extract order total
      const priceSpan = row.querySelector('.display-inline-block .mr-xs-1');
      const orderTotal = priceSpan?.textContent?.replace(/[^0-9.]/g, '') || '';
      log.info(`Order ${orderId}: Found total: $${orderTotal}`);
      
      // Extract order date
      const dateText = row.querySelector('.text-body-smaller:last-child')?.textContent || '';
      const orderDate = dateText.replace('Ordered ', '').trim();
      log.info(`Order ${orderId}: Found date: ${orderDate}`);
      
      // Extract shipping address - THIS IS THE CRITICAL PART
      let shippingAddress = {};
      const addressContainer = row.querySelector('.address');
      
      if (addressContainer) {
        // Parse structured address
        const nameSpan = addressContainer.querySelector('.name');
        const firstLineSpan = addressContainer.querySelector('.first-line');
        const citySpan = addressContainer.querySelector('.city');
        const stateSpan = addressContainer.querySelector('.state');
        const zipSpan = addressContainer.querySelector('.zip');
        const countrySpan = addressContainer.querySelector('.country-name');
        
        shippingAddress = {
          name: nameSpan?.textContent?.trim() || '',
          line1: firstLineSpan?.textContent?.trim() || '',
          line2: '', // Not typically shown in summary view
          city: citySpan?.textContent?.trim() || '',
          state: stateSpan?.textContent?.trim() || '',
          postalCode: zipSpan?.textContent?.trim() || '',
          country: countrySpan?.textContent?.trim() || ''
        };
        
        log.info(`Order ${orderId}: Found structured address`, shippingAddress);
      } else {
        // Fallback: Look for collapsed address view
        const collapsedAddress = row.querySelector('.break-word .text-body-smaller');
        if (collapsedAddress) {
          const addressText = collapsedAddress.textContent.trim();
          // Parse "Adam Greco Rye Brook, NY" format
          const parts = addressText.split(/,\s*/);
          if (parts.length >= 2) {
            const namePart = parts[0].trim();
            const locationPart = parts[1].trim();
            const stateParts = locationPart.split(/\s+/);
            
            shippingAddress = {
              name: namePart,
              line1: '',
              line2: '',
              city: stateParts.slice(0, -1).join(' '),
              state: stateParts[stateParts.length - 1],
              postalCode: '',
              country: ''
            };
            
            log.info(`Order ${orderId}: Parsed collapsed address`, shippingAddress);
          }
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
      
      // Simplified data structure - only order number, address, notes, and store info
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
          country: shippingAddress.country || 'US'
        },
        notes: notes || ''
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
      extract().then(() => {
        sendResponse({ 
          status: 'completed', 
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
        const status = {
          syncedCount: (result[STORAGE_KEY] || []).length,
          url: window.location.href,
          scriptLoaded: true,
          version: '3.1',
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

// One-shot extraction
extract();

// Observe for dynamic content updates
const observer = new MutationObserver(() => {
  // Debounce extraction to avoid too many calls
  clearTimeout(window.extractTimeout);
  window.extractTimeout = setTimeout(extract, 1000);
});

observer.observe(document.body, { 
  childList: true, 
  subtree: true 
});

log.info('Content script v3.1 initialization complete');

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
indicator.textContent = '✅ Kolayxport v3.1 - Fixed Data Format!';
document.body.appendChild(indicator);
setTimeout(() => indicator.remove(), 5000);