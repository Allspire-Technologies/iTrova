import { test, expect, type Page } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

const EMP = {
  id: "pe1", business_id: "biz-1", name: "Bola Ade", store_staff_id: null, user_id: null,
  pay_type: "monthly", base_rate: 100000, bank_name: null, account_number: null, account_name: null,
  notes: null, active: true, created_at: "2026-07-01T00:00:00Z",
};
const DRAFT_RUN = {
  id: "run-1", business_id: "biz-1", period_label: "July 2026", period_start: null, period_end: null,
  pay_date: "2026-07-28", status: "draft", expense_id: null, gross_total: 100000, deduction_total: 7500,
  net_total: 92500, notes: null, created_at: "2026-07-28T00:00:00Z",
};
const DRAFT_LINE = {
  id: "pl1", run_id: "run-1", employee_id: "pe1", employee_name: "Bola Ade", gross_pay: 100000,
  deductions: [{ label: "PAYE", amount: 7500 }], deduction_total: 7500, net_pay: 92500, notes: null,
};

async function gotoPayroll(page: Page) {
  await page.goto("/expenditure?tab=payroll");
  await expect(page.getByRole("button", { name: /New pay run/ }).first()).toBeVisible();
}

test.describe("Payroll", () => {
  test("Payroll tab lists pay runs and switches to the employees registry", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "payroll_employees", [EMP]);
    await stubRows(page, "payroll_runs", [DRAFT_RUN]);
    await gotoPayroll(page);

    await expect(page.getByRole("cell", { name: "July 2026", exact: true })).toBeVisible();
    await expect(page.locator("table").getByText("Draft")).toBeVisible();

    await page.getByRole("button", { name: /Employees/ }).click();
    await expect(page.locator("table").getByText("Bola Ade")).toBeVisible();
    await expect(page.locator("table").getByText("Store staff")).toHaveCount(0); // manual employee
  });

  test("enrolling a manual employee posts the expected payload", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "payroll_employees", []);
    await stubRows(page, "payroll_runs", []);
    await stubRows(page, "store_staff", []);
    let posted: any = null;
    await page.route("**/rest/v1/payroll_employees**", (r) => {
      if (r.request().method() === "POST") { posted = r.request().postDataJSON(); return r.fulfill({ status: 201, contentType: "application/json", body: "[]" }); }
      return r.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await gotoPayroll(page);

    await page.getByRole("button", { name: /Employees/ }).click();
    await page.getByRole("button", { name: /Enrol employee/ }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("Employee name").fill("Ade Cook");
    await dialog.getByPlaceholder("0").fill("80000"); // monthly salary
    await dialog.getByRole("button", { name: "Enrol", exact: true }).click();

    await expect(page.getByText("Employee enrolled")).toBeVisible();
    const row = Array.isArray(posted) ? posted[0] : posted;
    expect(row).toMatchObject({ name: "Ade Cook", pay_type: "monthly", base_rate: 80000, active: true, business_id: "biz-1" });
  });

  test("a new pay run pre-fills the salary, nets off a deduction, and saves the lines", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "payroll_employees", [EMP]);
    let linesBody: any = null;
    await page.route("**/rest/v1/payroll_runs**", (r) => {
      if (r.request().method() === "POST") return r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "run-9" }) });
      return r.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.route("**/rest/v1/payroll_run_lines**", (r) => {
      if (r.request().method() === "POST") { linesBody = r.request().postDataJSON(); return r.fulfill({ status: 201, contentType: "application/json", body: "[]" }); }
      return r.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await gotoPayroll(page);

    await page.getByRole("button", { name: /New pay run/ }).first().click();
    const dialog = page.getByRole("dialog");
    // The monthly employee's salary is pre-filled.
    await expect(dialog.getByLabel("Gross pay for Bola Ade")).toHaveValue("100000");
    // Add a deduction → net updates to 92,500.
    await dialog.getByRole("button", { name: /Add deduction/ }).click();
    await dialog.getByLabel("Deduction label 1 for Bola Ade").fill("PAYE");
    await dialog.getByLabel("Deduction amount 1 for Bola Ade").fill("7500");
    await expect(dialog.getByText(/Net.*92,?500/).first()).toBeVisible();

    await dialog.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved")).toBeVisible();
    const line = Array.isArray(linesBody) ? linesBody[0] : linesBody;
    expect(line).toMatchObject({ employee_name: "Bola Ade", gross_pay: 100000, deduction_total: 7500, net_pay: 92500 });
    expect(line.deductions[0]).toMatchObject({ label: "PAYE", amount: 7500 });
  });

  test("posting a draft run calls the RPC and reports the gross posted", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "payroll_employees", [EMP]);
    await stubRows(page, "payroll_runs", [DRAFT_RUN]);
    let rpcBody: any = null;
    await page.route("**/rest/v1/rpc/post_payroll_run**", (r) => {
      rpcBody = r.request().postDataJSON();
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ expense_id: "ex-9", gross_total: 100000, net_total: 92500, staff: 1 }) });
    });
    await gotoPayroll(page);

    await page.getByRole("button", { name: /More actions for July 2026/ }).first().click();
    await page.getByRole("menuitem", { name: /Post to Expenditure/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/Gross salaries/)).toBeVisible();
    await dialog.getByRole("button", { name: /Post payroll/ }).click();

    await expect(page.getByText(/Posted .*100,?000 to Expenditure/)).toBeVisible();
    expect(rpcBody).toMatchObject({ _run_id: "run-1", _mark_paid: true });
  });

  test("View lists each employee with a payslip download", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "payroll_employees", [EMP]);
    await stubRows(page, "payroll_runs", [DRAFT_RUN]);
    await stubRows(page, "payroll_run_lines", [DRAFT_LINE]);
    await gotoPayroll(page);

    await page.getByRole("button", { name: "View" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Bola Ade")).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      dialog.getByRole("button", { name: /Payslip/ }).click(),
    ]);
    expect(download.suggestedFilename()).toContain("payslip-bola-ade");
  });

  test("cashier cannot reach payroll (no Expenditure access)", async ({ page }) => {
    await authenticate(page, { role: "cashier" });
    await page.goto("/expenditure?tab=payroll");
    await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
  });
});
