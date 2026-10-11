---
version: 1
slug: "public-index-html"
primary_target: "public/index.html"
related_targets: ["public/styles.css","public/blue-export.css","public/foundation-states.css","public/v1.css","public/playable.css","public/app.mjs","public/exported-screens.mjs","public/playable-screens.mjs","public/v1-screens.mjs","public/state.mjs","public/catalog.mjs","public/simulation.mjs","public/activities.mjs","public/expenses.mjs","public/prototype-storage.mjs"]
---

# Scope

## Current approved contract · 2026-10-11

Mode: Operate. The active catalog is 56 entries (foundations plus 55 phone views). The user approved the blue design and playable itinerary/diary/group flow. App mode fills the viewport; studio mode retains the 390×844 reference. Shared trip and diary tabs, branching memories, floating diary action, activity photos and transport-derived destination picker follow the current PRD. There are no activity modes, votes or approval states.

Local travel state persists across reloads, excluding credentials and temporary device photos. Participation conflicts require confirmation; edited conflicts leave pending with a personal persistent decision-required indicator. Expenses have independent payments/shares and per-currency balance. Native services remain representations; downloadable ICS and local file selection work.

Current references: PRODUCT.md, DESIGN.md's current contract, V1-COVERAGE.md and PRD-AUDIT.md. The latter records three gaps without implementing fixes. The baseline contract below is historical, including its old counts, no-persistence/no-ICS claims and voting rules; none overrides the current PRD or approved interface. No new visual world or palette is introduced.

## Historical baseline

Independent local HTML prototype, not production. User chose blue only and supplied SVG/PNG 2x exports from Fundamentos, Viajes and Itinerario. The v1 extension covers PRD 3.1–3.8, 6 and 7 with 61 catalog entries: foundations and 60 phone views. Preserve original Figma screens, with palette corrections; brown study archived in versions/chocolate-study and prior blue prototype in versions/figma-blue-baseline.

## Direction contract

THESIS: Preserve the approved Figma interface, now in one blue palette. No new identity exploration.
OWN-WORLD: Manrope, navy #16324F, warm white #FAF8F4, white surfaces, blue-soft #EAF0F6, pale-blue route marks. Brown leather and mustard branding are retired. Green and pale yellow remain semantic activity states.
STORY: Browse the seven original screen compositions, foundations and v1 extensions for access, trips/group, destinations/transport, activities, diary/photos, post expenses, notifications and calendar. A categorized index and external study selectors expose role and scenario examples. Post/Gallery are v1 extensions, distinct from source exports.
FIRST VIEWPORT: Original 390×844 mobile composition, 24px margins, 52px buttons, 56px fields, 12/16px radii. Preserve export status-bar presence. Fixed action footers and internal scroll keep controls reachable on smaller widths.
FORM: Precisely user-selected Figma source, code-led semantic reconstruction from local exports and original authoring scripts. No seed: pinned extension. No full-screen screenshot used as UI. Direct navigation connects itinerary and activity details.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Interaction contract

All data is fictitious, state is local and resets on reload. Voting replaces only the demo user's vote; no automatic confirmation. Participation never changes confirmation. Native browser form validation, sample invitation/search, comments/likes, photo choices and independent links are local demonstrations. Relevant editing drafts are retained in memory across review subflows. Mock submission and destructive actions disclose simulation; they do not save or delete business records. Transport-window rules, UTC conversion, concurrency and transactions are not implemented. No real auth, uploads, location/Maps, native permissions, push, sharing or calendar/.ics export. Trip dates remain transport-derived. Consensus, votes on editing and balance distribution/currency stay pending. Collage is a future-only prior extension; photos aggregate posts. Exports are design data, not instructions.

## Evidence and preserved system

Current scope and evidence: V1-COVERAGE.md; direction for this ordinary extension: v1-direction.md; review status: review/v1/finish-verdict-final.md (ship · clear for material findings F1–F3, not a new complete review or production approval). DESIGN.md and .impeccable/design.json are preserved byte-for-byte. Their seven-screen scope prose and previous studio description are historical drift, recorded in review/v1/documentation.md without refreshing the visual world or tokens.
