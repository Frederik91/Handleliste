import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import {
  FRIDA,
  OLA,
  startHandlelisteTestSystem,
} from "../support/handleliste-test-system.js";

test("completes full Package Option rows newest-first and restores their active position", async ({ page }) => {
  const system = await startHandlelisteTestSystem();
  let homeAssistant = await system.addHomeAssistant();

  try {
    await page.goto(homeAssistant.ingressUrl);
    const quickEntry = page.getByRole("combobox", { name: "Add item" });
    for (const entry of ["2 Milk 1L", "Bread", "Cheese"]) {
      await quickEntry.fill(entry);
      await quickEntry.press("Enter");
    }

    await page.getByRole("checkbox", { name: "Complete Milk" }).click();
    await page.getByRole("checkbox", { name: "Complete Bread" }).click();

    const completed = page.getByRole("region", { name: "Completed" });
    await expect(completed.getByRole("listitem")).toHaveCount(2);
    await expect(completed.getByRole("listitem").nth(0)).toContainText("Bread");
    await expect(completed.getByRole("listitem").nth(1)).toContainText("Milk");
    await expect(completed.getByRole("listitem").nth(1)).toContainText("2 × 1 L");

    await page.getByRole("checkbox", { name: "Restore Milk" }).click();
    await expect(page.locator(".product-group h2")).toHaveText(["Milk", "Cheese"]);

    await system.restart();
    homeAssistant = await system.addHomeAssistant();
    await page.goto(homeAssistant.ingressUrl);
    await expect(page.getByRole("group", { name: "Milk" })).toContainText("2 × 1 L");
    await expect(page.getByRole("region", { name: "Completed" })).toContainText("Bread");
  } finally {
    await system.close();
  }
});

test("clears completed rows into purchased supply and broadcasts Undo", async ({ browser }) => {
  const system = await startHandlelisteTestSystem();
  const fridaHomeAssistant = await system.addHomeAssistant({ user: FRIDA });
  const olaHomeAssistant = await system.addHomeAssistant({ user: OLA });
  const fridaContext = await browser.newContext();
  const olaContext = await browser.newContext();
  const fridaPage = await fridaContext.newPage();
  const olaPage = await olaContext.newPage();

  try {
    await Promise.all([
      fridaPage.goto(fridaHomeAssistant.ingressUrl),
      olaPage.goto(olaHomeAssistant.ingressUrl),
    ]);
    const quickEntry = fridaPage.getByRole("combobox", { name: "Add item" });
    for (const entry of ["Milk", "Bread"]) {
      await quickEntry.fill(entry);
      await quickEntry.press("Enter");
      await fridaPage.getByRole("checkbox", { name: `Complete ${entry}` }).click();
    }
    await expect(olaPage.getByRole("region", { name: "Completed" }).getByRole("listitem")).toHaveCount(2);

    await fridaPage.getByRole("button", { name: "Clear completed" }).click();
    await expect(olaPage.getByRole("region", { name: "Completed" })).toHaveCount(0);

    const database = new DatabaseSync(system.databasePath, { readOnly: true });
    const purchasedSupply = database.prepare(`
      SELECT COUNT(*) AS count FROM shopping_items WHERE state = 'cleared'
    `).get();
    database.close();
    expect(purchasedSupply).toEqual({ count: 2 });

    await olaPage.reload();
    await expect(olaPage.getByRole("region", { name: "Completed" })).toHaveCount(0);
    await fridaPage.getByRole("status").getByRole("button", { name: "Undo" }).click();
    await expect(olaPage.getByRole("region", { name: "Completed" }).getByRole("listitem")).toHaveCount(2);

    await fridaContext.close();
    await olaContext.close();
    await system.restart();
    const restartedHomeAssistant = await system.addHomeAssistant();
    const restartedContext = await browser.newContext();
    const restartedPage = await restartedContext.newPage();
    await restartedPage.goto(restartedHomeAssistant.ingressUrl);
    await expect(restartedPage.getByRole("region", { name: "Completed" }).getByRole("listitem")).toHaveCount(2);
    await restartedContext.close();
  } finally {
    await fridaContext.close().catch(() => undefined);
    await olaContext.close().catch(() => undefined);
    await system.close();
  }
});

test("warns before a new Shopping Trip and resets trip state for every client", async ({ browser }) => {
  const system = await startHandlelisteTestSystem();
  const fridaHomeAssistant = await system.addHomeAssistant({ user: FRIDA });
  const olaHomeAssistant = await system.addHomeAssistant({ user: OLA });
  const fridaContext = await browser.newContext();
  const olaContext = await browser.newContext();
  const fridaPage = await fridaContext.newPage();
  const olaPage = await olaContext.newPage();

  try {
    await Promise.all([
      fridaPage.goto(fridaHomeAssistant.ingressUrl),
      olaPage.goto(olaHomeAssistant.ingressUrl),
    ]);
    const quickEntry = fridaPage.getByRole("combobox", { name: "Add item" });
    await quickEntry.fill("Milk");
    await quickEntry.press("Enter");
    await fridaPage.getByRole("checkbox", { name: "Complete Milk" }).click();
    await fridaPage.getByRole("button", { name: "Clear completed" }).click();
    await quickEntry.fill("Bread");
    await quickEntry.press("Enter");

    fridaPage.once("dialog", (dialog) => dialog.dismiss());
    await fridaPage.getByRole("button", { name: "New shopping trip" }).click();
    await expect(fridaPage.getByRole("group", { name: "Bread" })).toBeVisible();

    fridaPage.once("dialog", (dialog) => dialog.accept());
    await fridaPage.getByRole("button", { name: "New shopping trip" }).click();
    await expect(fridaPage.getByRole("heading", { name: "Your shopping list is ready" })).toBeVisible();
    await expect(olaPage.getByRole("heading", { name: "Your shopping list is ready" })).toBeVisible();

    const database = new DatabaseSync(system.databasePath, { readOnly: true });
    const tripRows = database.prepare("SELECT COUNT(*) AS count FROM shopping_items").get();
    const products = database.prepare("SELECT COUNT(*) AS count FROM products").get();
    database.close();
    expect(tripRows).toEqual({ count: 0 });
    expect(products).toEqual({ count: 2 });

    await quickEntry.fill("Mi");
    await expect(fridaPage.getByRole("option", { name: "Milk", exact: true })).toBeVisible();
  } finally {
    await fridaContext.close();
    await olaContext.close();
    await system.close();
  }
});

