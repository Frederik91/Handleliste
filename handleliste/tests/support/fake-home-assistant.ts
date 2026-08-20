import {
  createServer,
  request as requestUpstream,
  type IncomingHttpHeaders,
  type Server,
} from "node:http";

export interface FakeHomeAssistantUser {
  displayName: string;
  id: string;
  name: string;
}

export interface FakeHomeAssistantOptions {
  aiTaskResult?: unknown;
  appOrigin: string;
  theme?: {
    primaryBackgroundColor: string;
    primaryColor: string;
    primaryTextColor: string;
    textPrimaryColor: string;
  };
  user: FakeHomeAssistantUser;
}

export interface RunningFakeHomeAssistant {
  close(): Promise<void>;
  coreApiUrl: string;
  ingressUrl: string;
  panelUrl: string;
}

const INGRESS_PATH = "/api/hassio_ingress/test-token";

export async function startFakeHomeAssistant(
  options: FakeHomeAssistantOptions,
): Promise<RunningFakeHomeAssistant> {
  const appOrigin = new URL(options.appOrigin);
  const server = createServer((request, response) => {
    const requestUrl = request.url ?? "/";
    if (requestUrl === "/api/services/ai_task/generate_data?return_response") {
      void handleAiTask(request, response, options.aiTaskResult);
      return;
    }
    if (requestUrl === "/") {
      const theme = options.theme ?? {
        primaryBackgroundColor: "#fafafa",
        primaryColor: "#03a9f4",
        primaryTextColor: "#212121",
        textPrimaryColor: "#ffffff",
      };
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`
        <!doctype html>
        <html style="--primary-background-color:${theme.primaryBackgroundColor};--primary-color:${theme.primaryColor};--primary-text-color:${theme.primaryTextColor};--text-primary-color:${theme.textPrimaryColor}">
          <body style="margin:0"><iframe title="Handleliste" src="${INGRESS_PATH}/" style="border:0;width:100vw;height:100vh"></iframe></body>
        </html>
      `);
      return;
    }
    if (!requestUrl.startsWith(INGRESS_PATH)) {
      response.writeHead(404).end("Not found");
      return;
    }

    const upstreamPath = requestUrl.slice(INGRESS_PATH.length) || "/";
    const headers: IncomingHttpHeaders = {
      ...request.headers,
      host: appOrigin.host,
      "x-ingress-path": INGRESS_PATH,
      "x-remote-user-display-name": options.user.displayName,
      "x-remote-user-id": options.user.id,
      "x-remote-user-name": options.user.name,
    };
    const upstream = requestUpstream(
      {
        headers,
        hostname: appOrigin.hostname,
        method: request.method,
        path: upstreamPath,
        port: appOrigin.port,
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      },
    );
    upstream.on("error", (error) => {
      response.writeHead(502).end(error.message);
    });
    request.pipe(upstream);
  });

  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Fake Home Assistant did not bind to a TCP port");
  }

  return {
    close: () => close(server),
    coreApiUrl: `http://127.0.0.1:${address.port}/api`,
    ingressUrl: `http://127.0.0.1:${address.port}${INGRESS_PATH}/`,
    panelUrl: `http://127.0.0.1:${address.port}/`,
  };
}

async function handleAiTask(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  result: unknown,
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  const authorized = request.headers.authorization === "Bearer fake-supervisor-token";
  const contentType = request.headers["content-type"]?.split(";", 1)[0];
  const hasStructure =
    typeof body.structure === "object" && body.structure !== null && !Array.isArray(body.structure);
  if (
    request.method !== "POST" ||
    contentType !== "application/json" ||
    !authorized ||
    typeof body.task_name !== "string" ||
    typeof body.instructions !== "string" ||
    !hasStructure
  ) {
    response.writeHead(400).end("Invalid AI Task request");
    return;
  }
  response
    .writeHead(200, { "content-type": "application/json" })
    .end(JSON.stringify({ service_response: { data: result } }));
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
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
