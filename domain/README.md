# domain

Framework-independent domain package.

Keep entities, value objects, domain errors, use cases, result contracts, and ports here. This package must not depend on `apps/*`, MongoDB, AWS, HTTP, or Capacitor.

The public API exposes framework-independent ports for persistence, object storage, and notifications. Their operations return the discriminated `Result` contract.

## Commands

- `yarn workspace app-domain test --run`
- `yarn workspace app-domain build`
