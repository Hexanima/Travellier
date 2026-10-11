import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectMongoDatabase, readMongoDatabaseConfig, type MongoDatabaseConfig } from "./connection.js";
import { auditMongoContracts, type ContractAuditReport } from "./contract-audit.js";
import { loadApiEnvironment } from "../../load-env.js";

export const runMongoContractAudit = async (config: MongoDatabaseConfig): Promise<ContractAuditReport> => {
  const connection = await connectMongoDatabase(config);
  try {
    return await auditMongoContracts(connection.database);
  } finally {
    await connection.close();
  }
};

const isEntrypoint = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  loadApiEnvironment();
  // Promise callback also catches configuration errors without printing secrets from driver errors.
  Promise.resolve().then(() => runMongoContractAudit(readMongoDatabaseConfig())).then((report) => {
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.findings.length === 0 ? 0 : 2;
  }).catch(() => {
    console.error("MongoDB contract audit failed.");
    process.exitCode = 1;
  });
}
