import { parseShoppingListSnapshot } from "../../src/domain/shopping-list.js";
import { expect, test } from "@playwright/test";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  FRIDA,
  OLA,
  startHandlelisteTestSystem,
} from "../support/handleliste-test-system.js";

test("manages recipes and previews combined requirements with supported conversions", async ({ page }) => {
  const system = await startHandlelisteTestSystem();
  const homeAssistant = await system.addHomeAssistant();

  try {
    await page.goto(homeAssistant.ingressUrl);
    const quickEntry = page.getByRole("combobox", { name: "Add item" });
    for (const entry of ["Flour 1kg", "Milk 1L", "Eggs 12 piece"]) {
      await quickEntry.fill(entry);
      await quickEntry.press("Enter");
    }

    const manageRecipes = page.getByRole("button", { name: "Manage Recipes" });
    await manageRecipes.click();
    const manager = page.getByRole("dialog", { name: "Manage Recipes" });
    await expect(manager.evaluate((dialog: HTMLDialogElement) => dialog.matches(":modal"))).resolves.toBe(true);
    await page.keyboard.press("Escape");
    await expect(manager).not.toBeVisible();
    await expect(manageRecipes).toBeFocused();
    await manageRecipes.click();
    await manager.getByRole("button", { name: "Add recipe" }).click();
    await manager.getByRole("textbox", { name: "Recipe name" }).fill("Pancakes");
    await manager.getByRole("textbox", { name: "Note" }).fill("Sunday breakfast");

    const requirements = [
      ["Flour", "500", "g"],
      ["Flour", "1", "kg"],
      ["Milk", "1", "dl"],
      ["Milk", "2", "tbsp"],
      ["Eggs", "2", "piece"],
      ["Eggs", "3", "piece"],
    ] as const;
    for (const [index, [product, amount, unit]] of requirements.entries()) {
      if (index > 0) await manager.getByRole("button", { name: "Add ingredient" }).click();
      const row = manager.getByRole("group", { name: `Ingredient ${index + 1}` });
      await row.getByRole("combobox", { name: "Product" }).selectOption({ label: product });
      await row.getByRole("spinbutton", { name: "Amount" }).fill(amount);
      await row.getByRole("combobox", { name: "Unit" }).selectOption(unit);
    }
    await manager.getByRole("button", { name: "Save" }).click();

    const recipes = manager.getByRole("list", { name: "Recipes" });
    await expect(recipes.getByRole("listitem")).toHaveCount(1);
    await expect(recipes).toContainText("Pancakes");
    await expect(recipes).toContainText("Sunday breakfast");
    await manager.getByRole("searchbox", { name: "Search recipes" }).fill("cake");
    await expect(recipes.getByRole("listitem")).toHaveCount(1);
    await manager.getByRole("searchbox", { name: "Search recipes" }).fill("missing");
    await expect(recipes.getByRole("listitem")).toHaveCount(0);
    await manager.getByRole("searchbox", { name: "Search recipes" }).fill("");

    await manager.getByRole("button", { name: "Preview Pancakes" }).click();
    await manager.getByRole("spinbutton", { name: "Recipe count" }).fill("2");
    const preview = manager.getByRole("region", { name: "Recipe preview" });
    await expect(preview).toContainText("Flour 3000 g");
    await expect(preview).toContainText("Milk 260 ml");
    await expect(preview).toContainText("Eggs 10 piece");

    await manager.getByRole("button", { name: "Edit recipe Pancakes" }).click();
    await manager.getByRole("textbox", { name: "Recipe name" }).fill("Weekend pancakes");
    await manager.getByRole("button", { name: "Save" }).click();
    await manager.getByRole("button", { name: "Archive Weekend pancakes" }).click();
    await expect(recipes).toContainText("Archived");
    await manager.getByRole("button", { name: "Restore Weekend pancakes" }).click();

    await manager.getByRole("button", { name: "Close" }).click();
    await page.getByRole("combobox", { name: "Language" }).selectOption("nb");
    await expect(page.getByRole("button", { name: "Administrer oppskrifter" })).toBeVisible();
  } finally {
    await system.close();
  }
});

