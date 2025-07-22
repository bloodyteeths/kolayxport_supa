# Kolayxport Etsy Order Sync Chrome Extension

## Overview

The Kolayxport Etsy Order Sync Chrome Extension enables seamless synchronization of Etsy Shop Manager orders with the Kolayxport platform. This extension runs directly in the seller's browser, extracting order and shipping information from the Etsy Shop Manager interface without requiring API access or compromising security.

## Features

- **Automatic Order Detection**: Instantly detects and extracts orders when viewing Etsy Shop Manager
- **Real-time Synchronization**: Syncs orders to Kolayxport as they appear
- **Duplicate Prevention**: Intelligent tracking prevents duplicate order submissions
- **Bulk Import**: One-click import of all historical orders
- **Secure Authentication**: Uses existing Kolayxport session for seamless integration
- **Privacy-First**: All data processing happens locally in the browser

## Technical Architecture

### Manifest V3 Compliance
The extension is built using Chrome's Manifest V3 specification, ensuring:
- Enhanced security through service workers
- Better performance with declarative content scripts
- Future-proof compatibility with Chrome updates

### Core Components

1. **Content Script** (`src/content.js`)
   - Runs on Etsy Shop Manager order pages
   - Extracts order data using multiple fallback strategies
   - Handles dynamic content loading via MutationObserver
   - Manages local storage for duplicate prevention

2. **Background Service Worker** (`src/background.js`)
   - Manages authentication state
   - Handles cross-origin communication
   - Provides badge notifications
   - Coordinates between popup and content scripts

3. **Popup Interface** (`src/popup.html/js/css`)
   - Displays sync statistics
   - Shows authentication status
   - Provides manual sync controls
   - Offers quick access to Etsy orders

### Data Extraction Strategy

The extension uses a multi-layered approach to extract order data:

1. **Primary Method**: Looks for data attributes (`data-order-id`, `data-ship-address`)
2. **Secondary Method**: Parses visible DOM elements (address blocks, order details)
3. **Fallback Method**: Uses pattern matching on text content

This ensures compatibility with Etsy UI changes and A/B testing variations.

## Installation Guide

### Development Installation

1. **Clone the repository**
   ```bash
   git clone [repository-url]
   cd mybaby-sync-product/chrome-extension
   ```

2. **Convert icon files to PNG** (required)
   ```bash
   # Using ImageMagick
   cd icons
   for size in 16 32 48 128; do
     convert -background none icon-${size}.svg icon-${size}.png
   done
   ```

3. **Load the extension in Chrome**
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the `chrome-extension` directory

