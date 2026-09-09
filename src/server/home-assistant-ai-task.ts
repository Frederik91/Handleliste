export interface GenerateDataRequest {
  instructions: string;
  structure: Record<string, unknown>;
  taskName: string;
}

export interface AiTaskClient {
  generateData<T = unknown>(request: GenerateDataRequest): Promise<T>;
}

export interface HomeAssistantAiTaskClientOptions {
  apiBaseUrl?: string;
  token: string;
}

export class HomeAssistantAiTaskClient implements AiTaskClient {
  readonly #apiBaseUrl: string;
  readonly #token: string;

  constructor(options: HomeAssistantAiTaskClientOptions) {
    this.#apiBaseUrl = (options.apiBaseUrl ?? "http://supervisor/core/api").replace(/\/$/, "");
    this.#token = options.token;
  }

  async generateData<T = unknown>(request: GenerateDataRequest): Promise<T> {
    const response = await fetch(
      `${this.#apiBaseUrl}/services/ai_task/generate_data?return_response`,
      {
        body: JSON.stringify({
          instructions: request.instructions,
          structure: request.structure,
          task_name: request.taskName,
        }),
        headers: {
          authorization: `Bearer ${this.#token}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
    if (!response.ok) {
      throw new Error(`Home Assistant AI Task failed with status ${response.status}`);
    }

    const body: unknown = await response.json();
    if (!hasServiceResponse(body)) {
      throw new Error("Home Assistant AI Task returned an invalid response");
    }
    return body.service_response.data as T;
  }
}

function hasServiceResponse(
  value: unknown,
): value is { service_response: { data: unknown } } {
  if (typeof value !== "object" || value === null || !("service_response" in value)) {
    return false;
  }
  const serviceResponse = value.service_response;
  return (
    typeof serviceResponse === "object" &&
    serviceResponse !== null &&
    "data" in serviceResponse
  );
}
