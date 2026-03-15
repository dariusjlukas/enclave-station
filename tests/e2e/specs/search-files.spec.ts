/**
 * E2E tests for global search integration with space files.
 * Verifies that files uploaded via the Files tool appear in
 * the global search bar under the "Files" tab.
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
  apiCreateSpace,
  apiEnableFilesTool,
  apiUploadSpaceFile,
  apiCreateSpaceFolder,
  apiJoinSpace,
} from "../helpers/api.js";

let admin: TestUser;

test.beforeEach(async ({ workerConfig }) => {
  resetDatabase(workerConfig.dbConfig);
  admin = await setupAdminUser(workerConfig.apiConfig);
});

/** Open the global search bar, type a query, and switch to the Files tab. */
async function searchFiles(
  page: import("@playwright/test").Page,
  query: string,
) {
  const searchInput = page.getByPlaceholder("Search...");
  await searchInput.click();
  await searchInput.fill(query);
  // Switch to Files tab
  await page.getByRole("tab", { name: "Files" }).click();
  // Wait for results to load (spinner gone)
  await page.waitForTimeout(500);
}

test.describe("Search finds space files", () => {
  test("space file appears in search results", async ({
    page,
    workerConfig,
  }) => {
    const space = await apiCreateSpace(
      "Engineering",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );
    await apiEnableFilesTool(
      space.id,
      admin.token,
      workerConfig.apiConfig,
    );
    await apiUploadSpaceFile(
      space.id,
      "project-roadmap.pdf",
      "roadmap content",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );

    await loginViaToken(page, admin.token);
    await searchFiles(page, "roadmap");

    // The file should appear in the results
    await expect(page.getByText("project-roadmap.pdf")).toBeVisible({
      timeout: 10_000,
    });
    // Should show the space name in the subtitle
    await expect(page.getByText("Engineering").last()).toBeVisible();
  });

  test("partial filename match works", async ({ page, workerConfig }) => {
    const space = await apiCreateSpace(
      "Design",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );
    await apiEnableFilesTool(
      space.id,
      admin.token,
      workerConfig.apiConfig,
    );
    await apiUploadSpaceFile(
      space.id,
      "mockup-homepage-v3.png",
      "image data",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );

    await loginViaToken(page, admin.token);
    await searchFiles(page, "homepage");

    await expect(page.getByText("mockup-homepage-v3.png")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("non-member cannot see private space files", async ({
    page,
    workerConfig,
  }) => {
    const space = await apiCreateSpace(
      "SecretProject",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );
    await apiEnableFilesTool(
      space.id,
      admin.token,
      workerConfig.apiConfig,
    );
    await apiUploadSpaceFile(
      space.id,
      "confidential-plans.docx",
      "secret",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );

    // Login as a different user who is NOT a member of this space
    const user = await setupRegularUser(
      "outsider",
      "Outsider User",
      workerConfig.apiConfig,
    );
    await loginViaToken(page, user.token);
    await searchFiles(page, "confidential-plans");

    // Should show "No results found" instead of the file
    await expect(page.getByText("No results found")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("member can see space files in search", async ({
    page,
    workerConfig,
  }) => {
    const space = await apiCreateSpace(
      "TeamSpace",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );
    await apiEnableFilesTool(
      space.id,
      admin.token,
      workerConfig.apiConfig,
    );
    await apiUploadSpaceFile(
      space.id,
      "team-notes.txt",
      "meeting notes",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );

    const user = await setupRegularUser(
      "teammate",
      "Team Mate",
      workerConfig.apiConfig,
    );
    await apiJoinSpace(space.id, user.token, workerConfig.apiConfig);

    await loginViaToken(page, user.token);
    await searchFiles(page, "team-notes");

    await expect(page.getByText("team-notes.txt")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("clicking 'Open in Files' navigates to file browser", async ({
    page,
    workerConfig,
  }) => {
    const space = await apiCreateSpace(
      "NavSpace",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );
    await apiEnableFilesTool(
      space.id,
      admin.token,
      workerConfig.apiConfig,
    );
    await apiUploadSpaceFile(
      space.id,
      "navigate-me.txt",
      "content",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );

    await loginViaToken(page, admin.token);
    await searchFiles(page, "navigate-me");

    await expect(page.getByText("navigate-me.txt")).toBeVisible({
      timeout: 10_000,
    });

    // Click the "Open in Files" button on the result
    await page.getByTitle("Open in Files").click();

    // Should navigate to the file browser for that space
    await expect(page.getByText("NavSpace — Files")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("files from multiple spaces appear in search", async ({
    page,
    workerConfig,
  }) => {
    const space1 = await apiCreateSpace(
      "Alpha",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );
    const space2 = await apiCreateSpace(
      "Beta",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );
    await apiEnableFilesTool(
      space1.id,
      admin.token,
      workerConfig.apiConfig,
    );
    await apiEnableFilesTool(
      space2.id,
      admin.token,
      workerConfig.apiConfig,
    );
    await apiUploadSpaceFile(
      space1.id,
      "shared-report.txt",
      "alpha report",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );
    await apiUploadSpaceFile(
      space2.id,
      "shared-report.txt",
      "beta report",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );

    await loginViaToken(page, admin.token);
    await searchFiles(page, "shared-report");

    // Both files should appear (same name, different spaces)
    const results = page.locator("text=shared-report.txt");
    await expect(results).toHaveCount(2, { timeout: 10_000 });

    // Both space names should appear in the results
    await expect(page.getByText("Alpha").last()).toBeVisible();
    await expect(page.getByText("Beta").last()).toBeVisible();
  });

  test("folders appear in search results", async ({ page, workerConfig }) => {
    const space = await apiCreateSpace(
      "FolderSpace",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );
    await apiEnableFilesTool(
      space.id,
      admin.token,
      workerConfig.apiConfig,
    );
    await apiCreateSpaceFolder(
      space.id,
      "important-documents",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );

    await loginViaToken(page, admin.token);
    await searchFiles(page, "important-documents");

    // The folder should appear with "Folder" in the subtitle instead of a file size
    await expect(page.getByText("important-documents")).toBeVisible({
      timeout: 10_000,
    });
    // The subtitle should contain "Folder · @admin · FolderSpace"
    await expect(page.getByText(/^Folder\s+·/)).toBeVisible();
  });
});
