# Changelog

All notable, user-facing changes to iTrova are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/); entries are grouped by ship date, newest first.

## 2026-09-06 — Dashboard loads faster

### Changed
- **The Dashboard now fetches only today's sale lines** for the Top products card, instead of every
  sale line the business has ever recorded. Businesses with months of sales history will notice the
  Dashboard open noticeably faster, especially on slow connections. Nothing on the page changes.
- **The Dashboard and Reports show their figures first** and fetch the charting code in the
  background, with a soft placeholder holding each chart's space until it draws. On a slow
  connection the page is usable a few seconds earlier than before. Charts still work offline.

## 2026-08-20 — Signing up with an email that already has an account now tells you so

### Fixed
- **No more waiting for a confirmation email that never comes.** Creating an account with an email
  that's already on iTrova used to show "check your inbox" and send nothing. It now tells you the
  email already has an account and takes you straight to Sign in with your email filled in — use
  *Forgot password* from there if you need it.

## 2026-08-13 — Spend your referral credit

The credit you earn by referring other businesses now pays for your own subscription, without
asking us to apply it.

### Added
- **Use your referral credit at checkout** — when you renew or upgrade, the payment window offers
  your available credit. It comes off the price and you pay the difference; if your credit covers
  the whole plan, it activates with no payment page at all. Anything left over stays on your
  balance for next time, and you can switch it off if you'd rather pay in full.
- **Receipts show how you paid** — billing history and every invoice now split what was settled by
  referral credit and what was paid by card or transfer, instead of showing a single figure.

### Changed
- **Refer & earn shows what you can actually spend.** The credit figure now matches what checkout
  will honour — it excludes anything a payment you've already started is holding.

## 2026-08-13 — Pay for your plan in the app

Upgrading no longer means messaging us and waiting. Pick a plan, pay by transfer or card, and it
activates itself.

### Added
- **Pay for your subscription in Settings → Billing** — choose bank transfer or card and finish on a
  secure payment page. A transfer gets a one-off account number for that exact amount, so there's no
  wrong figure to send and nothing to reconcile by hand. Your plan activates as soon as the payment
  is confirmed.
- **Billing history** — every subscription payment on your account, five to a page, each with a
  receipt you can view on screen or download as a PDF.
- **Renew before you expire without losing days** — renewing the same plan and cycle early starts the
  new period when the current one ends, so paying five days early doesn't cost you five days.
- **Move to Free yourself** — with a confirmation first. You keep the plan you paid for until the end
  of the period, then move down; nothing is cut short.
- **Your referral discount applies itself** — if you signed up with someone's referral code, the
  discount comes off your first payment automatically, shown on the plan card before you pay.

### Changed
- **Billing cycles are now exact day counts** — monthly is 30 days, quarterly 90, six-monthly 180 and
  yearly 365, so "renews in N days" no longer drifts with the length of the month. Existing renewal
  dates were left exactly as promised.
- **Paying happens in the same tab** and brings you straight back to Billing when it's done — no
  stray second tab to close.

## 2026-08-04 — Reports you can hand to someone

### Added
- **Cashiers can download their own sales report.** They could already see it; now the Export PDF
  button works for them too, and the file contains only what their screen shows.

### Fixed
- **Report PDFs read properly.** Amounts print as `NGN 45,000.00` instead of a box where the naira
  sign should be, stock turnover shows `2.10x` (or "Sold out") instead of stray symbols, and every
  column heading now sits directly over its own figures.

## 2026-08-02 — Draft invoices leave your stock alone

### Added
- **Save as draft** — start an invoice, keep it as a draft, and finish it later.

### Changed
- **A draft no longer holds stock.** Stock is deducted when you issue the invoice, not while you're
  still drafting it, so a half-written invoice can't make a product look out of stock. Moving an
  issued invoice back to draft returns its stock to your shelves.

## 2026-07-31 — A tidier, friendlier app

### Added
- **A greeting that knows the time** — the Dashboard now says **Good morning**, **Good afternoon** or
  **Good evening** (morning from midnight, afternoon from noon, evening from 5pm) instead of "Good day".

