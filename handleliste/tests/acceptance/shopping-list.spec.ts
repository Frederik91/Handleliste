import { expect, test } from "@playwright/test";
import {
  FRIDA,
  OLA,
  startHandlelisteTestSystem,
} from "../support/handleliste-test-system.js";

test("adds a bare Quick Entry immediately and increments its implicit 1 unit option", async ({ page }) => {
  const system = await startHandlelisteTestSystem();
  const homeAssistant = await system.addHomeAssistant();

  try {
    await page.goto(homeAssistant.ingressUrl);
    const quickEntry = page.getByRole("textbox", { name: "Add item" });

    await quickEntry.fill("Bread");
    await quickEntry.press("Enter");
    await expect(page.getByRole("listitem")).toContainText("Bread");
    await expect(page.getByRole("listitem")).toContainText("1 × 1 unit");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await quickEntry.fill("  bread  ");
    await quickEntry.press("Enter");
    await expect(page.getByRole("listitem")).toHaveCount(1);
    await expect(page.getByRole("listitem")).toContainText("2 × 1 unit");

    await page.getByRole("combobox", { name: "Language" }).selectOption("nb");
    await expect(page.getByRole("listitem")).toContainText("2 × 1 enhet");
  } finally {
    await system.close();
  }
});

test("keeps authenticated household sessions synchronized without losing concurrent increments", async ({ browser }) => {
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
    const fridaEntry = fridaPage.getByRole("textbox", { name: "Add item" });
    const olaEntry = olaPage.getByRole("textbox", { name: "Add item" });

    await fridaEntry.fill("Milk");
    await fridaEntry.press("Enter");
    await expect(olaPage.getByRole("listitem")).toContainText("1 × 1 unit");

    await fridaEntry.fill("milk");
    await olaEntry.fill("MILK");
    await Promise.all([fridaEntry.press("Enter"), olaEntry.press("Enter")]);

    await expect(fridaPage.getByRole("listitem")).toContainText("3 × 1 unit");
    await expect(olaPage.getByRole("listitem")).toContainText("3 × 1 unit");
  } finally {
    await fridaContext.close();
    await olaContext.close();
    await system.close();
  }
});

test("restores the shared Shopping List after an App restart", async ({ page }) => {
  const system = await startHandlelisteTestSystem();
  let homeAssistant = await system.addHomeAssistant({ user: FRIDA });

  try {
    await page.goto(homeAssistant.ingressUrl);
    const quickEntry = page.getByRole("textbox", { name: "Add item" });
    await quickEntry.fill("Oats");
    await quickEntry.press("Enter");
    await expect(page.getByRole("listitem")).toContainText("Oats");

    await page.reload();
    await expect(page.getByRole("listitem")).toContainText("Oats");

    await system.restart();
    homeAssistant = await system.addHomeAssistant({ user: OLA });
    await page.goto(homeAssistant.ingressUrl);

    await expect(page.getByRole("listitem")).toContainText("Oats");
    await expect(page.getByRole("listitem")).toContainText("1 × 1 unit");
  } finally {
    await system.close();
  }
});

test("does not let an older mutation response replace a newer Quantity", async ({ browser }) => {
  const system = await startHandlelisteTestSystem();
  const delayedHomeAssistant = await system.addHomeAssistant({
    delayFirstShoppingItemResponseMs: 500,
    user: FRIDA,
  });
  const observingHomeAssistant = await system.addHomeAssistant({ user: OLA });
  const delayedContext = await browser.newContext();
  const observingContext = await browser.newContext();
  const delayedPage = await delayedContext.newPage();
  const observingPage = await observingContext.newPage();

  try {
    await Promise.all([
      delayedPage.goto(delayedHomeAssistant.ingressUrl),
      observingPage.goto(observingHomeAssistant.ingressUrl),
    ]);
    const delayedEntry = delayedPage.getByRole("textbox", { name: "Add item" });

    await delayedEntry.fill("Milk");
    await delayedEntry.press("Enter");
    await expect(observingPage.getByRole("listitem")).toContainText("1 × 1 unit");

    await delayedEntry.fill("milk");
    await delayedEntry.press("Enter");
    await expect(observingPage.getByRole("listitem")).toContainText("2 × 1 unit");
    await expect(delayedPage.getByRole("listitem")).toContainText("2 × 1 unit");
    await delayedEntry.fill("Cheese");
    await delayedPage.waitForTimeout(600);

    await expect(delayedPage.getByRole("listitem")).toContainText("2 × 1 unit");
    await expect(delayedEntry).toHaveValue("Cheese");
  } finally {
    await delayedContext.close();
    await observingContext.close();
    await system.close();
  }
});
