# eBay Integration — Clawd Tools Prompt

## Overview

KolayXport's eBay integration provides full listing management, order management, market research, competitor analysis, and AI-powered listing optimization. The integration spans three API endpoints:

- **`/api/clawd/ebay`** — Core listing management, orders, taxonomy, policies, market research, and analytics
- **`/api/clawd/ebay-research`** — Product tracking, seller tracking, niche analysis, and product database search
- **`/api/clawd/ebay-ai`** — AI-powered title optimization, description generation, listing analysis, and pricing suggestions

## Authentication

All three endpoints accept authentication via:

1. **API Key** — Pass via `apiKey` query param or `x-api-key` header. Must match the server's `CLAWD_API_KEY` env var.
2. **Session Auth** — Supabase session cookie (for browser-based requests).

### Common Parameters

| Parameter | Location | Required | Default | Description |
|-----------|----------|----------|---------|-------------|
| `apiKey` | query or header (`x-api-key`) | Yes (unless session auth) | — | API authentication key |
| `userId` / `user_id` | query | Yes (unless session auth provides it) | Session user ID | The user whose eBay account to operate on |
| `marketplace_id` | query | No | `EBAY_US` | eBay marketplace ID (e.g., `EBAY_US`, `EBAY_GB`, `EBAY_DE`) |
| `action` | query | Yes | — | The action to perform |

### Base URL Pattern

```
{KOLAYXPORT_API_URL}/api/clawd/ebay?apiKey={API_KEY}&userId={USER_ID}&action={ACTION}
```

---

## Endpoint 1: `/api/clawd/ebay` — Core eBay API

Max duration: 60 seconds.

---

### Taxonomy (No User Token Required)

These actions use an application-level token. No eBay account connection needed.

#### action=category_tree (GET)

Get the full eBay category tree.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `category_tree_id` | No | `0` | Category tree ID (`0` = US) |

**Example Request:**
```
GET /api/clawd/ebay?apiKey=KEY&userId=UID&action=category_tree&category_tree_id=0
```

**Example Response:**
```json
{
  "categoryTreeId": "0",
  "categoryTreeVersion": "126",
  "rootCategoryNode": {
    "category": { "categoryId": "0", "categoryName": "Root" },
    "childCategoryTreeNodes": [
      {
        "category": { "categoryId": "550", "categoryName": "Art" },
        "childCategoryTreeNodes": [...]
      }
    ]
  }
}
```

---

#### action=top_categories (GET)

Get top-level categories in a flattened, readable format (1-2 levels deep).

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `category_tree_id` | No | `0` | Category tree ID |

**Example Request:**
```
GET /api/clawd/ebay?apiKey=KEY&userId=UID&action=top_categories
```

**Example Response:**
```json
{
  "categoryTreeId": "0",
  "categoryTreeVersion": "126",
  "categories": [
    {
      "categoryId": "550",
      "categoryName": "Art",
      "childCount": 12,
      "children": [
        { "categoryId": "551", "categoryName": "Art Prints", "childCount": 5 },
        { "categoryId": "552", "categoryName": "Paintings", "childCount": 8 }
      ]
    }
  ]
}
```

---

#### action=category_suggestions (GET)

Get eBay category suggestions for a keyword.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `q` | **Yes** | — | Search keyword (e.g., "baby shoes") |
| `category_tree_id` | No | `0` | Category tree ID |

**Example Request:**
```
GET /api/clawd/ebay?apiKey=KEY&userId=UID&action=category_suggestions&q=baby%20shoes
```

**Example Response:**
```json
{
  "categorySuggestions": [
    {
      "category": {
        "categoryId": "57929",
        "categoryName": "Baby Shoes"
      },
      "categoryTreeNodeAncestors": [
        { "categoryId": "3", "categoryName": "Baby" },
        { "categoryId": "57928", "categoryName": "Baby & Toddler Clothing" }
      ],
      "categoryTreeNodeLevel": 4,
      "relevancy": "HIGH"
    }
  ]
}
```

---

#### action=item_aspects (GET)

Get required/recommended item aspects (specifics) for a category.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `category_id` | **Yes** | — | eBay category ID |
| `category_tree_id` | No | `0` | Category tree ID |

**Example Request:**
```
GET /api/clawd/ebay?apiKey=KEY&userId=UID&action=item_aspects&category_id=57929
```

**Example Response:**
```json
{
  "aspects": [
    {
      "localizedAspectName": "Brand",
      "aspectConstraint": { "aspectRequired": true, "itemToAspectCardinality": "SINGLE" },
      "aspectValues": [
        { "localizedValue": "Nike" },
        { "localizedValue": "Adidas" }
      ]
    },
    {
      "localizedAspectName": "Size",
      "aspectConstraint": { "aspectRequired": true, "itemToAspectCardinality": "SINGLE" },
      "aspectValues": [
        { "localizedValue": "0-3 Months" },
        { "localizedValue": "3-6 Months" }
      ]
    }
  ]
}
```

---

### Listing Management (User Token Required)

These actions require the user to have connected their eBay account.

#### action=listings (GET)

Get all offers enriched with inventory item data (images, aspects, etc.). This is the primary listing fetch endpoint.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `limit` | No | `200` | Max items to return |
| `offset` | No | `0` | Pagination offset |

**Example Request:**
```
GET /api/clawd/ebay?apiKey=KEY&userId=UID&action=listings&limit=50&offset=0
```

**Example Response:**
```json
{
  "total": 127,
  "size": 50,
  "offset": 0,
  "offers": [
    {
      "sku": "BABY-SHOE-001",
      "offerId": "5678901234",
      "listingId": "394829384723",
      "title": "Nike Baby Shoes Infant Sneakers Size 3-6 Months White",
      "description": "<div>Premium baby shoes...</div>",
      "price": { "value": "24.99", "currency": "USD" },
      "quantity": 15,
      "status": "PUBLISHED",
      "condition": "NEW",
      "categoryId": "57929",
      "imageUrl": "https://i.ebayimg.com/images/g/abc/s-l1600.jpg",
      "imageCount": 7,
      "aspects": { "Brand": ["Nike"], "Size": ["3-6 Months"] },
      "format": "FIXED_PRICE",
      "marketplaceId": "EBAY_US",
      "listingUrl": "https://www.ebay.com/itm/394829384723"
    }
  ]
}
```

---

#### action=inventory_items (GET)

Get raw inventory items (without offer enrichment). Alias: `get_inventory_items`.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `limit` | No | `200` | Max items |
| `offset` | No | `0` | Pagination offset |

**Example Request:**
```
GET /api/clawd/ebay?apiKey=KEY&userId=UID&action=inventory_items&limit=100
```

**Example Response:**
```json
{
  "total": 127,
  "size": 100,
  "offset": 0,
  "inventoryItems": [
    {
      "sku": "BABY-SHOE-001",
      "product": {
        "title": "Nike Baby Shoes",
        "description": "...",
        "imageUrls": ["https://i.ebayimg.com/images/g/abc/s-l1600.jpg"],
        "aspects": { "Brand": ["Nike"] }
      },
      "condition": "NEW",
      "availability": {
        "shipToLocationAvailability": { "quantity": 15 }
      }
    }
  ]
}
```

---

#### action=listing (GET)

Get a single inventory item and its associated offers by SKU.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `sku` | **Yes** | — | The item SKU |

