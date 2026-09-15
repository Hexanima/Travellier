import { handleApiRequest, type ApiResponse } from "./app.js";

export interface ApiGatewayHttpApiEvent {
  rawPath: string;
  requestContext: {
    http: {
      method: string;
      [attribute: string]: string;
    };
    [attribute: string]: unknown;
  };
  [attribute: string]: unknown;
}

export type ApiGatewayHttpApiResponse = ApiResponse;

export const handler = async (
  event: ApiGatewayHttpApiEvent,
): Promise<ApiGatewayHttpApiResponse> =>
  handleApiRequest({
    method: event.requestContext.http.method,
    url: event.rawPath,
  });
