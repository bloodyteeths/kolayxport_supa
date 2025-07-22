// Simple test service worker to verify registration
console.log('Service worker loaded successfully');

// Basic setup
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
  chrome.action.setBadgeText({ text: '✓' });
});

// Test message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Message received:', request);
  sendResponse({ success: true });
});