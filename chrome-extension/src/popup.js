/**
 * Kolayxport Etsy Order Sync - Popup Script
 * Manages the extension popup UI and user interactions
 */

// DOM Elements
const elements = {
  authStatus: document.getElementById('authStatus'),
  authMessage: document.getElementById('authMessage'),
  totalSynced: document.getElementById('totalSynced'),
  pendingSync: document.getElementById('pendingSync'),
  lastSync: document.getElementById('lastSync'),
  syncNowBtn: document.getElementById('syncNowBtn'),
  openEtsyBtn: document.getElementById('openEtsyBtn'),
  fullImportBtn: document.getElementById('fullImportBtn'),
  refreshAuthBtn: document.getElementById('refreshAuthBtn')
};

// State
let isAuthenticated = false;
let currentTab = null;
let isOnEtsyOrders = false;

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuthStatus();
  await checkCurrentTab();
  await loadSyncStats();
  setupEventListeners();
});

// Check authentication status
async function checkAuthStatus() {
  try {
    console.log('Checking auth status from popup...');
    const response = await chrome.runtime.sendMessage({ action: 'getAuthStatus' });
    console.log('Auth status response:', response);
    
    isAuthenticated = response.authenticated;
    
    updateAuthUI(isAuthenticated, response);
  } catch (error) {
    console.error('Failed to check auth status:', error);
    updateAuthUI(false, { error: error.message });
  }
}

// Check if current tab is Etsy orders page
async function checkCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;
    isOnEtsyOrders = tab.url && tab.url.includes('etsy.com/your/orders');
    
    // Enable/disable buttons based on context
    updateButtonStates();
  } catch (error) {
    console.error('Failed to check current tab:', error);
  }
}

// Load sync statistics
async function loadSyncStats() {
  try {
    // Get stats from storage
    const result = await chrome.storage.local.get(['syncStats', 'kx_synced_orders']);
    const stats = result.syncStats || {};
    const syncedOrders = result.kx_synced_orders || [];
    
    // Update UI
    elements.totalSynced.textContent = stats.totalSynced || syncedOrders.length;
    
    // Fix date formatting
    if (stats.lastSyncTime) {
      const lastSyncDate = new Date(stats.lastSyncTime);
      if (!isNaN(lastSyncDate.getTime())) {
        elements.lastSync.textContent = formatRelativeTime(lastSyncDate);
      } else {
        elements.lastSync.textContent = 'Invalid date';
      }
    } else {
      elements.lastSync.textContent = 'Hiçbir zaman';
    }
    
    // Get pending count from content script if on Etsy page
    if (isOnEtsyOrders && currentTab) {
      try {
        const response = await chrome.tabs.sendMessage(currentTab.id, { action: 'getStatus' });
        if (response && typeof response.pendingCount === 'number') {
          elements.pendingSync.textContent = response.pendingCount;
        } else {
          elements.pendingSync.textContent = '0';
        }
      } catch (error) {
        console.log('Could not get pending count from content script:', error.message);
        elements.pendingSync.textContent = '0';
      }
    } else {
      elements.pendingSync.textContent = '0';
    }
  } catch (error) {
    console.error('Failed to load sync stats:', error);
  }
}

// Update authentication UI
function updateAuthUI(authenticated, response = {}) {
  if (authenticated) {
    elements.authStatus.textContent = 'Bağlandı';
    elements.authStatus.className = 'status-badge connected';
    elements.authMessage.textContent = 'Kolayxport hesabınız bağlandı';
  } else {
    elements.authStatus.textContent = 'Bağlantı Kesildi';
    elements.authStatus.className = 'status-badge disconnected';
    
    if (response.error) {
      elements.authMessage.textContent = `Hata: ${response.error}`;
    } else {
      elements.authMessage.textContent = 'Siparişleri senkronlamak için Kolayxport\'a giriş yapın';
    }
  }
  
  // Add debug info for development
  if (response.debug) {
    console.log('Auth debug info:', response.debug);
  }
  
  updateButtonStates();
}

