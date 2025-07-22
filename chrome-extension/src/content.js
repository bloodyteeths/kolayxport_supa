/**
 * Kolayxport Etsy Order Sync - Content Script
 * Runs on Etsy Shop Manager order pages to extract and sync order data
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

const KOLAYXPORT_API = getKolayxportAPI();
const STORAGE_KEY = 'kx_synced_orders';
const MAX_STORED_IDS = 5000;
const SYNC_DEBOUNCE_MS = 1000;

class EtsyOrderScraper {
  constructor() {
    this.syncedOrderIds = new Set();
    this.pendingSync = [];
    this.syncTimeout = null;
    this.authToken = null;
    this.refreshToken = null;
    this.init();
  }

  async init() {
    // Load previously synced order IDs
    await this.loadSyncedOrders();
    
    // Get authentication token
    await this.getAuthToken();
    
    // Start scraping immediately
    this.scrapeOrders();
    
    // Observe DOM changes for dynamic content
    this.setupObserver();
    
    // Listen for messages from background script
    this.setupMessageListener();
  }

  async loadSyncedOrders() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      if (result[STORAGE_KEY]) {
        this.syncedOrderIds = new Set(result[STORAGE_KEY]);
      }
    } catch (error) {
      console.error('Failed to load synced orders:', error);
    }
  }

  async getAuthToken() {
    try {
      // Check for Supabase auth cookies
      const cookies = await chrome.runtime.sendMessage({ 
        action: 'getCookies',
        domain: 'app.kolayxport.com'
      });
      
      // Look for Supabase auth tokens
      if (cookies) {
        // Check for sb-access-token or sb-refresh-token
        for (const [name, value] of Object.entries(cookies)) {
          if (name.includes('sb-') && name.includes('access-token')) {
            this.authToken = value;
            break;
          } else if (name.includes('sb-') && name.includes('refresh-token')) {
            this.refreshToken = value;
          }
        }
        
        // Fallback to any auth-related cookie
        if (!this.authToken) {
          this.authToken = cookies['next-auth.session-token'] || 
                          cookies['__Secure-next-auth.session-token'] ||
                          cookies['authToken'];
        }
      }
    } catch (error) {
      console.error('Failed to get auth token:', error);
    }
  }

  setupObserver() {
    const observer = new MutationObserver(() => {
      this.scrapeOrders();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false
    });
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      console.log('📨 Received message from background:', request);
      
      switch (request.action) {
        case 'scrapeNow':
          console.log('🎯 Manual sync triggered from popup');
          this.scrapeOrders();
          sendResponse({ status: 'started' });
          break;
        case 'fullImport':
          console.log('📥 Full import triggered');
          this.performFullImport();
          sendResponse({ status: 'importing' });
          break;
        case 'getStatus':
          const status = {
            syncedCount: this.syncedOrderIds.size,
            pendingCount: this.pendingSync.length,
            authenticated: !!this.authToken
          };
          console.log('📊 Status requested:', status);
          sendResponse(status);
          break;
        default:
          console.log('❓ Unknown action:', request.action);
      }
      
      return true; // Keep message channel open for async response
    });
  }

  scrapeOrders() {
    const orders = this.extractOrderData();
    const newOrders = orders.filter(order => !this.syncedOrderIds.has(order.orderId));
    
    if (newOrders.length > 0) {
      this.pendingSync.push(...newOrders);
      this.scheduleSyncBatch();
    }
  }

  extractOrderData() {
    const orders = [];
    
    console.log('🔍 Starting order extraction from Etsy page...');
    console.log('Current URL:', window.location.href);
    
    // Strategy 1: Look for order rows with data attributes
    const orderRows = document.querySelectorAll('[data-order-id], [data-receipt-id]');
    console.log(`Found ${orderRows.length} rows with data attributes`);
    
    orderRows.forEach(row => {
      const orderData = this.extractOrderFromRow(row);
      if (orderData && orderData.orderId) {
        orders.push(orderData);
        console.log('✅ Extracted order from row:', orderData.orderId);
      }
    });
    
    // Strategy 2: Look for order cards (newer UI)
    const orderCards = document.querySelectorAll('.order-card, [class*="order-item"], [class*="receipt-card"]');
    console.log(`Found ${orderCards.length} order cards`);
    
    orderCards.forEach(card => {
      const orderData = this.extractOrderFromCard(card);
      if (orderData && orderData.orderId) {
        orders.push(orderData);
        console.log('✅ Extracted order from card:', orderData.orderId);
      }
    });
    
    // Strategy 3: Modern Etsy UI - Look for common patterns
    const modernOrderElements = document.querySelectorAll('div[class*="order"], div[class*="receipt"], table tr[class*="order"], li[class*="order"]');
    console.log(`Found ${modernOrderElements.length} potential modern order elements`);
    
    modernOrderElements.forEach(element => {
      const orderData = this.extractOrderFromModernUI(element);
      if (orderData && orderData.orderId && !orders.find(o => o.orderId === orderData.orderId)) {
        orders.push(orderData);
        console.log('✅ Extracted order from modern UI:', orderData.orderId);
      }
    });
    
    // Strategy 4: Fallback - scan all elements for order patterns
    if (orders.length === 0) {
      console.log('🔍 No orders found, trying fallback pattern matching...');
      this.scanForOrderPatterns().forEach(order => {
        if (order && order.orderId && !orders.find(o => o.orderId === order.orderId)) {
          orders.push(order);
          console.log('✅ Extracted order from pattern scan:', order.orderId);
        }
      });
    }
    
    console.log(`📊 Total orders extracted: ${orders.length}`);
    
    return orders;
  }

  extractOrderFromRow(row) {
    try {
      // Extract order ID
      const orderId = row.getAttribute('data-order-id') || 
                     row.getAttribute('data-receipt-id') ||
                     row.querySelector('[data-order-id]')?.getAttribute('data-order-id');
      
      if (!orderId) return null;
      
      // Try to get address from data attribute first
      const shipAddressData = row.querySelector('[data-ship-address]')?.getAttribute('data-ship-address');
      let address = {};
      
      if (shipAddressData) {
        try {
          address = JSON.parse(shipAddressData);
        } catch (e) {
          console.warn('Failed to parse ship address JSON:', e);
        }
      }
      
      // Fallback: extract from visible text
      if (!address.line1) {
        address = this.extractAddressFromDOM(row);
      }
      
      // Extract additional order details
      const orderDetails = {
        orderId,
        orderNumber: this.extractOrderNumber(row),
        buyerName: address.name || this.extractBuyerName(row),
        orderDate: this.extractOrderDate(row),
        orderTotal: this.extractOrderTotal(row),
        items: this.extractOrderItems(row),
        shippingAddress: {
          name: address.name || '',
          line1: address.line1 || address.street_address || '',
          line2: address.line2 || address.extended_address || '',
          city: address.city || address.locality || '',
          state: address.state || address.region || '',
          postalCode: address.postal_code || address.zip || '',
          country: address.country || address.country_code || ''
        }
      };
      
      return orderDetails;
    } catch (error) {
      console.error('Error extracting order from row:', error);
      return null;
    }
  }

  extractOrderFromCard(card) {
    try {
      // Extract order ID from various possible locations
      const orderId = this.findOrderIdInElement(card);
      if (!orderId) return null;
      
      const addressElement = card.querySelector('address, [class*="shipping-address"], [class*="ship-to"]');
      const address = this.extractAddressFromDOM(addressElement || card);
      
      return {
        orderId,
        orderNumber: this.extractOrderNumber(card),
        buyerName: address.name || this.extractBuyerName(card),
        orderDate: this.extractOrderDate(card),
        orderTotal: this.extractOrderTotal(card),
        items: this.extractOrderItems(card),
        shippingAddress: address
      };
    } catch (error) {
      console.error('Error extracting order from card:', error);
      return null;
    }
  }

  findOrderIdInElement(element) {
    // Try various strategies to find order ID
    const strategies = [
      () => element.getAttribute('data-order-id'),
      () => element.getAttribute('data-receipt-id'),
      () => element.querySelector('[data-order-id]')?.getAttribute('data-order-id'),
      () => element.querySelector('[data-receipt-id]')?.getAttribute('data-receipt-id'),
      () => element.querySelector('a[href*="/orders/"]')?.href.match(/orders\/(\d+)/)?.[1],
      () => element.querySelector('a[href*="receipt_id="]')?.href.match(/receipt_id=(\d+)/)?.[1],
      () => element.textContent.match(/Order\s*#?\s*(\d{8,})/)?.[1],
      () => element.textContent.match(/Receipt\s*#?\s*(\d{8,})/)?.[1]
    ];
    
    for (const strategy of strategies) {
      const result = strategy();
      if (result) return result;
    }
    
    return null;
  }

  extractAddressFromDOM(element) {
    const address = {
      name: '',
      line1: '',
      line2: '',
      city: '',
      state: '',
      postalCode: '',
      country: ''
    };
    
    // Look for address block
    const addressBlock = element.querySelector('address') || element;
    const addressText = addressBlock.innerText || addressBlock.textContent || '';
    const lines = addressText.split('\n').map(line => line.trim()).filter(Boolean);
    
    if (lines.length >= 3) {
      address.name = lines[0];
      address.line1 = lines[1];
      
      // Check if line 2 is a street address continuation
      let cityStateZipIndex = 2;
      if (lines.length > 3 && !lines[2].match(/[,\d]/)) {
        address.line2 = lines[2];
        cityStateZipIndex = 3;
      }
      
      // Parse city, state, zip
      if (lines[cityStateZipIndex]) {
        const cityStateZip = lines[cityStateZipIndex];
        const parts = cityStateZip.split(/[,\s]+/).filter(Boolean);
        
        if (parts.length >= 3) {
          address.city = parts.slice(0, -2).join(' ');
          address.state = parts[parts.length - 2];
          address.postalCode = parts[parts.length - 1];
        }
      }
      
      // Country might be on the last line
      if (lines.length > cityStateZipIndex + 1) {
        address.country = lines[cityStateZipIndex + 1];
      }
    }
    
    return address;
  }

  extractOrderNumber(element) {
    const patterns = [
      /Order\s*#?\s*(\d+)/i,
      /Receipt\s*#?\s*(\d+)/i,
      /Transaction\s*#?\s*(\d+)/i
    ];
    
    for (const pattern of patterns) {
      const match = element.textContent.match(pattern);
      if (match) return match[1];
    }
    
    return '';
  }

  extractBuyerName(element) {
    const selectors = [
      '[class*="buyer-name"]',
      '[class*="customer-name"]',
      '[data-buyer-name]',
      'strong:first-of-type'
    ];
    
    for (const selector of selectors) {
      const nameElement = element.querySelector(selector);
      if (nameElement?.textContent) {
        return nameElement.textContent.trim();
      }
    }
    
    return '';
  }

  extractOrderDate(element) {
    const datePatterns = [
      /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}/i,
      /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,
      /\b\d{4}-\d{2}-\d{2}\b/
    ];
    
    for (const pattern of datePatterns) {
      const match = element.textContent.match(pattern);
      if (match) return match[0];
    }
    
    return '';
  }

  extractOrderTotal(element) {
    const pricePatterns = [
      /Total[:\s]+\$?([\d,]+\.?\d*)/i,
      /Order\s+total[:\s]+\$?([\d,]+\.?\d*)/i,
      /\$?([\d,]+\.?\d*)\s*USD/
    ];
    
    for (const pattern of pricePatterns) {
      const match = element.textContent.match(pattern);
      if (match) return match[1].replace(',', '');
    }
    
    return '';
  }

  extractOrderItems(element) {
    const items = [];
    const itemElements = element.querySelectorAll('[class*="line-item"], [class*="order-item"], [class*="product"]');
    
    itemElements.forEach(itemEl => {
      const item = {
        title: itemEl.querySelector('[class*="title"], [class*="name"]')?.textContent?.trim() || '',
        quantity: itemEl.querySelector('[class*="quantity"]')?.textContent?.match(/\d+/)?.[0] || '1',
        price: itemEl.querySelector('[class*="price"]')?.textContent?.match(/[\d.]+/)?.[0] || '',
        sku: itemEl.querySelector('[class*="sku"]')?.textContent?.trim() || '',
        variation: itemEl.querySelector('[class*="variation"], [class*="variant"]')?.textContent?.trim() || ''
      };
      
      if (item.title) {
        items.push(item);
      }
    });
    
    return items;
  }
  
  extractOrderFromModernUI(element) {
    try {
      const orderId = this.findOrderIdInElement(element);
      if (!orderId) return null;
      
      // Modern Etsy UI often uses more semantic selectors
      const buyerName = this.extractTextFromSelectors(element, [
        '[data-test-id="buyer-name"]',
        '[class*="buyer"], [class*="customer"]',
        'strong', 'b'
      ]);
      
      const orderTotal = this.extractTextFromSelectors(element, [
        '[data-test-id="order-total"]',
        '[class*="total"], [class*="amount"]',
        '[class*="price"]'
      ]);
      
      const orderDate = this.extractOrderDate(element);
      
      return {
        orderId,
        orderNumber: this.extractOrderNumber(element),
        buyerName,
        orderDate,
        orderTotal,
        items: this.extractOrderItems(element),
        shippingAddress: this.extractAddressFromDOM(element)
      };
    } catch (error) {
      console.error('Error extracting order from modern UI:', error);
      return null;
    }
  }
  
  scanForOrderPatterns() {
    const orders = [];
    const bodyText = document.body.innerText || document.body.textContent || '';
    
    // Look for order number patterns in the page text
    const orderMatches = bodyText.match(/(?:Order|Receipt)[\s#]*(\d{8,})/gi);
    
    if (orderMatches) {
      orderMatches.forEach(match => {
        const orderId = match.match(/(\d{8,})/)[1];
        if (orderId) {
          orders.push({
            orderId,
            orderNumber: orderId,
            buyerName: 'Unknown',
            orderDate: new Date().toISOString(),
            orderTotal: '0',
            items: [],
            shippingAddress: {}
          });
        }
      });
    }
    
    return orders;
  }
  
  extractTextFromSelectors(element, selectors) {
    for (const selector of selectors) {
      const el = element.querySelector(selector);
      if (el && el.textContent && el.textContent.trim()) {
        return el.textContent.trim();
      }
    }
    return '';
  }

  scheduleSyncBatch() {
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
    }
    
    this.syncTimeout = setTimeout(() => {
      this.syncBatch();
    }, SYNC_DEBOUNCE_MS);
  }

  async syncBatch() {
    console.log('🚀 Starting sync batch...');
    console.log(`Pending sync orders: ${this.pendingSync.length}`);
    console.log(`Auth token available: ${!!this.authToken}`);
    
    if (this.pendingSync.length === 0) {
      console.log('❌ No orders to sync');
      return;
    }
    
    if (!this.authToken) {
      console.log('❌ No auth token available');
      return;
    }
    
    const batch = this.pendingSync.splice(0, 20); // Process fewer orders at a time for reliability
    console.log(`📦 Processing batch of ${batch.length} orders:`, batch.map(o => o.orderId));
    
    try {
      const headers = {
        'Content-Type': 'application/json',
        'X-Extension-Version': chrome.runtime.getManifest().version
      };
      
      // Add appropriate auth header based on token type
      if (this.authToken) {
        if (this.authToken.includes('sb-')) {
          // Supabase token
          headers['Authorization'] = `Bearer ${this.authToken}`;
        } else {
          // NextAuth token
          headers['Cookie'] = `next-auth.session-token=${this.authToken}`;
        }
      }
      
      console.log(`🌐 Sending request to: ${KOLAYXPORT_API}`);
      console.log('📋 Request headers:', headers);
      console.log('📦 Request payload:', { orders: batch, source: 'chrome-extension' });
      
      const response = await fetch(KOLAYXPORT_API, {
        method: 'POST',
        headers,
        credentials: 'include', // Include cookies for auth
        body: JSON.stringify({
          orders: batch,
          source: 'chrome-extension',
          timestamp: new Date().toISOString()
        })
      });
      
      console.log(`📡 Response status: ${response.status} ${response.statusText}`);
      
      if (response.ok) {
        const result = await response.json();
        console.log('✅ Sync successful:', result);
        
        // Mark orders as synced
        batch.forEach(order => {
          this.syncedOrderIds.add(order.orderId);
        });
        
        // Update storage
        await this.updateSyncedOrders();
        
        // Notify background script
        chrome.runtime.sendMessage({
          action: 'syncComplete',
          count: batch.length,
          totalSynced: this.syncedOrderIds.size
        });
        
        console.log(`🎉 Successfully synced ${batch.length} orders`);
        
        // Process remaining orders
        if (this.pendingSync.length > 0) {
          console.log(`🔄 Processing remaining ${this.pendingSync.length} orders...`);
          this.scheduleSyncBatch();
        }
      } else {
        // Handle errors
        const error = await response.text();
        console.error('❌ Sync failed with status:', response.status);
        console.error('❌ Error details:', error);
        
        // Put orders back in pending queue
        this.pendingSync.unshift(...batch);
        
        // Notify user of error
        chrome.runtime.sendMessage({
          action: 'syncError',
          error: error || response.statusText
        });
      }
    } catch (error) {
      console.error('Network error during sync:', error);
      
      // Put orders back in pending queue
      this.pendingSync.unshift(...batch);
      
      // Retry after delay
      setTimeout(() => this.scheduleSyncBatch(), 5000);
    }
  }

  async updateSyncedOrders() {
    // Keep only the most recent order IDs to prevent storage bloat
    const orderIds = Array.from(this.syncedOrderIds);
    if (orderIds.length > MAX_STORED_IDS) {
      const recentIds = orderIds.slice(-MAX_STORED_IDS);
      this.syncedOrderIds = new Set(recentIds);
    }
    
    await chrome.storage.local.set({
      [STORAGE_KEY]: Array.from(this.syncedOrderIds)
    });
  }

  async performFullImport() {
    // Scroll to load all orders
    let previousHeight = 0;
    let scrollAttempts = 0;
    const maxScrollAttempts = 50; // Prevent infinite scrolling
    
    const scrollInterval = setInterval(async () => {
      const currentHeight = document.body.scrollHeight;
      
      if (currentHeight === previousHeight || scrollAttempts >= maxScrollAttempts) {
        clearInterval(scrollInterval);
        
        // Final scrape after all content is loaded
        this.scrapeOrders();
        
        chrome.runtime.sendMessage({
          action: 'importComplete',
          totalOrders: this.syncedOrderIds.size
        });
        
        return;
      }
      
      previousHeight = currentHeight;
      scrollAttempts++;
      
      // Scroll to bottom
      window.scrollTo(0, currentHeight);
      
      // Scrape newly loaded content
      this.scrapeOrders();
      
    }, 1000);
  }
}

// Initialize scraper when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new EtsyOrderScraper();
  });
} else {
  new EtsyOrderScraper();
}