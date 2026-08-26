import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import fastifyStatic from "@fastify/static";
import {
  Type,
  type TypeBoxTypeProvider,
} from "@fastify/type-provider-typebox";
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";
import { AddQuickEntryCommand } from "../domain/quick-entry.js";
import { UserPreferences } from "./user-preferences.js";
import { ShoppingListEvents } from "./shopping-list-events.js";
import { ShoppingListCommandError, ShoppingListStore } from "./shopping-list.js";

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

interface HomeAssistantIdentity {
  displayName: string;
  id: string;
  name: string;
}

interface RequestContext {
  addQuickEntry: AddQuickEntryCommand;
  identities: WeakMap<FastifyRequest, HomeAssistantIdentity>;
  preferences: UserPreferences;
  shoppingList: ShoppingListStore;
  shoppingListEvents: ShoppingListEvents;
  trustedIngressAddresses: ReadonlySet<string>;
  webRoot: string;
}

const nonBlankString = Type.String({ minLength: 1, pattern: ".*\\S.*" });
const positiveInteger = Type.Integer({ minimum: 1 });
const packageUnit = Type.Union([
  Type.Literal("unit"),
  Type.Literal("piece"),
  Type.Literal("g"),
  Type.Literal("kg"),
  Type.Literal("ml"),
  Type.Literal("cl"),
  Type.Literal("dl"),
  Type.Literal("L"),
  Type.Literal("tsp"),
  Type.Literal("tbsp"),
]);
const itemIdParams = Type.Object({ itemId: positiveInteger });
const definitionIdParams = Type.Object({ definitionId: positiveInteger });
const undoBody = Type.Object({ token: nonBlankString });
const alwaysInStockDefinitionBody = Type.Object({
  defaultQuantity: positiveInteger,
  packageOptionId: positiveInteger,
  productId: positiveInteger,
});
const alwaysInStockSelectionsBody = Type.Object({
  selections: Type.Array(Type.Object({
    definitionId: positiveInteger,
    quantity: positiveInteger,
  })),
});

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

  configureErrors(application);
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

function configureErrors(application: FastifyInstance): void {
  application.addHook("onSend", async (_request, reply) => {
    if (!reply.hasHeader("cache-control")) reply.header("cache-control", "no-store");
  });
  application.setNotFoundHandler((_request, reply) => {
    void reply.status(404).type("text/plain; charset=utf-8").send("Not found");
  });
  application.setErrorHandler((error, request, reply) => {
    if (error instanceof ShoppingListCommandError) {
      void reply.status(400).send({ error: error.message });
      return;
    }
    if (hasErrorCode(error, "FST_ERR_CTP_BODY_TOO_LARGE")) {
      void reply.status(413).send({ error: "Request body is too large" });
      return;
    }
    if (
      hasErrorCode(error, "FST_ERR_CTP_EMPTY_JSON_BODY")
      || hasErrorCode(error, "FST_ERR_CTP_INVALID_JSON_BODY")
    ) {
      void reply.status(400).send({ error: "Request body must be valid JSON" });
      return;
    }
    if (isValidationError(error)) {
      void reply.status(400).send({ error: error.message });
      return;
    }
    if (isMissingFile(error)) {
      void reply.status(404).type("text/plain; charset=utf-8").send("Not found");
      return;
    }
    void reply.status(500).type("text/plain; charset=utf-8").send("Internal server error");
  });
}

