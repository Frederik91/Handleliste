import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { startHandlelisteApp, type RunningApplication } from "../server/application.js";
import {
  startFakeHomeAssistant,
  type RunningFakeHomeAssistant,
} from "../../tests/support/fake-home-assistant.js";

const dataDirectory = resolve(process.env.HANDLELISTE_DEV_DATA_DIR ?? ".dev-data");

async function run(): Promise<void> {
  await mkdir(dataDirectory, { recursive: true });

  const application = await startHandlelisteApp({
    dataDirectory,
    trustedIngressAddresses: ["127.0.0.1"],
  });

  let homeAssistant: RunningFakeHomeAssistant;
  try {
    homeAssistant = await startFakeHomeAssistant({
      appOrigin: application.origin,
      user: {
        displayName: "Local Developer",
        id: "local-developer",
        name: "local",
      },
    });
  } catch (error) {
    await application.close();
    throw error;
  }

  process.stdout.write(
    [
      "Handleliste is ready for local inspection.",
      `Open: ${homeAssistant.panelUrl}`,
      `Data: ${dataDirectory}`,
      "Press Ctrl+C to stop.",
      "",
    ].join("\n"),
  );

  registerShutdown(application, homeAssistant);
}

function registerShutdown(
  application: RunningApplication,
  homeAssistant: RunningFakeHomeAssistant,
): void {
  let shuttingDown = false;

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    process.stdout.write("\nStopping Handleliste...\n");
    await homeAssistant.close();
    await application.close();
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

await run();
