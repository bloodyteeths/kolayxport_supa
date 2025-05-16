import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { execSync } from 'child_process';

// Load environment variables
dotenv.config({ path: '.env.test' });

// Global test utilities
export const createTestUser = async () => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
    process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSJ9.vI9obAHOGyVVKa3pD--kJlyxp-Z2zV9UUMAhKpNLAcU'
  );

  // Always try to delete the user first to avoid unique constraint errors
  try {
    await supabase.auth.admin.deleteUser('test@example.com');
  } catch (e) {
    // Ignore errors if user does not exist
  }

  const { data: user, error } = await supabase.auth.admin.createUser({
    email: 'test@example.com',
    password: 'testpassword123',
    email_confirm: true,
  });

  if (error) throw error;
  return user;
};

export const deleteTestUser = async () => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
    process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSJ9.vI9obAHOGyVVKa3pD--kJlyxp-Z2zV9UUMAhKpNLAcU'
  );

  const { error } = await supabase.auth.admin.deleteUser(
    'test@example.com'
  );

  if (error) throw error;
}; 