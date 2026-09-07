import { expect, test, type Page } from "@playwright/test";
import { startHandlelisteTestSystem, OLA } from "../support/handleliste-test-system.js";

async function add(page: Page, entry: string) {
  const input = page.getByRole("combobox", { name: "Add item" });
  await input.fill(entry);
  await input.press("Enter");
  await expect(input).toHaveValue("");
}
async function recipe(page: Page, name: string, product: string, amount: string, unit: string) {
  await page.getByRole("button", { name: "Manage Recipes" }).click();
  const dialog = page.getByRole("dialog", { name: "Manage Recipes" });
  await dialog.getByRole("button", { name: "Add recipe" }).click();
  await dialog.getByRole("textbox", { name: "Recipe name" }).fill(name);
  await dialog.getByRole("combobox", { name: "Product" }).selectOption({ label: product });
  await dialog.getByRole("spinbutton", { name: "Amount" }).fill(amount);
  await dialog.getByRole("combobox", { name: "Unit" }).selectOption(unit);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("list", { name: "Recipes" })).toContainText(name);
  await dialog.getByRole("button", { name: "Close" }).click();
}
async function select(page: Page, name: string, count = "1") {
  await page.getByRole("button", { name: "Plan from Recipes" }).click();
  const dialog = page.getByRole("dialog", { name: "Plan from Recipes" });
  await dialog.getByRole("checkbox", { name: `Select ${name}` }).check();
  await dialog.getByRole("spinbutton", { name: `Recipe count ${name}` }).fill(count);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test("plans whole default packages from combined Recipe counts and shows their sources", async ({ page }) => {
  const system = await startHandlelisteTestSystem();
  try {
    const ha = await system.addHomeAssistant();
    await page.goto(ha.ingressUrl);
    await add(page, "Milk 1L");
    await recipe(page, "Breakfast", "Milk", "3", "dl");
    await recipe(page, "Pudding", "Milk", "750", "ml");
    const planButton = page.getByRole("button", { name: "Plan from Recipes" });
    await planButton.click();
    const planDialog = page.getByRole("dialog", { name: "Plan from Recipes" });
    await expect(planDialog.evaluate((dialog: HTMLDialogElement) => dialog.matches(":modal"))).resolves.toBe(true);
    await page.keyboard.press("Escape");
    await expect(planDialog).not.toBeVisible();
    await expect(planButton).toBeFocused();
    await select(page, "Breakfast", "2");
    await select(page, "Pudding");
    const milk = page.getByRole("group", { name: "Milk", exact: true });
    await expect(milk).toContainText("2 × 1 L");
    await expect(milk).toContainText("Recipes need 1350 ml");
    await expect(milk).toContainText("Outside recipes 650 ml");
    await expect(milk).toContainText("Baseline 1");
    await expect(milk).toContainText("Recipes 1");
    await milk.getByText("Recipe breakdown", { exact: true }).click();
    await expect(milk).toContainText("Breakfast × 2: 600 ml");
    await expect(milk).toContainText("Pudding × 1: 750 ml");
    await expect(page.getByRole("region", { name: "Selected Recipes" })).toContainText("Breakfast × 2");
    await page.reload();
    await expect(milk).toContainText("Recipes need 1350 ml");
  } finally { await system.close(); }
});

test("keeps Recipe provenance when restoring completed baseline packages into generated packages", async ({ page }) => {
  const system = await startHandlelisteTestSystem();
  try {
    const ha = await system.addHomeAssistant();
    await page.goto(ha.ingressUrl);
    await add(page, "Milk 1L");
    await recipe(page, "Custard", "Milk", "1250", "ml");
    await page.getByRole("checkbox", { name: "Complete Milk" }).click();
    await select(page, "Custard", "2");
    await expect(page.getByRole("group", { name: "Milk", exact: true })).toContainText("2 × 1 L");
    await page.getByRole("checkbox", { name: "Restore Milk" }).click();
    await select(page, "Custard", "1");
    const milk = page.getByRole("group", { name: "Milk", exact: true });
    await expect(milk).toContainText("2 × 1 L");
    await expect(milk).toContainText("Baseline 1");
    await expect(milk).toContainText("Recipes 1");
    await expect(milk).toContainText("Outside recipes 750 ml");
  } finally { await system.close(); }
});


test("retains cleared Recipe purchases, shares count changes live, and persists an empty baseline across restart", async ({ page, browser }) => {
  const system = await startHandlelisteTestSystem();
  const otherContext = await browser.newContext();
  try {
    const ha = await system.addHomeAssistant();
    const otherHa = await system.addHomeAssistant({ user: OLA });
    const other = await otherContext.newPage();
    await page.goto(ha.ingressUrl);
    await add(page, "Milk 1L");
    await recipe(page, "Porridge", "Milk", "750", "ml");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "New shopping trip" }).click();
    await expect(page.getByRole("heading", { name: "Your shopping list is ready" })).toBeVisible();
    await other.goto(otherHa.ingressUrl);
    await select(page, "Porridge");
    await expect(other.getByRole("group", { name: "Milk", exact: true })).toContainText("1 × 1 L");
    await page.getByRole("checkbox", { name: "Complete Milk" }).click();
    await page.getByRole("button", { name: "Clear completed", exact: true }).click();
    await select(page, "Porridge", "2");
    const milk = page.getByRole("group", { name: "Milk", exact: true });
    await expect(milk).toContainText("1 × 1 L");
    await expect(milk).toContainText("Outside recipes 500 ml");
    await select(page, "Porridge", "1");
    await expect(page.getByRole("checkbox", { name: "Complete Milk" })).toHaveCount(0);
    await expect(milk).toContainText("Outside recipes 250 ml");
    await milk.getByText("Recipe breakdown", { exact: true }).click();
    await expect(milk).toContainText("Cleared Purchased Supply: 1000 ml");
    await expect(milk).toContainText("Baseline: 0 ml");
    await expect(other.getByRole("region", { name: "Selected Recipes" })).toContainText("Porridge × 1");
    await system.restart();
    const restarted = await system.addHomeAssistant();
    await page.goto(restarted.ingressUrl);
    await expect(milk).toContainText("Outside recipes 250 ml");
    await select(page, "Porridge", "2");
    await expect(milk).toContainText("1 × 1 L");
    await milk.getByText("Recipe breakdown", { exact: true }).click();
    await expect(milk).toContainText("Baseline: 0 ml");
  } finally { await otherContext.close(); await system.close(); }
});

