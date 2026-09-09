import type { FastifyRequest } from "fastify";

export interface HomeAssistantIdentity {
  displayName: string;
  id: string;
  name: string;
}

export function readHomeAssistantIdentity(request: FastifyRequest): HomeAssistantIdentity | undefined {
  const id = singleHeader(request, "x-remote-user-id");
  const name = singleHeader(request, "x-remote-user-name");
  const displayName = singleHeader(request, "x-remote-user-display-name");
  return id && name && displayName ? { displayName, id, name } : undefined;
}

export function normalizeRemoteAddress(address: string | undefined): string | undefined {
  return address?.replace(/^::ffff:/, "");
}

function singleHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" && value.trim() ? value : undefined;
}
