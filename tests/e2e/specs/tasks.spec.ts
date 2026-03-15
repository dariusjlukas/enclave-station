/**
 * E2E tests for the task boards feature:
 * - Board creation and listing
 * - Task creation (kanban + list views)
 * - Task detail modal
 * - View mode switching (kanban / list / gantt)
 * - Permission enforcement
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
  apiEnableTasksTool,
  apiCreateTaskBoard,
  apiCreateTask,
  apiJoinSpace,
  apiAcceptSpaceInvite,
} from "../helpers/api.js";

let admin: TestUser;

test.beforeEach(async ({ workerConfig }) => {
  resetDatabase(workerConfig.dbConfig);
  admin = await setupAdminUser(workerConfig.apiConfig);
});

/** Navigate to a space's tasks by clicking Tasks in the sidebar. */
async function openTasks(
  page: import("@playwright/test").Page,
  spaceName: string,
) {
  await page.getByText(spaceName).first().click({ timeout: 10_000 });
  await page.getByRole("button", { name: "Tasks" }).click();
  // Wait for the task boards view to load
  await expect(page.getByText("Task Boards")).toBeVisible({ timeout: 10_000 });
}

/** Click a board card by its name to enter the board. */
async function enterBoard(
  page: import("@playwright/test").Page,
  boardName: string,
) {
  // Board cards are <button> elements inside the grid with an <h3> containing the name
  await page
    .locator("button", { has: page.locator("h3", { hasText: boardName }) })
    .click();
  // Wait for the back button to appear (we're inside a board now)
  await expect(
    page.locator("button[title='Back to boards']"),
  ).toBeVisible({ timeout: 10_000 });
}

