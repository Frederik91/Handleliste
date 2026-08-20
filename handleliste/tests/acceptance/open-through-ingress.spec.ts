import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startHandlelisteApp } from "../../src/server/application.js";
import { startFakeHomeAssistant } from "../support/fake-home-assistant.js";

test("opens through Home Assistant Ingress as the authenticated user", async ({ page }) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "handleliste-"));
  const app = await startHandlelisteApp({
    dataDirectory,
    trustedIngressAddresses: ["127.0.0.1"],
  });
  const homeAssistant = await startFakeHomeAssistant({
    appOrigin: app.origin,
    user: {
      displayName: "Frida Handlekurv",
      id: "ha-user-1",
      name: "frida",
    },
  });

  try {
    await page.goto(homeAssistant.ingressUrl);

    await expect(page.getByRole("heading", { name: "Handleliste" })).toBeVisible();
    await expect(page.getByText("Frida Handlekurv")).toBeVisible();
  } finally {
    await homeAssistant.close();
    await app.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("persists the Home Assistant user's language across an App restart", async ({ page }) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "handleliste-"));
  let app = await startHandlelisteApp({
    dataDirectory,
    trustedIngressAddresses: ["127.0.0.1"],
  });
  let homeAssistant = await startFakeHomeAssistant({
    appOrigin: app.origin,
    user: {
      displayName: "Frida Handlekurv",
      id: "ha-user-1",
      name: "frida",
    },
  });

  try {
    await page.goto(homeAssistant.ingressUrl);
    await page.getByRole("combobox", { name: "Language" }).selectOption("nb");
    await expect(page.getByRole("heading", { name: "Handleliste" })).toBeVisible();
    await expect(page.getByText("Handlelisten din er klar")).toBeVisible();

    await homeAssistant.close();
    await app.close();

    app = await startHandlelisteApp({
      dataDirectory,
      trustedIngressAddresses: ["127.0.0.1"],
    });
    homeAssistant = await startFakeHomeAssistant({
      appOrigin: app.origin,
      user: {
        displayName: "Frida Handlekurv",
        id: "ha-user-1",
        name: "frida",
      },
    });
    await page.goto(homeAssistant.ingressUrl);

    await expect(page.getByRole("combobox", { name: "Språk" })).toHaveValue("nb");
    await expect(page.getByText("Handlelisten din er klar")).toBeVisible();
  } finally {
    await homeAssistant.close();
    await app.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("uses the active Home Assistant theme inside the Ingress panel", async ({ page }) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "handleliste-"));
  const app = await startHandlelisteApp({
    dataDirectory,
    trustedIngressAddresses: ["127.0.0.1"],
  });
  const homeAssistant = await startFakeHomeAssistant({
    appOrigin: app.origin,
    theme: {
      primaryBackgroundColor: "rgb(12, 24, 36)",
      primaryColor: "rgb(18, 52, 86)",
      primaryTextColor: "rgb(238, 240, 242)",
      textPrimaryColor: "rgb(255, 255, 255)",
    },
    user: {
      displayName: "Frida Handlekurv",
      id: "ha-user-1",
      name: "frida",
    },
  });

  try {
    await page.goto(homeAssistant.panelUrl);
    const panel = page.frameLocator('iframe[title="Handleliste"]');

    await expect(panel.locator(".top-bar")).toHaveCSS("background-color", "rgb(18, 52, 86)");
    await expect(panel.locator(".app-shell")).toHaveCSS("background-color", "rgb(12, 24, 36)");
  } finally {
    await homeAssistant.close();
    await app.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});
