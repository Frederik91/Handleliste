import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import {
  FRIDA,
  OLA,
  startHandlelisteTestSystem,
} from "../support/handleliste-test-system.js";

test("manages and runs the Always in Stock checklist across Shopping Trips", async ({ page }) => {
  const system = await startHandlelisteTestSystem();
  const homeAssistant = await system.addHomeAssistant();

  try {
    await page.goto(homeAssistant.ingressUrl);
    const quickEntry = page.getByRole("combobox", { name: "Add item" });
    for (const entry of ["Milk 1L", "Bread 500g"]) {
      await quickEntry.fill(entry);
      await quickEntry.press("Enter");
    }

    await page.getByRole("button", { name: "Manage Always in Stock" }).click();
    const manager = page.getByRole("dialog", { name: "Manage Always in Stock" });
    await manager.getByRole("button", { name: "Add definition" }).click();
    await manager.getByRole("combobox", { name: "Product" }).selectOption({ label: "Milk" });
    await manager.getByRole("combobox", { name: "Package Option" }).selectOption({ label: "1 L" });
    await manager.getByRole("spinbutton", { name: "Default Quantity" }).fill("2");
    await manager.getByRole("button", { name: "Save" }).click();

    await manager.getByRole("button", { name: "Add definition" }).click();
    await manager.getByRole("combobox", { name: "Product" }).selectOption({ label: "Bread" });
    await manager.getByRole("combobox", { name: "Package Option" }).selectOption({ label: "500 g" });
    await manager.getByRole("button", { name: "Save" }).click();
    const definitions = manager.getByRole("list", { name: "Always in Stock definitions" });
    await expect(definitions.getByRole("listitem")).toHaveCount(2);

    await manager.getByRole("searchbox", { name: "Search definitions" }).fill("Bread");
    await expect(definitions.getByRole("listitem")).toHaveCount(1);
    await expect(definitions).toContainText("Bread");
    await manager.getByRole("searchbox", { name: "Search definitions" }).fill("");
    await manager.getByRole("button", { name: "Move up Bread" }).click();
    await expect(definitions.getByRole("listitem").first()).toContainText("Bread");
    await definitions.getByRole("listitem").filter({ hasText: "Bread" }).getByRole("button", { name: "Edit definition" }).click();
    await manager.getByRole("spinbutton", { name: "Default Quantity" }).fill("4");
    await manager.getByRole("button", { name: "Save" }).click();
    await expect(definitions.getByRole("listitem").filter({ hasText: "Bread" })).toContainText("4 × Default Quantity");
    await manager.getByRole("button", { name: "Archive Bread" }).click();
    await expect(definitions.getByRole("listitem").filter({ hasText: "Archived" })).toContainText("Bread");
    await manager.getByRole("button", { name: "Restore Bread" }).click();
    await manager.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { exact: true, name: "Always in Stock" }).click();
    const selection = page.getByRole("dialog", { name: "Always in Stock" });
    const milkCheckbox = selection.getByRole("checkbox", { name: "Enable Milk" });
    await milkCheckbox.check();
    await expect(selection.getByRole("spinbutton", { name: "Quantity Milk" })).toHaveValue("2");
    await selection.getByRole("button", { name: "Increase Milk" }).click();
    await selection.getByRole("button", { name: "Add to Shopping List" }).click();
    await expect(page.getByRole("group", { name: "Milk" })).toContainText("4 × 1 L");
    await expect(page.getByRole("group", { name: "Bread" })).toContainText("1 × 500 g");

    await page.getByRole("button", { exact: true, name: "Always in Stock" }).click();
    await expect(selection.getByRole("checkbox", { name: "Enable Milk" })).toBeChecked();
    await expect(selection.getByRole("spinbutton", { name: "Quantity Milk" })).toHaveValue("3");
    await selection.getByRole("button", { name: "Add to Shopping List" }).click();
    await expect(page.getByRole("group", { name: "Milk" }).getByRole("listitem")).toHaveCount(1);
    await expect(page.getByRole("group", { name: "Milk" })).toContainText("4 × 1 L");

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "New shopping trip" }).click();
    await expect(page.getByRole("heading", { name: "Your shopping list is ready" })).toBeVisible();
    await page.getByRole("button", { exact: true, name: "Always in Stock" }).click();
    await expect(selection.getByRole("checkbox", { name: "Enable Milk" })).not.toBeChecked();
    await selection.getByRole("checkbox", { name: "Enable Milk" }).check();
    await expect(selection.getByRole("spinbutton", { name: "Quantity Milk" })).toHaveValue("2");
    await selection.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("button", { name: "Manage Always in Stock" }).click();
    await expect(page.getByRole("dialog", { name: "Manage Always in Stock" }).getByRole("listitem")).toHaveCount(2);
  } finally {
    await system.close();
  }
});

test("broadcasts Always in Stock changes and restores them after an App restart", async ({ browser }) => {
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
    await quickEntry.fill("Milk 1L");
    await quickEntry.press("Enter");
    await expect(olaPage.getByRole("group", { name: "Milk" })).toContainText("1 × 1 L");

    await fridaPage.getByRole("button", { name: "Manage Always in Stock" }).click();
    await olaPage.getByRole("button", { name: "Manage Always in Stock" }).click();
    const fridaManager = fridaPage.getByRole("dialog", { name: "Manage Always in Stock" });
    const olaManager = olaPage.getByRole("dialog", { name: "Manage Always in Stock" });
    await fridaManager.getByRole("button", { name: "Add definition" }).click();
    await fridaManager.getByRole("combobox", { name: "Product" }).selectOption({ label: "Milk" });
    await fridaManager.getByRole("combobox", { name: "Package Option" }).selectOption({ label: "1 L" });
    await fridaManager.getByRole("spinbutton", { name: "Default Quantity" }).fill("2");
    await fridaManager.getByRole("button", { name: "Save" }).click();
    await expect(olaManager.getByRole("listitem")).toHaveCount(1);

    await fridaManager.getByRole("button", { name: "Close" }).click();
    await fridaPage.getByRole("button", { exact: true, name: "Always in Stock" }).click();
    const fridaSelection = fridaPage.getByRole("dialog", { name: "Always in Stock" });
    await fridaSelection.getByRole("checkbox", { name: "Enable Milk" }).check();
    await fridaSelection.getByRole("button", { name: "Add to Shopping List" }).click();
    await expect(olaPage.getByRole("group", { name: "Milk" })).toContainText("3 × 1 L");

    await fridaContext.close();
    await olaContext.close();
    await system.restart();
    const restartedHomeAssistant = await system.addHomeAssistant({ user: FRIDA });
    const restartedContext = await browser.newContext();
    const restartedPage = await restartedContext.newPage();
    await restartedPage.goto(restartedHomeAssistant.ingressUrl);
    await restartedPage.getByRole("button", { exact: true, name: "Always in Stock" }).click();
    const restartedSelection = restartedPage.getByRole("dialog", { name: "Always in Stock" });
    await expect(restartedSelection.getByRole("checkbox", { name: "Enable Milk" })).toBeChecked();
    await expect(restartedSelection.getByRole("spinbutton", { name: "Quantity Milk" })).toHaveValue("2");
    await restartedContext.close();
  } finally {
    await fridaContext.close().catch(() => undefined);
    await olaContext.close().catch(() => undefined);
    await system.close();
  }
});