// Update button states based on context
function updateButtonStates() {
  // Sync Now button - enabled if authenticated and on Etsy orders page
  elements.syncNowBtn.disabled = !isAuthenticated || !isOnEtsyOrders;
  
  // Full Import button - same requirements as Sync Now
  elements.fullImportBtn.disabled = !isAuthenticated || !isOnEtsyOrders;
  
  // Update button tooltips
  if (!isAuthenticated) {
    elements.syncNowBtn.title = 'Önce Kolayxport\'a giriş yapın';
    elements.fullImportBtn.title = 'Önce Kolayxport\'a giriş yapın';
  } else if (!isOnEtsyOrders) {
    elements.syncNowBtn.title = 'Etsy siparişler sayfanıza gidin';
    elements.fullImportBtn.title = 'Etsy siparişler sayfanıza gidin';
  } else {
    elements.syncNowBtn.title = 'Mevcut sayfadaki görünür siparişleri senkronla';
    elements.fullImportBtn.title = 'Tüm geçmiş siparişleri içe aktar (zaman alabilir)';
  }
}

// Setup event listeners
function setupEventListeners() {
  // Refresh Auth button
  elements.refreshAuthBtn.addEventListener('click', async () => {
    elements.refreshAuthBtn.textContent = '⟳ Kontrol ediliyor...';
    elements.refreshAuthBtn.disabled = true;
    
    await checkAuthStatus();
    
    elements.refreshAuthBtn.textContent = '🔄 Yenile';
    elements.refreshAuthBtn.disabled = false;
  });
  
  // Add logs viewer button
  const logsBtn = document.createElement('button');
  logsBtn.textContent = '📋 Logları Görüntüle';
  logsBtn.className = 'btn-secondary';
  logsBtn.addEventListener('click', showLogs);
  document.querySelector('.actions').appendChild(logsBtn);
  
  // Sync Now button
  elements.syncNowBtn.addEventListener('click', async () => {
    if (!currentTab || !isOnEtsyOrders) return;
    
    try {
      elements.syncNowBtn.disabled = true;
      elements.syncNowBtn.innerHTML = '<span class="loading"></span> Senkronlanıyor...';
      
      console.log('🎯 Triggering sync from popup...');
      console.log('Current tab URL:', currentTab.url);
      console.log('Tab ID:', currentTab.id);
      
      // First check if content script is loaded
      let response;
      try {
        response = await chrome.tabs.sendMessage(currentTab.id, { action: 'getStatus' });
        console.log('✅ Content script is loaded, status:', response);
      } catch (contentError) {
        console.warn('❌ Content script not loaded, injecting...');
        
        // Inject content script manually
        await chrome.scripting.executeScript({
          target: { tabId: currentTab.id },
          files: ['src/content.js']
        });
        
        // Wait a moment for script to initialize
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        response = await chrome.tabs.sendMessage(currentTab.id, { action: 'getStatus' });
        console.log('✅ Content script injected and loaded, status:', response);
      }
      
      // Now trigger sync
      const syncResponse = await chrome.tabs.sendMessage(currentTab.id, { action: 'scrapeNow' });
      console.log('🚀 Sync triggered:', syncResponse);
      
      // Don't close popup - let background process handle it
      showMessage('Senkron başlatıldı! Siparişler arka planda senkronlanacak.', 'success');
      
      // Reload stats after a moment
      setTimeout(async () => {
        await loadSyncStats();
        elements.syncNowBtn.innerHTML = `
          <svg class="btn-icon" viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
          </svg>
          Şimdi Senkronla
        `;
        elements.syncNowBtn.disabled = false;
      }, 2000);
      
    } catch (error) {
      console.error('❌ Failed to trigger sync:', error);
      
      let errorMessage = 'Senkron başlatılamadı.';
      if (error.message.includes('Could not establish connection')) {
        errorMessage = 'İçerik scripti yüklenemedi. Etsy sayfasını yenileyin ve tekrar deneyin.';
      } else if (error.message.includes('Frame with ID')) {
        errorMessage = 'Sayfa hazır değil. Biraz bekleyin ve tekrar deneyin.';
      }
      
      showMessage(errorMessage, 'error');
      
      elements.syncNowBtn.innerHTML = `
        <svg class="btn-icon" viewBox="0 0 24 24" width="16" height="16">
          <path fill="currentColor" d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
        </svg>
        Şimdi Senkronla
      `;
      elements.syncNowBtn.disabled = false;
    }
  });
  
  // Open Etsy button
  elements.openEtsyBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.etsy.com/your/orders/sold' });
    window.close();
  });
  
  // Full Import button
  elements.fullImportBtn.addEventListener('click', async () => {
    if (!currentTab || !isOnEtsyOrders) return;
    
    const confirmed = confirm(
      'Bu işlem geçmiş verileri içe aktarmak için tüm siparişlerinizi tarayacak. ' +
      'Sipariş hacminize bağlı olarak birkaç dakika sürebilir. Devam etmek istiyor musunuz?'
    );
    
    if (!confirmed) return;
    
    try {
      elements.fullImportBtn.disabled = true;
      elements.fullImportBtn.innerHTML = '<span class="loading"></span> İçe aktarılıyor...';
      
      await chrome.tabs.sendMessage(currentTab.id, { action: 'fullImport' });
      
      showMessage('Tam içe aktarma başlatıldı. Bu sekmeyi açık tutun.', 'success');
    } catch (error) {
      console.error('Failed to start import:', error);
      showMessage('İçe aktarma başlatılamadı. Sayfayı yenileyin ve tekrar deneyin.', 'error');
      elements.fullImportBtn.disabled = false;
    }
  });
  
  // Listen for updates from background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'syncComplete' || request.action === 'importComplete') {
      loadSyncStats();
    }
  });
}

