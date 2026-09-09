import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
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

