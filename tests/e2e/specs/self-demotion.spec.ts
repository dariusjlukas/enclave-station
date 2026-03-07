/**
 * E2E tests for self-demotion: owners/admins can demote themselves via the UI.
 *
 * This is a regression test for a bug where the role dropdown was hidden for
 * the current user, preventing self-demotion even though the backend allowed it.
 */

import { test, expect } from "@playwright/test";
import { resetDatabase } from "../helpers/db.js";
import {
  setupAdminUser,
  setupRegularUser,
  loginViaToken,
  type TestUser,
} from "../helpers/auth.js";
import {
  apiChangeUserRole,
  apiGetAdminUsers,
} from "../helpers/api.js";

let admin: TestUser;

test.beforeEach(async () => {
  resetDatabase();
  admin = await setupAdminUser();
});

/** Click the Nth button (0-indexed) in the header's right button group. */
async function clickHeaderButton(
  page: import("@playwright/test").Page,
  index: number,
) {
  const buttons = page.locator(
    "header .flex.items-center.justify-end button",
  );
  await buttons.nth(index).click();
}

const ADMIN_BTN = 0;

test.describe("Server-level self-demotion", () => {
  test("owner can see role dropdown for themselves in User Management", async ({
    page,
  }) => {
    // Create a second owner so demotion is allowed
    const regular = await setupRegularUser("user2", "User Two");
    await apiChangeUserRole(regular.userId, "owner", admin.token);

    await loginViaToken(page, admin.token);

    // Open admin panel
    await clickHeaderButton(page, ADMIN_BTN);
    await expect(page.getByText("Admin Panel").first()).toBeVisible({
      timeout: 10_000,
    });

    // Expand User Management section
    await page.getByText("User Management").click();

    // Wait for users to load - find our own username
    await expect(page.getByText("@admin").first()).toBeVisible({
      timeout: 5_000,
    });

    // The admin user's row should have a role Select (not just a text label)
    // Find the row containing @admin and look for a select/trigger element
    const adminRow = page
      .locator('[class*="bg-content1"]')
      .filter({ hasText: "@admin" });
    const roleSelect = adminRow.locator("select, [role='button'][aria-label='Role']");
    await expect(roleSelect).toBeVisible();
  });

  test("owner can demote themselves to admin via UI", async ({ page }) => {
    // Create a second owner so demotion is allowed
    const regular = await setupRegularUser("user2", "User Two");
    await apiChangeUserRole(regular.userId, "owner", admin.token);

    await loginViaToken(page, admin.token);

    // Open admin panel
    await clickHeaderButton(page, ADMIN_BTN);
    await expect(page.getByText("Admin Panel").first()).toBeVisible({
      timeout: 10_000,
    });

    // Expand User Management section
    await page.getByText("User Management").click();
    await expect(page.getByText("@admin").first()).toBeVisible({
      timeout: 5_000,
    });

    // Find the admin user's row and change the role via the hidden native <select>
    const adminRow = page
      .locator('[class*="bg-content1"]')
      .filter({ hasText: "@admin" });
    const nativeSelect = adminRow.locator("select");
    await nativeSelect.selectOption("admin", { force: true });

    // Verify the role changed - the user should now see "admin" reflected
    // After demotion, the admin panel may close or the user list refreshes
    // Verify via the API that the role actually changed
    const users = await apiGetAdminUsers(admin.token);
    const self = users.find((u) => u.username === "admin");
    expect(self?.role).toBe("admin");
  });
});
