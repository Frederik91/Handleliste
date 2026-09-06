import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  startHandlelisteApp,
  type RunningApplication,
} from "../../src/server/application.js";
import {
  startFakeHomeAssistant,
  type FakeHomeAssistantOptions,
  type FakeHomeAssistantUser,
  type RunningFakeHomeAssistant,
} from "../../src/dev-support/fake-home-assistant.js";

export const FRIDA: FakeHomeAssistantUser = {
  displayName: "Frida Handlekurv",
  id: "ha-user-1",
  name: "frida",
};

export const OLA: FakeHomeAssistantUser = {
  displayName: "Ola Handlekurv",
  id: "ha-user-2",
  name: "ola",
};

export interface HandlelisteTestSystem {
  addHomeAssistant(
    options?: Omit<FakeHomeAssistantOptions, "appOrigin">,
  ): Promise<RunningFakeHomeAssistant>;
  close(): Promise<void>;
  databasePath: string;
  restart(): Promise<void>;
}

export async function startHandlelisteTestSystem(): Promise<HandlelisteTestSystem> {
  const dataDirectory = await mkdtemp(join(tmpdir(), "handleliste-"));
  let app = await startApplication(dataDirectory);
  let homeAssistants: RunningFakeHomeAssistant[] = [];

  return {
    async addHomeAssistant(options = { user: FRIDA }) {
      const homeAssistant = await startFakeHomeAssistant({
        ...options,
        appOrigin: app.origin,
      });
      homeAssistants.push(homeAssistant);
      return homeAssistant;
    },
    async close() {
      await closeHomeAssistants(homeAssistants);
      homeAssistants = [];
      await app.close();
      await rm(dataDirectory, { force: true, recursive: true });
    },
    databasePath: join(dataDirectory, "handleliste.sqlite"),
    async restart() {
      await closeHomeAssistants(homeAssistants);
      homeAssistants = [];
      await app.close();
      app = await startApplication(dataDirectory);
    },
  };
}

function startApplication(dataDirectory: string): Promise<RunningApplication> {
  return startHandlelisteApp({
    dataDirectory,
    trustedIngressAddresses: ["127.0.0.1"],
  });
}

function closeHomeAssistants(
  homeAssistants: readonly RunningFakeHomeAssistant[],
): Promise<void[]> {
  return Promise.all(homeAssistants.map((homeAssistant) => homeAssistant.close()));
}
