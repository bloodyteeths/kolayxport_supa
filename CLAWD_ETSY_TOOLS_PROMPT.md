# Etsy Integration — Complete API Reference for Clawd

You have full access to the KolayXport Etsy API. All endpoints go through a single gateway.

## Authentication

Every request requires an API key:
```
?apiKey={API_KEY}
```
Or header: `X-Api-Key: {API_KEY}`

## Base URL Pattern

```
{METHOD} {KOLAYXPORT_API_URL}/etsy?apiKey={API_KEY}&action={ACTION}&shop_id={SHOP_ID}&...params
```

- `KOLAYXPORT_API_URL` = the base URL (e.g. `https://kolayxport.com/api/clawd`)
- All authenticated actions require `shop_id` (the Etsy numeric shop ID)
- Public actions (market research) do NOT require `shop_id`

---

## Quick Reference — All Actions

| Action | Method | Auth | Description |
|--------|--------|------|-------------|
| `receipts` | GET | shop | List orders/receipts |
| `receipt` | GET | shop | Get single order with items & tracking |
| `submit-tracking` | POST | shop | Submit tracking number to Etsy |
| `listings` | GET | shop | List active listings |
| `all_listings` | GET | shop | List listings by state |
| `listings_with_images` | GET | shop | List listings with thumbnail data |
| `listing` | GET | shop | Get full listing detail + images + personalization |
| `create_listing` | POST | shop | Create draft listing |
| `update_listing` | PATCH | shop | Update listing fields |
| `copy_listing` | POST | shop | Duplicate listing as draft |
| `delete_listing` | DELETE | shop | Delete listing permanently |
| `publish` | POST | shop | Publish draft → active |
| `renew_listing` | POST | shop | Renew expired listing |
| `drafts` | GET | shop | List draft listings |
| `upload_image` | POST | shop | Upload image to listing |
| `get_listing_images` | GET | shop | Get all images for listing |
| `update_listing_image` | PATCH | shop | Update image alt_text or rank |
| `delete_image` | DELETE | shop | Delete image from listing |
| `get_listing_videos` | GET | shop | Get videos for listing |
| `upload_video` | POST | shop | Upload/link video to listing |
| `delete_video` | DELETE | shop | Delete video from listing |
| `get_personalization` | GET | shop | Get personalization questions |
| `set_personalization` | POST | shop | Set multiple personalization questions |
| `set_simple_personalization` | POST | shop | Quick single text personalization |
| `remove_personalization` | POST/DELETE | shop | Remove all personalization |
| `get_listing_inventory` | GET | shop | Get inventory/variants |
| `update_listing_inventory` | PUT | shop | Update inventory/variants |
| `get_shipping_profiles` | GET | shop | List shipping profiles |
| `create_shipping_profile` | POST | shop | Create shipping profile |
| `update_shipping_profile` | PATCH | shop | Update shipping profile |
| `delete_shipping_profile` | DELETE | shop | Delete shipping profile |
| `get_return_policies` | GET | shop | List return policies |
| `create_return_policy` | POST | shop | Create return policy |
| `update_return_policy` | PUT | shop | Update return policy |
| `delete_return_policy` | DELETE | shop | Delete return policy |
| `get_shop_sections` | GET | shop | List shop sections |
| `create_shop_section` | POST | shop | Create shop section |
| `update_shop_section` | PUT | shop | Update shop section title |
| `delete_shop_section` | DELETE | shop | Delete shop section |
| `get_readiness_states` | GET | shop | List processing profiles |
| `create_readiness_state` | POST | shop | Create processing profile |
| `taxonomy` | GET | shop | Get Etsy category tree |
| `conversations` | GET | shop | List conversations |
| `conversation` | GET | shop | Get conversation with messages |
| `send_message` | POST | shop | Send message in conversation |
| `search_market` | GET | public | Search all Etsy listings |
| `get_public_shop` | GET | public | Get public shop info |
| `get_public_shop_listings` | GET | public | Get shop's public listings |
| `batch_shops` | GET | public | Get multiple shops info |

---

## ORDER MANAGEMENT

### List Orders (Receipts)

