import type { MongoDatabaseConfig } from "../mongodb/connection.js";
import type { SnsPushApplications } from "./sns-push-provider.js";
import { readMongoSecret, requiredSetting, type SecretValueReader } from "./runtime-config.js";

/** Configuration of the events worker: its role reads the MongoDB secret and the push applications registry, never the JWT secret. */
export interface EventsRuntimeConfig {
  environment: string;
  mongo: MongoDatabaseConfig;
  pushApplications: SnsPushApplications;
}

const SECRET_ARN = /^arn:aws[a-z-]*:secretsmanager:[a-z0-9-]+:\d{12}:secret:.+$/;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Messages never include the value read: the registry holds ARNs of the account. */
const readPushApplications = (secret: string, environment: string): SnsPushApplications => {
  let value: unknown;
  try { value = JSON.parse(secret); } catch { throw new Error("Push applications secret must be valid JSON"); }
  const registry = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  if (registry.stage !== environment) throw new Error("Push applications secret does not match APP_ENV");
  const stage = escape(environment);
  const android = new RegExp(`^arn:aws[a-z-]*:sns:[a-z0-9-]+:\\d{12}:app/GCM/travellier-${stage}-android$`);
  const ios = new RegExp(`^arn:aws[a-z-]*:sns:[a-z0-9-]+:\\d{12}:app/APNS(_SANDBOX)?/travellier-${stage}-ios$`);
  if (typeof registry.android !== "string" || !android.test(registry.android) || typeof registry.ios !== "string" || !ios.test(registry.ios)) {
    throw new Error("Push applications secret must include the android and ios application ARNs of the stage");
  }
  return { android: registry.android, ios: registry.ios };
};

export const readEventsRuntimeConfig = async (
  environment: Record<string, string | undefined>,
  secretValueReader: SecretValueReader,
): Promise<EventsRuntimeConfig> => {
  const appEnvironment = requiredSetting(environment, "APP_ENV");
  const mongoSecretArn = requiredSetting(environment, "MONGODB_SECRET_ARN");
  const pushSecretArn = requiredSetting(environment, "PUSH_APPLICATIONS_SECRET_ARN");
  if (!SECRET_ARN.test(mongoSecretArn)) throw new Error("MONGODB_SECRET_ARN must be a Secrets Manager ARN");
  if (!SECRET_ARN.test(pushSecretArn)) throw new Error("PUSH_APPLICATIONS_SECRET_ARN must be a Secrets Manager ARN");
  const [mongoSecret, pushSecret] = await Promise.all([secretValueReader.getSecretValue(mongoSecretArn), secretValueReader.getSecretValue(pushSecretArn)]);
  return { environment: appEnvironment, mongo: readMongoSecret(mongoSecret), pushApplications: readPushApplications(pushSecret, appEnvironment) };
};
