import { test, expect } from "@playwright/test";

test.describe("Documents & Lifecycle Management E2E (M4)", () => {
  test("renders documents repository with upload and bulk payslip actions", async ({
    page,
  }) => {
    await page.goto("/en/documents");

    await expect(page.locator("h1")).toContainText("Document Repository");

    const uploadBtn = page.getByRole("button", { name: "Upload Document" });
    await expect(uploadBtn).toBeVisible();

    const bulkBtn = page.getByRole("button", { name: "Bulk Upload Payslips" });
    await expect(bulkBtn).toBeVisible();
  });

  test("switches between document upload tab and displays file requirements", async ({
    page,
  }) => {
    await page.goto("/en/documents");

    await page.getByRole("button", { name: "Upload Document" }).click();

    await expect(page.getByText("Document Title")).toBeVisible();
    await expect(page.getByText("Select Category")).toBeVisible();
    await expect(
      page.getByText("Max 15MB. Supported: PDF, PNG, JPEG, TIFF, DOCX, XLSX."),
    ).toBeVisible();
  });

  test("renders onboarding checklist and bulk employee import view", async ({
    page,
  }) => {
    await page.goto("/en/onboarding");

    await expect(page.locator("h1")).toContainText("Employee Lifecycle");

    await expect(
      page.getByRole("button", { name: "Checklists" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Bulk Import Employees" }),
    ).toBeVisible();

    // Switch to CSV import tab
    await page.getByRole("button", { name: "Bulk Import Employees" }).click();

    await expect(
      page.getByText("Atomic Bulk Employee Import (CSV)"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Validate CSV" }),
    ).toBeVisible();
  });
});
