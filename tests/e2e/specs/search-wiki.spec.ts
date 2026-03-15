/**
 * E2E tests for global search integration with wiki pages.
 * Verifies that wiki pages appear in the global search bar
 * under the "Wiki" tab, with correct permission filtering.
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
  apiEnableWikiTool,
  apiCreateWikiPage,
  apiUpdateWikiPage,
  apiJoinSpace,
} from "../helpers/api.js";

let admin: TestUser;

test.beforeEach(async ({ workerConfig }) => {
  resetDatabase(workerConfig.dbConfig);
  admin = await setupAdminUser(workerConfig.apiConfig);
});

/** Open the global search bar, type a query, and switch to the Wiki tab. */
async function searchWiki(
  page: import("@playwright/test").Page,
  query: string,
) {
  const searchInput = page.getByPlaceholder("Search...");
  await searchInput.click();
  await searchInput.fill(query);
  await page.getByRole("tab", { name: "Wiki" }).click();
  await page.waitForTimeout(500);
}

test.describe("Search finds wiki pages", () => {
  test("wiki page appears in search results by content", async ({
    page,
    workerConfig,
  }) => {
    const space = await apiCreateSpace(
      "Engineering",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );
    await apiEnableWikiTool(
      space.id,
      admin.token,
      workerConfig.apiConfig,
    );
    const wikiPage = await apiCreateWikiPage(
      space.id,
      "Deployment Guide",
      admin.token,
      { content: "Instructions for deploying the application to production servers" },
      workerConfig.apiConfig,
    );
    // Ensure content is indexed by updating
    await apiUpdateWikiPage(
      space.id,
      wikiPage.id,
      { content: "Instructions for deploying the application to production servers" },
      admin.token,
      workerConfig.apiConfig,
    );

    await loginViaToken(page, admin.token);
    await searchWiki(page, "deploying production");

    await expect(page.getByText("Deployment Guide")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Engineering").last()).toBeVisible();
  });

  test("wiki page appears in search results by title", async ({
    page,
    workerConfig,
  }) => {
    const space = await apiCreateSpace(
      "Platform",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );
    await apiEnableWikiTool(
      space.id,
      admin.token,
      workerConfig.apiConfig,
    );
    await apiCreateWikiPage(
      space.id,
      "Architecture Overview",
      admin.token,
      { content: "High-level system design and component relationships" },
      workerConfig.apiConfig,
    );

    await loginViaToken(page, admin.token);
    await searchWiki(page, "architecture");

    await expect(page.getByText("Architecture Overview")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("non-member cannot see wiki pages from private space", async ({
    page,
    workerConfig,
  }) => {
    const space = await apiCreateSpace(
      "SecretProject",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );
    await apiEnableWikiTool(
      space.id,
      admin.token,
      workerConfig.apiConfig,
    );
    await apiCreateWikiPage(
      space.id,
      "Confidential Roadmap",
      admin.token,
      { content: "Top secret plans for world domination" },
      workerConfig.apiConfig,
    );

    const outsider = await setupRegularUser(
      "outsider",
      "Outsider User",
      workerConfig.apiConfig,
    );
    await loginViaToken(page, outsider.token);
    await searchWiki(page, "secret plans domination");

    await expect(page.getByText("No results found")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("space member can see wiki pages in search", async ({
    page,
    workerConfig,
  }) => {
    const space = await apiCreateSpace(
      "TeamSpace",
      admin.token,
      { is_public: true },
      workerConfig.apiConfig,
    );
    await apiEnableWikiTool(
      space.id,
      admin.token,
      workerConfig.apiConfig,
    );
    await apiCreateWikiPage(
      space.id,
      "Onboarding Checklist",
      admin.token,
      { content: "Steps for new team members joining the project" },
      workerConfig.apiConfig,
    );

    const member = await setupRegularUser(
      "teammate",
      "Team Mate",
      workerConfig.apiConfig,
    );
    await apiJoinSpace(space.id, member.token, workerConfig.apiConfig);

    await loginViaToken(page, member.token);
    await searchWiki(page, "onboarding");

    await expect(page.getByText("Onboarding Checklist")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("search shows snippet with highlighted match", async ({
    page,
    workerConfig,
  }) => {
    const space = await apiCreateSpace(
      "Docs",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );
    await apiEnableWikiTool(
      space.id,
      admin.token,
      workerConfig.apiConfig,
    );
    await apiCreateWikiPage(
      space.id,
      "API Reference",
      admin.token,
      { content: "The authentication endpoint requires a valid bearer token for all requests" },
      workerConfig.apiConfig,
    );

    await loginViaToken(page, admin.token);
    await searchWiki(page, "authentication bearer");

    await expect(page.getByText("API Reference")).toBeVisible({
      timeout: 10_000,
    });
    // The snippet should contain a <mark> element from ts_headline
    await expect(page.locator("mark").first()).toBeVisible({ timeout: 10_000 });
  });

  test("wiki pages from multiple spaces appear in search", async ({
    page,
    workerConfig,
  }) => {
    const space1 = await apiCreateSpace(
      "Frontend",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );
    const space2 = await apiCreateSpace(
      "Backend",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );
    await apiEnableWikiTool(
      space1.id,
      admin.token,
      workerConfig.apiConfig,
    );
    await apiEnableWikiTool(
      space2.id,
      admin.token,
      workerConfig.apiConfig,
    );
    await apiCreateWikiPage(
      space1.id,
      "Migration Guide",
      admin.token,
      { content: "Steps for migrating the frontend framework" },
      workerConfig.apiConfig,
    );
    await apiCreateWikiPage(
      space2.id,
      "Migration Guide",
      admin.token,
      { content: "Steps for migrating the database schema" },
      workerConfig.apiConfig,
    );

    await loginViaToken(page, admin.token);
    await searchWiki(page, "migration");

    const results = page.locator("text=Migration Guide");
    await expect(results).toHaveCount(2, { timeout: 10_000 });

    await expect(page.getByText("Frontend").last()).toBeVisible();
    await expect(page.getByText("Backend").last()).toBeVisible();
  });

  test("clicking wiki result navigates to wiki tool", async ({
    page,
    workerConfig,
  }) => {
    const space = await apiCreateSpace(
      "DevOps",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );
    await apiEnableWikiTool(
      space.id,
      admin.token,
      workerConfig.apiConfig,
    );
    await apiCreateWikiPage(
      space.id,
      "Runbook Procedures",
      admin.token,
      { content: "Emergency incident response procedures and escalation paths" },
      workerConfig.apiConfig,
    );

    await loginViaToken(page, admin.token);
    await searchWiki(page, "incident response");

    await expect(page.getByText("Runbook Procedures")).toBeVisible({
      timeout: 10_000,
    });

    // Click the wiki search result
    await page.getByText("Runbook Procedures").click();

    // Should navigate to the wiki view showing the empty state
    await expect(
      page.getByText("Select a page or create a new one"),
    ).toBeVisible({
      timeout: 10_000,
    });
  });
});
