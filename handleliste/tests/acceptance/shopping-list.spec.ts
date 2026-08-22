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
    const quickEntry = page.getByRole("combobox", { name: "Add item" });

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

test("parses package counts and sizes while keeping different Package Options distinct", async ({ page }) => {
  const system = await startHandlelisteTestSystem();
  const homeAssistant = await system.addHomeAssistant();

  try {
    await page.goto(homeAssistant.ingressUrl);
    const quickEntry = page.getByRole("combobox", { name: "Add item" });

    await quickEntry.fill("Milk 1L");
    await quickEntry.press("Enter");
    await quickEntry.fill("2x Milk 1.75L");
    await quickEntry.press("Enter");
    await quickEntry.fill("2 Milk 1L");
    await quickEntry.press("Enter");

    const milkGroup = page.getByRole("group", { name: "Milk" });
    await expect(milkGroup.getByRole("listitem")).toHaveCount(2);
    await expect(milkGroup).toContainText("3 × 1 L");
    await expect(milkGroup).toContainText("2 × 1.75 L");
  } finally {
    await system.close();
  }
});

test("uses deterministic V1 units and preserves uncertain input as the Product name", async ({ page }) => {
  const system = await startHandlelisteTestSystem();
  const homeAssistant = await system.addHomeAssistant();

  try {
    await page.goto(homeAssistant.ingressUrl);
    const quickEntry = page.getByRole("combobox", { name: "Add item" });
    for (const entry of [
      "Flour 1kg",
      "Oil 250 ml",
      "Juice 2cl",
      "Cream 3dl",
      "Spice 2 tsp",
      "Salt 1 tbsp",
      "Eggs 6 pieces",
      "Soda 12oz",
    ]) {
      await quickEntry.fill(entry);
      await quickEntry.press("Enter");
    }

    await expect(page.getByRole("group", { name: "Flour" })).toContainText("1 × 1 kg");
    await expect(page.getByRole("group", { name: "Oil" })).toContainText("1 × 250 ml");
    await expect(page.getByRole("group", { name: "Juice" })).toContainText("1 × 2 cl");
    await expect(page.getByRole("group", { name: "Cream" })).toContainText("1 × 3 dl");
    await expect(page.getByRole("group", { name: "Spice" })).toContainText("1 × 2 tsp");
    await expect(page.getByRole("group", { name: "Salt" })).toContainText("1 × 1 tbsp");
    await expect(page.getByRole("group", { name: "Eggs" })).toContainText("1 × 6 piece");
    await expect(page.getByRole("group", { name: "Soda 12oz" })).toContainText("1 × 1 unit");
  } finally {
    await system.close();
  }
});

test("keeps the first explicit Package Option as the default for later bare entries", async ({ page }) => {
  const system = await startHandlelisteTestSystem();
  const homeAssistant = await system.addHomeAssistant();

  try {
    await page.goto(homeAssistant.ingressUrl);
    const quickEntry = page.getByRole("combobox", { name: "Add item" });
    for (const entry of ["Milk 1L", "Milk 1.75L", "milk"]) {
      await quickEntry.fill(entry);
      await quickEntry.press("Enter");
    }

    const milkGroup = page.getByRole("group", { name: "Milk" });
    await expect(milkGroup).toContainText("2 × 1 L");
    await expect(milkGroup).toContainText("1 × 1.75 L");
  } finally {
    await system.close();
  }
});

