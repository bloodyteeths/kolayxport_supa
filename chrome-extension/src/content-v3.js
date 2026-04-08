/* Kolayxport Etsy Orders scraper – v3.0
 * Fixed selectors based on actual Etsy DOM structure
 * Extracts buyer address + line items and POSTs to Kolayxport SaaS.
 */

// Determine API endpoint based on current domain
const getKolayxportAPI = () => {
  const hostname = window.location.hostname;
  if (hostname.includes('localhost') || hostname.includes('127.0.0.1')) {
    return 'http://localhost:3000/api/integrations/etsy/orders';
  } else if (hostname.includes('staging') || hostname.includes('dev')) {
    return 'https://staging.kolayxport.com/api/integrations/etsy/orders';
  }
  return 'https://app.kolayxport.com/api/integrations/etsy/orders';
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

log.info('🚀 Kolayxport Etsy Content Script v3.0 Loading', { url: window.location.href });

// Get authentication token from background service worker
async function getAuthToken() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getAuthStatus' });
    if (response?.authenticated && response.token) {
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
    const token = await getAuthToken();
    if (!token) {
      log.error('No auth token available');
      return;
    }
    
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Extension-Version': chrome.runtime.getManifest().version
    };
    
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
        source: 'chrome-extension-v3',
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
  log.info('Starting order extraction with v3.0 selectors');
  
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
      
      // Extract items (basic extraction)
      const items = [];
      const productLink = row.querySelector('a[href*="/transaction/"]');
      if (productLink) {
        const title = productLink.getAttribute('title') || '';
        const image = row.querySelector('img[alt]');
        const alt = image?.getAttribute('alt') || title;
        
        // Extract quantity and variations
        const quantity = 1; // Default, could be extracted from item details
        
        items.push({
          id: productLink.href.match(/transaction\/(\d+)/)?.[1] || '',
          title: alt || title,
          quantity,
          sku: '',
          price: orderTotal
        });
        
        log.info(`Order ${orderId}: Found item: "${alt}"`);
      }
      
      const orderData = {
        orderId,
        orderNumber,
        buyer: buyerName,
        addr1: shippingAddress.line1 || '',
        addr2: shippingAddress.line2 || '',
        city: shippingAddress.city || '',
        state: shippingAddress.state || '',
        zip: shippingAddress.postalCode || '',
        country: shippingAddress.country || '',
        phone: '', // Not visible in summary view
        orderDate,
        orderTotal,
        items
      };
      
      // Only add if we have essential data
      if (orderData.orderId && orderData.buyer) {
        batch.push(orderData);
        log.success(`Order ${orderId}: Successfully extracted`, orderData);
      } else {
        log.warn(`Order ${orderId}: Missing essential data, skipping`, orderData);
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
          version: '3.0',
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

log.info('Content script v3.0 initialization complete');

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
indicator.textContent = '✅ Kolayxport v3.0 - Fixed Selectors!';
document.body.appendChild(indicator);
setTimeout(() => indicator.remove(), 5000);