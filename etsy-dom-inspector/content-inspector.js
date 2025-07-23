/* Kolayxport Etsy DOM Inspector – v1.0
 * Analyzes the actual DOM structure on Etsy orders page
 * to discover the correct selectors for order extraction
 */

const log = {
  messages: [],
  add: function(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, level, message, data };
    this.messages.push(logEntry);
    chrome.storage.local.set({ 'kx_inspector_logs': this.messages });
  },
  info: function(message, data) { this.add('info', message, data); },
  success: function(message, data) { this.add('success', message, data); },
  error: function(message, data) { this.add('error', message, data); },
  warn: function(message, data) { this.add('warn', message, data); }
};

log.info('🔍 Starting DOM inspection on Etsy orders page');

function inspectDOM() {
  const inspection = {
    url: window.location.href,
    title: document.title,
    timestamp: new Date().toISOString(),
    findings: {}
  };

  // 1. General page structure
  inspection.findings.pageStructure = {
    totalElements: document.querySelectorAll('*').length,
    divCount: document.querySelectorAll('div').length,
    tableCount: document.querySelectorAll('table').length,
    listCount: document.querySelectorAll('ul, ol').length
  };

  // 2. Look for any data attributes containing "order" or "receipt"
  const orderDataAttrs = [];
  document.querySelectorAll('*').forEach(el => {
    for (let attr of el.attributes) {
      if (attr.name.includes('order') || attr.name.includes('receipt') || 
          attr.value.includes('order') || attr.value.includes('receipt')) {
        orderDataAttrs.push({
          tag: el.tagName.toLowerCase(),
          attribute: attr.name,
          value: attr.value.substring(0, 100), // Truncate long values
          selector: generateSelector(el)
        });
      }
    }
  });
  inspection.findings.orderDataAttributes = orderDataAttrs.slice(0, 20); // Limit results

  // 3. Look for classes containing "order", "receipt", "sale", "transaction"
  const orderClasses = [];
  document.querySelectorAll('[class*="order"], [class*="receipt"], [class*="sale"], [class*="transaction"]').forEach(el => {
    orderClasses.push({
      tag: el.tagName.toLowerCase(),
      classes: el.className,
      selector: generateSelector(el),
      textContent: el.textContent.trim().substring(0, 100)
    });
  });
  inspection.findings.orderClasses = orderClasses.slice(0, 20);

  // 4. Look for table rows that might contain orders
  const tableRows = [];
  document.querySelectorAll('tr').forEach((tr, index) => {
    if (tr.textContent.trim().length > 0) {
      tableRows.push({
        index,
        selector: generateSelector(tr),
        attributes: Array.from(tr.attributes).map(attr => ({name: attr.name, value: attr.value.substring(0, 50)})),
        cellCount: tr.querySelectorAll('td, th').length,
        textPreview: tr.textContent.trim().substring(0, 100),
        hasAddress: !!tr.querySelector('address'),
        hasLinks: tr.querySelectorAll('a').length
      });
    }
  });
  inspection.findings.tableRows = tableRows.slice(0, 10);

  // 5. Look for list items that might be orders
  const listItems = [];
  document.querySelectorAll('li').forEach((li, index) => {
    if (li.textContent.trim().length > 50) { // Only substantial list items
      listItems.push({
        index,
        selector: generateSelector(li),
        attributes: Array.from(li.attributes).map(attr => ({name: attr.name, value: attr.value.substring(0, 50)})),
        textPreview: li.textContent.trim().substring(0, 100),
        hasAddress: !!li.querySelector('address'),
        hasLinks: li.querySelectorAll('a').length
      });
    }
  });
  inspection.findings.listItems = listItems.slice(0, 10);

  // 6. Look for divs that might contain order cards
  const orderDivs = [];
  document.querySelectorAll('div').forEach((div, index) => {
    const text = div.textContent.trim();
    if (text.length > 50 && text.length < 500) { // Reasonable size for order info
      const hasAddress = !!div.querySelector('address');
      const hasPrice = /\$\d+/.test(text);
      const hasDate = /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(text) || /Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/.test(text);
      
      if (hasAddress || (hasPrice && hasDate)) {
        orderDivs.push({
          index,
          selector: generateSelector(div),
          attributes: Array.from(div.attributes).map(attr => ({name: attr.name, value: attr.value.substring(0, 50)})),
          textPreview: text.substring(0, 150),
          hasAddress,
          hasPrice,
          hasDate,
          childrenCount: div.children.length
        });
      }
    }
  });
  inspection.findings.potentialOrderDivs = orderDivs.slice(0, 15);

  // 7. Look for address elements (shipping addresses)
  const addresses = [];
  document.querySelectorAll('address').forEach((addr, index) => {
    addresses.push({
      index,
      selector: generateSelector(addr),
      textContent: addr.textContent.trim(),
      parentTag: addr.parentElement?.tagName.toLowerCase(),
      parentSelector: generateSelector(addr.parentElement)
    });
  });
  inspection.findings.addresses = addresses;

  // 8. Look for specific patterns in text content
  const textPatterns = {
    orderNumbers: [],
    prices: [],
    dates: []
  };

  const bodyText = document.body.textContent;
  
  // Order number patterns
  const orderMatches = bodyText.match(/#?\d{8,}/g);
  if (orderMatches) textPatterns.orderNumbers = orderMatches.slice(0, 10);
  
  // Price patterns
  const priceMatches = bodyText.match(/\$\d+\.?\d*/g);
  if (priceMatches) textPatterns.prices = priceMatches.slice(0, 10);
  
  // Date patterns
  const dateMatches = bodyText.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/g);
  if (dateMatches) textPatterns.dates = dateMatches.slice(0, 10);

  inspection.findings.textPatterns = textPatterns;

  // 9. Look for React/Vue component markers
  const frameworks = {
    reactElements: document.querySelectorAll('[data-reactroot], [data-react-checksum]').length,
    vueElements: document.querySelectorAll('[data-v-]').length,
    angularElements: document.querySelectorAll('[ng-]').length
  };
  inspection.findings.frameworks = frameworks;

  return inspection;
}

