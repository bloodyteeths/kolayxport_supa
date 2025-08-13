# ETGB Implementation Testing Roadmap

## Overview
This document outlines comprehensive testing strategies for the ETGB (E-Ticaret Gümrük Beyanı) functionality that enables users to generate customs declarations, create invoices via Paraşüt, and email them to designated recipients.

## Test Categories

### 1. Unit Tests

#### 1.1 EtgbService Tests
**File**: `__tests__/lib/services/etgbService.test.ts`

```typescript
describe('EtgbService', () => {
  // Test processOrdersByIds
  // Test processOrderBatch
  // Test error handling
  // Test batch ID generation
  // Test file cleanup
});
```

**Test Cases**:
- ✅ Successfully processes valid order IDs
- ✅ Handles invalid/non-existent order IDs
- ✅ Validates user ownership of orders
- ✅ Generates unique batch IDs
- ✅ Cleans up temporary files after processing
- ✅ Handles missing recipient email gracefully

#### 1.2 EtgbExcelService Tests
**File**: `__tests__/lib/services/etgbExcelService.test.ts`

**Test Cases**:
- ✅ Generates valid Excel file with correct structure
- ✅ Handles orders with missing data fields
- ✅ Creates proper file names with timestamps
- ✅ Generates file hash correctly
- ✅ Handles empty order batches

#### 1.3 EtgbMailerService Tests
**File**: `__tests__/lib/services/etgbMailerService.test.ts`

**Test Cases**:
- ✅ Sends email with attachments successfully
- ✅ Handles invalid email addresses
- ✅ Includes CC emails correctly
- ✅ Generates proper email content
- ✅ Handles mail service failures

### 2. Integration Tests

#### 2.1 API Endpoint Tests
**File**: `__tests__/pages/api/etgb/process.test.ts`

```typescript
describe('/api/etgb/process', () => {
  // Test authentication
  // Test request validation
  // Test order processing
  // Test error responses
});
```

**Test Cases**:
- ✅ Requires user authentication
- ✅ Validates request payload (orderIds array)
- ✅ Limits batch size to 100 orders
- ✅ Returns proper success response
- ✅ Handles service failures gracefully
- ✅ Logs operations correctly

#### 2.2 Settings API Tests
**File**: `__tests__/pages/api/user/settings.test.ts`

**Test Cases**:
- ✅ GET returns shippingSettings including ETGB config
- ✅ PATCH updates ETGB settings correctly
- ✅ Validates email format for etgbRecipientEmail
- ✅ Handles missing shippingSettings gracefully

### 3. Frontend Component Tests

#### 3.1 ETGB Settings Component Tests
**File**: `__tests__/pages/ayarlar.test.tsx`

**Test Cases**:
- ✅ Renders ETGB settings section when user has access
- ✅ Shows current email and enabled status
- ✅ Updates settings on form submission
- ✅ Validates email format client-side
- ✅ Handles API errors during save

#### 3.2 Labels Page ETGB Integration Tests
**File**: `__tests__/pages/app/labels.test.tsx`

**Test Cases**:
- ✅ Shows checkboxes when ETGB is enabled
- ✅ Hides checkboxes when ETGB is disabled
- ✅ Enables "ETGB İşle" button when orders selected
- ✅ Clears selection after successful processing
- ✅ Shows proper error messages on failures
- ✅ Fetches user settings to check ETGB recipient email

### 4. End-to-End (E2E) Tests

#### 4.1 Complete ETGB Workflow
**File**: `__tests__/e2e/etgb-workflow.test.ts`

**Test Scenarios**:
1. **Happy Path**:
   - ✅ User configures ETGB settings in ayarlar
   - ✅ User enables ETGB functionality
   - ✅ User navigates to labels page
   - ✅ User selects multiple orders
   - ✅ User clicks "ETGB İşle" button
   - ✅ System processes orders successfully
   - ✅ User receives success notification
   - ✅ Email is sent to configured recipient

2. **Error Scenarios**:
   - ✅ User tries ETGB without configuring email
   - ✅ User selects too many orders (>100)
   - ✅ Network failure during processing
   - ✅ Invalid orders in selection

#### 4.2 Cross-Browser Testing
**Browsers**: Chrome, Firefox, Safari, Edge
- ✅ ETGB settings form works correctly
- ✅ Order selection checkboxes function properly
- ✅ Email validation behaves consistently

### 5. Performance Tests

#### 5.1 Load Testing
**File**: `__tests__/performance/etgb-load.test.ts`

**Test Cases**:
- ✅ Process 100 orders simultaneously
- ✅ Handle multiple concurrent ETGB requests
- ✅ Excel generation performance with large datasets
- ✅ Email sending performance with large attachments

#### 5.2 Memory Usage Tests
- ✅ File cleanup prevents memory leaks
- ✅ Large Excel files don't cause memory issues
- ✅ Concurrent processing doesn't exhaust resources

