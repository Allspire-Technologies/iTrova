# Changelog

All notable, user-facing changes to iTrova are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/); entries are grouped by ship date, newest first.

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
