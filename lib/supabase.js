import { createBrowserClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

// Create a single supabase client for interacting with your database
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Throw an error during development if keys are missing
  if (process.env.NODE_ENV === 'development') {
    throw new Error('Missing Supabase URL or Anon Key. Check your .env.local file.');
  } else {
    // Log error in production but don't necessarily throw to avoid breaking server start
    console.error('CRITICAL: Missing Supabase environment variables for client.');
  }
}

// Use createBrowserClient for the client-side Supabase instance
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);

// Helper function for server-side Supabase with admin rights
export const getServiceSupabase = () => {
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceKey) { // Also check supabaseUrl for robustness
    if (process.env.NODE_ENV === 'development') {
        throw new Error('Missing Supabase URL or Service Role Key for service client.');
    } else {
        console.error('CRITICAL: Missing Supabase environment variables for service client.');
        // Return a null or non-functional client in prod if keys are missing to prevent app crash, 
        // or handle this more gracefully depending on requirements.
        return null; 
    }
  }
  
  return createClient(supabaseUrl, supabaseServiceKey);
}; 