```
GET /etsy?apiKey={KEY}&shop_id={SHOP_ID}
GET /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=receipts&limit=25&offset=0
```

Optional: `&customer=John` (filter by name)

**Response:**
```json
[
  {
    "receipt_id": 1234567890,
    "customer": {
      "name": "John Smith",
      "first_name": "John",
      "last_name": "Smith"
    },
    "shipping_address": {
      "first_line": "123 Main St",
      "second_line": null,
      "city": "Portland",
      "state": "OR",
      "zip": "97201",
      "country_iso": "US"
    },
    "order_date": "2025-01-15",
    "total_price": 29.99
  }
]
```

### Get Single Order

```
GET /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=receipt&receipt_id=1234567890
```

**Response:**
```json
{
  "receipt_id": 1234567890,
  "customer": {
    "name": "John Smith",
    "first_name": "John",
    "last_name": "Smith"
  },
  "shipping_address": {
    "first_line": "123 Main St",
    "second_line": null,
    "city": "Portland",
    "state": "OR",
    "zip": "97201",
    "country_iso": "US"
  },
  "items": [
    {
      "transaction_id": 9876543,
      "title": "Personalized Necklace",
      "quantity": 1,
      "price": 24.99,
      "sku": "NECK-001"
    }
  ],
  "tracking": {
    "tracking_code": null,
    "carrier_name": null
  }
}
```

### Submit Tracking

```
POST /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=submit-tracking&receipt_id=1234567890
Content-Type: application/json

{
  "tracking_code": "1Z999AA10123456784",
  "carrier_name": "ups"
}
```

**Response:**
```json
{
  "success": true,
  "receipt_id": 1234567890,
  "tracking_code": "1Z999AA10123456784",
  "carrier_name": "ups"
}
```

---

## LISTING MANAGEMENT

### List Listings

```
GET /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=listings&limit=25&offset=0
```

**Response:**
```json
{
  "count": 150,
  "listings": [
    {
      "listing_id": 1234567890,
      "title": "Personalized Name Necklace Gold",
      "description": "Beautiful handmade necklace...",
      "tags": ["necklace", "personalized", "gold"],
      "materials": ["gold", "stainless steel"],
      "price": { "amount": 2499, "divisor": 100, "currency_code": "USD" },
      "views": 1250,
      "num_favorers": 89,
      "quantity": 25,
      "state": "active",
      "url": "https://www.etsy.com/listing/1234567890",
      "taxonomy_id": 1253,
      "shop_section_id": 12345,
      "who_made": "i_did",
      "when_made": "2020_2025",
      "is_supply": false,
      "created_timestamp": 1700000000,
      "updated_timestamp": 1705000000
    }
  ]
}
```

### List All Listings (any state)

```
GET /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=all_listings&state=active&limit=100&offset=0
```

State options: `active`, `draft`, `inactive`, `expired`

### List Listings with Images

```
GET /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=listings_with_images&state=active&limit=100&offset=0
```

Same as `all_listings` but includes `thumbnail` and `image_count` fields:
```json
{
  "thumbnail": {
    "listing_image_id": 111,
    "url_75x75": "https://...",
    "url_170x135": "https://...",
    "url_570xN": "https://..."
  },
  "image_count": 7
}
```

### List Draft Listings

```
GET /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=drafts&limit=25&offset=0
```

**Response:**
```json
{
  "count": 5,
  "drafts": [
    {
      "listing_id": 1234567890,
      "title": "New Bracelet Design",
      "state": "draft",
      "price": { "amount": 1999, "divisor": 100, "currency_code": "USD" },
      "quantity": 10,
      "created_timestamp": 1700000000,
      "updated_timestamp": 1705000000
    }
  ]
}
```

### Get Full Listing Detail

```
GET /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=listing&listing_id=1234567890
```