### Changed
- **Slim scrollbars everywhere** — the chunky browser scrollbar is gone. Scrollable areas (including the
  sidebar when your modules overflow) now show a thin, theme-matched bar that fades in only when you
  hover, and never shifts the layout.
- **A tidier sidebar** — every row (modules, Settings, Sign out) now shares one height and alignment, so
  icons sit in a single column and hover highlights line up. Collapsed to icons, the rail is properly
  centred and stays that way while scrolling.
- **One consistent tooltip** — hover hints across the app now use iTrova's own styling instead of the
  grey browser box, including on buttons that are switched off (so you can still see *why*).

### Fixed
- Sidebar tooltips no longer slide underneath the top bar.

## 2026-07-30 — Reports for every role

What each person sees in Reports now follows their permissions.

### Added
- **My sales report** — team members without financial access (cashiers by default) now get Reports
  showing their own performance: sales value, transactions, units, average sale, a daily trend and
  their payment-method split. Business-wide figures stay hidden.
- **Production activity in Reports** — production runs, units produced, materials consumed, material
  requests, top produced products and low raw materials — shown to anyone with Production access
  (e.g. a custom "Production Manager" role).
- **"View financials" permission** (Reports) — controls all money metrics: revenue, profit, VAT,
  supplier spend, sales by staff and payment methods. Owners and managers have it by default; grant
  it to anyone else per member.

### Changed
- Stock-health sections (out of stock, low stock, turnover, stocking history) now require Inventory
  access; the PDF export contains only the sections its viewer can see.

## 2026-07-30 — One role per member & custom-role names

### Changed
- A team member now holds exactly **one role** per business — enforced in the database, with any
  historical duplicates resolved to the member's highest role.
- Changing a role is now a single atomic operation (no more brief no-role gap), and switching
  someone off a custom role clears their old custom permissions so the new role is what they get.
- **Custom role names show everywhere** — the Team list, role pickers, filters and CSV export now say
  "Production Manager" instead of the underlying base role.
- The Team page can now assign **custom roles** directly (previously only at invite time).

### Fixed
- Reports' **Export PDF** button now respects the "Reports → Export" permission.

## 2026-07-30 — Delete (or archive) inventory products

Remove products you no longer stock — without ever losing your sales history.

### Added
- **Delete a product** from Inventory (owner-only by default; grantable to other roles from Permissions).
  A product that was **never used** is deleted outright; one with any **history** (sales, invoices,
  orders, production, POs) is **archived** instead — hidden from Inventory, the till and all product
  pickers, but kept so sales, invoices, cost-of-goods and reports stay accurate.
- **Show archived** toggle on Inventory to review archived products and **Restore** them anytime.

### Notes
- One migration on the shared iTrova project adds `products.archived_at`, a `delete_product` RPC (hard
  delete vs archive), a `restore_product` RPC, and a new `inventory.delete` permission.
- Reports keep archived products in cost-of-goods and Top Products (so past periods stay correct); only
  active-inventory views (stock alerts, turnover) exclude them.

## 2026-07-29 — Invoice inventory items, with stock & accounts kept in sync

Invoices can now sell what's in your inventory, not just free-text lines — and the numbers stay right everywhere.

### Added
- **Inventory line items on invoices** — pick a product per line (price pre-fills, stock shows) or add a
  **custom item / service** as before. Invoicing a product **reduces its stock**, exactly like a POS
  sale; you can't invoice more than you have (the line is blocked).
- **Edits reconcile stock** — changing a quantity, adding, removing or swapping a line adjusts stock by
  the difference. Voiding or deleting an invoice returns its stock. This now also applies when you edit
  a POS invoice's quantities.
- **Invoices count as sales** — every issued invoice's revenue now flows into **Reports** and the
  **Dashboard** (recognised when **issued**, matching your accounting ledger), with cost-of-goods added
  for inventory lines. This also brings older invoices into the sales figures.
- **Collected & Money owed** — new figures on the Dashboard and Reports: **Collected** (cash actually
  received, including invoice deposits and part-payments) and **Money owed** (unpaid invoice balances),
  so sales, cash and receivables all reconcile.

### Notes
- One migration on the shared iTrova project adds the product link + a `save_invoice` RPC (atomic stock
  reconciliation), the cost-of-goods ledger legs for inventory invoices, and stock return on void/delete.