test("does not replace an existing Product's unused default when a new size is entered", async ({ page }) => {
  const system = await startHandlelisteTestSystem();
  const homeAssistant = await system.addHomeAssistant();

  try {
    await page.goto(homeAssistant.ingressUrl);
    const quickEntry = page.getByRole("combobox", { name: "Add item" });
    for (const entry of ["Milk", "Bread"]) {
      await quickEntry.fill(entry);
      await quickEntry.press("Enter");
    }

    const milkRow = page.getByRole("group", { name: "Milk" }).getByRole("listitem");
    await milkRow.getByRole("button", { name: "Edit" }).click();
    await milkRow.getByRole("combobox", { name: "Product" }).fill("Bread");
    await milkRow.getByRole("button", { name: "Save" }).click();

    for (const entry of ["Milk 1L", "Milk"]) {
      await quickEntry.fill(entry);
      await quickEntry.press("Enter");
    }
    const milkGroup = page.getByRole("group", { name: "Milk" });
    await expect(milkGroup).toContainText("1 × 1 L");
    await expect(milkGroup).toContainText("1 × 1 unit");
  } finally {
    await system.close();
  }
});

test("lets the household explicitly reuse a Product through autocomplete without fuzzy merging", async ({ page }) => {
  const system = await startHandlelisteTestSystem();
  const homeAssistant = await system.addHomeAssistant();

  try {
    await page.goto(homeAssistant.ingressUrl);
    const quickEntry = page.getByRole("combobox", { name: "Add item" });
    await quickEntry.fill("Milk 1L");
    await quickEntry.press("Enter");

    await quickEntry.fill("mi");
    await page.getByRole("option", { name: "Milk" }).click();
    await quickEntry.press("Enter");
    await expect(page.getByRole("group", { name: "Milk" })).toContainText("2 × 1 L");

    await quickEntry.fill("Mil");
    await quickEntry.press("Enter");
    await expect(page.getByRole("group", { name: "Mil", exact: true })).toContainText("1 × 1 unit");
  } finally {
    await system.close();
  }
});

test("edits Product, Package Option, and Quantity from a Shopping Item row", async ({ page }) => {
  const system = await startHandlelisteTestSystem();
  const homeAssistant = await system.addHomeAssistant();

  try {
    await page.goto(homeAssistant.ingressUrl);
    const quickEntry = page.getByRole("combobox", { name: "Add item" });
    for (const entry of ["Milk 1L", "Bread 500g"]) {
      await quickEntry.fill(entry);
      await quickEntry.press("Enter");
    }

    const milkRow = page.getByRole("group", { name: "Milk" }).getByRole("listitem");
    await milkRow.getByRole("button", { name: "Edit" }).click();
    await milkRow.getByRole("combobox", { name: "Product" }).fill("Bread");
    await milkRow.getByRole("spinbutton", { name: "Package size" }).fill("500");
    await milkRow.getByRole("combobox", { name: "Unit" }).selectOption("g");
    await milkRow.getByRole("spinbutton", { name: "Quantity" }).fill("2");
    await milkRow.getByRole("button", { name: "Save" }).click();

    await expect(page.getByRole("group", { name: "Milk" })).toHaveCount(0);
    const breadGroup = page.getByRole("group", { name: "Bread" });
    await expect(breadGroup.getByRole("listitem")).toHaveCount(1);
    await expect(breadGroup).toContainText("3 × 500 g");
  } finally {
    await system.close();
  }
});

