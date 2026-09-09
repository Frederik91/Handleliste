import { expect, test } from "@playwright/test";
import { HomeAssistantAiTaskClient } from "../../src/server/home-assistant-ai-task.js";
import { startFakeHomeAssistant } from "../../src/dev-support/fake-home-assistant.js";

test("the fake Home Assistant boundary implements the structured AI Task contract", async () => {
  const homeAssistant = await startFakeHomeAssistant({
    aiTaskResult: { orderedIds: ["item-2", "item-1"] },
    appOrigin: "http://127.0.0.1:1",
    user: {
      displayName: "Frida Handlekurv",
      id: "ha-user-1",
      name: "frida",
    },
  });

  try {
    const client = new HomeAssistantAiTaskClient({
      apiBaseUrl: homeAssistant.coreApiUrl,
      token: "fake-supervisor-token",
    });
    const result = await client.generateData({
      instructions: "Return every supplied item ID exactly once.",
      structure: { orderedIds: { selector: { text: { multiple: true } } } },
      taskName: "Organize a shopping list",
    });

    expect(result).toEqual({ orderedIds: ["item-2", "item-1"] });
  } finally {
    await homeAssistant.close();
  }
});