**Example Request:**
```
GET /api/clawd/ebay?apiKey=KEY&userId=UID&action=listing&sku=BABY-SHOE-001
```

**Example Response:**
```json
{
  "sku": "BABY-SHOE-001",
  "inventoryItem": {
    "product": { "title": "Nike Baby Shoes", "imageUrls": [...], "aspects": {...} },
    "condition": "NEW",
    "availability": { "shipToLocationAvailability": { "quantity": 15 } }
  },
  "offers": [
    {
      "offerId": "5678901234",
      "sku": "BABY-SHOE-001",
      "status": "PUBLISHED",
      "pricingSummary": { "price": { "value": "24.99", "currency": "USD" } },
      "listing": { "listingId": "394829384723" }
    }
  ]
}
```

---

#### action=create_listing (POST)

Create a new inventory item + offer in one step. Optionally auto-publish.

| Body Param | Required | Default | Description |
|------------|----------|---------|-------------|
| `sku` | **Yes** | — | Unique SKU identifier |
| `title` | **Yes** | — | Listing title (max 80 chars) |
| `price` | **Yes** | — | Price as a number |
| `description` | No | — | HTML description |
| `aspects` | No | — | Item specifics object `{ "Brand": ["Nike"], "Size": ["M"] }` |
| `imageUrls` | No | — | Array of image URLs |
| `upc` | No | — | UPC barcode |
| `ean` | No | — | EAN barcode |
| `condition` | No | `NEW` | Item condition (`NEW`, `USED_EXCELLENT`, `USED_GOOD`, etc.) |
| `conditionDescription` | No | — | Description of condition (for used items) |
| `quantity` | No | `1` | Available quantity |
| `format` | No | `FIXED_PRICE` | Listing format |
| `currency` | No | `USD` | Price currency |
| `categoryId` | No | — | eBay category ID |
| `paymentPolicyId` | No | — | Payment policy ID |
| `returnPolicyId` | No | — | Return policy ID |
| `fulfillmentPolicyId` | No | — | Fulfillment/shipping policy ID |
| `merchantLocationKey` | No | — | Merchant location key |
| `publish` | No | `false` | Auto-publish after creation |

**Example Request:**
```
POST /api/clawd/ebay?apiKey=KEY&userId=UID&action=create_listing
Content-Type: application/json

{
  "sku": "SHOE-RED-42",
  "title": "Nike Air Max 90 Red Sneakers Men Size 42 EU Running Shoes",
  "price": 89.99,
  "currency": "USD",
  "description": "<div><h2>Nike Air Max 90</h2><p>Brand new in box...</p></div>",
  "aspects": {
    "Brand": ["Nike"],
    "Style": ["Running Shoes"],
    "US Shoe Size": ["8.5"],
    "Color": ["Red"]
  },
  "imageUrls": [
    "https://example.com/shoe1.jpg",
    "https://example.com/shoe2.jpg"
  ],
  "condition": "NEW",
  "quantity": 5,
  "categoryId": "15709",
  "paymentPolicyId": "6196939000",
  "returnPolicyId": "6196940000",
  "fulfillmentPolicyId": "6196941000",
  "publish": true
}
```

**Example Response:**
```json
{
  "success": true,
  "sku": "SHOE-RED-42",
  "offerId": "5678901234",
  "listingId": "394829384723",
  "published": true,
  "message": "Listing created and published."
}
```

---

#### action=update_listing (PUT/PATCH)

Update an existing inventory item (title, description, images, aspects, quantity, condition).

| Param | Location | Required | Description |
|-------|----------|----------|-------------|
| `sku` | query | **Yes** | The SKU to update |

| Body Param | Required | Description |
|------------|----------|-------------|
| `title` | No | Updated title |
| `description` | No | Updated HTML description |
| `aspects` | No | Updated item specifics |
| `imageUrls` | No | Updated image URLs array |
| `upc` | No | UPC barcode |
| `ean` | No | EAN barcode |
| `condition` | No | Item condition |
| `conditionDescription` | No | Condition description |
| `quantity` | No | Updated quantity |

**Example Request:**
```
PUT /api/clawd/ebay?apiKey=KEY&userId=UID&action=update_listing&sku=SHOE-RED-42
Content-Type: application/json

{
  "title": "Nike Air Max 90 Red Sneakers Men US 8.5 Running Shoes NEW",
  "quantity": 10,
  "aspects": {
    "Brand": ["Nike"],
    "Style": ["Running Shoes"],
    "US Shoe Size": ["8.5"],
    "Color": ["Red"],
    "Upper Material": ["Mesh"]
  }
}
```

**Example Response:**
```json
{
  "success": true,
  "sku": "SHOE-RED-42",
  "message": "Inventory item updated."
}
```

---

#### action=update_offer (PUT/PATCH)

Update offer details (pricing, policies, category). Merges with existing offer data.

| Param | Location | Required | Description |
|-------|----------|----------|-------------|
| `offerId` / `offer_id` | query | **Yes** | The offer ID to update |

| Body Param | Required | Description |
|------------|----------|-------------|
| `price` | No | New price value (number) |
| `currency` | No | Currency (default: existing or `USD`) |
| `categoryId` | No | New category ID |
| `format` | No | Listing format |
| `paymentPolicyId` | No | Payment policy |
| `returnPolicyId` | No | Return policy |
| `fulfillmentPolicyId` | No | Fulfillment policy |
| `merchantLocationKey` | No | Location key |

**Example Request:**
```
PUT /api/clawd/ebay?apiKey=KEY&userId=UID&action=update_offer&offerId=5678901234
Content-Type: application/json

{
  "price": 79.99,
  "currency": "USD"
}
```

**Example Response:**
```json
{
  "success": true,
  "offerId": "5678901234",
  "result": {},
  "message": "Offer updated."
}
```

---

#### action=delete_listing (DELETE)

Delete an inventory item by SKU. Also deletes associated offers.

| Param | Required | Description |
|-------|----------|-------------|
| `sku` | **Yes** | SKU to delete |

**Example Request:**
```
DELETE /api/clawd/ebay?apiKey=KEY&userId=UID&action=delete_listing&sku=SHOE-RED-42
```

**Example Response:**
```json
{
  "success": true,
  "sku": "SHOE-RED-42",
  "message": "Inventory item deleted."
}
```

---

#### action=publish (POST)

Publish an unpublished offer to make it live on eBay. Aliases: `publish_offer`.

| Param | Required | Description |
|-------|----------|-------------|
| `offerId` / `offer_id` | **Yes** | Query param or body `offerId` |

**Example Request:**
```
POST /api/clawd/ebay?apiKey=KEY&userId=UID&action=publish&offerId=5678901234
```

**Example Response:**
```json
{
  "success": true,
  "offerId": "5678901234",
  "listingId": "394829384723",
  "message": "Offer published."
}
```

---

#### action=withdraw (POST)

Withdraw (end) a published listing. Aliases: `withdraw_offer`, `end_listing`.

| Param | Required | Description |
|-------|----------|-------------|
| `offerId` / `offer_id` | **Yes** | Query param or body `offerId` |

**Example Request:**
```
POST /api/clawd/ebay?apiKey=KEY&userId=UID&action=withdraw&offerId=5678901234
```

**Example Response:**
```json
{
  "success": true,
  "offerId": "5678901234",
  "listingId": "394829384723",
  "message": "Listing withdrawn."
}
```

---

### Component-Specific Actions (Low-Level)

