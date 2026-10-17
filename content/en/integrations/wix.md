---
title: "Wix Integration: Orders, Products, Chat | KolayXport"
description: "Connect your Wix store with an app install: order sync, product editing, tracking upload, and answering Wix chats from the app."
h1: "Wix integration"
keyword: "wix integration"
updated: 2026-10-17
inventoryRefs: [settings-connections, order-sync-wix, wix-products, stock-sync, tracking-push-wix, label-fedex, label-dhl-ecommerce, reports-profit, inbox-unified, ai-message-draft, ai-listing-copy]
draft: false
name: "Wix"
kind: marketplace
status: beta
setupMinutes: 3
connect: "App install: from Settings › Connections you install the KolayXport app on your Wix site and grant access."
capabilities:
  - label: "Order sync"
    status: "partial"
    note: "Beta; may need to be switched on for your account"
    ref: order-sync-wix
  - label: "Product create and edit"
    status: "partial"
    note: "Products with variants and discounted products can't be edited"
    ref: wix-products
  - label: "Bulk edit"
    status: "yes"
    note: "Title, price and quantity"
    ref: wix-products
  - label: "Stock sync"
    status: "partial"
    note: "Read-only by default; nothing is written to Wix stock"
    ref: stock-sync
  - label: "Tracking push"
    status: "yes"
    note: "Beta"
    ref: tracking-push-wix
  - label: "Shipping labels"
    status: "yes"
    note: "FedEx/UPS international, DHL eCommerce domestic"
    ref: label-fedex
  - label: "Finance and profit"
    status: "no"
    note: "Wix sales appear in the sales report, not the profit report"
    ref: reports-profit
  - label: "Messages"
    status: "partial"
    note: "Wix chats, with AI reply drafts; beta"
    ref: inbox-unified
  - label: "AI listing writing"
    status: "no"
    ref: ai-listing-copy
faq:
  - q: "Is my Wix stock synced with other channels?"
    a: "Wix stock is read into the shared pool, but by default nothing is written back to Wix. Writing is supported for Etsy, eBay, Trendyol and Shopify."
  - q: "Can I answer Wix chats from the app?"
    a: "Yes. The inbox shows Wix chats with product and order context, and you reply with saved replies or an AI draft. This feature is in beta."
  - q: "Which Wix products can't I edit?"
    a: "Products with variants and discounted products. Turning stock tracking on or off can't be done from KolayXport either."
---

## What works

Your Wix orders land in the same list as your other channels; you print labels with FedEx, UPS or DHL eCommerce and send the tracking number to Wix. On the product side you create and edit Wix products, collections, media and stock, and you can delete products. The bulk editor covers title, price and quantity. In the inbox you answer Wix chats and get AI reply drafts.

For sellers with their own Wix site who also sell the same products on Etsy or eBay, having orders and customer chats in one list saves time. Product updates stay as drafts and go to Wix when you send them. You can answer questions from Wix chats faster with an AI draft.

## Setup

1. Under Settings › Connections, start the install from the Wix tile.
2. Add the KolayXport app to your Wix site and grant access.
3. Your products come into the app; orders and messages also appear if they're switched on for your account.

## Limits

- Order sync, tracking upload and messages are in beta and may need to be switched on for your account.
- Products with variants and discounted products can't be edited.
- In stock sync, Wix is read-only by default.
- No AI writing for Wix products and no profit report for Wix.
