# End-to-End Usage Counting Test Guide

This guide helps you manually test the usage counting implementation to ensure it's working correctly.

## Prerequisites
- A test user account (or use your existing account)
- Access to the database to check/modify usage counts

## Test Scenarios

### 1. Trial User Hitting Limits

**Setup:**
1. In the database, set your user to trial status with counts near limits:
```sql
UPDATE "User" 
SET "subscriptionStatus" = 'trialing',
    "subscriptionPlan" = NULL,
    "orderSyncCount" = 49,  -- Trial limit is 50
    "labelCount" = 9,       -- Trial limit is 10
    "trialExpiresAt" = NOW() + INTERVAL '7 days'
WHERE email = 'your-test-email@example.com';
```

**Test Steps:**
1. Go to `/ayarlar` - verify it shows:
   - Trial status
   - Order sync: 49/50
   - Labels: 9/10

2. Go to `/app/senkron` or `/app/labels`
3. Click "Senkronize Et" to sync orders
   - ✅ First sync should succeed (usage becomes 50/50)
   - Check `/ayarlar` - should show 50/50

4. Try to sync again
   - ❌ Should show error toast: "Paket limitine ulaşıldı. Fiyatlandırma sayfasına yönlendiriliyorsunuz..."
   - Should redirect to `/fiyatlandirma` after 2 seconds

5. Try to generate a label (UPS or FedEx)
   - ✅ First label should succeed (usage becomes 10/10)
   - ❌ Second label should show error and redirect

### 2. Paid Plan Usage

**Setup:**
```sql
UPDATE "User" 
SET "subscriptionStatus" = 'active',
    "subscriptionPlan" = 'starter',
    "orderSyncCount" = 199,  -- Starter limit is 200
    "labelCount" = 99        -- Starter limit is 100
WHERE email = 'your-test-email@example.com';
```

**Test Steps:**
1. Check `/ayarlar` shows Starter plan with 199/200 syncs, 99/100 labels
2. Perform one sync - should succeed
3. Try another sync - should fail and redirect
4. Generate one label - should succeed
5. Try another label - should fail and redirect

### 3. Enterprise Unlimited

**Setup:**
```sql
UPDATE "User" 
SET "subscriptionStatus" = 'active',
    "subscriptionPlan" = 'enterprise',
    "orderSyncCount" = 10000,
    "labelCount" = 5000
WHERE email = 'your-test-email@example.com';
```

**Test Steps:**
1. Sync orders multiple times - all should succeed
2. Generate multiple labels - all should succeed
3. Check `/ayarlar` - counts should keep incrementing with no limits shown

### 4. Expired Trial

**Setup:**
```sql
UPDATE "User" 
SET "subscriptionStatus" = 'trialing',
    "subscriptionPlan" = NULL,
    "orderSyncCount" = 10,
    "labelCount" = 5,
    "trialExpiresAt" = NOW() - INTERVAL '1 day'  -- Expired yesterday
WHERE email = 'your-test-email@example.com';
```

**Test Steps:**
1. Try to sync orders - should immediately fail and redirect
2. Try to generate labels - should immediately fail and redirect
3. All operations should be blocked until plan upgrade

## Verification Points

✅ **Working Correctly If:**
- Usage counters increment after each successful operation
- Operations are blocked when limits are reached
- Error toast appears with redirect message
- Automatic redirect to `/fiyatlandirma` happens after 2 seconds
- `/ayarlar` page shows accurate current usage
- Enterprise plan has no limits

❌ **Issues If:**
- Counters don't increment after operations
- Operations succeed even after limit reached
- No error message or redirect when blocked
- `/ayarlar` shows incorrect counts
- Trial continues working after expiration

## Database Queries for Debugging

Check current usage:
```sql
SELECT email, "subscriptionStatus", "subscriptionPlan", 
       "orderSyncCount", "labelCount", "trialExpiresAt"
FROM "User"
WHERE email = 'your-test-email@example.com';
```

Reset counters for testing:
```sql
UPDATE "User"
SET "orderSyncCount" = 0,
    "labelCount" = 0
WHERE email = 'your-test-email@example.com';
```

## API Testing with cURL

Test order sync limit:
```bash
# Get auth token from browser DevTools (Network tab)
AUTH_TOKEN="your-auth-token"

curl -X POST http://localhost:3000/api/orders/sync \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected when over limit:
```json
{
  "error": "Payment Required",
  "details": "Trial limit reached."
}
```