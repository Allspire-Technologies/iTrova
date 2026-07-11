# Changelog

All notable, user-facing changes to iTrova are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/); entries are grouped by ship date, newest first.

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
