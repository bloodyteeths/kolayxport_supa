---
title: "Trendyol Integration: Products, Stock, Q&A | KolayXport"
description: "Connect your Trendyol store with an API key: product creation and bulk editing, Turkish AI, stock sync, customer questions and profit reports."
h1: "Trendyol integration"
keyword: "trendyol integration"
updated: 2026-10-17
inventoryRefs: [settings-connections, order-sync-trendyol, trendyol-products, ai-listing-copy, stock-sync, label-dhl-ecommerce, reports-profit, inbox-unified, ai-message-draft, arbitrage-price-gap, research-product-finder]
draft: false
name: "Trendyol"
kind: marketplace
status: production
setupMinutes: 5
connect: "API credentials: you enter the API Key, API Secret and Supplier ID from your Trendyol seller panel under Settings › Connections."
capabilities:
  - label: "Order sync"
    status: "partial"
    note: "Beta; may need to be switched on for your account"
    ref: order-sync-trendyol
  - label: "Product create and edit"
    status: "yes"
    note: "Create, edit, price/stock, archive; Turkish AI"
    ref: trendyol-products
  - label: "Bulk edit"
    status: "yes"
    note: "Title, price and quantity"
    ref: trendyol-products
  - label: "Stock sync"
    status: "yes"
    note: "Beta; checked about every 3 minutes"
    ref: stock-sync
  - label: "Tracking push"
    status: "no"
    note: "A number you enter is saved in KolayXport only"
  - label: "Shipping labels"
    status: "yes"
    note: "Domestic with DHL eCommerce (MNG Kargo)"
    ref: label-dhl-ecommerce
  - label: "Finance and profit"
    status: "yes"
    note: "Excludes ad spend; Pro feature"
    ref: reports-profit
  - label: "Messages"
    status: "partial"
    note: "Customer questions, with AI reply drafts; beta"
    ref: inbox-unified
  - label: "Research"
    status: "partial"
    note: "Product finder and the Trendyol→eBay arbitrage source"
    ref: research-product-finder
faq:
  - q: "Where do I get the API credentials?"
    a: "Copy your API Key, API Secret and Supplier ID from the integration details section of your Trendyol seller panel and paste them into KolayXport."
  - q: "Are tracking numbers sent to Trendyol orders?"
    a: "No. A number you add to a Trendyol order is saved in KolayXport only."
  - q: "What do I need to create a new product?"
    a: "What Trendyol requires: brand, category, barcode, cargo company, and shipping/return addresses. The product goes to Trendyol as a batch job; it completes in the background and the result shows in the app."
  - q: "Why beta?"
    a: "Trendyol order sync and the inbox are features that are switched on separately on the server. Product management works independently of them."
---

## What works

Create, edit, update price and stock for, and archive your Trendyol products in KolayXport. Turkish AI writes titles and descriptions. The bulk editor lets you change titles, prices and quantities in one grid. Changes stay as drafts and go to Trendyol when you press Send.

With stock sync on, your Trendyol stock is fed from the same pool as Etsy, eBay and Shopify. In the inbox you answer Trendyol customer questions and get AI reply drafts. Finance sync brings Trendyol settlements and deductions into the profit report (Pro). Trendyol products are compared with eBay prices in the arbitrage table.

For Trendyol sellers expanding abroad, seeing Trendyol products and stock next to Etsy and eBay keeps things simple. We don't integrate with Hepsiburada, N11 or Çiçeksepeti, so you can keep your current integrator for those channels.

## Setup

1. Get your API Key, API Secret and Supplier ID from the Trendyol seller panel.
2. Enter them under Settings › Connections › Trendyol and save.
3. Your products appear on the Trendyol products page.

## Limits

- Order sync and the inbox are in beta and may need to be switched on for your account.
- Tracking numbers aren't sent to Trendyol.
- Trendyol ad spend isn't included in the profit report.
- Domestic labels only with DHL eCommerce (MNG Kargo); no Trendyol Express, Yurtiçi or Aras labels.
