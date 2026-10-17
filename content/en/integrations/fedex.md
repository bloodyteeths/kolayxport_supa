---
title: "FedEx Integration: International Labels and ETD | KolayXport"
description: "Print international labels for your Etsy, eBay and Amazon orders with your own FedEx account, and send the commercial invoice electronically via ETD."
h1: "FedEx integration"
keyword: "fedex label turkey"
updated: 2026-10-17
inventoryRefs: [settings-connections, label-fedex, customs-commercial-invoice, labels-bulk, label-void, label-tracking-status, sender-profile, tracking-push-ebay, usage-meters]
draft: false
name: "FedEx"
kind: carrier
status: partial
setupMinutes: 15
connect: "API credentials: you enter the API Key and API Secret from your FedEx developer account, plus your FedEx account number, under Settings › Connections."
capabilities:
  - label: "Label creation"
    status: "yes"
    note: "International Priority and International Economy; with your own FedEx account"
    ref: label-fedex
  - label: "Electronic commercial invoice (ETD)"
    status: "yes"
    note: "Needs an HS code and description per item"
    ref: customs-commercial-invoice
  - label: "Bulk labels"
    status: "yes"
    note: "Orders print one after another; stop and retry supported"
    ref: labels-bulk
  - label: "Tracking number to marketplace"
    status: "yes"
    note: "To eBay, Amazon and Wix; to Etsy via the Chrome extension"
    ref: tracking-push-ebay
  - label: "Shipment status tracking"
    status: "no"
    note: "The tracking number is stored; status isn't updated in the app"
    ref: label-tracking-status
  - label: "Label void"
    status: "partial"
    note: "Done manually on the FedEx portal; the app links you there"
    ref: label-void
  - label: "Domestic shipping"
    status: "no"
    note: "Use DHL eCommerce for domestic orders"
    ref: label-fedex
faq:
  - q: "Can I get labels from KolayXport without a FedEx account?"
    a: "No. KolayXport doesn't sell shipping; labels are printed with your FedEx account at your negotiated rate."
  - q: "Do I need to print the commercial invoice and put it in the parcel?"
    a: "With ETD, the commercial invoice goes to FedEx electronically. Each item's HS code and description need to be correct."
  - q: "Can I see where my shipment is in the app?"
    a: "No. The tracking number is stored and sent to marketplaces that support it, but we don't show FedEx shipment status in the app."
---

## What works

The FedEx integration lets you print International Priority or International Economy labels with your own FedEx account for Etsy, eBay, Amazon, Shopify and Wix orders going abroad. The commercial invoice is sent electronically with the label through FedEx ETD (Electronic Trade Documents). On the bulk label screen you can select many orders and print them one after another, and the tracking number is sent to eBay, Amazon and Wix orders.

It suits sellers who ship with their own FedEx agreement rather than Etsy's shipping options. Before printing, each item's HS code and English description must be right on the order; they go straight onto the commercial invoice and the customs declaration. Enter them correctly once and you save time on every later shipment.

## Setup

1. Fill in your sender profile in Settings; it's required for printing labels.
2. Create an API project in your FedEx developer account and get an API Key and API Secret.
3. Enter them, along with your FedEx account number, under Settings › Connections › FedEx.

## Limits

- International shipments only; no domestic FedEx labels.
- Your own FedEx account is required; the price is your agreement.
- Shipment status isn't tracked in the app.
- Labels are voided manually on the FedEx portal.
- Each label counts toward your usage meter (label limit).
