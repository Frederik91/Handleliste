import { expect, test } from "@playwright/test";
import {
  FRIDA,
  startHandlelisteTestSystem,
} from "../support/handleliste-test-system.js";

test("opens through Home Assistant Ingress as the authenticated user", async ({ page }) => {
  const system = await startHandlelisteTestSystem();
  const homeAssistant = await system.addHomeAssistant();

  try {
    await page.goto(homeAssistant.ingressUrl);

    await expect(page.getByRole("heading", { name: "Handleliste" })).toBeVisible();
    await expect(page.getByText("Frida Handlekurv")).toBeVisible();
  } finally {
    await system.close();
  }
});

test("persists the Home Assistant user's language across an App restart", async ({ page }) => {
  const system = await startHandlelisteTestSystem();
  let homeAssistant = await system.addHomeAssistant({ user: FRIDA });

  try {
    await page.goto(homeAssistant.ingressUrl);
    await page.getByRole("combobox", { name: "Language" }).selectOption("nb");
    await expect(page.getByRole("heading", { name: "Handleliste" })).toBeVisible();
    await expect(page.getByText("Handlelisten din er klar")).toBeVisible();

    await system.restart();
    homeAssistant = await system.addHomeAssistant({ user: FRIDA });
    await page.goto(homeAssistant.ingressUrl);

    await expect(page.getByRole("combobox", { name: "Språk" })).toHaveValue("nb");
    await expect(page.getByText("Handlelisten din er klar")).toBeVisible();
  } finally {
    await system.close();
  }
});

test("uses the active Home Assistant theme inside the Ingress panel", async ({ page }) => {
  const system = await startHandlelisteTestSystem();
  const homeAssistant = await system.addHomeAssistant({
    theme: {
      cardBackgroundColor: "rgb(20, 30, 40)",
      primaryBackgroundColor: "rgb(12, 24, 36)",
      primaryColor: "rgb(18, 52, 86)",
      primaryTextColor: "rgb(238, 240, 242)",
      textPrimaryColor: "rgb(255, 255, 255)",
    },
    user: FRIDA,
  });

  try {
    await page.goto(homeAssistant.panelUrl);
    const panel = page.frameLocator('iframe[title="Handleliste"]');

    await expect(panel.locator(".top-bar")).toHaveCSS("background-color", "rgb(18, 52, 86)");
    await expect(panel.locator(".app-shell")).toHaveCSS("background-color", "rgb(12, 24, 36)");
    const quickEntry = panel.getByRole("textbox", { name: "Add item" });
    await quickEntry.fill("Bread");
    await quickEntry.press("Enter");
    await expect(panel.locator(".shopping-item")).toHaveCSS("background-color", "rgb(20, 30, 40)");
  } finally {
    await system.close();
  }
});
