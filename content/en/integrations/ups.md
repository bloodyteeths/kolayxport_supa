---
title: "UPS Integration: International Labels | KolayXport"
description: "Print labels for your international orders with your own UPS account; the commercial invoice goes electronically and IOSS/VAT details are checked first."
h1: "UPS integration"
keyword: "ups export label turkey"
updated: 2026-10-17
inventoryRefs: [settings-connections, label-ups, customs-commercial-invoice, labels-bulk, label-void, label-tracking-status, sender-profile, tracking-push-ebay, usage-meters]
draft: false
name: "UPS"
kind: carrier
status: partial
setupMinutes: 15
connect: "API credentials: you enter the API Key and API Secret from your UPS developer account, plus your UPS account number, under Settings › Connections."
capabilities:
  - label: "Label creation"
    status: "yes"
    note: "UPS international services; with your own UPS account"
    ref: label-ups
  - label: "Electronic commercial invoice"
    status: "yes"
    note: "IOSS and VAT details checked; needs an HS code per item"
    ref: customs-commercial-invoice
  - label: "Bulk labels"
    status: "yes"
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
    note: "Done manually on the UPS portal"
    ref: label-void
  - label: "Domestic shipping"
    status: "no"
    note: "Use DHL eCommerce for domestic orders"
    ref: label-ups
faq:
  - q: "Why is my product description cut short?"
    a: "UPS labels allow at most 35 characters for the product description. Write a short, clear English description."
  - q: "Can I get labels without a UPS account?"
    a: "No. Labels are printed with your UPS account at your negotiated rate."
  - q: "Can I download a printed label again later?"
    a: "Download and keep the label right after printing; the UPS label file isn't stored permanently on our server."
---

## What works

The UPS integration lets you print international labels with your own UPS account for orders going abroad. The commercial invoice is sent to UPS electronically, and for EU shipments IOSS and VAT details are checked before the shipment is created. On the bulk label screen you can select several orders and print them one after another. The tracking number is sent to eBay, Amazon and Wix orders.

It suits sellers who ship abroad with their own UPS agreement. Missing or wrong details such as an IOSS number can leave a parcel waiting at customs in the EU; KolayXport checks these before the label is printed. Each item's HS code and short English description must be correct on the order.

## Setup

1. Fill in your sender profile in Settings.
2. Create an app in your UPS developer account and get an API Key and API Secret.
3. Enter them, along with your UPS account number, under Settings › Connections › UPS.

## Limits

- International services only; no domestic UPS labels.
- Product descriptions are limited to 35 characters.
- Shipment status isn't tracked in the app; labels are voided on the UPS portal.
- Download and keep the label file after printing.
- Each label counts toward your usage meter.
