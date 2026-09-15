import { handleApiRequest, type ApiResponse } from "./app.js";
import {
  readLambdaRuntimeConfig,
  type LambdaRuntimeConfig,
} from "./adapters/aws/runtime-config.js";
import { createSecretsManagerSecretValueReader } from "./adapters/aws/secrets-manager-reader.js";

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

export interface LambdaHandlerDependencies {
  loadRuntimeConfig: () => Promise<LambdaRuntimeConfig>;
}

export const createLambdaHandler = ({
  loadRuntimeConfig,
}: LambdaHandlerDependencies) =>
  async (
    event: ApiGatewayHttpApiEvent,
  ): Promise<ApiGatewayHttpApiResponse> => {
    await loadRuntimeConfig();

    return handleApiRequest({
      method: event.requestContext.http.method,
      url: event.rawPath,
    });
  };

const secretValueReader = createSecretsManagerSecretValueReader();
let runtimeConfig: LambdaRuntimeConfig | undefined;

const loadRuntimeConfig = async (): Promise<LambdaRuntimeConfig> => {
  if (runtimeConfig !== undefined) {
    return runtimeConfig;
  }

  runtimeConfig = await readLambdaRuntimeConfig(process.env, secretValueReader);
  return runtimeConfig;
};

export const handler = createLambdaHandler({ loadRuntimeConfig });