These are granular endpoints for UIs that manage inventory items and offers separately.

#### action=create_inventory_item (PUT)

Create or replace an inventory item. Body is the raw eBay inventory item payload.

| Param | Required | Description |
|-------|----------|-------------|
| `sku` | **Yes** (query) | SKU for the item |

**Example Request:**
```
PUT /api/clawd/ebay?apiKey=KEY&userId=UID&action=create_inventory_item&sku=MY-SKU-001
Content-Type: application/json

{
  "product": {
    "title": "Handmade Ceramic Mug",
    "imageUrls": ["https://example.com/mug.jpg"],
    "aspects": { "Material": ["Ceramic"], "Color": ["Blue"] }
  },
  "condition": "NEW",
  "availability": {
    "shipToLocationAvailability": { "quantity": 20 }
  }
}
```

**Example Response:**
```json
{ "success": true, "sku": "MY-SKU-001" }
```

---

#### action=update_inventory_item (PUT/PATCH)

Update an inventory item by merging with existing data. Body fields override existing fields.

| Param | Required | Description |
|-------|----------|-------------|
| `sku` | **Yes** (query) | SKU to update |

Body is a partial eBay inventory item payload (merged with existing).

---

#### action=create_offer (POST)

Create an offer for an existing inventory item. Body is the raw eBay offer payload.

**Example Request:**
```
POST /api/clawd/ebay?apiKey=KEY&userId=UID&action=create_offer
Content-Type: application/json

{
  "sku": "MY-SKU-001",
  "marketplaceId": "EBAY_US",
  "format": "FIXED_PRICE",
  "pricingSummary": {
    "price": { "value": "29.99", "currency": "USD" }
  },
  "categoryId": "46290",
  "listingPolicies": {
    "paymentPolicyId": "6196939000",
    "returnPolicyId": "6196940000",
    "fulfillmentPolicyId": "6196941000"
  }
}
```

**Example Response:**
```json
{ "success": true, "offerId": "5678901234" }
```

---

#### action=delete_inventory_item (DELETE)

Delete an inventory item by SKU.

| Param | Required | Description |
|-------|----------|-------------|
| `sku` | **Yes** (query) | SKU to delete |

---

#### action=get_inventory_item_group (GET)

Get an inventory item group (for variation listings).

| Param | Required | Description |
|-------|----------|-------------|
| `sku` | **Yes** (query) | Group key / SKU |

**Example Response:**
```json
{
  "variantSKUs": ["SHOE-RED-42", "SHOE-BLUE-42", "SHOE-RED-43"]
}
```

---

### Account Policies

#### action=fulfillment_policies (GET)

Get all fulfillment (shipping) policies.

**Example Response:**
```json
{
  "total": 3,
  "fulfillmentPolicies": [
    {
      "fulfillmentPolicyId": "6196941000",
      "name": "Free Shipping - Standard",
      "marketplaceId": "EBAY_US",
      "shippingOptions": [
        {
          "costType": "FLAT_RATE",
          "shippingServices": [
            { "shippingServiceCode": "ShippingMethodStandard", "freeShipping": true }
          ]
        }
      ]
    }
  ]
}
```

---

#### action=return_policies (GET)

Get all return policies.

**Example Response:**
```json
{
  "total": 2,
  "returnPolicies": [
    {
      "returnPolicyId": "6196940000",
      "name": "30 Day Returns",
      "returnsAccepted": true,
      "returnPeriod": { "value": 30, "unit": "DAY" },
      "returnShippingCostPayer": "BUYER"
    }
  ]
}
```

---

#### action=payment_policies (GET)

Get all payment policies.

**Example Response:**
```json
{
  "total": 1,
  "paymentPolicies": [
    {
      "paymentPolicyId": "6196939000",
      "name": "eBay Managed Payments",
      "immediatePay": true
    }
  ]
}
```

---

### Bulk Operations

#### action=bulk_update_price (POST)

Bulk update prices and/or quantities for multiple items.

| Body Param | Required | Description |
|------------|----------|-------------|
| `requests` | **Yes** | Array of update requests |

Each request in the array:

| Field | Required | Description |
|-------|----------|-------------|
| `sku` | **Yes** | SKU to update |
| `quantity` | No | New inventory quantity |
| `offers` | No | Array of offer updates |
| `offers[].offerId` | **Yes** (if offers provided) | Offer ID |
| `offers[].availableQuantity` | No | New available quantity |
| `offers[].price` | No | `{ value: "19.99", currency: "USD" }` |

**Example Request:**
```
POST /api/clawd/ebay?apiKey=KEY&userId=UID&action=bulk_update_price
Content-Type: application/json

{
  "requests": [
    {
      "sku": "SHOE-RED-42",
      "quantity": 20,
      "offers": [
        { "offerId": "5678901234", "price": { "value": "74.99", "currency": "USD" } }
      ]
    },
    {
      "sku": "SHOE-BLUE-42",
      "quantity": 0
    }
  ]
}
```

**Example Response:**
```json
{
  "success": true,
  "responses": [
    { "statusCode": 200, "sku": "SHOE-RED-42" },
    { "statusCode": 200, "sku": "SHOE-BLUE-42" }
  ],
  "message": "Bulk update completed for 2 item(s)."
}
```

---

### Order Management

#### action=orders (GET)

Get seller's eBay orders.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `limit` | No | `50` | Max orders |
| `offset` | No | `0` | Pagination offset |
| `filter` | No | — | eBay order filter string (e.g., `orderfulfillmentstatus:{NOT_STARTED}`) |

**Example Request:**
```
GET /api/clawd/ebay?apiKey=KEY&userId=UID&action=orders&limit=20&filter=orderfulfillmentstatus:{NOT_STARTED}
```

**Example Response:**
```json
{
  "total": 47,
  "offset": 0,
  "limit": 20,
  "orders": [
    {
      "orderId": "12-34567-89012",
      "creationDate": "2026-03-20T14:30:00.000Z",
      "orderFulfillmentStatus": "NOT_STARTED",
      "orderPaymentStatus": "PAID",
      "pricingSummary": {
        "total": { "value": "24.99", "currency": "USD" }
      },
      "buyer": { "username": "buyer123" },
      "lineItems": [
        {
          "lineItemId": "9876543210",
          "legacyItemId": "394829384723",
          "title": "Nike Baby Shoes",
          "quantity": 1,
          "lineItemCost": { "value": "24.99", "currency": "USD" },
          "sku": "BABY-SHOE-001"
        }
      ],
      "fulfillmentStartInstructions": [
        {
          "shippingStep": {
            "shipTo": {
              "fullName": "John Doe",
              "contactAddress": {
                "addressLine1": "123 Main St",
                "city": "New York",
                "stateOrProvince": "NY",
                "postalCode": "10001",
                "countryCode": "US"
              }
            }
          }
        }
      ]
    }
  ]
}
```

---

#### action=order (GET)

Get a single order by ID.

| Param | Required | Description |
|-------|----------|-------------|
| `orderId` | **Yes** | eBay order ID |

**Example Request:**
```
GET /api/clawd/ebay?apiKey=KEY&userId=UID&action=order&orderId=12-34567-89012
```

---

### Market Research (Browse API)

These actions use the Browse API for market research. They require a userId but use application tokens internally.

#### action=search_market (GET)