- Accounting stays balanced: issuing posts Dr Accounts Receivable / Cr Sales / Cr VAT (+ Dr COGS /
  Cr Inventory); payments post Dr Cash / Cr Accounts Receivable — so the ledger's A/R equals "Money owed".

## 2026-07-28 — Dark mode, global search & a What's-new tour

Personalise how iTrova looks and find anything in a keystroke.

### Added
- **Dark / light mode** — a switch in the top bar. It follows your device by default and remembers your
  choice on every visit. Every screen, chart and badge has been tuned for both themes.
- **Search anything** — press **Ctrl/⌘ K** (or the magnifier in the top bar) to jump to any page or
  find a product, supplier, invoice or export invoice instantly. Results respect what your plan and
  role allow.
- **What's new** — a one-time tour that introduces new features. You only ever see what's changed since
  you last looked; it starts with dark mode and search.
- **Keyboard shortcuts** — press **?** any time (or pick it from search) to see the list. Includes
  **Ctrl/⌘ K** to search and **Ctrl/⌘ B** to show/hide the sidebar.

## 2026-07-25 — Deleted businesses sign out cleanly

### Fixed
- When a business is deleted, its owner and staff are now signed out instead of being stranded in an
  empty dashboard. A stale session with no account is ended automatically, and signing in again shows
  the normal "invalid credentials" error — the email is free to register a brand-new business.

## 2026-07-22 — Refer & earn

Invite other businesses to iTrova and earn credit toward your own subscription.

### Added
- **Refer & earn card** (Settings → Billing) — generate your personal referral code and share your
  signup link on WhatsApp in one tap.
- **Referral rewards** — every business that signs up with your link and subscribes earns you a share
  of their first-year payments as **subscription credit**. The card shows how many businesses you've
  referred, how many now subscribe, and your **available credit**.
- **Referral applied** note — a business that signed up through a referral link sees its
  **first-payment discount**, now **applied automatically to the plan prices** on the Billing tab
  (only for a first-time payer whose referral code is valid). The discounted amount also carries into
  the upgrade request sent to the team.
- Signup now accepts a **referral code** (pre-filled and locked when you arrive via a share link).

## 2026-07-14 — Profit at a glance in Inventory

See what your stock is worth and what it will earn you, right in the product list.

### Added
- **Cost total** column on each product — cost price × the stock you hold.
- **Profit** column — (sale price − cost price) × stock on hand, with the **markup on cost** shown
  beneath it. A product priced below cost shows a red, negative profit.
- An **info button** on the Profit column (and beside Profit on phones) explains exactly how the
  figures are worked out.

### Changed
- The selling-price column is now labelled **Sale price**.
- Products with no cost price yet show **—** for cost and profit (nothing is guessed).

## 2026-07-13 — Split payments & payment methods everywhere

Record exactly how a customer paid — including part cash, part transfer — and see it on every receipt,
invoice, and report.

### Added
- **Split payment at the till.** Point of Sale has a new **Split payment** toggle: enter an amount per
  method (Cash / Transfer / POS Terminal) with a live **Remaining** indicator; **Complete sale** stays
  disabled until the amounts add up to the total. Single-method sales work exactly as before.
- **Payment methods on Reports and the Dashboard.** A new **Payment methods** card — a donut chart plus
  an amount-and-share list — shows how money came in over the period (Reports) and this month (Dashboard).
  Included in the Reports PDF export.

### Changed
- **Payment method now shows everywhere.** Receipts, the invoice view, print and PDF download all display
  how the sale was paid — "Paid via Cash" for a single method, or an itemised split like
  "Cash ₦5,000 · Transfer ₦3,000". End-of-Day totals attribute each split sale's amounts to the right
  methods.
- Existing sales are shown against their recorded method automatically — no action needed.

### Notes
- One new migration adds the `sale_payments` table (one row per method) and backfills your past sales.
- The general ledger still posts sale proceeds to Cash; mapping transfer/POS to Bank is a future refinement.

## 2026-07-12 — Accounting: purchase-orders now post to your books

