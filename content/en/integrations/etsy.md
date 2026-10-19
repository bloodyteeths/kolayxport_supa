---
title: "Etsy Integration: Listings, Orders, Stock | KolayXport"
description: "Connect your Etsy shop: listing creation and bulk editing, AI-assisted SEO, order sync, stock sync and FedEx/UPS labels."
h1: "Etsy integration"
keyword: "etsy integration"
updated: 2026-10-17
inventoryRefs: [settings-connections, order-sync-etsy, ext-etsy-address, etsy-listing-editor, etsy-listing-create, etsy-bulk-editor, bulk-photo-studio, stock-sync, tracking-push-etsy, ext-etsy-tracking, label-fedex, label-ups, reports-profit, inbox-unified, research-keywords, ext-etsy-research, etsy-copy-to-shop]
draft: false
name: "Etsy"
kind: marketplace
status: production
setupMinutes: 3
connect: "OAuth: under Settings › Connections you sign in with Etsy and grant access. You can connect more than one shop."
capabilities:
  - label: "Order sync"
    status: "yes"
    note: "Etsy's API withholds buyer addresses; full addresses need the Chrome extension"
    ref: order-sync-etsy
  - label: "Listing create and edit"
    status: "yes"
    note: "Title, tags, variations, personalization, photos, video, shipping and return policies"
    ref: etsy-listing-editor
  - label: "Bulk edit"
    status: "yes"
    note: "Title, price, quantity, section, tags; bulk photo studio is Pro"
    ref: etsy-bulk-editor
  - label: "Stock sync"
    status: "yes"
    note: "Beta; Etsy changes arrive in about a minute"
    ref: stock-sync
  - label: "Tracking push"
    status: "partial"
    note: "Entered on Etsy only while the Chrome extension is running"
    ref: tracking-push-etsy
  - label: "Shipping labels"
    status: "yes"
    note: "International with your own FedEx/UPS account, domestic with DHL eCommerce; no Etsy Postage"
    ref: label-fedex
  - label: "Finance and profit"
    status: "yes"
    note: "Includes ad spend; Pro feature"
    ref: reports-profit
  - label: "Messages"
    status: "no"
    note: "Etsy conversations aren't shown in the app"
    ref: inbox-unified
  - label: "Research"
    status: "yes"
    note: "Product finder, keywords, listing doctor, competitor tracker"
    ref: research-keywords
  - label: "Extension overlay"
    status: "partial"
    note: "Works on Etsy pages; install it from the Chrome Web Store"
    ref: ext-etsy-research
faq:
  - q: "Can I connect more than one Etsy shop?"
    a: "Yes. Connect each shop separately, and copy listings from one shop to another with their variations, photos and video."
  - q: "Does an edit change Etsy right away?"
    a: "No. Changes stay as drafts and go to Etsy when you press Send or at the time you schedule. If the listing changed on Etsy in the meantime, the send stops."
  - q: "Why are addresses missing on Etsy orders?"
    a: "Etsy's API doesn't share the buyer's address or email. The Chrome extension brings in the full address. Install it from the Chrome Web Store."
  - q: "Can I reply to Etsy messages?"
    a: "Not right now. The inbox covers Trendyol customer questions and Wix chats only."
---

## What works

Etsy is KolayXport's deepest integration. You edit almost every part of your listings in the app: title, description, tags, price, category attributes, variations and variation images, personalization, photo order and alt text, video, sections, and shipping and return policies. You can create new listings, renew, deactivate and copy them. Every change stays a draft first, and you can roll back a wrong edit from the listing's version history.

Orders land in the same list as your other channels, and you print international labels with your own FedEx or UPS account. On the finance side, Etsy fees and ad spend flow into the profit report (Pro).

## Setup

1. Under Settings › Connections, press Connect on the Etsy tile.
2. Sign in on Etsy and allow KolayXport access.
3. Your listings and orders come into the app. Repeat for any other shop.

## Limits

- Etsy's API doesn't provide buyer addresses or emails; these, and pushing tracking numbers to Etsy, depend on the KolayXport Chrome extension.
- Etsy messages aren't in the app.
- Etsy's own shipping labels (Etsy Postage) aren't supported.
- Stock sync is in beta and stays off until you complete the wizard and go live.