Search active eBay listings with price stats and keyword analysis.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `q` | **Yes** | — | Search query |
| `limit` | No | `50` | Max results (up to 200) |
| `offset` | No | `0` | Pagination offset |
| `sort` | No | `BEST_MATCH` | Sort order (`BEST_MATCH`, `price`, `-price`, `newlyListed`) |
| `filter` | No | — | eBay filter string (e.g., `price:[10..50],conditionIds:{1000}`) |
| `category_id` | No | — | Limit to category |
| `marketplace_id` | No | `EBAY_US` | Marketplace |

**Example Request:**
```
GET /api/clawd/ebay?apiKey=KEY&userId=UID&action=search_market&q=baby%20shoes%20nike&limit=50&sort=BEST_MATCH
```

**Example Response:**
```json
{
  "total": 12450,
  "offset": 0,
  "limit": 50,
  "items": [
    {
      "itemId": "v1|110553820182|0",
      "title": "Nike Baby Shoes Infant Sneakers Air Max White Size 4C",
      "price": { "value": "29.99", "currency": "USD" },
      "condition": "New with box",
      "conditionId": "1000",
      "image": { "imageUrl": "https://i.ebayimg.com/images/g/abc/s-l225.jpg" },
      "itemWebUrl": "https://www.ebay.com/itm/110553820182",
      "seller": { "username": "shoeseller99", "feedbackPercentage": "99.2", "feedbackScore": 4523 },
      "categories": [{ "categoryId": "57929", "categoryName": "Baby Shoes" }],
      "buyingOptions": ["FIXED_PRICE"],
      "shippingOptions": [{ "shippingCost": { "value": "0.00", "currency": "USD" }, "type": "Free" }],
      "itemLocation": { "city": "Los Angeles", "stateOrProvince": "California", "country": "US" },
      "topRatedBuyingExperience": true,
      "legacyItemId": "110553820182"
    }
  ],
  "priceStats": {
    "min": 8.99,
    "max": 89.99,
    "avg": 28.45,
    "median": 24.99,
    "count": 50
  },
  "topKeywords": [
    { "keyword": "nike", "count": 38, "percentage": 76 },
    { "keyword": "baby", "count": 45, "percentage": 90 },
    { "keyword": "shoes", "count": 42, "percentage": 84 },
    { "keyword": "infant", "count": 22, "percentage": 44 },
    { "keyword": "toddler", "count": 18, "percentage": 36 }
  ],
  "aspectDistributions": [
    {
      "localizedAspectName": "Brand",
      "aspectValueDistributions": [
        { "localizedAspectValue": "Nike", "matchCount": 38, "refinementHref": "..." }
      ]
    }
  ]
}
```

---

#### action=analyze_seo (GET)

Compare your listing title against market competitors for SEO optimization.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `q` | **Yes** | — | Search query (your niche/category) |
| `my_title` | No | `""` | Your listing title to analyze |
| `category_id` | No | — | Limit to category |
| `marketplace_id` | No | `EBAY_US` | Marketplace |

**Example Request:**
```
GET /api/clawd/ebay?apiKey=KEY&userId=UID&action=analyze_seo&q=baby%20shoes%20nike&my_title=Nike%20Baby%20Shoes%20White
```

**Example Response:**
```json
{
  "totalCompetitors": 12450,
  "seoScore": 35,
  "keywordCoverage": [
    { "keyword": "nike", "count": 156, "percentage": 78, "inMyTitle": true },
    { "keyword": "baby", "count": 180, "percentage": 90, "inMyTitle": true },
    { "keyword": "shoes", "count": 168, "percentage": 84, "inMyTitle": true },
    { "keyword": "infant", "count": 88, "percentage": 44, "inMyTitle": false },
    { "keyword": "toddler", "count": 72, "percentage": 36, "inMyTitle": false },
    { "keyword": "sneakers", "count": 65, "percentage": 33, "inMyTitle": false }
  ],
  "priceStats": {
    "min": 8.99,
    "max": 89.99,
    "avg": 28.45,
    "median": 24.99
  },
  "avgTitleLength": 62,
  "myTitleLength": 21,
  "aspectAnalysis": [
    {
      "name": "Brand",
      "topValues": [
        { "value": "Nike", "count": 156 },
        { "value": "Adidas", "count": 43 }
      ]
    }
  ],
  "recommendations": [
    "Basliginiz rakiplere gore kisa (21 vs ortalama 62 karakter). Daha uzun baslik kullanmayi deneyin.",
    "Rakiplerin en populer anahtar kelimelerinin sadece 3 tanesini kullaniyorsunuz. Eksik kelimeleri eklemeyi deneyin.",
    "En populer anahtar kelimeler: nike, baby, shoes, infant, toddler"
  ]
}
```

---

#### action=get_item_details (GET)

Get full details for any eBay item by legacy item ID.

| Param | Required | Description |
|-------|----------|-------------|
| `legacy_item_id` | **Yes** | eBay legacy item ID |

**Example Request:**
```
GET /api/clawd/ebay?apiKey=KEY&userId=UID&action=get_item_details&legacy_item_id=110553820182
```

**Example Response:**
```json
{
  "itemId": "v1|110553820182|0",
  "title": "Nike Baby Shoes Infant Sneakers Air Max White Size 4C",
  "price": { "value": "29.99", "currency": "USD" },
  "condition": "New with box",
  "categoryPath": "Clothing, Shoes & Accessories|Baby|Baby Shoes",
  "categoryId": "57929",
  "image": { "imageUrl": "https://i.ebayimg.com/images/g/abc/s-l1600.jpg" },
  "additionalImages": [],
  "seller": { "username": "shoeseller99", "feedbackPercentage": "99.2" },
  "estimatedAvailabilities": [
    { "estimatedSoldQuantity": 47, "estimatedRemainingQuantity": 12 }
  ],
  "localizedAspects": [
    { "name": "Brand", "value": "Nike" },
    { "name": "Size", "value": "4C" }
  ],
  "itemWebUrl": "https://www.ebay.com/itm/110553820182",
  "description": "<div>...</div>"
}
```

---

#### action=search_seller (GET)

Search all listings from a specific seller. Top 20 items are enriched with sold quantities.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `seller` | **Yes** | — | Seller username |
| `q` | No | seller name | Optional keyword filter |
| `limit` | No | `50` | Max results |
| `marketplace_id` | No | `EBAY_US` | Marketplace |

**Example Request:**
```
GET /api/clawd/ebay?apiKey=KEY&userId=UID&action=search_seller&seller=shoeseller99&limit=50
```

**Example Response:**
```json
{
  "total": 234,
  "seller": "shoeseller99",
  "items": [
    {
      "itemId": "v1|110553820182|0",
      "title": "Nike Baby Shoes",
      "price": { "value": "29.99", "currency": "USD" },
      "condition": "New with box",
      "estimatedSoldQuantity": 47,
      "seller": { "username": "shoeseller99" },
      "legacyItemId": "110553820182"
    }
  ],
  "aspectDistributions": [...]
}
```

---

#### action=category_bestsellers (GET)

Find bestselling items in a category. Top 20 items enriched and sorted by sold quantity.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `category_id` | **Yes** | — | eBay category ID |
| `limit` | No | `50` | Max results |
| `condition` | No | — | Condition filter (e.g., `1000` for New) |
| `marketplace_id` | No | `EBAY_US` | Marketplace |

**Example Request:**
```
GET /api/clawd/ebay?apiKey=KEY&userId=UID&action=category_bestsellers&category_id=57929&limit=20
```