// Utility functions
function formatRelativeTime(date) {
  const now = new Date();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (seconds < 60) {
    return 'Just now';
  } else if (minutes < 60) {
    return `${minutes}m ago`;
  } else if (hours < 24) {
    return `${hours}h ago`;
  } else if (days < 7) {
    return `${days}d ago`;
  } else {
    return date.toLocaleDateString();
  }
}

function showMessage(text, type) {
  // Create message element
  const message = document.createElement('div');
  message.className = `message ${type} show`;
  message.textContent = text;
  
  // Insert after actions
  const actions = document.querySelector('.actions');
  actions.parentNode.insertBefore(message, actions.nextSibling);
  
  // Remove after 5 seconds
  setTimeout(() => {
    message.remove();
  }, 5000);
}

// Show logs in a modal
function showLogs() {
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0];
    if (tab && tab.url && tab.url.includes('etsy.com')) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getLogs' });
        displayLogsModal(response.logs || []);
      } catch (error) {
        showMessage('Etsy sayfasından loglar alınamadı', 'error');
      }
    } else {
      // Get logs from storage
      const result = await chrome.storage.local.get(['kx_logs']);
      displayLogsModal(result.kx_logs || []);
    }
  });
}

function displayLogsModal(logs) {
  // Create modal
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.8);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: white;
    padding: 20px;
    border-radius: 8px;
    max-width: 500px;
    max-height: 80vh;
    overflow-y: auto;
    font-family: monospace;
    font-size: 12px;
  `;
  
  const header = document.createElement('div');
  header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;';
  header.innerHTML = `
    <h3 style="margin: 0;">Eklenti Logları (${logs.length})</h3>
    <button id="closeLogs" style="background: #f44336; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">&times;</button>
  `;
  
  const logContainer = document.createElement('div');
  logContainer.style.cssText = 'max-height: 400px; overflow-y: auto; border: 1px solid #ddd; padding: 10px;';
  
  if (logs.length === 0) {
    logContainer.innerHTML = '<em>Hiç log bulunmuyor</em>';
  } else {
    logs.slice(-50).forEach(log => {
      const logEntry = document.createElement('div');
      logEntry.style.cssText = `
        margin-bottom: 8px;
        padding: 5px;
        border-left: 3px solid ${
          log.level === 'error' ? '#f44336' :
          log.level === 'success' ? '#4caf50' :
          log.level === 'warn' ? '#ff9800' : '#2196f3'
        };
        background: #f9f9f9;
      `;
      
      const time = new Date(log.timestamp).toLocaleTimeString();
      logEntry.innerHTML = `
        <div style="font-weight: bold; color: #666;">${time} - ${log.level.toUpperCase()}</div>
        <div>${log.message}</div>
        ${log.data ? `<div style="color: #666; font-size: 11px;">${JSON.stringify(log.data, null, 2)}</div>` : ''}
      `;
      
      logContainer.appendChild(logEntry);
    });
  }
  
  content.appendChild(header);
  content.appendChild(logContainer);
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  // Close modal
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.id === 'closeLogs') {
      modal.remove();
    }
  });
}