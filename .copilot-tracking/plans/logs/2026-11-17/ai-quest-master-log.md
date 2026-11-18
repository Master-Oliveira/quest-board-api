<!-- markdownlint-disable-file -->
# Planning log: AI Quest Master (issue #2)

## Discrepancy log

* Research step order put the concurrency check after adventurer lookup. The plan checks the shared cap after JSON parsing and before the generator, so the generator keeps ownership of validation. Invalid requests still never call the model, but a busy server may return 429 to an invalid body.
* Research mapped invalid model output to the existing `INVALID_MODEL_RESPONSE` code. The plan raises it as a domain `ApiError(502)` so the domain does not import the Foundry module (which loads the SDK).
* Research suggested optionally injecting the logger through `createApp`; the plan injects it only through `createServices` to keep a single composition root.

## Implementation paths considered

* Selected: server-managed `objectives`/`aiGenerated` on every quest; extend `complete()` options; domain generator; strict validation with no repair or retry
* Rejected: writable `objectives` (breaks the all-writable-fields rule), separate metadata store, `completeJson`, clamping, and automatic retries (see research alternatives A to D)

## Process note

* Source edits were started before the plan was reviewed; they were reverted with `git restore` at the user's request. The working tree contains only `.copilot-tracking/` artifacts.

## Suggested follow-on work

* Optional billable smoke test of structured output against the configured deployment (`npm run verify:foundry`-style, user-approved only)
* Consider a configurable output-token cap for generation if 1024 proves tight