**Example Response:**
```json
{
  "total": 58000,
  "categoryId": "57929",
  "items": [
    {
      "itemId": "v1|110553820182|0",
      "title": "Nike Baby Shoes Infant Sneakers",
      "price": { "value": "29.99", "currency": "USD" },
      "estimatedSoldQuantity": 234,
      "seller": { "username": "topbabyseller" },
      "topRatedBuyingExperience": true,
      "legacyItemId": "110553820182"
    }
  ],
  "priceStats": {
    "min": 5.99,
    "max": 120.00,
    "avg": 32.50,
    "median": 27.99
  },
  "aspectDistributions": [...]
}
```

---

#### action=my_legacy_listings (GET)

Get the current user's own listings via Analytics API + Browse API + seller search. Returns full item details for all discovered listings.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `marketplace_id` | No | `EBAY_US` | Marketplace |

**Example Request:**
```
GET /api/clawd/ebay?apiKey=KEY&userId=UID&action=my_legacy_listings
```

**Example Response:**
```json
{
  "total": 45,
  "totalAnalytics": 48,
  "listings": [
    {
      "legacyItemId": "394829384723",
      "itemId": "v1|394829384723|0",
      "title": "Nike Baby Shoes Infant Sneakers",
      "price": { "value": "24.99", "currency": "USD" },
      "condition": "New with box",
      "categoryPath": "Baby|Baby Shoes",
      "categoryId": "57929",
      "image": { "imageUrl": "https://i.ebayimg.com/images/g/abc/s-l1600.jpg" },
      "additionalImages": [],
      "brand": "Nike",
      "seller": { "username": "mystore" },
      "estimatedSoldQuantity": 12,
      "estimatedRemainingQuantity": 8,
      "localizedAspects": [...],
      "itemWebUrl": "https://www.ebay.com/itm/394829384723",
      "description": "<div>...</div>",
      "shippingOptions": [...],
      "returnTerms": {...}
    }
  ]
}
```

---

#### action=analytics (GET)

Get listing traffic/performance analytics for the user's store.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `days` | No | `30` | Number of days to look back |
| `marketplace_id` | No | `EBAY_US` | Marketplace |

**Example Request:**
```
GET /api/clawd/ebay?apiKey=KEY&userId=UID&action=analytics&days=30
```

**Example Response:**
```json
{
  "total": 23,
  "dateRange": { "start": "20260221", "end": "20260322" },
  "records": [
    {
      "listingId": "394829384723",
      "LISTING_IMPRESSION_TOTAL": "1243",
      "LISTING_VIEWS_TOTAL": "87",
      "CLICK_THROUGH_RATE": "7.0"
    },
    {
      "listingId": "394829384724",
      "LISTING_IMPRESSION_TOTAL": "856",
      "LISTING_VIEWS_TOTAL": "42",
      "CLICK_THROUGH_RATE": "4.9"
    }
  ]
}
```

---

## Endpoint 2: `/api/clawd/ebay-research` — Product Tracking & Niche Research

This endpoint manages persistent tracking of products, sellers, and niche research sessions. Data is stored in the database.

Authentication: same as main endpoint (API key or session).
Requires `userId` and `action` query params.
Default `marketplace_id`: `EBAY_US`.

---

### GET Actions

#### action=tracked_products (GET)

Get all actively tracked products with their last 30 price snapshots.

**Example Request:**
```
GET /api/clawd/ebay-research?apiKey=KEY&userId=UID&action=tracked_products
```

**Example Response:**
```json
{
  "products": [
    {
      "id": "clxyz123",
      "userId": "user-id",
      "legacyItemId": "110553820182",
      "itemId": "v1|110553820182|0",
      "title": "Nike Baby Shoes Infant Sneakers",
      "imageUrl": "https://i.ebayimg.com/images/g/abc/s-l1600.jpg",
      "categoryId": "57929",
      "categoryPath": "Baby|Baby Shoes",
      "seller": "shoeseller99",
      "condition": "New with box",
      "currentPrice": 29.99,
      "currency": "USD",
      "currentQuantity": 12,
      "totalSold": 47,
      "itemWebUrl": "https://www.ebay.com/itm/110553820182",
      "notes": "Top competitor in baby shoes",
      "tags": ["competitor", "nike"],
      "isActive": true,
      "lastCheckedAt": "2026-03-23T10:00:00.000Z",
      "createdAt": "2026-03-01T08:00:00.000Z",
      "updatedAt": "2026-03-23T10:00:00.000Z",
      "snapshots": [
        {
          "id": "snap-001",
          "price": 29.99,
          "currency": "USD",
          "quantity": 12,
          "soldQuantity": 47,
          "timestamp": "2026-03-23T10:00:00.000Z"
        },
        {
          "id": "snap-002",
          "price": 31.99,
          "currency": "USD",
          "quantity": 15,
          "soldQuantity": 44,
          "timestamp": "2026-03-22T10:00:00.000Z"
        }
      ]
    }
  ]
}
```

---

#### action=price_history (GET)

Get full price history (all snapshots) for a tracked product.

| Param | Required | Description |
|-------|----------|-------------|
| `product_id` | **Yes** | Tracked product ID |

**Example Request:**
```
GET /api/clawd/ebay-research?apiKey=KEY&userId=UID&action=price_history&product_id=clxyz123
```

**Example Response:**
```json
{
  "product": {
    "id": "clxyz123",
    "legacyItemId": "110553820182",
    "title": "Nike Baby Shoes",
    "currentPrice": 29.99,
    "totalSold": 47
  },
  "snapshots": [
    { "id": "snap-001", "price": 24.99, "currency": "USD", "quantity": 20, "soldQuantity": 30, "timestamp": "2026-03-01T10:00:00.000Z" },
    { "id": "snap-002", "price": 27.99, "currency": "USD", "quantity": 18, "soldQuantity": 35, "timestamp": "2026-03-08T10:00:00.000Z" },
    { "id": "snap-003", "price": 29.99, "currency": "USD", "quantity": 12, "soldQuantity": 47, "timestamp": "2026-03-23T10:00:00.000Z" }
  ]
}
```

---

#### action=tracked_sellers (GET)

Get all actively tracked sellers.

**Example Request:**
```
GET /api/clawd/ebay-research?apiKey=KEY&userId=UID&action=tracked_sellers
```

**Example Response:**
```json
{
  "sellers": [
    {
      "id": "seller-001",
      "userId": "user-id",
      "sellerUsername": "shoeseller99",
      "notes": "Top Nike baby shoe seller",
      "isActive": true,
      "createdAt": "2026-03-10T08:00:00.000Z",
      "updatedAt": "2026-03-10T08:00:00.000Z"
    }
  ]
}
```

---

#### action=saved_niches (GET)

Get all saved niche research sessions.

**Example Request:**
```
GET /api/clawd/ebay-research?apiKey=KEY&userId=UID&action=saved_niches
```

**Example Response:**
```json
{
  "niches": [
    {
      "id": "niche-001",
      "userId": "user-id",
      "query": "baby shoes nike",
      "categoryId": "57929",
      "categoryName": "Baby Shoes",
      "marketplace": "EBAY_US",
      "totalResults": 12450,
      "avgPrice": 28.45,
      "medianPrice": 24.99,
      "uniqueSellers": 342,
      "demandScore": 72,
      "competitionScore": 65,
      "notes": "Good opportunity - moderate competition",
      "createdAt": "2026-03-15T12:00:00.000Z"
    }
  ]
}
```

