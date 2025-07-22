/* Kolayxport Etsy Orders scraper – v2.0
 * Injected on https://www.etsy.com/your/orders/**
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

log.info('🚀 Kolayxport Etsy Content Script v2.0 Loading', { url: window.location.href });

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
        source: 'chrome-extension-v2',
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

// Core extractor using ChatGPT's robust approach
async function extract() {
  log.info('Starting order extraction');
  
  const synced = (await chrome.storage.local.get({ [STORAGE_KEY]: [] }))[STORAGE_KEY];
  
  // Try multiple selector strategies for Etsy orders
  const selectors = [
    "tr[data-order-id]",                    // Primary selector
    "tr[data-receipt-id]",                  // Alternative
    "[data-order-id]",                      // Broader search
    ".order-row",                           // Class-based
    "[class*='order-']:has([data-order-id])" // Modern CSS
  ];
  
  let rows = [];
  for (const selector of selectors) {
    try {
      rows = document.querySelectorAll(selector);
      if (rows.length > 0) {
        log.info(`Found ${rows.length} order rows using selector: ${selector}`);
        break;
      }
    } catch (e) {
      log.warn(`Selector failed: ${selector}`, e.message);
    }
  }
  
  if (rows.length === 0) {
    log.warn('No order rows found with any selector');
    return;
  }
  
  const batch = [];
  
  rows.forEach((row, index) => {
    try {
      const orderId = row.getAttribute("data-order-id") || 
                     row.getAttribute("data-receipt-id") ||
                     row.querySelector("[data-order-id]")?.getAttribute("data-order-id");
      
      if (!orderId) {
        log.warn(`Row ${index}: No order ID found`);
        return;
      }
      
      if (synced.includes(orderId)) {
        log.info(`Row ${index}: Order ${orderId} already synced, skipping`);
        return;
      }
      
      log.info(`Row ${index}: Processing order ${orderId}`);
      
      // 1) Preferred: hidden JSON blob
      let j = row.querySelector("[data-ship-address]")?.dataset.shipAddress;
      let a = {};
      if (j) {
        try { 
          a = JSON.parse(j);
          log.info(`Order ${orderId}: Found JSON shipping address`, a);
        } catch (_) {
          log.warn(`Order ${orderId}: Failed to parse JSON shipping address`);
        }
      }
      
      // 2) Fallback: visible <address>
      if (!a.line1) {
        const addressEl = row.querySelector("address");
        if (addressEl) {
          const lines = addressEl.innerText.split("\n").map(t => t.trim()).filter(Boolean);
          log.info(`Order ${orderId}: Found address lines`, lines);
          
          if (lines.length >= 4) {
            a = {
              name:        lines[0],
              line1:       lines[1],
              line2:       lines.length === 6 ? lines[2] : "",
              city:        lines.at(-3),
              state:       lines.at(-2),
              postal_code: lines.at(-1),
              country:     ""                 // not always present
            };
            log.info(`Order ${orderId}: Parsed address from DOM`, a);
          }
        }
      }
      
      if (!a.line1) {
        log.warn(`Order ${orderId}: No valid shipping address found, skipping`);
        return;
      }
      
      // Line-items (title, sku, qty)
      const itemSelectors = [
        "li[data-item-id]",
        "[data-item-id]", 
        ".line-item",
        "[class*='item-']"
      ];
      
      let items = [];
      for (const itemSelector of itemSelectors) {
        const itemElements = row.querySelectorAll(itemSelector);
        if (itemElements.length > 0) {
          items = [...itemElements].map(li => ({
            id:    li.dataset.itemId || li.getAttribute('data-item-id') || '',
            qty:   +(li.querySelector("[data-quantity]")?.innerText || 
                     li.querySelector("[class*='quantity']")?.innerText || 1),
            sku:   li.querySelector("[data-sku]")?.innerText || 
                   li.querySelector("[class*='sku']")?.innerText || "",
            title: li.querySelector("[data-title]")?.innerText || 
                   li.querySelector("[class*='title']")?.innerText ||
                   li.querySelector("a")?.innerText || ""
          }));
          log.info(`Order ${orderId}: Found ${items.length} items using ${itemSelector}`, items);
          break;
        }
      }
      
      const orderData = {
        orderId,
        buyer:   a.name,
        addr1:   a.line1,
        addr2:   a.line2 || "",
        city:    a.city,
        state:   a.state,
        zip:     a.postal_code,
        country: a.country || "",
        phone:   a.phone || "",
        items
      };
      
      batch.push(orderData);
      log.info(`Order ${orderId}: Successfully extracted`, orderData);
      
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
  
  // Scroll to load more orders (ChatGPT's suggestion)
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

// Observe React infinite-scroll and dynamic content
const observer = new MutationObserver(() => {
  // Debounce extraction to avoid too many calls
  clearTimeout(window.extractTimeout);
  window.extractTimeout = setTimeout(extract, 1000);
});

observer.observe(document.body, { 
  childList: true, 
  subtree: true 
});

log.info('Content script initialization complete');

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
indicator.textContent = '✅ Kolayxport Extension Active';
document.body.appendChild(indicator);
setTimeout(() => indicator.remove(), 3000);