**Response:** (all fields from list + these extras)
```json
{
  "listing_id": 1234567890,
  "title": "Personalized Name Necklace Gold",
  "description": "Beautiful handmade necklace...",
  "tags": ["necklace", "personalized", "gold"],
  "materials": ["gold", "stainless steel"],
  "price": { "amount": 2499, "divisor": 100, "currency_code": "USD" },
  "views": 1250,
  "num_favorers": 89,
  "quantity": 25,
  "state": "active",
  "url": "https://www.etsy.com/listing/1234567890",
  "taxonomy_id": 1253,
  "shop_section_id": 12345,
  "processing_min": 1,
  "processing_max": 3,
  "who_made": "i_did",
  "when_made": "2020_2025",
  "is_supply": false,
  "item_weight": 0.5,
  "item_weight_unit": "oz",
  "item_length": 10,
  "item_width": 5,
  "item_height": 1,
  "item_dimensions_unit": "in",
  "shipping_profile_id": 98765,
  "return_policy_id": 54321,
  "is_personalizable": true,
  "personalization_questions": [
    {
      "question_id": 111,
      "question_type": "text_input",
      "question_text": "Name for necklace",
      "instructions": "Max 10 characters, letters only",
      "required": true,
      "max_allowed_characters": 10
    }
  ],
  "images": [
    {
      "listing_image_id": 222,
      "url_75x75": "https://...",
      "url_170x135": "https://...",
      "url_570xN": "https://...",
      "url_fullxfull": "https://...",
      "rank": 1,
      "alt_text": "Gold personalized necklace"
    }
  ],
  "created_timestamp": 1700000000,
  "updated_timestamp": 1705000000
}
```

### Create Listing (Draft)

```
POST /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=create_listing
Content-Type: application/json

{
  "title": "Handmade Silver Bracelet — Personalized Gift",
  "description": "Beautiful handmade silver bracelet, perfect for gifts...",
  "price": 29.99,
  "taxonomy_id": 1253,
  "quantity": 10,
  "tags": ["bracelet", "silver", "handmade", "personalized", "gift"],
  "materials": ["sterling silver"],
  "who_made": "i_did",
  "when_made": "2020_2025",
  "is_supply": false,
  "shipping_profile_id": 98765,
  "return_policy_id": 54321,
  "shop_section_id": 12345,
  "processing_min": 1,
  "processing_max": 3
}
```

**Required fields:** `title`, `description`, `price`, `taxonomy_id`

**Optional fields:** `quantity` (default 1), `tags`, `materials`, `shop_section_id`, `processing_min`, `processing_max`, `readiness_state_id`, `shipping_profile_id`, `return_policy_id`, `who_made`, `when_made`, `is_supply`

`who_made` values: `"i_did"`, `"someone_else"`, `"collective"`
`when_made` values: `"made_to_order"`, `"2020_2025"`, `"2010_2019"`, `"2004_2009"`, `"before_2004"`, `"2000_2003"`, `"1990s"`, `"1980s"`, `"1970s"`, `"1960s"`, `"1950s"`, `"1940s"`, `"1930s"`, `"1920s"`, `"1910s"`, `"1900s"`, `"1800s"`, `"1700s"`, `"before_1700"`

**Response:**
```json
{
  "success": true,
  "listing_id": 1234567890,
  "state": "draft",
  "title": "Handmade Silver Bracelet — Personalized Gift",
  "url": "https://www.etsy.com/listing/1234567890",
  "message": "Draft listing created"
}
```

### Update Listing

```
PATCH /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=update_listing&listing_id=1234567890
Content-Type: application/json

{
  "title": "Updated Title Here",
  "price": 34.99,
  "tags": ["bracelet", "silver", "handmade", "gift", "birthday"],
  "quantity": 15,
  "description": "Updated description..."
}
```

All fields are optional — only send what you want to change. Supports: `title`, `description`, `tags`, `materials`, `price`, `quantity`, `shop_section_id`, `who_made`, `when_made`, `is_supply`, `taxonomy_id`, `shipping_profile_id`, `return_policy_id`, `item_weight`, `item_weight_unit`, `item_length`, `item_width`, `item_height`, `item_dimensions_unit`, `processing_min`, `processing_max`, `state`

**Response:**
```json
{
  "success": true,
  "listing_id": 1234567890,
  "updated_fields": ["title", "price", "tags", "quantity", "description"]
}
```

### Copy (Duplicate) Listing

