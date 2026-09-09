import type { ServerResponse } from "node:http";

export class ShoppingListEvents {
  readonly #clients = new Set<ServerResponse>();

  connect(response: ServerResponse): void {
    response.writeHead(200, {
      "cache-control": "no-cache",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    });
    response.write("event: ready\ndata: {}\n\n");
    this.#clients.add(response);
    response.once("close", () => this.#clients.delete(response));
  }

  publishChanged(): void {
    for (const client of this.#clients) {
      client.write("event: changed\ndata: {}\n\n");
    }
  }

  close(): void {
    for (const client of this.#clients) {
      client.end();
    }
    this.#clients.clear();
  }
}
