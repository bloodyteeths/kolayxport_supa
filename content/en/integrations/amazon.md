---
title: "Amazon Integration: Orders, Tracking, Profit | KolayXport"
description: "Connect your Amazon Seller Central account: order sync, tracking upload, FedEx/UPS labels, review requests and a profit report that includes ad spend."
h1: "Amazon integration"
keyword: "amazon integration"
updated: 2026-10-17
inventoryRefs: [settings-connections, order-sync-amazon, tracking-push-amazon, msg-amazon-buyer, label-fedex, reports-profit, listings-grid, stock-sync, ext-ebay-amazon-research, research-product-finder]
draft: false
name: "Amazon"
kind: marketplace
status: production
setupMinutes: 5
connect: "OAuth (SP-API): under Settings › Connections you pick your marketplace and grant access with your Seller Central account."
capabilities:
  - label: "Order sync"
    status: "yes"
    note: "Product images and buyer details may be limited by Amazon permissions"
    ref: order-sync-amazon
  - label: "Listing create and edit"
    status: "no"
    ref: listings-grid
  - label: "Stock sync"
    status: "no"
    note: "Nothing is written to Amazon stock; Amazon orders still lower the shared stock pool"
    ref: stock-sync
  - label: "Tracking push"
    status: "yes"
    note: "Sent to Amazon as a shipment confirmation; Amazon may take a while to process it"
    ref: tracking-push-amazon
  - label: "Shipping labels"
    status: "yes"
    note: "With your own FedEx/UPS account"
    ref: label-fedex
  - label: "Finance and profit"
    status: "yes"
    note: "Includes ad spend; Pro feature"
    ref: reports-profit
  - label: "Messages"
    status: "partial"
    note: "Template messages and review requests to the buyer; replies can't be read"
    ref: msg-amazon-buyer
  - label: "Research"
    status: "no"
    note: "The Amazon research tab in the app is disabled"
    ref: research-product-finder
  - label: "Extension overlay"
    status: "partial"
    note: "Estimates on Amazon .com, .com.tr, .de, .co.uk pages"
    ref: ext-ebay-amazon-research
faq:
  - q: "Can I edit my Amazon listings in KolayXport?"
    a: "No. There's no Amazon listing management; you keep managing listings in Seller Central."
  - q: "Is my Amazon stock synced with other channels?"
    a: "No. We don't write to Amazon stock. But orders from Amazon lower the shared pool in stock sync, so your other channels stay current."
  - q: "Can I ask Amazon buyers for a review?"
    a: "Yes. 'Message buyer' in the order panel sends the template messages Amazon allows, including the review request. Buyer replies don't appear in the app."
---

## What works

The Amazon integration focuses on orders and shipping. Your orders come in through Amazon reports and appear in the same list as your other channels. You print labels with your own FedEx or UPS account and send the tracking number to Amazon. From the order panel you can send Amazon template messages and a review request to the buyer. Finance sync brings sales, fees and ad spend into the profit report (Pro).

It suits sellers who sell internationally on Amazon and pack those orders alongside Etsy or eBay orders. Because Amazon orders lower the shared pool in stock sync, your stock on other channels stays current if you sell the same product on Etsy or eBay too.

## Setup

1. Under Settings › Connections, open the Amazon tile and pick the marketplace you sell on.
2. Sign in with your Seller Central account and allow KolayXport access.
3. Your orders start coming in.

## Limits

- No Amazon listing creation or editing.
- Nothing is written to Amazon stock.
- Product research in the app doesn't cover Amazon; the Chrome extension only shows estimates read from Amazon pages, and it isn't on the Chrome Web Store yet.
- Because of Amazon's permission scope, some orders may lack product images or buyer details.
- Messages to buyers are one-way; replies can't be read.