```
POST /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=copy_listing
Content-Type: application/json

{
  "source_listing_id": 1234567890,
  "title_prefix": "COPY - "
}
```

Creates a draft copy with all data including personalization questions. `title_prefix` defaults to `"COPY - "`.

**Response:**
```json
{
  "success": true,
  "source_listing_id": 1234567890,
  "new_listing_id": 9876543210,
  "title": "COPY - Handmade Silver Bracelet",
  "state": "draft",
  "url": "https://www.etsy.com/listing/9876543210",
  "personalization_copied": true,
  "personalization_questions": 2,
  "message": "Listing copied as draft. Upload images and publish when ready."
}
```

### Delete Listing

```
DELETE /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=delete_listing&listing_id=1234567890
```

**Response:**
```json
{
  "success": true,
  "listing_id": "1234567890",
  "message": "Listing deleted"
}
```

### Publish Draft

```
POST /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=publish&listing_id=1234567890
```

Listing must have at least 1 image to publish.

**Response:**
```json
{
  "success": true,
  "listing_id": 1234567890,
  "state": "active",
  "title": "Handmade Silver Bracelet",
  "url": "https://www.etsy.com/listing/1234567890",
  "message": "Listing published successfully"
}
```

### Renew Expired Listing

```
POST /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=renew_listing&listing_id=1234567890
```

**Response:**
```json
{
  "success": true,
  "listing": { ... }
}
```

---

## IMAGE MANAGEMENT

### Upload Image

```
POST /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=upload_image&listing_id=1234567890
Content-Type: application/json

{
  "image_url": "https://example.com/photo.jpg",
  "rank": 1,
  "overwrite": true,
  "alt_text": "Gold personalized necklace on white background"
}
```

**OR** with base64:
```json
{
  "image_base64": "/9j/4AAQSkZJRgABAQ...",
  "image_content_type": "image/jpeg",
  "image_filename": "necklace.jpg",
  "rank": 1,
  "alt_text": "Gold personalized necklace"
}
```

Supported types: `image/jpeg`, `image/png`, `image/gif`, `image/webp`

**Response:**
```json
{
  "success": true,
  "listing_id": "1234567890",
  "listing_image_id": 5555555,
  "rank": 1,
  "url_fullxfull": "https://i.etsystatic.com/...",
  "alt_text": "Gold personalized necklace",
  "message": "Image uploaded at rank 1"
}
```

### Get Listing Images

```
GET /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=get_listing_images&listing_id=1234567890
```

**Response:**
```json
{
  "count": 7,
  "images": [
    {
      "listing_image_id": 5555555,
      "listing_id": 1234567890,
      "url_75x75": "https://...",
      "url_170x135": "https://...",
      "url_570xN": "https://...",
      "url_fullxfull": "https://...",
      "rank": 1,
      "alt_text": "Gold necklace"
    }
  ]
}
```

### Update Image (alt text or rank)

```
PATCH /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=update_listing_image&listing_id=1234567890&image_id=5555555
Content-Type: application/json

{
  "alt_text": "Updated alt text for SEO",
  "rank": 2
}
```

### Delete Image

```
DELETE /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=delete_image&listing_id=1234567890&image_id=5555555
```

---

## VIDEO MANAGEMENT

### Get Listing Videos

```
GET /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=get_listing_videos&listing_id=1234567890
```

**Response:**
```json
{
  "count": 1,
  "videos": [
    {
      "video_id": 777777,
      "video_url": "https://...",
      "thumbnail_url": "https://...",
      "height": 1080,
      "width": 1920,
      "video_state": "active"
    }
  ]
}
```

### Upload Video

```
POST /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=upload_video&listing_id=1234567890
Content-Type: application/json

{
  "video_url": "https://example.com/product-demo.mp4",
  "name": "Product Demo"
}
```

**OR** link existing video:
```json
{
  "video_id": 777777
}
```

Supported: MP4, MOV, AVI, MPEG, FLV (max 100MB, 5-60 seconds)

### Delete Video

```
DELETE /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=delete_video&listing_id=1234567890&video_id=777777
```

---

## PERSONALIZATION MANAGEMENT