### 6. Security Tests

#### 6.1 Authentication & Authorization
**Test Cases**:
- ✅ Unauthenticated users cannot access ETGB API
- ✅ Users can only process their own orders
- ✅ ETGB settings are user-specific
- ✅ Email validation prevents injection attacks

#### 6.2 Data Validation
- ✅ Order ID validation prevents SQL injection
- ✅ Email validation prevents header injection
- ✅ File path validation prevents directory traversal

### 7. Error Handling Tests

#### 7.1 Service Failure Scenarios
**Test Cases**:
- ✅ Paraşüt API unavailable
- ✅ Email service failure
- ✅ Database connection issues
- ✅ File system write permissions
- ✅ Network timeouts

#### 7.2 Data Integrity Tests
- ✅ Partial order processing failures
- ✅ Corrupted order data handling
- ✅ Missing required order fields

### 8. User Experience Tests

#### 8.1 Usability Testing
**Manual Test Cases**:
- ✅ ETGB settings are intuitive to configure
- ✅ Order selection process is clear
- ✅ Loading states provide adequate feedback
- ✅ Error messages are helpful and actionable
- ✅ Success notifications confirm completion

#### 8.2 Accessibility Testing
- ✅ ETGB forms work with screen readers
- ✅ Keyboard navigation functions properly
- ✅ Color contrast meets WCAG standards
- ✅ Focus indicators are visible

### 9. Integration with External Services

#### 9.1 Paraşüt Integration Tests
**Test Cases**:
- ✅ Invoice generation with valid order data
- ✅ Authentication with Paraşüt API
- ✅ Error handling for API failures
- ✅ Invoice PDF attachment generation

#### 9.2 Email Service Integration
**Test Cases**:
- ✅ SMTP configuration validation
- ✅ Attachment size limits
- ✅ Email delivery confirmation
- ✅ Bounce handling

### 10. Database Tests

#### 10.1 Data Persistence
**Test Cases**:
- ✅ ETGB settings save correctly to user table
- ✅ Order data retrieval for ETGB processing
- ✅ Transaction rollback on failures
- ✅ Concurrent access handling

### 11. Monitoring & Logging Tests

#### 11.1 Observability
**Test Cases**:
- ✅ ETGB operations are logged properly
- ✅ Error logs contain sufficient debugging info
- ✅ Performance metrics are captured
- ✅ User activity tracking works

## Testing Timeline

### Phase 1: Core Functionality (Week 1)
- Unit tests for all service classes
- API endpoint integration tests
- Basic frontend component tests

### Phase 2: User Experience (Week 2)
- End-to-end workflow tests
- Frontend integration tests
- Error handling scenarios

### Phase 3: Production Readiness (Week 3)
- Performance and load testing
- Security testing
- Cross-browser compatibility
- Accessibility testing

### Phase 4: External Integrations (Week 4)
- Paraşüt integration testing
- Email service testing
- Database integration tests
- Monitoring and logging validation

## Test Data Requirements

### Sample Orders
- Orders with complete address information
- Orders with missing optional fields
- Orders from different marketplaces
- Orders with various product types

### Test Users
- User with ETGB enabled and configured
- User with ETGB disabled
- User without ETGB settings configured
- User with invalid email configuration

### Test Environments
- Development: Basic functionality testing
- Staging: Full integration testing with external services
- Production: Smoke tests and monitoring

## Success Criteria

- ✅ All unit tests pass with >90% coverage
- ✅ Integration tests cover all API endpoints
- ✅ E2E tests validate complete user workflows
- ✅ Performance tests meet response time requirements (<5s for 50 orders)
- ✅ Security tests pass vulnerability scans
- ✅ Accessibility tests meet WCAG 2.1 AA standards
- ✅ Zero critical bugs in production testing

## Tools and Frameworks

- **Unit Testing**: Vitest (already configured)
- **Integration Testing**: Supertest with Next.js API routes
- **E2E Testing**: Playwright (already configured)
- **Performance Testing**: Artillery or k6
- **Security Testing**: OWASP ZAP
- **Accessibility Testing**: axe-core

## Continuous Integration

Add ETGB tests to existing CI pipeline:
```yaml
- name: Run ETGB Tests
  run: |
    npm run test:unit -- __tests__/**/*etgb*
    npm run test:api -- __tests__/pages/api/etgb/
    npm run test:e2e -- __tests__/e2e/etgb*
```

## Risk Mitigation

### High-Risk Areas
1. **Email Delivery**: Test with multiple email providers
2. **File Generation**: Test with various order data scenarios
3. **External APIs**: Mock Paraşüt API for reliable testing
4. **Concurrent Processing**: Test race conditions and locks

### Monitoring in Production
- Track ETGB processing success rates
- Monitor email delivery rates
- Alert on file generation failures
- Log performance metrics for optimization