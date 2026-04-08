# Privacy Policy — KolayXport Etsy & eBay Research Extension

*Last Updated: April 8, 2026*

## Overview

The KolayXport Chrome Extension ("Extension") provides marketplace research data (sales estimates, SEO scores, competition analysis) directly on Etsy and eBay pages, and optionally syncs order data to your KolayXport account.

## Information Collection

### What We Access
- **Marketplace page content**: Listing titles, prices, tags, and publicly visible seller information on Etsy and eBay pages you visit
- **Search queries**: Keywords you search on Etsy and eBay (to provide competition and market data)
- **Order information** (optional): Order details visible on your Etsy Shop Manager pages, if you use the order sync feature

### What We Do NOT Access
- Your marketplace login credentials or passwords
- Your payment or financial information
- Private messages or personal communications
- Pages outside of Etsy, eBay, and kolayxport.com
- Any other browser tabs, browsing history, or websites
- Microphone, camera, or location data

## How We Use Information

- **Research overlays**: Marketplace page data is sent to KolayXport servers to compute sales estimates, SEO scores, and competition metrics. Results are displayed inline on the page and cached locally.
- **Order sync** (optional): Order data is sent to your authenticated KolayXport account for order management.
- **Authentication**: We store a session token locally to authenticate API requests.

### Data Transmission
- All data is transmitted over secure HTTPS connections
- Data is sent only to kolayxport.com servers
- No data is sent to third parties, advertisers, or analytics services
- No data is sold or shared

## Data Storage

### Local Storage (on your device)
- Authentication token
- Cached research data (auto-expires, clearable via popup)
- Overlay on/off preference
- Previously synced order IDs (for duplicate prevention)

### Server Storage
- Research queries are processed in real-time and not permanently stored
- Order data (if synced) is stored in your KolayXport account, subject to KolayXport's main privacy policy

## Your Rights

You can:
- Disable all overlays via the extension popup toggle
- Clear cached research data at any time via the popup
- Uninstall the extension to remove all local data
- Request deletion of server-side data by contacting support

## Permissions Explained

| Permission | Purpose |
|-----------|---------|
| `storage` | Save preferences, cache research data, store auth token |
| `activeTab` | Read marketplace page content for research overlays |
| `cookies` | Check authentication status with kolayxport.com |
| `host_permissions` (etsy.com, ebay.com, kolayxport.com) | Inject research overlays and communicate with our API |

## Children's Privacy

This Extension is not intended for anyone under 18. We do not knowingly collect data from children.

## Changes to This Policy

Updates will be reflected in the "Last Updated" date above and noted in extension update release notes.

## Contact

- Email: privacy@kolayxport.com
- Website: https://kolayxport.com
- Support: https://kolayxport.com/help

## Compliance

This Extension complies with:
- Chrome Web Store Developer Program Policies
- General Data Protection Regulation (GDPR)
- California Consumer Privacy Act (CCPA)

---

By using the KolayXport Extension, you acknowledge that you have read and understood this Privacy Policy.