### Get Personalization Questions

```
GET /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=get_personalization&listing_id=1234567890
```

**Response:**
```json
{
  "listing_id": "1234567890",
  "personalization_questions": [
    {
      "question_id": 111,
      "question_type": "text_input",
      "question_text": "Name for engraving",
      "instructions": "Max 15 characters",
      "required": true,
      "max_allowed_characters": 15
    },
    {
      "question_id": 112,
      "question_type": "dropdown",
      "question_text": "Font style",
      "required": false,
      "options": [
        { "label": "Script" },
        { "label": "Block" },
        { "label": "Serif" }
      ]
    }
  ],
  "count": 2
}
```

### Set Personalization Questions (Multi-Question API)

```
POST /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=set_personalization&listing_id=1234567890
Content-Type: application/json

{
  "personalization_questions": [
    {
      "question_type": "text_input",
      "question_text": "Name for engraving",
      "instructions": "Letters only, max 15 chars",
      "required": true,
      "max_allowed_characters": 15
    },
    {
      "question_type": "dropdown",
      "question_text": "Font style",
      "required": false,
      "options": [
        { "label": "Script" },
        { "label": "Block" },
        { "label": "Serif" }
      ]
    },
    {
      "question_type": "unlabeled_upload",
      "question_text": "Upload your photo",
      "instructions": "High resolution preferred",
      "required": false,
      "max_allowed_files": 3
    }
  ]
}
```

**Question types:**
- `text_input` — Free text. Requires `max_allowed_characters` (1-1024).
- `dropdown` — Selection. Requires `options` (1-30 items). NO `instructions` allowed.
- `unlabeled_upload` — File upload. Requires `max_allowed_files` (1-10).
- `labeled_upload` — Labeled file upload. Requires `options` AND `max_allowed_files` (count must match).

**Limits:** Max 5 questions per listing. Max 1 upload question per listing.

### Set Simple Personalization (Quick Helper)

```
POST /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=set_simple_personalization&listing_id=1234567890
Content-Type: application/json

{
  "question_text": "Personalization",
  "instructions": "Enter your custom text here",
  "required": false,
  "max_characters": 256
}
```

### Remove All Personalization

```
POST /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=remove_personalization&listing_id=1234567890
```

or:

```
DELETE /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=remove_personalization&listing_id=1234567890
```

---

## INVENTORY & VARIATIONS

### Get Listing Inventory

```
GET /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=get_listing_inventory&listing_id=1234567890
```

**Response:**
```json
{
  "listing_id": "1234567890",
  "products": [
    {
      "product_id": 111,
      "sku": "NECK-GOLD-S",
      "offerings": [
        {
          "offering_id": 222,
          "price": { "amount": 2499, "divisor": 100, "currency_code": "USD" },
          "quantity": 10,
          "is_enabled": true
        }
      ],
      "property_values": [
        {
          "property_id": 200,
          "property_name": "Color",
          "values": ["Gold"],
          "scale_id": null
        },
        {
          "property_id": 100,
          "property_name": "Size",
          "values": ["Small"],
          "scale_id": null
        }
      ]
    }
  ]
}
```

### Update Listing Inventory

```
PUT /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=update_listing_inventory&listing_id=1234567890
Content-Type: application/json

{
  "products": [
    {
      "sku": "NECK-GOLD-S",
      "offerings": [
        {
          "price": 24.99,
          "quantity": 15,
          "is_enabled": true
        }
      ],
      "property_values": [
        {
          "property_id": 200,
          "property_name": "Color",
          "values": ["Gold"]
        }
      ]
    }
  ]
}
```

---

## SHOP CONFIGURATION

### Shipping Profiles

**List:**
```
GET /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=get_shipping_profiles
```

**Response:**
```json
{
  "count": 3,
  "shipping_profiles": [
    {
      "shipping_profile_id": 98765,
      "title": "Standard US Shipping",
      "origin_country_iso": "US",
      "min_processing_days": 1,
      "max_processing_days": 3,
      "processing_days_display_label": "1-3 business days"
    }
  ]
}
```

