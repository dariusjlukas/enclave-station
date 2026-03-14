/**
 * E2E tests for server lockdown via the admin panel Danger Zone.
 */

import { test, expect } from "../fixtures.js";
import { resetDatabase } from "../helpers/db.js";
import {
  setupAdminUser,
  setupRegularUser,
  loginViaToken,
  type TestUser,
} from "../helpers/auth.js";
import {
  apiLockdownServer,
  apiUnlockServer,
  apiGetAdminSettings,
  apiChangeUserRole,
} from "../helpers/api.js";

let admin: TestUser;

test.beforeEach(async ({ workerConfig }) => {
  resetDatabase(workerConfig.dbConfig);
  admin = await setupAdminUser(workerConfig.apiConfig);
});

/** Open Admin Panel via the avatar dropdown. */
async function clickAdminPanel(page: import("@playwright/test").Page) {
  const avatarBtn = page.locator(
    "header .flex.items-center.justify-end button.rounded-full",
  );
  await avatarBtn.click();
  await page.getByRole("menuitem", { name: "Admin Panel" }).click();
}

/** Navigate to the Danger Zone tab in the admin panel. */
async function openDangerZone(page: import("@playwright/test").Page) {
  await clickAdminPanel(page);
  await expect(page.getByText("Admin Panel").first()).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "Danger Zone" }).click();
}

test.describe("Lockdown via admin panel UI", () => {
  test("owner can lock down the server", async ({ page, workerConfig }) => {
    await loginViaToken(page, admin.token);
    await openDangerZone(page);

    // Should see lockdown description text
    await expect(
      page.getByText("Lockdown mode will immediately kick all non-admin users"),
    ).toBeVisible({ timeout: 5_000 });

    // Register dialog handler BEFORE any click that could trigger confirm()
    page.on("dialog", (dialog) => dialog.accept());

    // The lockdown emergency button has layered CSS (absolute inset-0 divs
    // with backfaceVisibility and 3D transforms) that interfere with
    // Playwright's mouse-coordinate hit-testing. Use dispatchEvent to
    // fire click events directly on the DOM elements instead.
    await page.getByText("Lift cover to arm").first().dispatchEvent("click");

    // Wait for the cover to open (button becomes enabled)
    const lockdownBtn = page.locator("button").filter({ hasText: "БЛОК" });
    await expect(lockdownBtn).toBeEnabled({ timeout: 2_000 });

    // Click the БЛОК button via dispatchEvent (cover overlay blocks mouse)
    await lockdownBtn.dispatchEvent("click");

    // After lockdown, should show "Lift Lockdown" button and locked-down description
    await expect(
      page.getByRole("button", { name: "Lift Lockdown" }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByText("The server is currently in lockdown"),
    ).toBeVisible();

    // Verify via API
    const settings = await apiGetAdminSettings(
      admin.token,
      workerConfig.apiConfig,
    );
    expect(settings.server_locked_down).toBe(true);
  });

  test("owner can lift lockdown", async ({ page, workerConfig }) => {
    // Lock down via API first
    await apiLockdownServer(admin.token, workerConfig.apiConfig);

    await loginViaToken(page, admin.token);
    await openDangerZone(page);

    // Should show locked-down state
    await expect(
      page.getByRole("button", { name: "Lift Lockdown" }),
    ).toBeVisible({ timeout: 5_000 });

    // Click lift lockdown
    await page.getByRole("button", { name: "Lift Lockdown" }).click();

    // Should show the lockdown button again (not locked down)
    await expect(
      page.getByText("Lockdown mode will immediately kick all non-admin users"),
    ).toBeVisible({ timeout: 5_000 });

    // Verify via API
    const settings = await apiGetAdminSettings(
      admin.token,
      workerConfig.apiConfig,
    );
    expect(settings.server_locked_down).toBe(false);
  });
});

test.describe("Lockdown kicks active user", () => {
  test("regular user is kicked when lockdown is activated", async ({
    page,
    workerConfig,
  }) => {
    const regular = await setupRegularUser(
      "victim",
      "Victim User",
      workerConfig.apiConfig,
    );

    // Login as the regular user — this establishes a WebSocket connection
    await loginViaToken(page, regular.token);
    await expect(page.getByText("EnclaveStation").first()).toBeVisible({
      timeout: 10_000,
    });

    // Activate lockdown via API — the server sends a "server_locked_down"
    // WS message to non-admin users before disconnecting them, which
    // triggers clearAuth() on the client.
    await apiLockdownServer(admin.token, workerConfig.apiConfig);

    // The user should be redirected to the login page
    await expect(
      page.getByText("Sign in to continue"),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("after lifting lockdown, regular user can log in again", async ({
    page,
    workerConfig,
  }) => {
    const regular = await setupRegularUser(
      "restored",
      "Restored User",
      workerConfig.apiConfig,
    );

    // Lock down then unlock
    await apiLockdownServer(admin.token, workerConfig.apiConfig);
    await apiUnlockServer(admin.token, workerConfig.apiConfig);

    // Regular user should be able to log in now
    await loginViaToken(page, regular.token);
    await expect(page.getByText("EnclaveStation").first()).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe("Lockdown admin access preserved", () => {
  test("admin user can still access the app during lockdown", async ({
    page,
    workerConfig,
  }) => {
    const adminUser = await setupRegularUser(
      "myadmin",
      "My Admin",
      workerConfig.apiConfig,
    );
    await apiChangeUserRole(
      adminUser.userId,
      "admin",
      admin.token,
      workerConfig.apiConfig,
    );

    // Lock down the server
    await apiLockdownServer(admin.token, workerConfig.apiConfig);

    // Admin should still be able to access the app
    await loginViaToken(page, adminUser.token);
    await expect(page.getByText("EnclaveStation").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("owner can still access the app during lockdown", async ({
    page,
    workerConfig,
  }) => {
    await apiLockdownServer(admin.token, workerConfig.apiConfig);

    await loginViaToken(page, admin.token);
    await expect(page.getByText("EnclaveStation").first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
