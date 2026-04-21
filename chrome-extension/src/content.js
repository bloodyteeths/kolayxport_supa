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

log.info('🚀 Kolayxport Etsy Address Enrichment v5.3 Loading', { url: window.location.href });

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
    const response = await chrome.runtime.sendMessage({ action: 'getAuthStatus' });
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
    const response = await chrome.runtime.sendMessage({
      action: 'syncOrders',
      orders: batch,
      source: 'chrome-extension-v5.3-multistore',
      timestamp: new Date().toISOString()
    });
    
    if (response.success) {
      const result = response.result;
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
      log.error(`Sync failed via background script`, { error: response.error });
    }
  } catch (err) {
    log.error("Sync failed", { message: err.message, stack: err.stack });
  }
};

// Helper function to expand address sections if collapsed
function expandAddressSections() {
  // Look for collapsed address buttons and click them
  const collapsedButtons = document.querySelectorAll('[data-content-toggle][aria-expanded="false"]');
  let expandedCount = 0;
  
  collapsedButtons.forEach(button => {
    // Check if this is an address-related toggle
    const buttonText = button.textContent?.toLowerCase() || '';
    if (buttonText.includes('ship to') || buttonText.includes('address')) {
      try {
        button.click();
        expandedCount++;
        log.info('Expanded address section');
      } catch (e) {
        log.warn('Failed to expand address section', e.message);
      }
    }
  });
  
  return expandedCount;
}

// Core extractor using REAL Etsy DOM structure
async function extract() {
  log.info('Starting order extraction with v3.2 selectors and address expansion');
  
  // First, try to expand any collapsed address sections
  const expandedCount = expandAddressSections();
  if (expandedCount > 0) {
    log.info(`Expanded ${expandedCount} address sections, waiting for DOM update`);
    await new Promise(r => setTimeout(r, 1000)); // Wait for expansion animation
  }
  
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
      
      // Extract shipping address - Updated for correct HTML structure
      let shippingAddress = {};
      
      // Look for expanded address view first (most detailed)
      const addressContainer = row.querySelector('.address.break-word');
      
      if (addressContainer) {
        // Parse structured address from expanded view
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
        
        log.info(`Order ${orderId}: Found expanded address structure`, shippingAddress);
      } else {
        // Try looking for collapsible address button area
        const shipToButton = row.querySelector('[data-content-toggle]');
        if (shipToButton) {
          // Look for address in the collapsible content area
          const addressContent = row.querySelector('.address');
          if (addressContent) {
            const nameSpan = addressContent.querySelector('.name');
            const firstLineSpan = addressContent.querySelector('.first-line');
            const citySpan = addressContent.querySelector('.city');
            const stateSpan = addressContent.querySelector('.state');
            const zipSpan = addressContent.querySelector('.zip');
            const countrySpan = addressContent.querySelector('.country-name');
            
            shippingAddress = {
              name: nameSpan?.textContent?.trim() || '',
              line1: firstLineSpan?.textContent?.trim() || '',
              line2: '',
              city: citySpan?.textContent?.trim() || '',
              state: stateSpan?.textContent?.trim() || '',
              postalCode: zipSpan?.textContent?.trim() || '',
              country: countrySpan?.textContent?.trim() || ''
            };
            
            log.info(`Order ${orderId}: Found collapsible address`, shippingAddress);
          }
        }
        
        // Final fallback: Look for any collapsed address summary
        if (!shippingAddress.name) {
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
              
              log.info(`Order ${orderId}: Parsed collapsed address fallback`, shippingAddress);
            }
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
          country: shippingAddress.country || 'US'
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
        const syncedOrderIds = result[STORAGE_KEY] || [];
        const totalOrdersOnPage = document.querySelectorAll('.panel-body-row').length;
        const pendingCount = Math.max(0, totalOrdersOnPage - syncedOrderIds.length);
        
        const status = {
          syncedCount: syncedOrderIds.length,
          pendingCount: pendingCount,
          totalOrdersOnPage: totalOrdersOnPage,
          url: window.location.href,
          scriptLoaded: true,
          version: '5.3',
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
      return Array.from(mutation.addedNodes).some(node => {
        return node.nodeType === 1 && // Element node
               (node.classList?.contains('panel-body-row') || 
                node.querySelector?.('.panel-body-row'));
      });
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

log.info('Content script v5.3 initialization complete');

// ─── Tracking Push Feature ─────────────────────────────────────────
// When user navigates to an Etsy order detail page, check if KolayXport
// has a pending tracking number and offer to fill it via DOM automation.

let trackingPushActive = false;
let pendingTrackingData = null;

// Detect if we're on an order detail page
function getReceiptIdFromUrl() {
  const url = window.location.href;
  // Patterns: /your/orders/1234567890, order_id=1234567890
  const match = url.match(/\/your\/orders\/(\d+)/) ||
                url.match(/order_id=(\d+)/);
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

    const actionTexts = [
      'mark as complete', 'add tracking', 'complete order',
      'mark as shipped', 'kargo bilgisi ekle', 'gönderildi olarak işaretle',
      'siparişi tamamla', 'tracking',
    ];

    let actionButton = null;

    // Try selectors first
    for (const sel of actionSelectors) {
      actionButton = document.querySelector(sel);
      if (actionButton) break;
    }

    // Fallback: search by button text
    if (!actionButton) {
      const allButtons = document.querySelectorAll('button, a.btn, [role="button"]');
      for (const b of allButtons) {
        const text = (b.textContent || '').toLowerCase().trim();
        if (actionTexts.some(t => text.includes(t))) {
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
      // Try to find matching option
      const options = carrierSelect.querySelectorAll('option');
      let matched = false;
      for (const opt of options) {
        const val = (opt.value || '').toLowerCase();
        const text = (opt.textContent || '').toLowerCase();
        if (val.includes(carrierValue) || text.includes(carrierValue) ||
            text.includes(data.carrierName.toLowerCase())) {
          carrierSelect.value = opt.value;
          carrierSelect.dispatchEvent(new Event('change', { bubbles: true }));
          matched = true;
          log.info(`Selected carrier: ${opt.textContent}`);
          break;
        }
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
      'submit', 'save', 'kaydet', 'gönder', 'complete', 'tamamla',
      'mark as complete', 'ship', 'confirm',
    ];

    // Look for submit button within the tracking form area
    const formArea = trackingInput.closest('form') || trackingInput.closest('[role="dialog"]') || trackingInput.closest('.overlay-body') || document.body;
    const submitButtons = formArea.querySelectorAll('button[type="submit"], button.btn-primary, input[type="submit"], button[data-test-id*="submit"]');

    let submitButton = null;

    // First try type="submit" or primary buttons
    if (submitButtons.length > 0) {
      submitButton = submitButtons[submitButtons.length - 1]; // Usually the last primary button
    }

    // Fallback: search by text
    if (!submitButton) {
      const allBtns = formArea.querySelectorAll('button, input[type="submit"]');
      for (const b of allBtns) {
        const text = (b.textContent || '').toLowerCase().trim();
        if (submitTexts.some(t => text.includes(t))) {
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
    await chrome.runtime.sendMessage({
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
    const response = await chrome.runtime.sendMessage({
      action: 'fetchPendingTracking',
      shopName: storeInfo.storeName,
    });

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