**Create:**
```
POST /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=create_shipping_profile
Content-Type: application/json

{
  "title": "International Shipping",
  "origin_country_iso": "TR",
  "primary_cost": 12.99,
  "secondary_cost": 5.99,
  "min_processing_days": 3,
  "max_processing_days": 7,
  "destination_country_iso": "US"
}
```

**Update:**
```
PATCH /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=update_shipping_profile&shipping_profile_id=98765
Content-Type: application/json

{
  "title": "Updated Title",
  "primary_cost": 14.99
}
```

**Delete:**
```
DELETE /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=delete_shipping_profile&shipping_profile_id=98765
```

### Return Policies

**List:**
```
GET /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=get_return_policies
```

**Create:**
```
POST /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=create_return_policy
Content-Type: application/json

{
  "accepts_returns": true,
  "accepts_exchanges": true,
  "return_deadline": 30
}
```

**Update:**
```
PUT /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=update_return_policy&return_policy_id=54321
Content-Type: application/json

{
  "accepts_returns": false
}
```

**Delete:**
```
DELETE /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=delete_return_policy&return_policy_id=54321
```

### Shop Sections

**List:**
```
GET /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=get_shop_sections
```

**Response:**
```json
{
  "count": 5,
  "shop_sections": [
    {
      "shop_section_id": 12345,
      "title": "Necklaces",
      "rank": 1,
      "active_listing_count": 23
    }
  ]
}
```

**Create:**
```
POST /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=create_shop_section
Content-Type: application/json

{ "title": "New Arrivals" }
```

**Update:**
```
PUT /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=update_shop_section&section_id=12345
Content-Type: application/json

{ "title": "Updated Section Name" }
```

**Delete:**
```
DELETE /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=delete_shop_section&section_id=12345
```

### Processing Profiles (Readiness States)

**List:**
```
GET /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=get_readiness_states
```

**Response:**
```json
{
  "count": 2,
  "readiness_states": [
    {
      "readiness_state_id": 111,
      "readiness_state": "ready_to_ship",
      "min_processing_time": 1,
      "max_processing_time": 1,
      "processing_time_unit": "business_days"
    },
    {
      "readiness_state_id": 222,
      "readiness_state": "made_to_order",
      "min_processing_time": 3,
      "max_processing_time": 5,
      "processing_time_unit": "business_days"
    }
  ]
}
```

**Create:**
```
POST /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=create_readiness_state
Content-Type: application/json

{
  "readiness_state": "made_to_order",
  "min_processing_time": 5,
  "max_processing_time": 7,
  "processing_time_unit": "business_days"
}
```

### Category Taxonomy

```
GET /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=taxonomy
```

Returns the full Etsy seller taxonomy tree for setting `taxonomy_id` on listings.

---

## CONVERSATIONS

### List Conversations

```
GET /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=conversations&limit=25&offset=0
```

### Get Conversation with Messages

```
GET /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=conversation&conversation_id=9999999
```

### Send Message

```
POST /etsy?apiKey={KEY}&shop_id={SHOP_ID}&action=send_message&conversation_id=9999999
Content-Type: application/json

{
  "message": "Thank you for your order! It will ship tomorrow."
}
```

---

## MARKET RESEARCH (Public — No shop_id needed)

### Search Market

```
GET /etsy?apiKey={KEY}&action=search_market&keywords=personalized+necklace&limit=200
```

Optional params: `min_price`, `max_price`, `sort_on` (score|price|created|updated), `sort_order` (asc|desc), `taxonomy_id`

**Response:**
```json
{
  "total": 45230,
  "items": [
    {
      "listing_id": 111,
      "title": "Personalized Name Necklace",
      "description": "...",
      "price": 24.99,
      "currency_code": "USD",
      "views": 5000,
      "num_favorers": 320,
      "tags": ["necklace", "personalized"],
      "shop_id": 222,
      "taxonomy_id": 1253,
      "url": "https://...",
      "quantity": 999,
      "image_url": "https://...",
      "created_timestamp": 1700000000,
      "state": "active"
    }
  ],
  "priceStats": { "min": 5.99, "max": 199.99, "avg": 34.50, "median": 28.00, "count": 200 },
  "tagFrequency": [
    { "tag": "personalized", "count": 180, "pct": 90 },
    { "tag": "necklace", "count": 175, "pct": 88 }
  ],
  "titleKeywords": [
    { "keyword": "personalized", "count": 165, "pct": 83 },
    { "keyword": "necklace", "count": 155, "pct": 78 }
  ],
  "shopIds": [222, 333, 444]
}
```

