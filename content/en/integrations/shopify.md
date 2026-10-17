---
title: "Shopify Integration: Orders, Products, Stock | KolayXport"
description: "Connect your Shopify store: order sync, product creation and bulk editing, stock sync with Etsy/eBay/Trendyol, and FedEx/UPS/DHL eCommerce labels."
h1: "Shopify integration"
keyword: "shopify integration"
updated: 2026-10-17
inventoryRefs: [settings-connections, order-sync-shopify, shopify-products, stock-sync, label-fedex, label-dhl-ecommerce, reports-profit, inbox-unified, ai-listing-copy, shopify-free]
draft: false
name: "Shopify"
kind: marketplace
status: partial
setupMinutes: 3
connect: "OAuth: install the KolayXport app from the Shopify App Store or from Settings › Connections, and approve access for your store."
capabilities:
  - label: "Order sync"
    status: "yes"
    ref: order-sync-shopify
  - label: "Product create and edit"
    status: "partial"
    note: "Price/stock can't be changed on multi-variant products or stock spread across locations"
    ref: shopify-products
  - label: "Bulk edit"
    status: "yes"
    note: "Title, price, quantity and tags"
    ref: shopify-products
  - label: "Stock sync"
    status: "yes"
    note: "Beta; about every 15 minutes"
    ref: stock-sync
  - label: "Tracking push"
    status: "no"
    note: "A number you enter is saved in KolayXport only"
  - label: "Shipping labels"
    status: "yes"
    note: "FedEx/UPS international, DHL eCommerce domestic"
    ref: label-fedex
  - label: "Finance and profit"
    status: "no"
    note: "Shopify sales appear in the sales report, not the profit report"
    ref: reports-profit
  - label: "Messages"
    status: "no"
    ref: inbox-unified
  - label: "AI listing writing"
    status: "no"
    ref: ai-listing-copy
faq:
  - q: "Do I pay if I install from the Shopify App Store?"
    a: "Stores installed through the Shopify App Store use KolayXport for free, with no order or label limits. Pro features are off for these installs."
  - q: "Can I edit products with variants?"
    a: "You can edit product details, images and SEO fields. Price and stock changes are refused for multi-variant products and for products whose stock is spread across several locations."
  - q: "Are tracking numbers sent to Shopify?"
    a: "Not yet. A number you add to a Shopify order is saved in KolayXport only, so mark the order fulfilled in Shopify."
---

## What works

Your Shopify orders land in the same list as Etsy, eBay and your other channels, and get labels from FedEx, UPS or DHL eCommerce. On the product side you create new products (as Draft or Active), and edit product fields, price, SKU and stock for single-variant products, images and SEO fields. The bulk editor lets you change titles, prices, quantities and tags in one grid. Changes stay as drafts first.

If you turn on stock sync, your Shopify stock is updated from a shared pool with Etsy, eBay and Trendyol.

It suits sellers with their own Shopify store who also sell the same products on Etsy, eBay or Trendyol. Orders and stock come together in one list, and product updates are prepared as drafts and go to Shopify when you approve them. Stores installed from the Shopify App Store use KolayXport for free with no order or label limits.

## Setup

1. Install KolayXport from the Shopify App Store, or enter your store address (.myshopify.com) in the Shopify tile under Settings › Connections.
2. Approve Shopify's permission screen.
3. Your orders and products come into the app.

## Limits

- No price/stock editing for multi-variant or multi-location products.
- No AI writing for Shopify products.
- Tracking numbers aren't sent to Shopify.
- No finance or profit report for Shopify.
