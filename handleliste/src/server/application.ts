import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { UserPreferences, type Locale } from "./user-preferences.js";
import { ShoppingListStore } from "./shopping-list.js";
import { ShoppingListEvents } from "./shopping-list-events.js";
import { AddQuickEntryCommand } from "../domain/quick-entry.js";
import { isPackageUnit } from "../shared/package-option.js";
import { ShoppingListCommandError } from "./shopping-list.js";

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

interface RequestContext {
  addQuickEntry: AddQuickEntryCommand;
  preferences: UserPreferences;
  shoppingList: ShoppingListStore;
  shoppingListEvents: ShoppingListEvents;
  trustedIngressAddresses: ReadonlySet<string>;
  webRoot: string;
}

export async function startHandlelisteApp(
  options: ApplicationOptions,
): Promise<RunningApplication> {
  const host = options.host ?? "127.0.0.1";
  const webRoot = resolve(options.webRoot ?? join(process.cwd(), "dist", "web"));
  const trustedIngressAddresses = new Set(
    options.trustedIngressAddresses ?? ["172.30.32.2"],
  );
  const preferences = new UserPreferences(options.dataDirectory);
  const shoppingList = new ShoppingListStore(options.dataDirectory);
  const shoppingListEvents = new ShoppingListEvents();
  const context: RequestContext = {
    addQuickEntry: new AddQuickEntryCommand(shoppingList),
    preferences,
    shoppingList,
    shoppingListEvents,
    trustedIngressAddresses,
    webRoot,
  };
  const server = createServer((request, response) => {
    void handleRequest(request, response, context);
  });

  await listen(server, options.port ?? 0, host);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Handleliste did not bind to a TCP port");
  }

  return {
    close: async () => {
      shoppingListEvents.close();
      await close(server);
      preferences.close();
      shoppingList.close();
    },
    origin: `http://${host}:${address.port}`,
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
): Promise<void> {
  try {
    if (request.url === "/health") {
      send(response, 200, "text/plain; charset=utf-8", "ok");
      return;
    }

    const remoteAddress = normalizeAddress(request.socket.remoteAddress);
    if (!remoteAddress || !context.trustedIngressAddresses.has(remoteAddress)) {
      send(response, 403, "text/plain; charset=utf-8", "Ingress proxy required");
      return;
    }

    const identity = readIdentity(request);
    if (!identity) {
      send(response, 401, "text/plain; charset=utf-8", "Authenticated Home Assistant user required");
      return;
    }

    const pathname = new URL(request.url ?? "/", "http://handleliste.local").pathname;
    if (pathname === "/api/shopping-list" && request.method === "GET") {
      sendJson(response, 200, context.shoppingList.getSnapshot());
      return;
    }

    if (pathname === "/api/shopping-list/events" && request.method === "GET") {
      context.shoppingListEvents.connect(response);
      return;
    }

    if (pathname === "/api/shopping-list/items" && request.method === "POST") {
      const body = await readJson(request);
      if (typeof body.entry !== "string" || body.entry.trim() === "") {
        sendJson(response, 400, { error: "Entry must contain a Product name" });
        return;
      }
      const productId = body.productId;
      if (productId !== undefined && (!Number.isSafeInteger(productId) || Number(productId) < 1)) {
        sendJson(response, 400, { error: "Product ID must be a positive integer" });
        return;
      }
      const snapshot = context.addQuickEntry.execute({
        entry: body.entry,
        productId: productId === undefined ? undefined : Number(productId),
      });
      context.shoppingListEvents.publishChanged();
      sendJson(response, 201, snapshot);
      return;
    }

    if (pathname === "/api/shopping-list/quick-entry/undo" && request.method === "POST") {
      const body = await readJson(request);
      if (typeof body.token !== "string" || body.token.trim() === "") {
        sendJson(response, 400, { error: "Undo token is required" });
        return;
      }
      const snapshot = context.shoppingList.undoQuickEntry(body.token);
      context.shoppingListEvents.publishChanged();
      sendJson(response, 200, snapshot);
      return;
    }

    const shoppingItemMatch = pathname.match(/^\/api\/shopping-list\/items\/(\d+)$/);
    if (shoppingItemMatch && request.method === "PATCH") {
      const body = await readJson(request);
      const itemId = Number(shoppingItemMatch[1]);
      if (
        typeof body.productName !== "string"
        || body.productName.trim() === ""
        || (body.productId !== undefined && !isPositiveInteger(body.productId))
        || typeof body.packageSize !== "number"
        || !Number.isFinite(body.packageSize)
        || body.packageSize <= 0
        || !isPackageUnit(body.packageUnit)
        || !isPositiveInteger(body.quantity)
      ) {
        sendJson(response, 400, { error: "Product, Package Option, and Quantity are invalid" });
        return;
      }
      const snapshot = context.shoppingList.updateItem({
        itemId,
        packageSize: body.packageSize,
        packageUnit: body.packageUnit,
        productId: body.productId,
        productName: body.productName,
        quantity: body.quantity,
      });
      context.shoppingListEvents.publishChanged();
      sendJson(response, 200, snapshot);
      return;
    }

    if (pathname === "/api/preferences/locale" && request.method === "POST") {
      const body = await readJson(request);
      if (!isLocale(body.locale)) {
        sendJson(response, 400, { error: "Locale must be 'en' or 'nb'" });
        return;
      }
      context.preferences.setLocale(identity.id, body.locale);
      sendJson(response, 200, { locale: body.locale });
      return;
    }

    if (pathname === "/") {
      const template = await readFile(join(context.webRoot, "index.html"), "utf8");
      const bootstrap = escapeJsonForHtml(
        JSON.stringify({
          identity,
          locale: context.preferences.getLocale(identity.id),
          shoppingList: context.shoppingList.getSnapshot(),
        }),
      );
      const html = template.replace(
        "<!--HANDLELISTE_BOOTSTRAP-->",
        `<script>window.__HANDLELISTE_BOOTSTRAP__=${bootstrap}</script>`,
      );
      send(response, 200, "text/html; charset=utf-8", html);
      return;
    }

    const filePath = resolve(context.webRoot, `.${pathname}`);
    if (!filePath.startsWith(`${context.webRoot}${sep}`)) {
      send(response, 404, "text/plain; charset=utf-8", "Not found");
      return;
    }
    const body = await readFile(filePath);
    send(response, 200, contentType(filePath), body);
  } catch (error) {
    if (error instanceof ShoppingListCommandError) {
      sendJson(response, 400, { error: error.message });
      return;
    }
    if (error instanceof RequestBodyError) {
      sendJson(response, error.status, { error: error.message });
      return;
    }
    const status = isMissingFile(error) ? 404 : 500;
    send(response, status, "text/plain; charset=utf-8", status === 404 ? "Not found" : "Internal server error");
  }
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) {
      throw new RequestBodyError(413, "Request body is too large");
    }
    chunks.push(buffer);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestBodyError(400, "Request body must be valid JSON");
  }
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

class RequestBodyError extends Error {
  constructor(readonly status: 400 | 413, message: string) {
    super(message);
  }
}

function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "nb";
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function readIdentity(request: IncomingMessage) {
  const id = singleHeader(request, "x-remote-user-id");
  const name = singleHeader(request, "x-remote-user-name");
  const displayName = singleHeader(request, "x-remote-user-display-name");
  return id && name && displayName ? { displayName, id, name } : undefined;
}

function singleHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeAddress(address: string | undefined): string | undefined {
  return address?.replace(/^::ffff:/, "");
}

function escapeJsonForHtml(json: string): string {
  return json.replace(/</g, "\\u003c");
}

function contentType(path: string): string {
  switch (extname(path)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function send(
  response: ServerResponse,
  status: number,
  contentTypeValue: string,
  body: string | Buffer,
): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": contentTypeValue,
  });
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  send(response, status, "application/json; charset=utf-8", JSON.stringify(body));
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
}