### Get Public Shop Info

```
GET /etsy?apiKey={KEY}&action=get_public_shop&target_shop_id=12345678
```

**Response:**
```json
{
  "shop_id": 12345678,
  "shop_name": "JewelryByMaria",
  "num_sales": 15420,
  "review_count": 8900,
  "review_average": 4.9,
  "listing_active_count": 234,
  "currency_code": "USD",
  "url": "https://www.etsy.com/shop/JewelryByMaria",
  "icon_url": "https://..."
}
```

### Get Public Shop Listings

```
GET /etsy?apiKey={KEY}&action=get_public_shop_listings&target_shop_id=12345678&limit=100
```

### Batch Shop Info

```
GET /etsy?apiKey={KEY}&action=batch_shops&shop_ids=111,222,333,444
```

Max 20 shop IDs. Returns array of shop info objects.

---

## AI-POWERED OPTIMIZATION

These use a separate endpoint: `{KOLAYXPORT_API_URL}/../ai/etsy`

### Suggest Tags

```
POST /ai/etsy
Content-Type: application/json

{
  "action": "suggest_tags",
  "title": "Handmade Silver Ring Personalized",
  "description": "Beautiful sterling silver ring...",
  "tags_current": ["ring", "silver"],
  "category": "Jewelry"
}
```

**Response:** `{ "suggestions": ["handmade ring", "silver ring", "personalized ring", ...] }` (13 tags)

### Optimize Title

```
POST /ai/etsy
Content-Type: application/json

{
  "action": "optimize_title",
  "title": "Silver Ring",
  "description": "Handmade sterling silver ring with custom engraving",
  "tags": ["ring", "silver", "handmade"],
  "category": "Jewelry"
}
```

**Response:** `{ "optimized_title": "Handmade Sterling Silver Ring, Personalized Engraved Ring, Custom Gift for Her", "explanation": "..." }`

### Generate Description

```
POST /ai/etsy
Content-Type: application/json

{
  "action": "generate_description",
  "title": "Personalized Name Necklace",
  "tags": ["necklace", "personalized", "gold"],
  "materials": ["14k gold fill"],
  "category": "Jewelry"
}
```

### Generate Alt Text

```
POST /ai/etsy
Content-Type: application/json

{
  "action": "generate_alt_text",
  "title": "Gold Name Necklace",
  "description": "Personalized 14k gold necklace...",
  "image_url": "https://..."
}
```

### Bulk Optimize (up to 20 listings)

```
POST /ai/etsy
Content-Type: application/json

{
  "action": "bulk_optimize",
  "listings": [
    { "listing_id": 111, "title": "...", "description": "...", "tags": [...] },
    { "listing_id": 222, "title": "...", "description": "...", "tags": [...] }
  ]
}
```

### Market Analysis (AI)

```
POST /ai/etsy
Content-Type: application/json

{
  "action": "market_analysis",
  "query": "personalized necklace",
  "totalResults": 45000,
  "priceStats": { "min": 5, "max": 200, "avg": 35, "median": 28 },
  "topTags": [{ "tag": "personalized", "count": 180, "pct": 90 }],
  "topKeywords": [{ "keyword": "necklace", "count": 155, "pct": 78 }],
  "shopCount": 20,
  "avgFavorites": 45,
  "avgViews": 1200,
  "topShops": [{ "shop_name": "...", "num_sales": 15000 }]
}
```

---

## WORKFLOWS

### Workflow 1: Create and Publish a New Listing