test.describe("Task board basics", () => {
  test("shows empty boards view for new space", async ({
    page,
    workerConfig,
  }) => {
    const space = await apiCreateSpace(
      "TestSpace",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );
    await apiEnableTasksTool(
      space.id,
      admin.token,
      workerConfig.apiConfig,
    );

    await loginViaToken(page, admin.token);
    await openTasks(page, "TestSpace");

    await expect(page.getByText("No boards yet")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "New Board" }),
    ).toBeVisible();
  });

  test("can create a board via modal", async ({ page, workerConfig }) => {
    const space = await apiCreateSpace(
      "TestSpace",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );
    await apiEnableTasksTool(
      space.id,
      admin.token,
      workerConfig.apiConfig,
    );

    await loginViaToken(page, admin.token);
    await openTasks(page, "TestSpace");

    // Click New Board
    await page.getByRole("button", { name: "New Board" }).click();

    // Fill in the form
    await page.getByPlaceholder("Board name").fill("Sprint 1");

    // Create
    await page.getByRole("button", { name: "Create" }).click();

    // Should navigate into the board with default columns
    await expect(page.getByText("Sprint 1").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("To Do")).toBeVisible();
    await expect(page.getByText("In Progress")).toBeVisible();
    await expect(page.getByText("Done")).toBeVisible();
  });

  test("board appears in board list after creation", async ({
    page,
    workerConfig,
  }) => {
    const space = await apiCreateSpace(
      "TestSpace",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );
    await apiEnableTasksTool(
      space.id,
      admin.token,
      workerConfig.apiConfig,
    );
    await apiCreateTaskBoard(
      space.id,
      "My Sprint Board",
      admin.token,
      workerConfig.apiConfig,
    );

    await loginViaToken(page, admin.token);
    await openTasks(page, "TestSpace");

    await expect(page.getByText("My Sprint Board")).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe("Task creation and interaction", () => {
  test("can create a task in kanban view", async ({ page, workerConfig }) => {
    const space = await apiCreateSpace(
      "TestSpace",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );
    await apiEnableTasksTool(
      space.id,
      admin.token,
      workerConfig.apiConfig,
    );
    await apiCreateTaskBoard(
      space.id,
      "Kanban Test",
      admin.token,
      workerConfig.apiConfig,
    );

    await loginViaToken(page, admin.token);
    await openTasks(page, "TestSpace");
    await enterBoard(page, "Kanban Test");

    // Columns should be visible
    await expect(page.getByText("To Do")).toBeVisible();

    // Click "Add task" under the first column
    await page.getByText("Add task").first().click();

    // Type task title and submit
    await page.getByPlaceholder("Task title...").fill("My First Task");
    await page.getByRole("button", { name: "Add" }).first().click();

    // Task should appear as a card
    await expect(page.getByText("My First Task")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("clicking a task opens the detail modal", async ({
    page,
    workerConfig,
  }) => {
    const space = await apiCreateSpace(
      "TestSpace",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );
    await apiEnableTasksTool(
      space.id,
      admin.token,
      workerConfig.apiConfig,
    );
    const board = await apiCreateTaskBoard(
      space.id,
      "Detail Test",
      admin.token,
      workerConfig.apiConfig,
    );
    const colId = board.columns[0].id;
    await apiCreateTask(
      space.id,
      board.id,
      colId,
      "Detail Task",
      admin.token,
      {},
      workerConfig.apiConfig,
    );

    await loginViaToken(page, admin.token);
    await openTasks(page, "TestSpace");
    await enterBoard(page, "Detail Test");

    await expect(page.getByText("Detail Task")).toBeVisible({
      timeout: 10_000,
    });

    // Click the task card
    await page.getByText("Detail Task").click();

    // Modal should show task details with editable fields
    await expect(page.getByText("Status")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Priority")).toBeVisible();
    await expect(page.getByText("Due Date")).toBeVisible();
    await expect(page.getByText("Start Date")).toBeVisible();
    await expect(page.getByText("Duration (days)")).toBeVisible();
  });
});

test.describe("View mode switching", () => {
  test("can switch between kanban, list, and gantt views", async ({
    page,
    workerConfig,
  }) => {
    const space = await apiCreateSpace(
      "TestSpace",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );
    await apiEnableTasksTool(
      space.id,
      admin.token,
      workerConfig.apiConfig,
    );
    const board = await apiCreateTaskBoard(
      space.id,
      "Views Test",
      admin.token,
      workerConfig.apiConfig,
    );
    const colId = board.columns[0].id;
    await apiCreateTask(
      space.id,
      board.id,
      colId,
      "View Task",
      admin.token,
      {},
      workerConfig.apiConfig,
    );

    await loginViaToken(page, admin.token);
    await openTasks(page, "TestSpace");
    await enterBoard(page, "Views Test");

    await expect(page.getByText("View Task")).toBeVisible({
      timeout: 10_000,
    });

    // Switch to list view
    await page.locator("button[title='List view']").click();
    // List view should show table headers
    await expect(page.getByText("View Task")).toBeVisible({ timeout: 5_000 });

    // Switch to gantt view
    await page.locator("button[title='Gantt chart']").click();
    // Gantt view should show the task in the left panel
    await expect(page.getByText("View Task")).toBeVisible({ timeout: 5_000 });
  });

  test("list view shows task data in table format", async ({
    page,
    workerConfig,
  }) => {
    const space = await apiCreateSpace(
      "TestSpace",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );
    await apiEnableTasksTool(
      space.id,
      admin.token,
      workerConfig.apiConfig,
    );
    const board = await apiCreateTaskBoard(
      space.id,
      "List Test",
      admin.token,
      workerConfig.apiConfig,
    );
    const colId = board.columns[0].id;
    await apiCreateTask(
      space.id,
      board.id,
      colId,
      "Table Task",
      admin.token,
      { priority: "high" },
      workerConfig.apiConfig,
    );

    await loginViaToken(page, admin.token);
    await openTasks(page, "TestSpace");
    await enterBoard(page, "List Test");

    await expect(page.getByText("Table Task")).toBeVisible({
      timeout: 10_000,
    });

    // Switch to list view
    await page.locator("button[title='List view']").click();

    // Should show task data
    await expect(page.getByText("Table Task")).toBeVisible({ timeout: 5_000 });
    // High priority should be shown
    await expect(page.getByText("high", { exact: true })).toBeVisible();
  });
});

test.describe("Task permissions", () => {
  test("New Board button hidden for view-only users", async ({
    page,
    workerConfig,
  }) => {
    const space = await apiCreateSpace(
      "TestSpace",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );
    await apiEnableTasksTool(
      space.id,
      admin.token,
      workerConfig.apiConfig,
    );

    const viewer = await setupRegularUser(
      "viewer",
      "Viewer User",
      workerConfig.apiConfig,
    );
    // Add as read-only member
    const res = await fetch(
      `${workerConfig.apiConfig.apiBase}/api/spaces/${space.id}/members`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${admin.token}`,
        },
        body: JSON.stringify({ user_id: viewer.userId, role: "user" }),
      },
    );
    expect(res.ok).toBeTruthy();
    await apiAcceptSpaceInvite(
      space.id,
      viewer.token,
      workerConfig.apiConfig,
    );

    await loginViaToken(page, viewer.token);
    await openTasks(page, "TestSpace");

    // New Board button should NOT be visible for view-only user
    await expect(
      page.getByRole("button", { name: "New Board" }),
    ).not.toBeVisible();
  });

  test("view-only user cannot add tasks", async ({ page, workerConfig }) => {
    const space = await apiCreateSpace(
      "TestSpace",
      admin.token,
      undefined,
      workerConfig.apiConfig,
    );
    await apiEnableTasksTool(
      space.id,
      admin.token,
      workerConfig.apiConfig,
    );
    await apiCreateTaskBoard(
      space.id,
      "Perms Test",
      admin.token,
      workerConfig.apiConfig,
    );

    const viewer = await setupRegularUser(
      "viewer",
      "Viewer User",
      workerConfig.apiConfig,
    );
    const res = await fetch(
      `${workerConfig.apiConfig.apiBase}/api/spaces/${space.id}/members`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${admin.token}`,
        },
        body: JSON.stringify({ user_id: viewer.userId, role: "user" }),
      },
    );
    expect(res.ok).toBeTruthy();
    await apiAcceptSpaceInvite(
      space.id,
      viewer.token,
      workerConfig.apiConfig,
    );

    await loginViaToken(page, viewer.token);
    await openTasks(page, "TestSpace");
    await enterBoard(page, "Perms Test");

    // Columns should be visible but "Add task" should NOT
    await expect(page.getByText("To Do")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Add task")).not.toBeVisible();
  });
});
