# KolayXport team ERP: Google Sheet + Apps Script

**The ERP:** https://docs.google.com/spreadsheets/d/1G0JnXXvjZViBD-wG3uH5GPam5IiiMaioOupks80v7oU (owner kolayxport@gmail.com, imported 2026-10-21).

From now on the **Google Sheet is the source of truth**. `../KolayXport-ERP.xlsx` was only the import file; don't edit it any more.

## What the script adds

- **🚀 KolayXport menu** (appears a few seconds after the sheet opens):
  - **📋 Bugünüm (side panel):** pick your name once. It shows your overdue tasks, tasks due this week, partners who replied, follow-ups that are due (+4/+9/+16 days), and your unsent first messages. Each item has buttons: *Tamamlandı*, *Gönderdim*, *Takip yazdım*, *Cevap geldi*, *Kabul etti*, *Aç*.
  - **✉️ / 💬 / ✅:** mark the selected message *sent* or *replied*, or mark the selected task *done*.
  - **➕ Yeni ortak adayı / ➕ Yeni görev:** forms. IDs and dates fill themselves.
  - **📧 Günlük e-posta özeti:** on/off, at 08:00 Istanbul time. Only goes to people with an e-mail and "Evet" in the **Ekip** tab. It's **off** until someone turns it on.
- **Automatic on edit:**
  - Wave-1 message set to *sent*: the "Sent on" date is stamped, and the matching Partner pipeline row becomes *Contacted* with today's date, so follow-up dates start counting.
  - Message set to *replied* / *declined* / *opted out*: the pipeline status follows.
  - Pipeline status *Contacted* or *Signed*: the date is stamped if it's empty.
  - Task set to *Done*: "✔ done YYYY-MM-DD" is added to Notes.
  - New task text typed in an empty row: the next T-number is assigned.

## Install (one time, ~2 minutes, sheet owner)

1. Open the sheet and go to **Extensions › Apps Script**.
2. Delete everything in `Code.gs`, paste the full contents of [`Code.gs`](Code.gs), then press **Save** (💾).
3. Back in the sheet, reload the page. The **🚀 KolayXport** menu appears.
4. The first time you use a menu item, Google asks for permission: *Review permissions* → choose kolayxport@gmail.com → *Allow*. The script only touches this spreadsheet; it also needs Gmail send permission for the optional digest.
5. Each team member also authorises once, the first time they use the menu.

To update: paste the new `Code.gs` over the old one and save. The sheet layout must keep header row 4 and data starting at row 5.
