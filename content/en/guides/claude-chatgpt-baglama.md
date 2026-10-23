---
title: Connect Claude or ChatGPT to your KolayXport shop | KolayXport
description: >-
  Ask Claude or ChatGPT about your orders, listings, sales and fees across Etsy, eBay, Amazon and Trendyol, and let it stage listing drafts for you.
h1: Connect Claude or ChatGPT to your KolayXport shop
keyword: kolayxport claude connector
updated: '2026-10-18'
inventoryRefs:
  - ai-connector-mcp
draft: false
order: 20
steps:
  - name: Add the connector
    text: >-
      In Claude, open Settings › Connectors and add KolayXport from the directory, or choose Add custom connector and
      enter https://kolayxport.com/api/mcp. In ChatGPT, add KolayXport from the apps directory in Settings › Apps.
  - name: Sign in and approve
    text: >-
      Claude or ChatGPT sends you to kolayxport.com. Sign in to your KolayXport account and review what the AI may do:
      read your shop data, and optionally stage listing drafts. Sharing buyer names and shipping addresses is a
      separate checkbox and is off by default.
  - name: Ask about your shop
    text: >-
      Ask in plain language, for example "What was my last Etsy order and why was it cheaper than the listing price?"
      The AI picks the right KolayXport tool and answers from your synced data.
  - name: Review staged changes in KolayXport
    text: >-
      When the AI suggests a new title, tags, price or stock, it only saves a draft. Open the listing in KolayXport,
      check the change and send it to the marketplace yourself.
faq:
  - q: Do I need a KolayXport account?
    a: >-
      Yes. The connector works with your own KolayXport account and the marketplaces you connected there (Etsy, eBay,
      Amazon, Trendyol, Hepsiburada, Wix, Shopify). Every plan, including the free trial, can connect an AI.
  - q: Can the AI change my listings on Etsy or eBay?
    a: >-
      No. Write tools only stage drafts inside KolayXport. Nothing changes on a marketplace until you open the draft in
      KolayXport and send it.
  - q: Does the AI see my buyers' names and addresses?
    a: >-
      Not by default: orders show the buyer's country only. You can turn on "Share buyer names and shipping addresses"
      when you connect. Amazon buyer data, e-mail addresses and phone numbers are never shared.
  - q: How do I disconnect?
    a: >-
      Remove the connector in Claude or ChatGPT, or revoke the connection in KolayXport under Settings › AI. A revoked
      connection stops working immediately.
---

KolayXport's connector lets Claude and ChatGPT work with the data in your KolayXport account: orders from every
marketplace you connected, your listings and stock, sales totals, marketplace fees and payouts. It reads data
KolayXport has already synced, so answers are fast and never touch the marketplaces' own limits.

**Connector URL:** `https://kolayxport.com/api/mcp` (Streamable HTTP, OAuth 2.1). Other MCP clients can use a personal
key from Settings › AI instead, for example in Claude Code:
`claude mcp add --transport http kolayxport https://kolayxport.com/api/mcp`.

## What you can ask

- "What was my last Etsy order, and how much was the discount, shipping and tax?"
- "How many orders did I get in the last 30 days on each marketplace, and from which countries?"
- "What did Etsy charge me in fees last month, and what is my current Etsy payment account balance?"
- "Which of my listings are almost out of stock?"
- "Audit my listing for the pink tutu dress and suggest a better title and tags, then stage them as a draft."

## Tools

| Tool | What it does | Changes data |
|---|---|---|
| Store overview | Listing counts, orders in the last 7 and 30 days by marketplace and country, late orders, newest orders, finance sync times | No |
| List orders | Orders with filters, country, totals and items with the price paid | No |
| Get one order | One order with the full money breakdown: items, discount, shipping, tax, total, price paid vs current listing price | No |
| List listings | Your listings on one marketplace, with search | No |
| Get one listing | Full details of one listing | No |
| Low stock | Listings at or below a stock level, across marketplaces | No |
| Sales summary | Order count and gross order value per marketplace and currency, top items | No |
| Finance summary | Fees by type, ad spend, refunds, net profit, payouts and the latest payment account balance (Financials plan) | No |
| Audit a listing | Listing health score with fixes | No |
| Listing rules per marketplace | Title, tag, description and photo rules for each marketplace | No |
| Check proposed listing text | Checks a title or tags against the rules | No |
| Market research | Search demand and competition for a keyword | No |
| Stage listing changes | Saves title, description, tags, price or stock changes as a draft for you to review | Draft only |
| Create a new listing draft | Starts a new listing as a draft in KolayXport | Draft only |
| Add photos to a listing | Adds photos to a listing draft | Draft only |

## Data and privacy

- The AI only sees your own account. Every request is limited to the KolayXport account you signed in with.
- Buyer names and shipping addresses are shared only if you tick the checkbox when connecting. Amazon buyer data, e-mail
  addresses and phone numbers are never shared.
- KolayXport logs which tool was called and when, not the answers.
- See the [privacy policy](https://kolayxport.com/en/gizlilik-politikasi) for what we store and for how long.

## Support

Write to destek@kolayxport.com or use the contact page at https://kolayxport.com/en/iletisim.