4. **Test the extension**
   - Log in to Kolayxport (https://app.kolayxport.com)
   - Navigate to Etsy Shop Manager Orders (https://www.etsy.com/your/orders/sold)
   - Click the extension icon to view status

### Production Installation

Once published to the Chrome Web Store:
1. Visit the extension page in Chrome Web Store
2. Click "Add to Chrome"
3. Confirm permissions
4. Extension will auto-update with new releases

## Configuration

### API Endpoint Configuration

The extension automatically detects the environment and uses the appropriate API endpoint:

```javascript
// Production: https://app.kolayxport.com/api/integrations/etsy/orders
// Staging: https://staging.kolayxport.com/api/integrations/etsy/orders  
// Development: http://localhost:3000/api/integrations/etsy/orders
```

### Authentication

The extension uses Supabase authentication with fallback to NextAuth:

**Supabase Auth (Primary):**
- `sb-access-token` cookies
- `sb-refresh-token` cookies  
- `supabase.auth.token` from localStorage

**NextAuth (Fallback):**
- `next-auth.session-token` cookies
- `__Secure-next-auth.session-token` cookies

No separate login required - uses existing Kolayxport session.

## Usage Guide

### Basic Usage

1. **Initial Setup**
   - Install the extension
   - Log in to your Kolayxport account
   - Navigate to Etsy Shop Manager Orders

2. **Automatic Sync**
   - Orders are automatically detected and synced
   - Check the extension icon for sync status
   - Green badge = connected and syncing
   - Red badge = error (check popup for details)

3. **Manual Sync**
   - Click extension icon to open popup
   - Click "Sync Now" to force immediate sync
   - View statistics and last sync time

### Bulk Import

For importing historical orders:
1. Navigate to Etsy Shop Manager Orders page
2. Click extension icon
3. Click "Import All Orders"
4. Keep the tab open while import runs
5. Extension will auto-scroll and import all orders

### Troubleshooting

**Extension not detecting orders:**
- Ensure you're on the correct Etsy page (`/your/orders/`)
- Check if you're logged in to Kolayxport
- Try refreshing the page
- Check browser console for errors

**Authentication issues:**
- Log out and back in to Kolayxport
- Clear browser cookies for Kolayxport
- Ensure cookies are not blocked for the domain

**Sync failures:**
- Check internet connection
- Verify Kolayxport subscription is active
- Look for specific error messages in popup

## API Integration

### Request Format

The extension sends order data to Kolayxport in the following format:

```json
{
  "orders": [
    {
      "orderId": "1234567890",
      "orderNumber": "1234567890",
      "buyerName": "John Doe",
      "orderDate": "Jan 15, 2025",
      "orderTotal": "49.99",
      "items": [
        {
          "title": "Product Name",
          "quantity": "1",
          "price": "49.99",
          "sku": "SKU123",
          "variation": "Size: Large"
        }
      ],
      "shippingAddress": {
        "name": "John Doe",
        "line1": "123 Main St",
        "line2": "Apt 4",
        "city": "New York",
        "state": "NY",
        "postalCode": "10001",
        "country": "US"
      }
    }
  ],
  "source": "chrome-extension",
  "timestamp": "2025-01-22T10:30:00Z"
}
```

### Response Handling

Successful sync:
```json
{
  "success": true,
  "processed": 10,
  "errors": []
}
```

Error response:
```json
{
  "success": false,
  "error": "Authentication required",
  "code": "AUTH_REQUIRED"
}
```

## Security Considerations

### Data Protection
- All data processing occurs client-side
- No data is stored on external servers
- Uses Chrome's secure storage API
- Respects Etsy's robots.txt and terms of service

### Permissions
The extension requests minimal permissions:
- `activeTab`: Only accesses Etsy when user is on the page
- `storage`: Stores sync history locally
- `scripting`: Injects content script for data extraction

### Privacy Policy
- No personal data is collected by the extension itself
- Order data is sent only to user's Kolayxport account
- No third-party analytics or tracking
- Source code is available for audit

## Development

### Project Structure
```
chrome-extension/
├── manifest.json          # Extension manifest (Manifest V3)
├── src/
│   ├── content.js        # Content script for Etsy pages
│   ├── background.js     # Service worker for coordination
│   ├── popup.html        # Extension popup interface
│   ├── popup.js          # Popup functionality
│   └── popup.css         # Popup styling
├── icons/                # Extension icons (16, 32, 48, 128px)
├── docs/                 # Additional documentation
├── generate-icons.js     # Icon generation script
└── EXTENSION.md          # This file
```

### Building for Production

1. **Prepare icons**
   ```bash
   node generate-icons.js
   # Convert SVG to PNG as needed
   ```

2. **Update version**
   - Edit `manifest.json` version field
   - Follow semantic versioning

3. **Create release package**
   ```bash
   # Exclude development files
   zip -r kolayxport-etsy-sync.zip . \
     -x "*.md" \
     -x "generate-icons.js" \
     -x ".git/*" \
     -x "*.svg"
   ```

### Testing

**Manual Testing Checklist:**
- [ ] Extension installs without errors
- [ ] Authentication detection works
- [ ] Orders are correctly extracted
- [ ] Duplicate prevention functions
- [ ] Bulk import completes successfully
- [ ] Error messages display properly
- [ ] Badge updates reflect status

**Automated Testing:**
```javascript
// Example test for order extraction
describe('Order Extraction', () => {
  it('should extract order from data attributes', () => {
    const mockRow = createMockOrderRow();
    const order = extractOrderFromRow(mockRow);
    expect(order.orderId).toBe('1234567890');
  });
});
```

## Chrome Web Store Submission

### Required Assets
1. **Extension Package**: ZIP file with all necessary files
2. **Screenshots**: 1280x800 or 640x400 (at least 1, max 5)
3. **Promotional Images**: 
   - Small tile: 440x280
   - Large tile: 920x680 (optional)
   - Marquee: 1400x560 (optional)
4. **Privacy Policy**: URL to hosted privacy policy
5. **Description**: Clear explanation of functionality

### Submission Checklist
- [ ] Remove all console.log statements
- [ ] Ensure all permissions are justified
- [ ] Test on Chrome stable, beta, and dev channels
- [ ] Verify no remote code execution
- [ ] Include detailed description
- [ ] Add screenshots showing key features
- [ ] Set appropriate category (Productivity)
- [ ] Define target audience (Etsy sellers)

### Review Guidelines
- No obfuscated code
- All functionality must be clear
- Must handle errors gracefully
- Cannot access unrelated sites
- Must respect user privacy

## Maintenance

### Regular Updates
- Monitor Etsy UI changes
- Update selectors as needed
- Test with each Chrome update
- Review user feedback

### Version History
- v1.0.0: Initial release with core functionality
- v1.1.0: Added bulk import feature (planned)
- v1.2.0: Performance improvements (planned)

### Support
- GitHub Issues: [repository-url]/issues
- Email: support@kolayxport.com
- Documentation: https://app.kolayxport.com/help/chrome-extension

## Legal Compliance

### Terms of Service
This extension is designed to:
- Respect Etsy's Terms of Service
- Only access data the user can already see
- Not circumvent any security measures
- Operate with explicit user consent

### Data Usage
- Extension only reads data visible to logged-in seller
- No automated API calls to Etsy
- All actions initiated by user interaction
- Complies with GDPR and privacy regulations

### Disclaimer
This extension is not affiliated with, endorsed by, or sponsored by Etsy Inc. It is an independent tool created to help sellers manage their orders more efficiently.

---

## Quick Start for Developers

```bash
# 1. Clone and setup
git clone [repository-url]
cd mybaby-sync-product/chrome-extension

# 2. Generate and convert icons
node generate-icons.js
# Convert SVG to PNG using your preferred method

# 3. Load in Chrome
# Go to chrome://extensions/
# Enable Developer mode
# Click "Load unpacked" and select this directory

# 4. Test
# Log in to Kolayxport
# Visit Etsy Shop Manager Orders
# Watch the magic happen!
```

For questions or contributions, please refer to the main project documentation or contact the development team.