test("captures manual, Always in Stock, completed and cleared capacity once, and explains later missing supply", async ({ page }) => {
  const system = await startHandlelisteTestSystem();
  try {
    const ha = await system.addHomeAssistant();
    await page.goto(ha.ingressUrl);
    await add(page, "Flour 500g");
    await page.getByRole("button", { name: "Manage Always in Stock" }).click();
    const manager = page.getByRole("dialog", { name: "Manage Always in Stock" });
    await manager.getByRole("button", { name: "Add definition" }).click();
    await manager.getByRole("spinbutton", { name: "Default Quantity" }).fill("2");
    await manager.getByRole("button", { name: "Save", exact: true }).click();
    await manager.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Always in Stock", exact: true }).click();
    const checklist = page.getByRole("dialog", { name: "Always in Stock", exact: true });
    await checklist.getByRole("checkbox", { name: "Enable Flour" }).check();
    await checklist.getByRole("button", { name: "Add to Shopping List" }).click();
    await add(page, "Flour 250g");
    await page.getByRole("group", { name: "Flour", exact: true }).getByRole("listitem").filter({ hasText: "250 g" }).getByRole("checkbox").click();
    await page.getByRole("button", { name: "Clear completed", exact: true }).click();
    await add(page, "Flour 250g");
    await page.getByRole("group", { name: "Flour", exact: true }).getByRole("listitem").filter({ hasText: "250 g" }).getByRole("checkbox").click();
    await recipe(page, "Bread", "Flour", "2400", "g");
    await select(page, "Bread");
    const flour = page.getByRole("group", { name: "Flour", exact: true });
    await expect(flour).toContainText("4 × 500 g");
    await expect(flour).toContainText("Outside recipes 100 g");
    await flour.getByText("Recipe breakdown", { exact: true }).click();
    await expect(flour).toContainText("Baseline: 2000 g");
    await expect(flour).toContainText("Cleared Purchased Supply: 250 g");
    await flour.getByRole("button", { name: "Edit", exact: true }).click();
    await flour.getByRole("spinbutton", { name: "Quantity", exact: true }).fill("1");
    await flour.getByRole("button", { name: "Save", exact: true }).click();
    await expect(flour).toContainText("Missing for recipes 1400 g");
    await expect(flour).toContainText("1 × 500 g");
    await page.reload();
    await expect(flour).toContainText("Missing for recipes 1400 g");
  } finally { await system.close(); }
});

