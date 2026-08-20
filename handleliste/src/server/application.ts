import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { UserPreferences, type Locale } from "./user-preferences.js";

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
  const webRoot = resolve(options.webRoot ?? join(process.cwd(), "dist", "web"));
  const trustedIngressAddresses = new Set(
    options.trustedIngressAddresses ?? ["172.30.32.2"],
  );
  const preferences = new UserPreferences(options.dataDirectory);
  const server = createServer((request, response) => {
    void handleRequest(request, response, webRoot, trustedIngressAddresses, preferences);
  });

  await listen(server, options.port ?? 0, host);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Handleliste did not bind to a TCP port");
  }

  return {
    close: async () => {
      await close(server);
      preferences.close();
    },
    origin: `http://${host}:${address.port}`,
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  webRoot: string,
  trustedIngressAddresses: ReadonlySet<string>,
  preferences: UserPreferences,
): Promise<void> {
  try {
    if (request.url === "/health") {
      send(response, 200, "text/plain; charset=utf-8", "ok");
      return;
    }

    const remoteAddress = normalizeAddress(request.socket.remoteAddress);
    if (!remoteAddress || !trustedIngressAddresses.has(remoteAddress)) {
      send(response, 403, "text/plain; charset=utf-8", "Ingress proxy required");
      return;
    }

    const identity = readIdentity(request);
    if (!identity) {
      send(response, 401, "text/plain; charset=utf-8", "Authenticated Home Assistant user required");
      return;
    }

    const pathname = new URL(request.url ?? "/", "http://handleliste.local").pathname;
    if (pathname === "/api/preferences/locale" && request.method === "POST") {
      const body = await readJson(request);
      if (!isLocale(body.locale)) {
        sendJson(response, 400, { error: "Locale must be 'en' or 'nb'" });
        return;
      }
      preferences.setLocale(identity.id, body.locale);
      sendJson(response, 200, { locale: body.locale });
      return;
    }

    if (pathname === "/") {
      const template = await readFile(join(webRoot, "index.html"), "utf8");
      const bootstrap = escapeJsonForHtml(
        JSON.stringify({ identity, locale: preferences.getLocale(identity.id) }),
      );
      const html = template.replace(
        "<!--HANDLELISTE_BOOTSTRAP-->",
        `<script>window.__HANDLELISTE_BOOTSTRAP__=${bootstrap}</script>`,
      );
      send(response, 200, "text/html; charset=utf-8", html);
      return;
    }

    const filePath = resolve(webRoot, `.${pathname}`);
    if (!filePath.startsWith(`${webRoot}${sep}`)) {
      send(response, 404, "text/plain; charset=utf-8", "Not found");
      return;
    }
    const body = await readFile(filePath);
    send(response, 200, contentType(filePath), body);
  } catch (error) {
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
      throw new Error("Request body is too large");
    }
    chunks.push(buffer);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "nb";
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