test("corrects a newly parsed Product name and Package Option from its row", async ({ page }) => {
  const system = await startHandlelisteTestSystem();
  const homeAssistant = await system.addHomeAssistant();

  try {
    await page.goto(homeAssistant.ingressUrl);
    const quickEntry = page.getByRole("combobox", { name: "Add item" });
    await quickEntry.fill("Vitamin B 12 g");
    await quickEntry.press("Enter");

    const parsedRow = page.getByRole("group", { name: "Vitamin B" }).getByRole("listitem");
    await parsedRow.getByRole("button", { name: "Edit" }).click();
    await parsedRow.getByRole("combobox", { name: "Product" }).fill("Vitamin B 12 g");
    await parsedRow.getByRole("spinbutton", { name: "Package size" }).fill("1");
    await parsedRow.getByRole("combobox", { name: "Unit" }).selectOption("unit");
    await parsedRow.getByRole("button", { name: "Save" }).click();

    await expect(page.getByRole("group", { exact: true, name: "Vitamin B" })).toHaveCount(0);
    await expect(page.getByRole("group", { exact: true, name: "Vitamin B 12 g" })).toContainText("1 × 1 unit");
    await quickEntry.fill("Vitamin");
    await expect(page.getByRole("option", { exact: true, name: "Vitamin B" })).toHaveCount(0);
    await expect(page.getByRole("option", { name: "Vitamin B 12 g" })).toBeVisible();

    await quickEntry.fill("Cheese 300g");
    await quickEntry.press("Enter");
    const cheeseRow = page.getByRole("group", { name: "Cheese" }).getByRole("listitem");
    await cheeseRow.getByRole("button", { name: "Edit" }).click();
    await cheeseRow.getByRole("spinbutton", { name: "Package size" }).fill("350");
    await cheeseRow.getByRole("button", { name: "Save" }).click();
    await quickEntry.fill("Cheese");
    await quickEntry.press("Enter");
    await expect(page.getByRole("group", { name: "Cheese" })).toContainText("2 × 350 g");
  } finally {
    await system.close();
  }
});

test("undoes a Quick Entry and restores its prior Shopping List and catalog state", async ({ page }) => {
  const system = await startHandlelisteTestSystem();
  const homeAssistant = await system.addHomeAssistant();

  try {
    await page.goto(homeAssistant.ingressUrl);
    const quickEntry = page.getByRole("combobox", { name: "Add item" });
    await quickEntry.fill("Chorizo 300g");
    await quickEntry.press("Enter");
    await expect(page.getByRole("group", { name: "Chorizo" })).toContainText("1 × 300 g");

    const notification = page.getByRole("status");
    await expect(notification).toContainText("Item added");
    await notification.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("group", { name: "Chorizo" })).toHaveCount(0);

    await quickEntry.fill("Chorizo");
    await quickEntry.press("Enter");
    await expect(page.getByRole("group", { name: "Chorizo" })).toContainText("1 × 1 unit");
  } finally {
    await system.close();
  }
});

test("persists structured entries and broadcasts row corrections and Undo", async ({ browser }) => {
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
    await quickEntry.fill("2 Milk 1L");
    await quickEntry.press("Enter");
    await expect(olaPage.getByRole("group", { name: "Milk" })).toContainText("2 × 1 L");

    const olaMilkRow = olaPage.getByRole("group", { name: "Milk" }).getByRole("listitem");
    await olaMilkRow.getByRole("button", { name: "Edit" }).click();
    await olaMilkRow.getByRole("spinbutton", { name: "Quantity" }).fill("4");
    await olaMilkRow.getByRole("button", { name: "Save" }).click();
    await expect(fridaPage.getByRole("group", { name: "Milk" })).toContainText("4 × 1 L");

    await quickEntry.fill("Chorizo 300g");
    await quickEntry.press("Enter");
    await expect(olaPage.getByRole("group", { name: "Chorizo" })).toContainText("1 × 300 g");
    await fridaPage.getByRole("status").getByRole("button", { name: "Undo" }).click();
    await expect(olaPage.getByRole("group", { name: "Chorizo" })).toHaveCount(0);

    await fridaContext.close();
    await olaContext.close();
    await system.restart();
    const restartedHomeAssistant = await system.addHomeAssistant({ user: FRIDA });
    const restartedContext = await browser.newContext();
    const restartedPage = await restartedContext.newPage();
    await restartedPage.goto(restartedHomeAssistant.ingressUrl);
    await expect(restartedPage.getByRole("group", { name: "Milk" })).toContainText("4 × 1 L");
    await restartedContext.close();
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
    const fridaEntry = fridaPage.getByRole("combobox", { name: "Add item" });
    const olaEntry = olaPage.getByRole("combobox", { name: "Add item" });

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
    const quickEntry = page.getByRole("combobox", { name: "Add item" });
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
    const delayedEntry = delayedPage.getByRole("combobox", { name: "Add item" });

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