function generateSelector(element) {
  if (!element) return null;
  
  // Try ID first
  if (element.id) return `#${element.id}`;
  
  // Try unique class
  if (element.className) {
    const classes = element.className.split(' ').filter(c => c.trim());
    if (classes.length > 0) {
      return `.${classes[0]}`;
    }
  }
  
  // Fallback to tag with position
  const parent = element.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children);
    const index = siblings.indexOf(element);
    return `${element.tagName.toLowerCase()}:nth-child(${index + 1})`;
  }
  
  return element.tagName.toLowerCase();
}

// Message listener for popup communication
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  log.info('Inspector received message', request);
  
  switch (request.action) {
    case 'inspectDOM':
      log.info('Starting DOM inspection');
      const inspection = inspectDOM();
      log.success('DOM inspection completed', { findingsCount: Object.keys(inspection.findings).length });
      sendResponse(inspection);
      break;
      
    case 'getInspectorLogs':
      chrome.storage.local.get(['kx_inspector_logs']).then(result => {
        sendResponse({ logs: result.kx_inspector_logs || [] });
      });
      break;
      
    default:
      log.warn('Unknown inspector action', request.action);
  }
  
  return true;
});

// Auto-run inspection on load
log.info('DOM Inspector loaded, running initial inspection');
const initialInspection = inspectDOM();
log.success('Initial inspection complete', initialInspection);

// Add visual indicator
const indicator = document.createElement('div');
indicator.style.cssText = `
  position: fixed !important;
  top: 10px !important;
  right: 10px !important;
  background: #FF5722 !important;
  color: white !important;
  padding: 8px 12px !important;
  border-radius: 6px !important;
  z-index: 999999 !important;
  font-size: 12px !important;
  font-family: Arial, sans-serif !important;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2) !important;
`;
indicator.textContent = '🔍 DOM Inspector Active';
document.body.appendChild(indicator);
setTimeout(() => indicator.remove(), 5000);