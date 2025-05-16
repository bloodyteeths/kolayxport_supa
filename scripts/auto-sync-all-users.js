// This script can be used with GitHub Actions, EasyCron, or any external scheduler to trigger incremental sync for all users every 15 minutes.
// It assumes your site is deployed and accessible at the given BASE_URL.
// You must provide a way to authenticate as each user (e.g. service tokens, or trigger per-user from your backend).

const axios = require('axios');

const BASE_URL = process.env.KOLAYXPORT_BASE_URL || 'https://your-production-url.vercel.app';
// If you have a list of user tokens or IDs, loop through them. Here we demo a single call for all users (backend must handle all users).

async function autoSyncAllUsers() {
  try {
    // If your backend supports a global sync for all users, call it here:
    // await axios.post(`${BASE_URL}/api/orders/sync-recent`, { allUsers: true });
    // Otherwise, loop through user tokens/IDs:
    // for (const token of USER_TOKENS) {
    //   await axios.post(`${BASE_URL}/api/orders/sync-recent`, {}, { headers: { Authorization: `Bearer ${token}` } });
    // }
    console.log('Auto-sync triggered. Implement user loop or backend logic as needed.');
  } catch (err) {
    console.error('Auto-sync failed:', err.message);
  }
}

// Run the sync
autoSyncAllUsers();
