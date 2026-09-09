import type { FastifyInstance } from "fastify";
import { ShoppingListCommandError } from "../shopping-list.js";

export function configureHttpErrors(application: FastifyInstance): void {
  application.addHook("onSend", async (_request, reply) => {
    if (!reply.hasHeader("cache-control")) reply.header("cache-control", "no-store");
  });
  application.setNotFoundHandler((_request, reply) => {
    void reply.status(404).type("text/plain; charset=utf-8").send("Not found");
  });
  application.setErrorHandler((error, _request, reply) => {
    if (error instanceof ShoppingListCommandError) {
      void reply.status(400).send({ error: error.message });
      return;
    }
    if (hasErrorCode(error, "FST_ERR_CTP_BODY_TOO_LARGE")) {
      void reply.status(413).send({ error: "Request body is too large" });
      return;
    }
    if (hasErrorCode(error, "FST_ERR_CTP_EMPTY_JSON_BODY") || hasErrorCode(error, "FST_ERR_CTP_INVALID_JSON_BODY")) {
      void reply.status(400).send({ error: "Request body must be valid JSON" });
      return;
    }
    if (isValidationError(error)) {
      void reply.status(400).send({ error: error.message });
      return;
    }
    if (hasErrorCode(error, "ENOENT")) {
      void reply.status(404).type("text/plain; charset=utf-8").send("Not found");
      return;
    }
    void reply.status(500).type("text/plain; charset=utf-8").send("Internal server error");
  });
}

export function validationError(message: string): () => Error {
  return () => new Error(message);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function isValidationError(error: unknown): error is Error & { validation: readonly unknown[] } {
  return error instanceof Error && "validation" in error && Array.isArray(error.validation);
}
