import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ObjectId } from "app-domain";

export interface HealthResponse {
  app: "travellier";
  status: "ready";
}

export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface ApiRequest {
  method?: string;
  url?: string;
  authenticatedUserId?: ObjectId;
}

export const createHealthResponse = async (): Promise<HealthResponse> => ({
  app: "travellier",
  status: "ready",
});

const jsonResponse = (statusCode: number, payload: unknown): ApiResponse => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});

export const handleApiRequest = async (
  request: ApiRequest,
): Promise<ApiResponse> => {
  if (request.method === "GET" && request.url === "/health") {
    return jsonResponse(200, await createHealthResponse());
  }

  return jsonResponse(404, { error: "NotFound" });
};

export const requestHandler = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  const apiResponse = await handleApiRequest(request);
  response.writeHead(apiResponse.statusCode, apiResponse.headers);
  response.end(apiResponse.body);
};

export const createApp = () => createServer(requestHandler);

const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
  });
}