---

#### action=product_database (GET)

Advanced product search with filters, price stats, keyword analysis, and sold quantity enrichment for top 20 results.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `q` | Conditional | — | Search query (required if no `category_id`) |
| `category_id` | Conditional | — | Category ID (required if no `q`) |
| `min_price` | No | — | Minimum price filter |
| `max_price` | No | — | Maximum price filter |
| `condition` | No | — | Condition ID filter (e.g., `1000` for New) |
| `sort` | No | `newlyListed` | Sort: `price`, `-price`, `newlyListed` |
| `limit` | No | `50` | Max results (up to 200) |
| `offset` | No | `0` | Pagination offset |

**Example Request:**
```
GET /api/clawd/ebay-research?apiKey=KEY&userId=UID&action=product_database&q=wireless%20earbuds&min_price=10&max_price=50&sort=newlyListed&limit=50
```

**Example Response:**
```json
{
  "items": [
    {
      "itemId": "v1|123456789|0",
      "title": "Wireless Earbuds Bluetooth 5.3 Sport Headphones",
      "price": { "value": "19.99", "currency": "USD" },
      "condition": "New",
      "enriched": true,
      "estimatedSoldQuantity": 89,
      "estimatedRemainingQuantity": 234
    }
  ],
  "total": 45000,
  "priceStats": {
    "avg": 24.67,
    "median": 22.99,
    "min": 10.49,
    "max": 49.99
  },
  "topKeywords": [
    { "word": "wireless", "count": 45 },
    { "word": "bluetooth", "count": 42 },
    { "word": "earbuds", "count": 40 }
  ],
  "offset": 0,
  "limit": 50
}
```

---

#### action=niche_analyze (GET)

Deep niche analysis with demand/competition scores, seller concentration, shipping analysis, and condition breakdown.

| Param | Required | Description |
|-------|----------|-------------|
| `q` | Conditional | Search query (required if no `category_id`) |
| `category_id` | Conditional | Category ID (required if no `q`) |

**Example Request:**
```
GET /api/clawd/ebay-research?apiKey=KEY&userId=UID&action=niche_analyze&q=vintage%20vinyl%20records
```

**Example Response:**
```json
{
  "query": "vintage vinyl records",
  "categoryId": null,
  "marketplace": "EBAY_US",
  "totalResults": 87500,
  "avgPrice": 18.72,
  "medianPrice": 12.99,
  "priceSpread": { "min": 0.99, "max": 499.99 },
  "uniqueSellers": 4523,
  "sellerConcentration": 3.2,
  "topSellers": [
    { "username": "vinylking", "listings": 45 },
    { "username": "recordshop101", "listings": 38 }
  ],
  "freeShippingPct": 42.5,
  "conditionBreakdown": {
    "Used": 120,
    "New": 35,
    "Very Good": 28,
    "Good": 12
  },
  "aspectDistributions": {
    "Genre": { "Rock": 45, "Jazz": 23, "Pop": 18 },
    "Speed": { "33 RPM": 112, "45 RPM": 34 }
  },
  "topProducts": [
    {
      "legacyItemId": "110553820182",
      "title": "Beatles Abbey Road Vinyl LP Original Press",
      "price": 45.00,
      "soldQuantity": 23,
      "remainingQuantity": 5,
      "seller": "vinylking"
    }
  ],
  "demandScore": 72,
  "competitionScore": 65
}
```

**Score Interpretation:**
- **Demand Score (0-100)**: Based on total search results (40%) and average sold quantity of enriched items (60%). Higher = more demand.
- **Competition Score (0-100)**: Based on unique sellers (30%), inverse seller concentration (30%), and total results (40%). Higher = more competition.
- **Seller Concentration**: Percentage of total listings held by top 3 sellers. Lower = more fragmented (easier to enter).

---

### POST Actions

#### action=track_product (POST)

Add an eBay product to your tracking list. Automatically fetches full details and creates an initial price snapshot.

| Body Param | Required | Description |
|------------|----------|-------------|
| `legacyItemId` | **Yes** | eBay legacy item ID |
| `title` | No | Custom title override |
| `notes` | No | Personal notes |
| `tags` | No | Array of tags for organization |

**Example Request:**
```
POST /api/clawd/ebay-research?apiKey=KEY&userId=UID&action=track_product
Content-Type: application/json

{
  "legacyItemId": "110553820182",
  "notes": "Top competitor - monitor pricing weekly",
  "tags": ["competitor", "nike", "baby-shoes"]
}
```

**Example Response (201):**
```json
{
  "product": {
    "id": "clxyz123",
    "userId": "user-id",
    "legacyItemId": "110553820182",
    "title": "Nike Baby Shoes Infant Sneakers",
    "currentPrice": 29.99,
    "currency": "USD",
    "currentQuantity": 12,
    "totalSold": 47,
    "imageUrl": "https://i.ebayimg.com/images/g/abc/s-l1600.jpg",
    "seller": "shoeseller99",
    "notes": "Top competitor - monitor pricing weekly",
    "tags": ["competitor", "nike", "baby-shoes"],
    "isActive": true,
    "lastCheckedAt": "2026-03-23T10:00:00.000Z"
  }
}
```

Returns **409** if the product is already being tracked.

---

#### action=refresh_tracked (POST)

Refresh prices and quantities for all tracked products. Creates new price snapshots.

**Example Request:**
```
POST /api/clawd/ebay-research?apiKey=KEY&userId=UID&action=refresh_tracked
```

**Example Response:**
```json
{
  "updated": 8,
  "failed": 1,
  "total": 9,
  "results": [
    { "id": "clxyz123", "legacyItemId": "110553820182", "success": true },
    { "id": "clxyz124", "legacyItemId": "110553820183", "success": true },
    { "id": "clxyz125", "legacyItemId": "110553820184", "success": false, "error": "eBay API error: 404 - Item not found" }
  ]
}
```

---

#### action=track_seller (POST)

Add a seller to your tracking list.

| Body Param | Required | Description |
|------------|----------|-------------|
| `sellerUsername` | **Yes** | eBay seller username |
| `notes` | No | Personal notes |

**Example Request:**
```
POST /api/clawd/ebay-research?apiKey=KEY&userId=UID&action=track_seller
Content-Type: application/json

{
  "sellerUsername": "shoeseller99",
  "notes": "Main competitor in baby shoes niche"
}
```

**Example Response (201):**
```json
{
  "seller": {
    "id": "seller-001",
    "userId": "user-id",
    "sellerUsername": "shoeseller99",
    "notes": "Main competitor in baby shoes niche",
    "isActive": true,
    "createdAt": "2026-03-23T10:00:00.000Z"
  }
}
```

Returns **409** if the seller is already being tracked.

---

#### action=save_niche (POST)

Save the results of a niche research session for later reference.

| Body Param | Required | Description |
|------------|----------|-------------|
| `query` | **Yes** | The search query used |
| `categoryId` | No | Category ID |
| `categoryName` | No | Category name |
| `marketplace` | No | Marketplace ID (default: `EBAY_US`) |
| `totalResults` | No | Total search results |
| `avgPrice` | No | Average price |
| `medianPrice` | No | Median price |
| `uniqueSellers` | No | Number of unique sellers |
| `demandScore` | No | Demand score (0-100) |
| `competitionScore` | No | Competition score (0-100) |
| `notes` | No | Personal notes |

