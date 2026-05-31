// Minimal env shim so the Prisma singleton in lib/prisma.ts can instantiate without a real DB.
// Tests that actually exercise Prisma must mock @/lib/prisma directly.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/test';
}
if (!process.env.NEXTAUTH_SECRET) {
  process.env.NEXTAUTH_SECRET = 'test-nextauth-secret-' + 'x'.repeat(32);
}
if (!process.env.STRIPE_SECRET_KEY) {
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_for_unit_tests';
}