The last inventory‑posting gap is closed — your Balance Sheet now reflects stock you buy on a purchase
order, not just your opening figure.

### Changed
- **Purchase orders auto‑post to the ledger when received.** Buying **products** for resale (and any
  **raw materials** on the same PO) now books to **Inventory** — net of VAT, with landed costs
  capitalised — against Cash, so the general ledger matches the stock you actually received.
- **PO input VAT is captured** — the "of which VAT" on a received PO now posts to VAT Payable (raw
  material lines were previously dropped from the ledger).
- The Balance Sheet's "How this is calculated" note is updated: sales, expenses, invoices, payments,
  **purchase‑orders and production runs all post automatically** now.

### Notes
- Posting is completely safe — a ledger issue can never block receiving a PO, and nothing posts until
  you've set up your chart of accounts (open Accounting once).
- **Migration to apply:** `20260723100000_ledger_autopost_po_products.sql`.

## 2026-07-12 — Mobile polish for dense forms & lists

### Changed
- **Record production, New purchase order and New journal entry** forms now stack neatly on phones —
  each line puts the item on its own row with the amounts side‑by‑side, instead of squeezing into one
  cramped row.
- **Landed‑costs** rows (freight/duty) stack cleanly on mobile (no more collapsed name field).
- **Purchase Orders** list: the mobile card reads better (formatted dates, clearer total) and its
  action buttons no longer clip; the filters go full‑width on phones.

## 2026-07-12 — Production: add shipping/transport to a batch's cost

### Added
- **Shipping / transport** field on a production run — separate from labour/overhead. It's added to the
  batch cost, split across the products you made (by selling value) into their cost price, and
  capitalised into your inventory in the ledger. The live cost/unit updates as you type.

### Notes
- **Migration to apply:** `20260722100000_production_shipping.sql`.

A new **Assets** module for your fixed assets — with automatic depreciation that flows into your books.

### Added
- **Asset register** — record each item's **name, cost, year purchased** and a **depreciation rate**
  (default **20%/year**). iTrova shows the **current value** (straight‑line: it loses 20% of its
  original cost each year, reaching zero after 5).
- **Run depreciation** — one click posts the depreciation to date into Accounting
  (Dr Depreciation Expense / Cr Accumulated Depreciation). It's safe to run repeatedly — it never
  double‑posts.
- **Flows into your statements** — because Accounting reads the ledger, your **Balance Sheet** shows
  fixed assets at **net book value** and your **Profit & Loss** shows the depreciation, automatically.

### Notes
- Assets is a **paid module** (enable per plan). Adding an asset also records its purchase against Cash
  in the ledger. Depreciation posting needs your Accounting chart set up (open Accounting once).
- **Migrations to apply (in order):** `20260721100000_fixed_assets.sql`, then
  `20260721110000_assets_module.sql`.

Stop guessing what a batch cost — iTrova now works it out for you.

### Added
- **Automatic product cost from production.** A run's cost = the raw materials it uses (plus waste) at
  their cost, and it flows onto the products you made as their new cost price — blended using your
  inventory costing method (moving‑average or last‑cost).
- **Optional labour / overhead** field on a run — added to the batch cost and capitalised into your
  inventory in the ledger.
- **Multiple products from one run** split the cost fairly by **relative selling value**.
- The **cost/unit shows live** as you fill in the run; type a figure to **override** it.

### Notes
- Production now also posts to the general ledger (labour/overhead into Inventory), tightening the
  Accounting figures.
- **Migration to apply:** `20260720100000_production_auto_cost.sql`.

Your financial statements now come **straight from the general ledger**, so they agree with each other
and with the Trial Balance.

### Changed
- **Profit & Loss, Balance Sheet and Cash Flow are now ledger‑derived.** They read your account
  balances instead of re‑adding source records, so the numbers reconcile.
- **Balance Sheet always balances** — Assets = Liabilities + Equity by construction (current‑period
  profit sits in Equity). The old "doesn't fully tie" note is gone.
- **Cash Flow** reads the actual movements on your Cash & Bank accounts, grouped by cause (sales
  receipts, invoice payments, expenses paid, stock purchases).

