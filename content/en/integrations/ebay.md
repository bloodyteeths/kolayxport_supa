---
title: "eBay Integration: Listings, Orders, Tracking | KolayXport"
description: "Connect your eBay account: AI-assisted listing creation, bulk price/quantity, order sync, automatic tracking upload, stock sync and profit reports."
h1: "eBay integration"
keyword: "ebay integration"
updated: 2026-10-17
inventoryRefs: [settings-connections, order-sync-ebay, ebay-listing-create, ebay-listing-editor, ebay-bulk-editor, stock-sync, tracking-push-ebay, label-fedex, reports-profit, inbox-unified, research-keywords, ext-ebay-amazon-research, crosslist-etsy-ebay]
draft: false
name: "eBay"
kind: marketplace
status: production
setupMinutes: 3
connect: "OAuth: under Settings › Connections you sign in with eBay and grant access."
capabilities:
  - label: "Order sync"
    status: "yes"
    ref: order-sync-ebay
  - label: "Listing create and edit"
    status: "partial"
    note: "Older listings created in Seller Hub can't be edited, only copied into a new listing"
    ref: ebay-listing-editor
  - label: "Bulk edit"
    status: "yes"
    note: "Title, price and quantity"
    ref: ebay-bulk-editor
  - label: "Stock sync"
    status: "yes"
    note: "Beta; excludes older Seller Hub listings"
    ref: stock-sync
  - label: "Tracking push"
    status: "yes"
    note: "UPS, FedEx, USPS, DHL, Royal Mail mapped; others sent as 'Other'"
    ref: tracking-push-ebay
  - label: "Shipping labels"
    status: "yes"
    note: "With your own FedEx/UPS account"
    ref: label-fedex
  - label: "Finance and profit"
    status: "yes"
    note: "Includes ad spend; Pro feature"
    ref: reports-profit
  - label: "Messages"
    status: "no"
    ref: inbox-unified
  - label: "Research"
    status: "yes"
    note: "Product finder, keywords, listing doctor, competitor tracker"
    ref: research-keywords
  - label: "Extension overlay"
    status: "partial"
    note: "Works on 7 eBay domains; install it from the Chrome Web Store"
    ref: ext-ebay-amazon-research
faq:
  - q: "Why can't I edit listings I created in Seller Hub?"
    a: "KolayXport works through eBay's Inventory API, and eBay doesn't allow listings created in Seller Hub to be edited that way. You can copy them into a new listing and manage that one from KolayXport."
  - q: "Can I move an Etsy listing to eBay?"
    a: "Yes. 'Copy to eBay' in the Etsy listings grid creates an eBay draft with photos and variations. If the currencies differ, you enter the price."
  - q: "Is the tracking number sent to eBay automatically?"
    a: "Yes. When you print a label in the app or add a tracking number to the order, it's sent to the eBay order."
---

## What works

Once your eBay account is connected, your orders appear in the same list as your other channels. In the listing studio, AI fills in the title, description, item specifics and a price suggestion; you publish the listing or save it on eBay unpublished. Variation listings, withdrawing and deleting are handled in the app too. The bulk editor lets you change titles, prices and quantities in one grid.

The tracking number from a label you print with your own FedEx or UPS account is sent to the eBay order. Finance sync brings your eBay sales, fees and ad spend into the profit report (Pro).

For Etsy sellers moving into eBay, the shortest route is copying an Etsy listing to an eBay draft in one click. The draft doesn't go live on its own; you check the category, item specifics and price, then send it. The product finder, keyword explorer and listing doctor in Research all work for eBay too.

## Setup

1. Under Settings › Connections, press Connect on the eBay tile.
2. Sign in on eBay and grant access.
3. Your orders and the listings KolayXport can manage come into the app.

## Limits

- Older listings created in eBay Seller Hub can't be edited and aren't part of stock sync; they can be copied into a new listing.
- eBay messages aren't in the app.
- With eBay, two sales arriving at the same moment can occasionally collide during a stock update.
