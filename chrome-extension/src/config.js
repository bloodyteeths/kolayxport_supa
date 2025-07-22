/**
 * Kolayxport Chrome Extension Configuration
 */

// Environment detection and API endpoints
export const CONFIG = {
  // API endpoints for different environments
  API_ENDPOINTS: {
    production: 'https://app.kolayxport.com/api/integrations/etsy/orders',
    staging: 'https://staging.kolayxport.com/api/integrations/etsy/orders',
    development: 'http://localhost:3000/api/integrations/etsy/orders'
  },
  
  // Kolayxport domains for auth
  DOMAINS: {
    production: 'app.kolayxport.com',
    staging: 'staging.kolayxport.com', 
    development: 'localhost'
  },
  
  // Sync settings
  SYNC: {
    STORAGE_KEY: 'kx_synced_orders',
    MAX_STORED_IDS: 5000,
    DEBOUNCE_MS: 1000,
    BATCH_SIZE: 20,
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 2000
  },
  
  // Authentication token patterns
  AUTH_PATTERNS: {
    SUPABASE: [
      'sb-access-token',
      'sb-refresh-token',
      'supabase-auth-token',
      'supabase.auth.token'
    ],
    NEXTAUTH: [
      'next-auth.session-token',
      '__Secure-next-auth.session-token'
    ]
  }
};

// Detect current environment
export function getEnvironment() {
  const hostname = window.location?.hostname || 'production';
  
  if (hostname.includes('localhost') || hostname.includes('127.0.0.1')) {
    return 'development';
  } else if (hostname.includes('staging') || hostname.includes('dev')) {
    return 'staging';
  }
  return 'production';
}

// Get API endpoint for current environment
export function getApiEndpoint() {
  const env = getEnvironment();
  return CONFIG.API_ENDPOINTS[env];
}

// Get domain for current environment  
export function getDomain() {
  const env = getEnvironment();
  return CONFIG.DOMAINS[env];
}

// Check if token matches auth patterns
export function identifyTokenType(tokenName) {
  if (CONFIG.AUTH_PATTERNS.SUPABASE.some(pattern => tokenName.includes(pattern))) {
    return 'supabase';
  }
  if (CONFIG.AUTH_PATTERNS.NEXTAUTH.some(pattern => tokenName.includes(pattern))) {
    return 'nextauth';
  }
  return 'unknown';
}