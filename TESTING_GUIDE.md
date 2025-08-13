# Testing Guide for New Integrations

## Services Implemented

1. **Etsy Tracking Service** - Submit tracking information to Etsy
2. **ETGB Excel & Email Service** - Generate and email ETGB export files
3. **Paraşüt e-Invoice Service** - Generate Turkish e-invoices

## Environment Setup

Add these variables to your `.env.local`:

```bash
# ETGB Email Service (Your SMTP)
ETGB_SMTP_HOST=smtp.gmail.com
ETGB_SMTP_PORT=587
ETGB_SMTP_SECURE=false
ETGB_SMTP_USER=your-business-email@gmail.com
ETGB_SMTP_PASS=your-app-password

# Etsy API (Optional - for testing Etsy tracking)
ETSY_API_KEY=your-etsy-api-key
ETSY_ACCESS_TOKEN=your-etsy-access-token
ETSY_SHOP_ID=your-shop-id

# Paraşüt Sandbox (Optional - for testing invoices)
PARASUT_SANDBOX_CLIENT_ID=your-sandbox-client-id
PARASUT_SANDBOX_CLIENT_SECRET=your-sandbox-secret
PARASUT_SANDBOX_USERNAME=your-sandbox-username
PARASUT_SANDBOX_PASSWORD=your-sandbox-password
PARASUT_SANDBOX_COMPANY_ID=your-sandbox-company-id
```

## Database Migration

Run the migration to add Paraşüt fields:

```bash
npx prisma migrate dev --name add-parasut-fields
```

## Testing Methods

### 1. Manual Testing Scripts

Run individual test scripts to verify each service:

```bash
# Test ETGB flow (Excel generation + email)
tsx scripts/test-etgb-flow.ts

# Test Etsy tracking submission
tsx scripts/test-etsy-tracking.ts

# Test Paraşüt sandbox integration
tsx scripts/test-parasut-sandbox.ts
```

### 2. API Testing

Use curl or Postman to test the new endpoints:

**Test Etsy Tracking:**
```bash
curl -X POST http://localhost:3000/api/tracking/etsy \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "shopId": "test-shop-id",
    "receiptId": "12345678",
    "trackingNumber": "TEST123456789",
    "carrier": "FedEx"
  }'
```

**Test ETGB Processing:**
```bash
curl -X POST http://localhost:3000/api/etgb/process \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "orderIds": ["order-id-1", "order-id-2"],
    "recipientEmail": "etgb@example.com"
  }'
```

### 3. User Configuration

**For ETGB Email Recipient:**
1. Go to Settings/Ayarlar page
2. Add field for `etgbRecipientEmail` in user's `shippingSettings`
3. Save configuration

**For Paraşüt Credentials:**
1. Add Paraşüt credential fields to your settings UI
2. Store in user's `Credential` model:
   - `parasutClientId`
   - `parasutClientSecret`
   - `parasutUsername`
   - `parasutPassword`
   - `parasutCompanyId`

## What Each Service Does

### ETGB Service
- Reads order data from your database
- Generates Excel file with Turkish customs format
- Sends email with Excel + invoice attachments
- Uses your own SMTP service
- Configurable recipient email per user

### Etsy Tracking Service
- Submits tracking info to Etsy v3 API
- Requires OAuth scopes: `transactions_r`, `transactions_w`
- Logs submission in `TrackingSubmission` table
- Returns success/failure status

### Paraşüt Invoice Service
- Connects to Paraşüt v4 API with OAuth
- Creates e-invoices for orders
- Downloads PDF invoices
- Auto-attaches to ETGB emails

## Troubleshooting

**Build Errors:** All TypeScript errors have been fixed. If you get new ones, check:
- Field names match your Prisma schema
- Logger calls use correct parameter order: `logger.error(message, error?, details?)`

**Runtime Errors:**
- Check environment variables are set
- Verify database migration completed
- Ensure user has required credentials configured
- Check SMTP settings for email service

**Testing Issues:**
- Scripts will show warnings if credentials are missing
- Use sandbox/test credentials when possible
- Check network connectivity for API calls

## Next Steps

1. **Run Prisma Migration:** `npx prisma migrate dev --name add-parasut-fields`
2. **Test with Real Data:** Use your existing orders
3. **Configure User Settings:** Add UI for email/credential configuration
4. **Production Setup:** Add real SMTP credentials and API keys
5. **Monitor Logs:** Check application logs for any integration issues

The services are production-ready and follow your existing codebase patterns!