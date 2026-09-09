import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHandlelisteApp } from "../../src/server/application.js";
import { startHandlelisteTestSystem } from "../support/handleliste-test-system.js";

test("keeps health public while rejecting requests that bypass Home Assistant Ingress", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "handleliste-fastify-"));
  const application = await startHandlelisteApp({ dataDirectory });

  try {
    const health = await fetch(`${application.origin}/health`);
    expect(health.status).toBe(200);
    expect(await health.text()).toBe("ok");

    const protectedRequest = await fetch(`${application.origin}/api/shopping-list`);
    expect(protectedRequest.status).toBe(403);
    expect(await protectedRequest.text()).toBe("Ingress proxy required");
  } finally {
    await application.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("requires Home Assistant user headers from a trusted proxy address", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "handleliste-fastify-"));
  const application = await startHandlelisteApp({
    dataDirectory,
    trustedIngressAddresses: ["127.0.0.1"],
  });

  try {
    const response = await fetch(`${application.origin}/api/shopping-list`);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Authenticated Home Assistant user required");
  } finally {
    await application.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("validates JSON requests at the Fastify route seam with stable errors", async () => {
  const system = await startHandlelisteTestSystem();
  const homeAssistant = await system.addHomeAssistant();

  try {
    const invalidEntry = await fetch(`${homeAssistant.ingressUrl}api/shopping-list/items`, {
      body: JSON.stringify({ entry: "   " }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(invalidEntry.status).toBe(400);
    expect(await invalidEntry.json()).toEqual({ error: "Entry must contain a Product name" });

    const malformedJson = await fetch(`${homeAssistant.ingressUrl}api/shopping-list/items`, {
      body: "{",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(malformedJson.status).toBe(400);
    expect(await malformedJson.json()).toEqual({ error: "Request body must be valid JSON" });

    const emptyJson = await fetch(`${homeAssistant.ingressUrl}api/shopping-list/items`, {
      body: "",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(emptyJson.status).toBe(400);
    expect(await emptyJson.json()).toEqual({ error: "Request body must be valid JSON" });

    const oversizedBody = await fetch(`${homeAssistant.ingressUrl}api/shopping-list/items`, {
      body: JSON.stringify({ entry: "x".repeat(17_000) }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(oversizedBody.status).toBe(413);
    expect(await oversizedBody.json()).toEqual({ error: "Request body is too large" });
  } finally {
    await system.close();
  }
});
