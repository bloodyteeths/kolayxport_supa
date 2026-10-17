---
title: "DHL eCommerce (MNG Kargo) Integration | KolayXport"
description: "Print DHL eCommerce (MNG Kargo) labels for your domestic Turkish orders: cash on delivery, SMS, same-day delivery, tracking and cancellation."
h1: "DHL eCommerce (MNG Kargo) integration"
keyword: "dhl ecommerce turkey integration"
updated: 2026-10-17
inventoryRefs: [settings-connections, label-dhl-ecommerce, labels-bulk, label-void, label-tracking-status, sender-profile, orders-pick-packing, usage-meters]
draft: false
name: "DHL eCommerce"
kind: carrier
status: production
setupMinutes: 5
connect: "Customer credentials: you enter your DHL eCommerce (MNG Kargo) customer number and password under Settings › Connections."
capabilities:
  - label: "Label creation"
    status: "yes"
    note: "Standard, Express and Same-day; cash on delivery and SMS options"
    ref: label-dhl-ecommerce
  - label: "Bulk labels"
    status: "yes"
    note: "Domestic orders are routed to DHL eCommerce automatically in bulk labels"
    ref: labels-bulk
  - label: "Shipment status tracking"
    status: "yes"
    ref: label-tracking-status
  - label: "Label void"
    status: "yes"
    note: "From the app"
    ref: label-void
  - label: "International shipping"
    status: "no"
    note: "Turkey only; use FedEx or UPS for international orders"
    ref: label-dhl-ecommerce
faq:
  - q: "Can I print labels with Yurtiçi, Aras or Sürat Kargo?"
    a: "No. Domestically you can only print DHL eCommerce (MNG Kargo) labels. For other carriers you can enter the tracking number on the order by hand."
  - q: "Can I ship cash on delivery?"
    a: "Yes. When creating the label you can tick cash on delivery and turn on an SMS notification for the buyer."
  - q: "What details do I need?"
    a: "Your DHL eCommerce (MNG Kargo) customer number and password, which come with your contract with the carrier."
---

## What works

The DHL eCommerce (formerly MNG Kargo) integration lets you print labels for orders within Turkey from KolayXport. You choose between Standard, Express and Same-day services and can turn on cash on delivery and SMS notifications. Shipment status shows in the app, and you cancel labels from the app. On the bulk label screen, domestic orders are routed to DHL eCommerce automatically and international ones to FedEx or UPS.

It's a practical complement for sellers who sell abroad but also get orders from inside Turkey: label domestic orders from Etsy, Shopify, Wix or Trendyol from the same list, and leave international orders to FedEx or UPS. Your sender profile must be filled in before printing; the address and phone number on the label come from there.

## Setup

1. Fill in your sender profile in Settings.
2. Enter your customer number and password under Settings › Connections › DHL eCommerce.
3. Press "Create label" on an order and choose DHL eCommerce.

## Limits

- Shipments within Turkey only.
- You need your own customer contract with DHL eCommerce; the price is your agreement.
- For Trendyol and Shopify orders, the tracking number isn't sent to the marketplace.
- Each label counts toward your usage meter.