### Added
- **Raw‑material purchases auto‑post** — deliveries book to Inventory (with input VAT) against Cash.
- **Opening inventory** is captured in your opening journal (from current stock at cost), so the ledger
  starts from your real position.

### Notes
- As accurate as what's posted: sales, expenses, invoices, payments and raw‑material purchases post
  automatically. **Still to come:** product purchase‑orders and production runs — until then their stock
  is carried at your opening figure.
- **Migration to apply:** `20260719100000_ledger_autopost_purchases.sql`.

## 2026-07-11 — Accounting v2: more of your activity posts itself

The ledger now builds itself from more of your day‑to‑day, not just sales.

### Added
- **Expenses auto‑post** — every expense (including **payroll salaries**) posts a journal: the cost to
  Operating Expenses, input VAT to VAT Payable, and the credit to Cash (if paid) or Accounts Payable
  (if it's a pending bill).
- **Invoices & payments auto‑post** — issuing a manual invoice records the money owed (Accounts
  Receivable) and the sale; recording a payment moves it from receivable to Cash.
- **Stays in sync** — editing, marking‑paid, voiding or deleting any of these updates the ledger
  automatically, so the Journal and Trial Balance keep matching your records.

### Notes
- Posting is completely safe — a ledger issue can never block saving an expense, invoice or payment,
  and nothing posts until you've set up your chart of accounts.
- Still to come: purchases/stock, and switching the Profit & Loss / Balance Sheet / Cash Flow to read
  from the ledger so they tie exactly.
- **Migration to apply:** `20260718100000_ledger_autopost_expenses_ar.sql`.

## 2026-07-11 — Accounting v2: General Ledger (foundation)

Real double‑entry bookkeeping under the hood, so your books can actually tie out.

### Added
- **Chart of Accounts** — a seeded, editable set of accounts (Cash, Bank, Accounts Receivable,
  Inventory, Accounts Payable, VAT Payable, Owner's Capital, Retained Earnings, Sales, Cost of Goods
  Sold, Operating Expenses). Rename or add your own.
- **General Journal** — every entry is balanced double‑entry (debits = credits, enforced). Post manual
  entries and adjustments; they sit alongside auto‑posted activity.
- **Automatic posting of POS sales** — each sale now posts a proper journal (Dr Cash / Cr Sales / Cr
  VAT, plus Dr Cost of Goods Sold / Cr Inventory), so the ledger builds itself as you trade.
- **Trial Balance** — every account's balance with totals that always tie, exportable to PDF/CSV.
- **Opening balances** you set become the opening journal entry, so the ledger starts from your real
  position.

### Notes
- Accounting is a **paid module**; posting journals / editing accounts needs the new *Accounting →
  Manage* permission (owners + managers by default).
- This is the **foundation** — auto‑posting for expenses, payments, payroll and purchases, and switching
  the P&L / Balance Sheet / Cash Flow to derive from the ledger, follow next. Sales post today.
- **Migrations to apply (in order):** `20260717100000_ledger.sql`, then
  `20260717110000_ledger_autopost_sales.sql`.

## 2026-07-10 — Accounting: Balance Sheet & Cash Flow

Two more financial statements join Profit & Loss in the Accounting module.

### Added
- **Cash Flow statement** — cash **in** (POS sales + invoice payments) vs cash **out** (expenses paid,
  incl. Payroll salaries, + stock/material purchases) for any period, with the **net cash movement**.
- **Balance Sheet** — a position snapshot as at any date: **Assets** (cash, inventory at cost,
  accounts receivable) · **Liabilities** (bills to pay, VAT payable) · **Equity** (owner's capital,
  retained earnings), with an honest **reconciliation note** when the two sides don't perfectly tie.
- **Opening balances setup** — owners enter starting cash/bank and owner's capital as of a date, so
  the Balance Sheet can show real Cash and Equity.
- Accounting is now **tabbed**: Profit & Loss · Balance Sheet · Cash Flow — each with its own
  **"How this is calculated"** explainer and **PDF + CSV export**.

### Notes
- **Migration to apply:** `20260716100000_accounting_opening_balances.sql`.
- Cash Flow is cash‑basis and VAT‑inclusive (real money moved); the Balance Sheet is an estimate
  because iTrova isn't a full double‑entry ledger — any gap is shown transparently to reconcile.

## 2026-07-10 — Accounting: Profit & Loss (MVP)

See how your business is really doing with a proper Profit & Loss statement.

### Added
- **New Accounting module** with a **Profit & Loss statement** for any date range:
  Revenue → Cost of Goods Sold → **Gross Profit** → Operating Expenses (by category) → **Net Profit**,
  with **profit margins** and a **previous‑period comparison** column.
- **Accurate cost of goods sold** — each item's cost is now captured at the moment of sale, so profit
  reflects what things actually cost (older sales fall back to the product's current cost).
- **Export** the statement to **PDF** or **CSV**.
- A built‑in **"How this is calculated"** explainer (accrual basis, VAT‑net, COGS, expenses) and a
  **heads‑up when sold items have no cost price**, so you know when profit may be overstated.

### Notes
- Accounting is a **paid module** — enable it per plan. Access follows the new *Accounting* permission
  (owners + managers by default).
- Revenue is **net of VAT** and counted when invoiced (accrual). Salaries flow in from Payroll; stock
  purchases are cost of goods sold when sold, not expenses.
- **Migrations to apply (in order):** `20260715100000_sale_item_cost.sql`, then
  `20260715110000_accounting_module.sql`.

## 2026-07-10 — Tidier Settings for your plan

### Changed
- **Settings now only shows what applies to your business.** Options for modules you don't have are
  hidden instead of sitting there unusable:
  - **Exporter Profile** shows only if you have the **Export Invoice** module.
  - **Notification preferences** — *General Store*, *Production* and *Expenditure* alerts appear only
    if you have those modules.
  - **Inventory costing** (valuation method) appears only if you have **Purchase Orders** or **Raw
    Materials** (it only matters when you procure stock).

## 2026-07-10 — Date picker & date format

A cleaner, consistent way to pick and read dates across the whole app.

### Added
- **New date picker** — every date field is now a clean, tappable field with a **calendar icon** that
  opens a proper calendar to pick a day. Replaces the old browser date box, so it looks and behaves
  the same on every device and browser (Inventory expiry, Invoice/PO/expense dates, report and list
  date filters, payroll dates, and more). Optional date fields can be cleared with one tap.

### Changed
- **One date format everywhere** — dates now display consistently as **DD MMM YYYY** (e.g. `05 Jun
  2026`) across lists, receipts, invoices, reports and pickers.

## 2026-07-10 — Payroll & Salaries

Run staff payroll straight from the Expenditure module, with salaries flowing into your books
automatically.

### Added
- **Payroll tab in Expenditure** — a new sub-section alongside Expenses, with two views: **Pay runs**
  and **Employees**.
- **Employee registry** — enrol people for pay from your **General Store staff**, your **Team
  members**, or add them **manually**. Each employee has a pay type (**monthly salary**, **daily
  wage**, or **hourly rate**), a rate, and optional bank details for payslips. Active employees are
  the ones pulled into new pay runs.
- **Pay runs** — pick a pay period and pay date; active employees are pre-filled with their salary.
  Adjust each person's gross pay and add **free-form deductions** (e.g. PAYE tax, pension, salary
  advance, absence). Live totals show **gross, deductions and net pay**. Save as a **draft** and come
  back later, or **post** it.
- **Post to Expenditure** — posting a pay run records one **"Salaries" expense for the total gross
  pay** (the real cost to the business), dated on the pay date, so payroll shows up in Expenditure,
  Reports and Net profit with no double entry. Choose the payment method and whether it's paid now or
  recorded as a pending bill.
- **Payslip PDFs** — download a per-employee payslip (earnings − deductions = net, with your business
  name and TIN) from any pay run.
- **Mobile-friendly** throughout — card layouts on phones, tables on desktop; consistent with the rest
  of the app.

### Notes
- Access follows your existing **Expenditure permissions** (owners and managers by default). Anyone
  with Expenditure access can see and run payroll.
- Deductions are entered manually in v1 — automatic Nigerian PAYE/pension calculators are planned for a
  later release.
- **Database migrations to apply (in order):** `20260714100000_payroll.sql`, then
  `20260714110000_payroll_post_rpc.sql`.
