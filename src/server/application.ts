import { join, resolve } from "node:path";
import { type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify from "fastify";
import { AddQuickEntryCommand } from "../domain/quick-entry.js";
import { configureHttpErrors } from "./http/errors.js";
import { registerRoutes, type RequestContext } from "./http/routes.js";
import { ShoppingListEvents } from "./shopping-list-events.js";
import { ShoppingListStore } from "./shopping-list.js";
import { UserPreferences } from "./user-preferences.js";

export interface ApplicationOptions {
  dataDirectory: string;
  host?: string;
  port?: number;
  trustedIngressAddresses?: readonly string[];
  webRoot?: string;
}

export interface RunningApplication {
  close(): Promise<void>;
  origin: string;
}

export async function startHandlelisteApp(
  options: ApplicationOptions,
): Promise<RunningApplication> {
  const host = options.host ?? "127.0.0.1";
  const preferences = new UserPreferences(options.dataDirectory);
  const shoppingList = new ShoppingListStore(options.dataDirectory);
  const shoppingListEvents = new ShoppingListEvents();
  const context: RequestContext = {
    addQuickEntry: new AddQuickEntryCommand(shoppingList),
    identities: new WeakMap(),
    preferences,
    shoppingList,
    shoppingListEvents,
    trustedIngressAddresses: new Set(options.trustedIngressAddresses ?? ["172.30.32.2"]),
    webRoot: resolve(options.webRoot ?? join(process.cwd(), "dist", "web")),
  };
  const application = Fastify({ bodyLimit: 16_384, logger: false })
    .withTypeProvider<TypeBoxTypeProvider>();

  configureHttpErrors(application);
  registerRoutes(application, context);

  let origin: string;
  try {
    origin = await application.listen({ host, port: options.port ?? 0 });
  } catch (error) {
    shoppingListEvents.close();
    preferences.close();
    shoppingList.close();
    throw error;
  }

  return {
    close: async () => {
      shoppingListEvents.close();
      await application.close();
      preferences.close();
      shoppingList.close();
    },
    origin,
  };
}
