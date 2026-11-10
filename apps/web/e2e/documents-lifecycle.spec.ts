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

  // A11Y-001: the template dialog must trap focus, close on Esc and hand
  // focus back to the button that opened it.
  test("new template dialog is keyboard operable", async ({ page }) => {
    await page.goto("/en/documents");
    await page.getByRole("button", { name: "Templates & Generation" }).click();

    const trigger = page.getByRole("button", { name: "New Template" }).first();
    await trigger.click();

    const dialog = page.getByRole("dialog", {
      name: "Create New Document Template",
    });
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Tab");
    await expect(dialog.locator(":focus")).toHaveCount(1);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
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