```
1. GET  ?action=get_shipping_profiles        → pick a shipping_profile_id
2. GET  ?action=get_return_policies           → pick a return_policy_id
3. GET  ?action=get_shop_sections             → pick a shop_section_id (or create one)
4. GET  ?action=taxonomy                      → find the right taxonomy_id
5. POST ?action=create_listing                → creates a draft, returns listing_id
6. POST ?action=upload_image&listing_id=X     → upload 1-10 images (rank 1 = main photo)
7. POST ?action=upload_video&listing_id=X     → optional: add a video
8. POST ?action=set_personalization&listing_id=X → optional: add personalization questions
9. PUT  ?action=update_listing_inventory&listing_id=X → optional: set variations
10. POST ?action=publish&listing_id=X          → go live!
```

### Workflow 2: SEO Optimization for Existing Listing

```
1. GET  ?action=listing&listing_id=X          → get current title, tags, description
2. POST /ai/etsy  action=optimize_title       → get optimized title
3. POST /ai/etsy  action=suggest_tags         → get 13 optimized tags
4. POST /ai/etsy  action=generate_description → get SEO description
5. PATCH ?action=update_listing&listing_id=X  → apply title + tags + description
6. GET  ?action=get_listing_images&listing_id=X → get current images
7. POST /ai/etsy  action=generate_alt_text    → for each image
8. PATCH ?action=update_listing_image&listing_id=X&image_id=Y → set alt_text
```

### Workflow 3: Bulk SEO Optimization

```
1. GET  ?action=listings_with_images&limit=100 → get all listings
2. POST /ai/etsy  action=bulk_optimize         → optimize up to 20 at a time
3. For each result:
   PATCH ?action=update_listing&listing_id=X   → apply optimized title, tags, description
```

### Workflow 4: Duplicate a Listing

```
1. POST ?action=copy_listing  (source_listing_id=X) → creates draft copy
2. PATCH ?action=update_listing&listing_id=NEW       → modify title, price, etc.
3. POST ?action=upload_image&listing_id=NEW          → upload new images
4. POST ?action=publish&listing_id=NEW               → go live
```

### Workflow 5: Order Fulfillment

```
1. GET  ?action=receipts                      → list unfulfilled orders
2. GET  ?action=receipt&receipt_id=X           → get order details & address
3. (Generate shipping label via FedEx/UPS)
4. POST ?action=submit-tracking&receipt_id=X   → submit tracking to Etsy
```

### Workflow 6: Market Research → New Product

```
1. GET  ?action=search_market&keywords=X       → analyze competition
2. GET  ?action=batch_shops&shop_ids=...       → analyze top sellers
3. GET  ?action=get_public_shop_listings&target_shop_id=X → study competitor
4. POST /ai/etsy  action=market_analysis       → get AI strategy
5. → Use insights to create optimized listing (Workflow 1)
```

### Workflow 7: Add Personalization to Listing

```
1. GET  ?action=get_personalization&listing_id=X       → check current state
2. POST ?action=set_personalization&listing_id=X       → set questions
   OR
   POST ?action=set_simple_personalization&listing_id=X → quick text field
3. GET  ?action=listing&listing_id=X                   → verify personalization is set
```

### Workflow 8: Manage Inventory Variations

```
1. GET  ?action=get_listing_inventory&listing_id=X     → see current variants
2. PUT  ?action=update_listing_inventory&listing_id=X   → update prices/quantities per variant
```

---

## IMPORTANT NOTES

- **Token refresh is automatic** — the API handles expired OAuth tokens transparently.
- **Rate limits** — Etsy enforces rate limits. The API adds 120ms delays on paginated calls. Don't make more than ~10 requests/second.
- **Price format** — When reading: `{ amount: 2499, divisor: 100 }` = $24.99. When writing: just send `24.99` as a number.
- **Tags** — Always send exactly 13 tags for optimal SEO. Each tag max 20 characters.
- **Title** — Etsy recommends 100-140 characters. Use important keywords at the front.
- **Images** — Rank 1 is the main/thumbnail image. Upload up to 10 images per listing.
- **Taxonomy** — Use `?action=taxonomy` to browse categories. This is required for listing creation.
- **Personalization** — New Feb 2026 multi-question API. Max 5 questions, max 1 upload type.
- **State transitions** — draft → active (publish), active → inactive (update state), expired → active (renew).