**Example Request:**
```
POST /api/clawd/ebay-research?apiKey=KEY&userId=UID&action=save_niche
Content-Type: application/json

{
  "query": "vintage vinyl records",
  "categoryName": "Records",
  "marketplace": "EBAY_US",
  "totalResults": 87500,
  "avgPrice": 18.72,
  "medianPrice": 12.99,
  "uniqueSellers": 4523,
  "demandScore": 72,
  "competitionScore": 65,
  "notes": "Good niche - high demand, moderate competition. Sweet spot at $12-25 range."
}
```

**Example Response (201):**
```json
{
  "niche": {
    "id": "niche-001",
    "query": "vintage vinyl records",
    "demandScore": 72,
    "competitionScore": 65,
    "createdAt": "2026-03-23T10:00:00.000Z"
  }
}
```

---

### DELETE Actions

#### action=untrack_product (DELETE)

Soft-delete a tracked product (sets `isActive: false`).

| Param | Required | Description |
|-------|----------|-------------|
| `product_id` | **Yes** (query) | Tracked product ID |

**Example Request:**
```
DELETE /api/clawd/ebay-research?apiKey=KEY&userId=UID&action=untrack_product&product_id=clxyz123
```

**Example Response:**
```json
{ "success": true, "productId": "clxyz123" }
```

---

#### action=untrack_seller (DELETE)

Soft-delete a tracked seller.

| Param | Required | Description |
|-------|----------|-------------|
| `seller_id` | **Yes** (query) | Tracked seller ID |

**Example Request:**
```
DELETE /api/clawd/ebay-research?apiKey=KEY&userId=UID&action=untrack_seller&seller_id=seller-001
```

**Example Response:**
```json
{ "success": true, "sellerId": "seller-001" }
```

---

#### action=delete_niche (DELETE)

Permanently delete a saved niche research session.

| Param | Required | Description |
|-------|----------|-------------|
| `niche_id` | **Yes** (query) | Niche research ID |

**Example Request:**
```
DELETE /api/clawd/ebay-research?apiKey=KEY&userId=UID&action=delete_niche&niche_id=niche-001
```

**Example Response:**
```json
{ "success": true, "nicheId": "niche-001" }
```

---

## Endpoint 3: `/api/clawd/ebay-ai` — AI-Powered Tools

All actions are **POST only**. Max duration: 30 seconds. Powered by Claude (Anthropic API).

Authentication: same as other endpoints (API key or session). No `userId` required.

---

#### action=optimize_title (POST)

AI-optimize an eBay listing title for maximum search visibility.

| Body Param | Required | Description |
|------------|----------|-------------|
| `title` | **Yes** | Current listing title |
| `categoryName` | No | Category name for context |
| `keywords` | No | Additional keywords to consider (array) |

**Example Request:**
```
POST /api/clawd/ebay-ai?apiKey=KEY&action=optimize_title
Content-Type: application/json

{
  "title": "Nice baby shoes white color",
  "categoryName": "Baby Shoes",
  "keywords": ["Nike", "infant", "sneakers"]
}
```

**Example Response:**
```json
{
  "optimizedTitle": "Nike Baby Shoes Infant Sneakers White Soft Sole Size 0-6 Months New",
  "suggestions": [
    "Include specific size information for better search matching",
    "Add the brand name at the beginning of the title",
    "Include condition (New) as buyers filter by this"
  ],
  "score": {
    "before": 25,
    "after": 82
  }
}
```

---

#### action=generate_description (POST)

Generate a professional HTML listing description.

| Body Param | Required | Description |
|------------|----------|-------------|
| `title` | **Yes** | Listing title |
| `aspects` | No | Item specifics `{ "Brand": ["Nike"], "Size": ["4C"] }` |
| `condition` | No | Item condition |
| `price` | No | Price (number) |

**Example Request:**
```
POST /api/clawd/ebay-ai?apiKey=KEY&action=generate_description
Content-Type: application/json

{
  "title": "Nike Air Max 90 Baby Shoes Infant Sneakers White",
  "aspects": {
    "Brand": ["Nike"],
    "Size": ["4C"],
    "Color": ["White"],
    "Upper Material": ["Leather"]
  },
  "condition": "New with box",
  "price": 29.99
}
```

**Example Response:**
```json
{
  "description": "<div style=\"font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px;\"><h2>Nike Air Max 90 Baby Shoes - Infant Sneakers in White</h2><p>Give your little one the iconic Nike style with these brand new Air Max 90 infant sneakers. Perfect for babies taking their first steps.</p><h3>Key Features</h3><ul><li><strong>Brand:</strong> Nike</li><li><strong>Size:</strong> 4C (Infant)</li><li><strong>Color:</strong> White</li><li><strong>Upper Material:</strong> Premium Leather</li></ul><h3>Condition</h3><p>Brand new with original box. Never worn.</p><h3>Shipping & Returns</h3><p>Please see our store policies for shipping options and return information.</p></div>"
}
```

---

#### action=analyze_listing (POST)

Get an AI analysis of listing quality with issues and improvement tips.

| Body Param | Required | Description |
|------------|----------|-------------|
| `title` | **Yes** | Listing title |
| `description` | No | HTML description (first 500 chars analyzed) |
| `price` | No | Price (number) |
| `imageCount` | No | Number of images |
| `aspects` | No | Item specifics object |
| `categoryName` | No | Category name |

**Example Request:**
```
POST /api/clawd/ebay-ai?apiKey=KEY&action=analyze_listing
Content-Type: application/json

{
  "title": "shoes",
  "price": 15.00,
  "imageCount": 2,
  "categoryName": "Baby Shoes"
}
```

**Example Response:**
```json
{
  "score": 28,
  "issues": [
    {
      "type": "title",
      "severity": "critical",
      "message": "Title is only 5 characters. eBay allows 80 characters - you're using only 6% of available space.",
      "fix": "Add brand, size, color, condition, and descriptive keywords. Example: 'Nike Baby Shoes Infant Sneakers White Size 4C New with Box'"
    },
    {
      "type": "images",
      "severity": "warning",
      "message": "Only 2 images. eBay recommends 7-12 images for optimal conversion.",
      "fix": "Add photos from multiple angles, close-ups of details, and packaging."
    },
    {
      "type": "aspects",
      "severity": "warning",
      "message": "No item specifics provided. Listings with complete item specifics rank higher in search.",
      "fix": "Add Brand, Size, Color, Material, and other category-specific attributes."
    },
    {
      "type": "description",
      "severity": "info",
      "message": "No description provided.",
      "fix": "Add a detailed HTML description with features, specifications, and condition details."
    }
  ],
  "tips": [
    "Listings with 7+ images get 20-30% more views on average",
    "Include exact size measurements to reduce returns",
    "Offer free shipping to appear in eBay's free shipping filter"
  ]
}
```

---

#### action=suggest_price (POST)

Get AI-powered pricing suggestions based on item details and competitor data.

| Body Param | Required | Description |
|------------|----------|-------------|
| `title` | **Yes** | Item title |
| `condition` | No | Item condition |
| `categoryName` | No | Category name |
| `competitorPrices` | No | Array of competitor prices (numbers) |