test("rejects incompatible recipe dimensions transactionally", async ({ page }) => {
  const system = await startHandlelisteTestSystem();
  const homeAssistant = await system.addHomeAssistant();

  try {
    await page.goto(homeAssistant.ingressUrl);
    const quickEntry = page.getByRole("combobox", { name: "Add item" });
    await quickEntry.fill("Tomato 1kg");
    await quickEntry.press("Enter");
    const added = parseShoppingListSnapshot(await page.evaluate(async () => (await fetch("api/shopping-list")).json()));
    const productId = added.products[0]?.id;
    if (productId === undefined) throw new Error("Quick Entry did not create the Product");
    await page.evaluate(async (selectedProductId) => {
      await fetch("api/shopping-list/items", {
        body: JSON.stringify({ entry: "Tomato 1L", productId: selectedProductId }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    }, productId);

    const result = await page.evaluate(async (selectedProductId) => {
      const response = await fetch("api/recipes", {
        body: JSON.stringify({
          name: "Invalid soup",
          note: "Must roll back",
          requirements: [
            { amount: 100, productId: selectedProductId, unit: "g" },
            { amount: 100, productId: selectedProductId, unit: "ml" },
          ],
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body: unknown = await response.json();
      return { body, status: response.status };
    }, productId);
    expect(result.status).toBe(400);
    const errorBody = Value.Parse(Type.Object({ error: Type.String() }), result.body);
    expect(errorBody).toEqual({ error: "A Product cannot use incompatible dimensions in one Recipe" });

    const snapshot = parseShoppingListSnapshot(await page.evaluate(async () => (await fetch("api/shopping-list")).json()));
    expect(snapshot.recipes).toEqual([]);
  } finally {
    await system.close();
  }
});

test("broadcasts recipes and restores them after an App restart", async ({ browser }) => {
  const system = await startHandlelisteTestSystem();
  const fridaHomeAssistant = await system.addHomeAssistant({ user: FRIDA });
  const olaHomeAssistant = await system.addHomeAssistant({ user: OLA });
  const fridaContext = await browser.newContext();
  const olaContext = await browser.newContext();
  const fridaPage = await fridaContext.newPage();
  const olaPage = await olaContext.newPage();

  try {
    await Promise.all([fridaPage.goto(fridaHomeAssistant.ingressUrl), olaPage.goto(olaHomeAssistant.ingressUrl)]);
    const quickEntry = fridaPage.getByRole("combobox", { name: "Add item" });
    await quickEntry.fill("Rice 1kg");
    await quickEntry.press("Enter");
    await fridaPage.getByRole("button", { name: "Manage Recipes" }).click();
    const fridaManager = fridaPage.getByRole("dialog", { name: "Manage Recipes" });
    await fridaManager.getByRole("button", { name: "Add recipe" }).click();
    await fridaManager.getByRole("textbox", { name: "Recipe name" }).fill("Rice bowl");
    const ingredient = fridaManager.getByRole("group", { name: "Ingredient 1" });
    await ingredient.getByRole("combobox", { name: "Product" }).selectOption({ label: "Rice" });
    await ingredient.getByRole("spinbutton", { name: "Amount" }).fill("250");
    await ingredient.getByRole("combobox", { name: "Unit" }).selectOption("g");
    await fridaManager.getByRole("button", { name: "Save" }).click();

    await olaPage.getByRole("button", { name: "Manage Recipes" }).click();
    await expect(olaPage.getByRole("dialog", { name: "Manage Recipes" })).toContainText("Rice bowl");

    await fridaContext.close();
    await olaContext.close();
    await system.restart();
    const restartedHomeAssistant = await system.addHomeAssistant({ user: FRIDA });
    const restartedContext = await browser.newContext();
    const restartedPage = await restartedContext.newPage();
    await restartedPage.goto(restartedHomeAssistant.ingressUrl);
    await restartedPage.getByRole("button", { name: "Manage Recipes" }).click();
    await expect(restartedPage.getByRole("dialog", { name: "Manage Recipes" })).toContainText("Rice bowl");
    await restartedContext.close();
  } finally {
    await fridaContext.close().catch(() => undefined);
    await olaContext.close().catch(() => undefined);
    await system.close();
  }
});