function registerRoutes(
  application: FastifyInstance,
  context: RequestContext,
): void {
  const routes = application.withTypeProvider<TypeBoxTypeProvider>();

  routes.get("/health", async (_request, reply) => {
    await reply.type("text/plain; charset=utf-8").send("ok");
  });

  routes.addHook("onRequest", async (request, reply) => {
    if (request.routeOptions.url === "/health") return;
    const remoteAddress = normalizeAddress(request.raw.socket.remoteAddress);
    if (!remoteAddress || !context.trustedIngressAddresses.has(remoteAddress)) {
      await reply.status(403).type("text/plain; charset=utf-8").send("Ingress proxy required");
      return;
    }
    const identity = readIdentity(request);
    if (!identity) {
      await reply.status(401).type("text/plain; charset=utf-8").send("Authenticated Home Assistant user required");
      return;
    }
    context.identities.set(request, identity);
  });

  routes.get("/api/shopping-list", async () => context.shoppingList.getSnapshot());

  routes.get("/api/shopping-list/always-in-stock", async () => {
    const snapshot = context.shoppingList.getSnapshot();
    return {
      definitions: snapshot.alwaysInStockDefinitions,
      selections: snapshot.alwaysInStockSelections,
    };
  });

  routes.post(
    "/api/shopping-list/always-in-stock/definitions",
    {
      schema: {
        body: alwaysInStockDefinitionBody,
      },
      schemaErrorFormatter: validationError("Product, Package Option, and default Quantity are invalid"),
    },
    async (request, reply) => {
      const snapshot = changed(context, () => context.shoppingList.createAlwaysInStockDefinition(request.body));
      await reply.status(201).send(snapshot);
    },
  );

  routes.patch(
    "/api/shopping-list/always-in-stock/definitions/:definitionId",
    {
      schema: {
        body: alwaysInStockDefinitionBody,
        params: definitionIdParams,
      },
      schemaErrorFormatter: validationError("Product, Package Option, and default Quantity are invalid"),
    },
    async (request) => changed(
      context,
      () => context.shoppingList.updateAlwaysInStockDefinition(request.params.definitionId, request.body),
    ),
  );

  routes.post(
    "/api/shopping-list/always-in-stock/definitions/:definitionId/archive",
    {
      schema: {
        body: Type.Object({ archived: Type.Boolean() }),
        params: definitionIdParams,
      },
      schemaErrorFormatter: validationError("Archived state is invalid"),
    },
    async (request) => changed(
      context,
      () => context.shoppingList.archiveAlwaysInStockDefinition(
        request.params.definitionId,
        request.body.archived,
      ),
    ),
  );

  routes.post(
    "/api/shopping-list/always-in-stock/definitions/reorder",
    {
      schema: {
        body: Type.Object({ definitionIds: Type.Array(positiveInteger) }),
      },
      schemaErrorFormatter: validationError("Always in Stock definition order is invalid"),
    },
    async (request) => changed(
      context,
      () => context.shoppingList.reorderAlwaysInStockDefinitions(request.body.definitionIds),
    ),
  );

  routes.put(
    "/api/shopping-list/always-in-stock/selections",
    {
      schema: {
        body: alwaysInStockSelectionsBody,
      },
      schemaErrorFormatter: validationError("Always in Stock selections are invalid"),
    },
    async (request) => changed(
      context,
      () => context.shoppingList.replaceAlwaysInStockSelections(request.body.selections),
    ),
  );

  routes.get("/api/shopping-list/events", async (_request, reply) => {
    reply.hijack();
    context.shoppingListEvents.connect(reply.raw);
  });

  routes.post(
    "/api/shopping-list/items",
    {
      schema: {
        body: Type.Object({
          entry: nonBlankString,
          productId: Type.Optional(positiveInteger),
        }),
      },
      schemaErrorFormatter: validationError("Entry must contain a Product name"),
    },
    async (request, reply) => {
      const snapshot = context.addQuickEntry.execute(request.body);
      context.shoppingListEvents.publishChanged();
      await reply.status(201).send(snapshot);
    },
  );

  routes.post(
    "/api/shopping-list/quick-entry/undo",
    {
      schema: { body: undoBody },
      schemaErrorFormatter: validationError("Undo token is required"),
    },
    async (request) => changed(context, () => context.shoppingList.undoQuickEntry(request.body.token)),
  );

  routes.post(
    "/api/shopping-list/completed/clear",
    async () => changed(context, () => context.shoppingList.clearCompleted()),
  );

  routes.post(
    "/api/shopping-list/completed/undo-clear",
    {
      schema: { body: undoBody },
      schemaErrorFormatter: validationError("Undo token is required"),
    },
    async (request) => changed(context, () => context.shoppingList.undoClearCompleted(request.body.token)),
  );

  routes.post(
    "/api/shopping-list/trips/new",
    async () => changed(context, () => context.shoppingList.startNewTrip()),
  );

  routes.post(
    "/api/shopping-list/items/:itemId/completion",
    {
      schema: {
        body: Type.Object({ completed: Type.Boolean() }),
        params: itemIdParams,
      },
      schemaErrorFormatter: validationError("Completed must be true or false"),
    },
    async (request) => changed(
      context,
      () => context.shoppingList.setItemCompletion(request.params.itemId, request.body.completed),
    ),
  );

  routes.patch(
    "/api/shopping-list/items/:itemId",
    {
      schema: {
        body: Type.Object({
          packageSize: Type.Number({ exclusiveMinimum: 0 }),
          packageUnit,
          productId: Type.Optional(positiveInteger),
          productName: nonBlankString,
          quantity: positiveInteger,
        }),
        params: itemIdParams,
      },
      schemaErrorFormatter: validationError("Product, Package Option, and Quantity are invalid"),
    },
    async (request) => changed(context, () => context.shoppingList.updateItem({
      itemId: request.params.itemId,
      ...request.body,
    })),
  );

  routes.post(
    "/api/preferences/locale",
    {
      schema: {
        body: Type.Object({
          locale: Type.Union([Type.Literal("en"), Type.Literal("nb")]),
        }),
      },
      schemaErrorFormatter: validationError("Locale must be 'en' or 'nb'"),
    },
    async (request) => {
      const identity = identityFor(request, context);
      context.preferences.setLocale(identity.id, request.body.locale);
      return { locale: request.body.locale };
    },
  );

  routes.get("/", async (request, reply) => {
    const identity = identityFor(request, context);
    const template = await readFile(join(context.webRoot, "index.html"), "utf8");
    const bootstrap = escapeJsonForHtml(JSON.stringify({
      identity,
      locale: context.preferences.getLocale(identity.id),
      shoppingList: context.shoppingList.getSnapshot(),
    }));
    const html = template.replace(
      "<!--HANDLELISTE_BOOTSTRAP-->",
      `<script>window.__HANDLELISTE_BOOTSTRAP__=${bootstrap}</script>`,
    );
    await reply.type("text/html; charset=utf-8").send(html);
  });

  void routes.register(fastifyStatic, {
    index: false,
    prefix: "/",
    root: context.webRoot,
  });
}