test("keeps later household additions extra and validates whole-number counts before resetting a trip", async ({ page }) => {
  const system = await startHandlelisteTestSystem();
  try {
    const ha = await system.addHomeAssistant();
    await page.goto(ha.ingressUrl);
    await add(page, "Milk 1L");
    await recipe(page, "Custard", "Milk", "1250", "ml");
    await select(page, "Custard", "2");
    await add(page, "Milk");
    const milk = page.getByRole("group", { name: "Milk", exact: true });
    await expect(milk).toContainText("4 × 1 L");
    await expect(milk).toContainText("Recipes 2");
    await select(page, "Custard", "1");
    await expect(milk).toContainText("3 × 1 L");
    await expect(milk).toContainText("Outside recipes 1750 ml");
    await page.getByRole("button", { name: "Plan from Recipes" }).click();
    const dialog = page.getByRole("dialog", { name: "Plan from Recipes" });
    for (const invalid of ["0", "1.5"]) {
      await dialog.getByRole("spinbutton", { name: "Recipe count Custard" }).fill(invalid);
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(dialog).toBeVisible();
      await expect(page.getByRole("region", { name: "Selected Recipes", includeHidden: true })).toContainText("Custard × 1");
    }
    await dialog.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Plan from Recipes" }).click();
    await dialog.getByRole("checkbox", { name: "Select Custard" }).uncheck();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(milk).toContainText("2 × 1 L");
    await add(page, "Milk");
    await select(page, "Custard", "2");
    await expect(milk).toContainText("5 × 1 L");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "New shopping trip" }).click();
    await expect(page.getByRole("region", { name: "Selected Recipes" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Your shopping list is ready" })).toBeVisible();
    await select(page, "Custard");
    await expect(milk).toContainText("2 × 1 L");
    await milk.getByText("Recipe breakdown", { exact: true }).click();
    await expect(milk).toContainText("Baseline: 0 ml");
  } finally { await system.close(); }
});

test("keeps measured baseline fixed after editing the package size", async ({ page }) => {
  const system = await startHandlelisteTestSystem();
  try {
    const ha = await system.addHomeAssistant();
    await page.goto(ha.ingressUrl);
    await add(page, "Milk 1L");
    await recipe(page, "Custard", "Milk", "1250", "ml");
    await select(page, "Custard");
    const milk = page.getByRole("group", { name: "Milk", exact: true });
    await milk.getByRole("button", { name: "Edit", exact: true }).click();
    await milk.getByRole("spinbutton", { name: "Package size" }).fill("2");
    await milk.getByRole("button", { name: "Save", exact: true }).click();
    await select(page, "Custard", "3");
    await expect(milk).toContainText("3 × 2 L");
    await milk.getByText("Recipe breakdown", { exact: true }).click();
    await expect(milk).toContainText("Baseline: 1000 ml");
    await expect(milk).toContainText("Outside recipes 2250 ml");
  } finally { await system.close(); }
});

test("retains generated source when changing to another existing Package Option", async ({ page }) => {
  const system = await startHandlelisteTestSystem();
  try {
    const ha = await system.addHomeAssistant();
    await page.goto(ha.ingressUrl);
    await add(page, "Milk 1L");
    await add(page, "Milk 2L");
    await recipe(page, "Custard", "Milk", "1500", "ml");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "New shopping trip" }).click();
    await select(page, "Custard", "2");
    const milk = page.getByRole("group", { name: "Milk", exact: true });
    await expect(milk).toContainText("3 × 1 L");
    await milk.getByRole("button", { name: "Edit", exact: true }).click();
    await milk.getByRole("spinbutton", { name: "Package size" }).fill("2");
    await milk.getByRole("button", { name: "Save", exact: true }).click();
    await select(page, "Custard", "1");
    await expect(milk).toContainText("1 × 2 L");
    await expect(milk).toContainText("Recipes 1");
    await expect(milk.getByRole("listitem")).toHaveCount(1);
  } finally { await system.close(); }
});