**Example Request:**
```
POST /api/clawd/ebay-ai?apiKey=KEY&action=suggest_price
Content-Type: application/json

{
  "title": "Nike Air Max 90 Baby Shoes White Size 4C New",
  "condition": "New with box",
  "categoryName": "Baby Shoes",
  "competitorPrices": [24.99, 29.99, 27.50, 34.99, 22.00, 31.99]
}
```

**Example Response:**
```json
{
  "suggestedPrice": 27.99,
  "priceRange": { "min": 24.99, "max": 32.99 },
  "reasoning": "Based on 6 competitor prices ranging from $22.00 to $34.99, the median is ~$28.75. Pricing at $27.99 positions you slightly below the median, which is competitive for a new listing looking to gain traction. The item's New condition and Nike brand justify staying above the $24.99 floor. Consider starting at $27.99 and adjusting based on views and watchers after 7 days."
}
```

---

#### action=bulk_optimize_titles (POST)

Optimize multiple listing titles at once. Max 10 per request.

| Body Param | Required | Description |
|------------|----------|-------------|
| `listings` | **Yes** | Array of `{ id, title, categoryName? }` objects |

**Example Request:**
```
POST /api/clawd/ebay-ai?apiKey=KEY&action=bulk_optimize_titles
Content-Type: application/json

{
  "listings": [
    { "id": "SKU-001", "title": "baby shoes", "categoryName": "Baby Shoes" },
    { "id": "SKU-002", "title": "nice phone case iphone", "categoryName": "Cell Phone Cases" },
    { "id": "SKU-003", "title": "vintage record Beatles", "categoryName": "Records" }
  ]
}
```

**Example Response:**
```json
{
  "results": [
    {
      "id": "SKU-001",
      "original": "baby shoes",
      "optimized": "Baby Shoes Infant First Walker Soft Sole Newborn Crib Shoes 0-12 Months"
    },
    {
      "id": "SKU-002",
      "original": "nice phone case iphone",
      "optimized": "iPhone 15 Pro Case Protective Shockproof Clear Slim Fit TPU Cover"
    },
    {
      "id": "SKU-003",
      "original": "vintage record Beatles",
      "optimized": "The Beatles Vinyl Record LP Vintage Original Press Classic Rock Album"
    }
  ]
}
```

---

## Workflows

### Create a New eBay Listing (Simple)

1. **Find the right category**: `GET action=category_suggestions&q=your product`
2. **Get required item aspects**: `GET action=item_aspects&category_id=CATEGORY_ID`
3. **Get business policies**: `GET action=fulfillment_policies`, `GET action=return_policies`, `GET action=payment_policies`
4. **Optimize the title**: `POST /ebay-ai?action=optimize_title` with your draft title
5. **Generate description**: `POST /ebay-ai?action=generate_description` with title and aspects
6. **Create and publish**: `POST action=create_listing` with all data and `publish: true`

### Create a New eBay Listing (Step-by-Step)

1. **Create inventory item**: `PUT action=create_inventory_item&sku=YOUR-SKU` with product data
2. **Create offer**: `POST action=create_offer` with pricing and policies
3. **Publish**: `POST action=publish&offerId=OFFER_ID`

### SEO Research Workflow

1. **Search the market**: `GET action=search_market&q=your product` to see competitors
2. **Analyze your title**: `GET action=analyze_seo&q=your product&my_title=Your Current Title`
3. **AI-optimize title**: `POST /ebay-ai?action=optimize_title` with missing keywords
4. **Analyze full listing**: `POST /ebay-ai?action=analyze_listing` for comprehensive review
5. **Update the listing**: `PUT action=update_listing&sku=YOUR-SKU` with optimized data

### Competitor Analysis Workflow

1. **Search seller's listings**: `GET action=search_seller&seller=COMPETITOR_USERNAME`
2. **Track the seller**: `POST /ebay-research?action=track_seller` with their username
3. **Track their top products**: `POST /ebay-research?action=track_product` for each item
4. **Analyze the niche**: `GET /ebay-research?action=niche_analyze&q=product category`
5. **Save the research**: `POST /ebay-research?action=save_niche` with analysis results
6. **Monitor over time**: `POST /ebay-research?action=refresh_tracked` periodically

### Pricing Research Workflow

1. **Search market**: `GET action=search_market&q=your product` to get `priceStats`
2. **Check category bestsellers**: `GET action=category_bestsellers&category_id=CAT_ID`
3. **Get AI price suggestion**: `POST /ebay-ai?action=suggest_price` with competitor prices from step 1
4. **Bulk update prices**: `POST action=bulk_update_price` if adjusting multiple listings

### Niche Discovery Workflow

1. **Browse top categories**: `GET action=top_categories`
2. **Analyze a niche**: `GET /ebay-research?action=niche_analyze&q=niche keyword`
3. **Search product database**: `GET /ebay-research?action=product_database&q=niche keyword`
4. **Check bestsellers**: `GET action=category_bestsellers&category_id=CAT_ID`
5. **Save promising niches**: `POST /ebay-research?action=save_niche`
6. **Compare saved niches**: `GET /ebay-research?action=saved_niches`

---

## Notes

### Marketplace IDs

| ID | Market |
|----|--------|
| `EBAY_US` | United States (default) |
| `EBAY_GB` | United Kingdom |
| `EBAY_DE` | Germany |
| `EBAY_AU` | Australia |
| `EBAY_CA` | Canada |
| `EBAY_FR` | France |
| `EBAY_IT` | Italy |
| `EBAY_ES` | Spain |

### Condition IDs

| ID | Condition |
|----|-----------|
| `1000` | New |
| `1500` | New other |
| `1750` | New with defects |
| `2000` | Manufacturer refurbished |
| `2500` | Seller refurbished |
| `3000` | Used |
| `4000` | Very Good |
| `5000` | Good |
| `6000` | Acceptable |
| `7000` | For parts or not working |

### eBay Browse API Sort Options

| Value | Description |
|-------|-------------|
| `BEST_MATCH` | Default relevance sort |
| `price` | Price ascending |
| `-price` | Price descending |
| `newlyListed` | Newest first |
| `endingSoonest` | Ending soonest (auctions) |

### Rate Limits

- eBay APIs have rate limits per app and per user. The Browse API (search/research endpoints) uses application tokens and has higher limits.
- Sell APIs (listing management, orders) use user tokens and are more restrictive.
- The `refresh_tracked` action iterates sequentially to avoid burst rate limits.
- `search_market`, `category_bestsellers`, and `search_seller` enrich up to 20 items with sold quantity data (parallel calls).
- `niche_analyze` and `product_database` also enrich up to 20 items.

### Error Handling

All endpoints return errors in this format:
```json
{
  "error": "Human-readable error message"
}
```

Common HTTP status codes:
- `400` — Bad request (missing params, unknown action)
- `401` — Unauthorized (invalid API key, no session)
- `403` — eBay not connected / token expired
- `404` — Resource not found
- `405` — Method not allowed
- `409` — Conflict (already tracked)
- `500` — Internal server error / eBay API error

### Action Aliases

| Alias | Maps To |
|-------|---------|
| `publish_offer` | `publish` |
| `withdraw_offer` | `withdraw` |
| `end_listing` | `withdraw` (same underlying call) |
| `get_inventory_items` | `inventory_items` |

### Token Management

- User tokens are automatically refreshed when expired or expiring within 5 minutes.
- Application tokens (for Browse API / taxonomy) are obtained via client credentials flow.
- If a user's refresh token is invalid, the API returns 403 with a message to reconnect.