function changed<T>(context: RequestContext, mutate: () => T): T {
  const result = mutate();
  context.shoppingListEvents.publishChanged();
  return result;
}

function identityFor(
  request: FastifyRequest,
  context: RequestContext,
): HomeAssistantIdentity {
  const identity = context.identities.get(request);
  if (!identity) throw new Error("Authenticated Home Assistant identity is missing");
  return identity;
}

function readIdentity(request: FastifyRequest): HomeAssistantIdentity | undefined {
  const id = singleHeader(request, "x-remote-user-id");
  const name = singleHeader(request, "x-remote-user-name");
  const displayName = singleHeader(request, "x-remote-user-display-name");
  return id && name && displayName ? { displayName, id, name } : undefined;
}

function singleHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeAddress(address: string | undefined): string | undefined {
  return address?.replace(/^::ffff:/, "");
}

function escapeJsonForHtml(json: string): string {
  return json.replace(/</g, "\\u003c");
}

function validationError(message: string): () => Error {
  return () => new Error(message);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function isValidationError(error: unknown): error is Error & { validation: readonly unknown[] } {
  return error instanceof Error && "validation" in error && Array.isArray(error.validation);
}

function isMissingFile(error: unknown): boolean {
  return hasErrorCode(error, "ENOENT");
}
