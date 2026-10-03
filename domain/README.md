# domain

Framework-independent domain package.

Keep entities, value objects, domain errors, use cases, result contracts, and ports here. This package must not depend on `apps/*`, MongoDB, AWS, HTTP, or Capacitor.

The public API exposes framework-independent ports for persistence, object storage, and notifications. Their operations return the discriminated `Result` contract.

## Itinerary generation (T31)

`generateItineraryDays.execute({}, { tripId, destinations, transports })` returns a `Result` of `ItineraryDayDraft[]`. Dates and interval bounds preserve UTC instants. The drafts contain no IDs and are not persisted by this use case.

For each destination, outbound transport generates `transit_out`, return transport generates `transit_return`, and a known outbound arrival plus return departure generates the bounded `activity` window. Incomplete destinations yield only their known transit intervals. No open-ended activity window is inferred. Zero-duration intervals have no slices.

Each positive interval is split at UTC midnight into canonical storage days. `date` is midnight UTC, while `startsAt` and `endsAt` retain the exact interval, including milliseconds. Adjacent slices share a boundary; an interval ending at midnight does not create an empty slice on the following date. Global `order` starts at 1 and follows chronology, with destination order breaking equal-start ties. A date can contain multiple types and destinations.

The local itinerary presentation belongs to T34: project and group the exact intervals in the viewer's timezone, splitting at local midnight as needed. Converting a UTC `date` directly to a local date label is insufficient; a canonical UTC day can overlap two local calendar dates. This does not change the UTC instants or persistent references.

The PRD's schema lists `arrival`, but its functional rules and T01–T61 define only outbound transit, activity and return transit. The type remains in the entity contract for schema compatibility and is not emitted by the generator.

The payload accepts destinations and transports, with no manual itinerary-day creation operation. Validation rejects invalid T28 entities, foreign references, duplicate destination identities/positions, duplicate transport directions and incompatible sequential activity windows before deriving a projection. Inputs are not mutated, and each call returns independent Date instances.

## Itinerary persistence (T32)

`createJourneyTransport`, `updateJourneyTransport` and destination reordering regenerate the complete Trip projection within `TripJourneyPort.withTransaction`. The port must roll back on `Result.err` and re-read the state on transaction retries. Partial transport updates are merged inside that transaction.

Each `(tripId, destinationId, date UTC, type)` slice keeps its ObjectId across regeneration. New slices receive IDs through the injected factory; obsolete unreferenced slices are removed. `order` and viewer timezone do not identify a slice.

Removing a referenced slice or excluding a linked activity's exact `scheduledAt` returns `ItineraryConflictError`. Activities/posts and their dependent data are never deleted or reassigned automatically. Posts' creation timestamps do not determine whether their associations survive.

Future activity/post mutations must use the same per-Trip unit of work so their reference validation cannot race itinerary regeneration.

## Commands

- `yarn workspace app-domain test --run`
- `yarn workspace app-domain build`
