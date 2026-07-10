# Changelog

All notable, user-facing changes to iTrova are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/); entries are grouped by ship date, newest first.

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
