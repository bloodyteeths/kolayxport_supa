---
title: "Paraşüt Integration: e-Invoice and e-Archive | KolayXport"
description: "Connect Paraşüt so that a contact and sales invoice are created in Paraşüt when you send the ETGB file for your international orders."
h1: "Paraşüt integration"
keyword: "parasut integration"
updated: 2026-10-17
inventoryRefs: [settings-connections, parasut-einvoice, etgb-excel-email]
draft: false
name: "Paraşüt"
kind: accounting
status: partial
setupMinutes: 10
connect: "API credentials: you enter the Client ID, Client Secret, username, password and company ID from Paraşüt under Settings › Connections."
capabilities:
  - label: "e-Invoice / e-Archive creation"
    status: "partial"
    note: "Runs only while sending ETGB; no separate invoice button"
    ref: parasut-einvoice
  - label: "Contact creation"
    status: "yes"
    note: "A buyer contact is created in Paraşüt during invoicing"
    ref: parasut-einvoice
  - label: "Invoice PDF"
    status: "yes"
    note: "The invoice PDF is fetched from Paraşüt"
    ref: parasut-einvoice
  - label: "Invoice list and error alerts"
    status: "no"
    note: "Check your invoices and any errors in Paraşüt"
    ref: parasut-einvoice
faq:
  - q: "Is every order invoiced automatically?"
    a: "No. A Paraşüt invoice is created only when you send ETGB for the orders you select. There's no separate 'issue invoice' button."
  - q: "Will I know if an invoice fails?"
    a: "Right now the app doesn't show a separate warning, and the ETGB email is still sent. We recommend checking your invoices in Paraşüt."
  - q: "Can I use another e-invoice provider?"
    a: "No. Only Paraşüt is supported right now."
---

## What works

When your Paraşüt account is connected and you send ETGB for international orders, KolayXport creates the buyer contact in Paraşüt, creates the sales invoice, processes it as an e-Fatura or e-Arşiv invoice, and fetches the invoice PDF. That way the invoice for your micro-export orders is prepared in the same step as the ETGB file.

This integration is designed for sellers who already keep their books in Paraşüt and want micro-export invoices prepared together with ETGB. We recommend checking the invoice content and VAT treatment with your accountant.

## Setup

1. Get a Client ID and Client Secret for API access from Paraşüt.
2. Enter them, together with your Paraşüt username, password and company ID, under Settings › Connections › Paraşüt.
3. Set the ETGB recipient (your customs broker's email) in Settings.

## Limits

- Invoices are created only while sending ETGB; there's no standalone invoicing.
- No invoice list in the app.
- If Paraşüt returns an error the app doesn't warn you and the ETGB email still goes out; check your invoices in Paraşüt.
- No e-invoice provider other than Paraşüt is supported.
- Invoices aren't issued automatically for every order.
