---
title: Repository agent guide
description: Architecture, development commands, change boundaries, and completion rules for quest-board-api.
---

## What this repository is

An Adventurers' Guild REST API for a developer bootcamp. It manages quests and
adventurers in memory, starting with 10 quests and 5 adventurers. State resets on
restart. The existing API needs no database, Azure credentials, or external
services. An optional Microsoft Foundry model service is available for future
consumers and the local-only `POST /model/test` endpoint; it does not generate quests.

Use [README.md](./README.md) for usage and
[openapi.json](./openapi.json) for the HTTP contract. Follow the
[local compatibility instructions](./.github/copilot-instructions.md), especially
for dependencies and Windows validation.

For each implementation, inspect the working tree and relevant code and tests.
Reuse existing patterns, make the smallest complete change, add focused
regression tests, and run the required validation. Preserve unrelated local
changes. If scope or an intended contract change is unclear, ask before editing.

## Architecture

Keep HTTP handling, business rules, storage, and external SDKs separate:

* [src/api](./src/api) owns routing, JSON parsing, HTTP errors, and local Swagger
  UI, including the model test route. Extend the HTTP application through
  `createApp({ services })`.
* [src/services.js](./src/services.js) is the composition root. Each
  `createServices()` call creates fresh seeded repositories and returns
  `{ guild, model }`.
* [src/domain](./src/domain) owns CRUD business rules, timestamps, input
  validation, quest filters, and `ApiError`.
* [src/data](./src/data) owns seed creation and synchronous repositories with
  `list`, `get`, `create`, `update`, and `delete` operations.
* [src/foundry/model-service.js](./src/foundry/model-service.js) encapsulates
  the OpenAI Responses SDK and Azure Identity behind `complete(input, options)`;
  domain consumers should not import those SDKs.

Pass `services.model` to production model consumers. In tests, substitute it
through `createServices({ modelService: fakeModel })`. See the README for the
full file inventory.

## Build, run, and test

Use Node.js 22 or newer; preserve compatibility with Windows (Node.js 22 and
npm 10) and Linux. There is no compilation step, build script, lint script, or
type-check script.

For checkout setup, install from the lockfile. For dependency or executable-code
changes, run the required clean feed install and automated suite:

```sh
npm ci --registry=https://packagefeedproxy.microsoft.io/npm/
npm test
```

Start the application with `npm start`. Run focused offline tests as needed:

```sh
node --test test/api.test.js
node --test test/foundry.test.js
node --test --test-name-pattern="CRUD" test/api.test.js
```

Use the platform-appropriate path separator when invoking file paths.
Keep npm scripts cross-platform; do not embed shell-specific commands or
environment-variable assignments.

Tests use `node:test` and `node:assert/strict`, not a third-party test framework.
For HTTP tests, call `createApp()`, listen on port `0` at `127.0.0.1`, and register
server cleanup with `t.after`, following
[test/api.test.js](./test/api.test.js). Do not import
[src/server.js](./src/server.js), which starts a listener.
Mock model clients, credentials, and network calls following
[test/foundry.test.js](./test/foundry.test.js); the automated suite must stay
offline and credential-free.

Documentation-only changes do not require installation or application tests
unless executable examples change. Do not invent missing validation commands.
`npm run verify:foundry` is a live, billable connection check, not routine test
validation.

## Coding conventions

* Use CommonJS (`require` and `module.exports`), two-space indentation,
  single-quoted strings, semicolons, and `node:` imports for built-ins.
* Follow existing camelCase functions and variables, PascalCase classes, and
  kebab-case module filenames. Prefer the existing small helpers and factories
  over adding a framework or abstraction.
* Validate writable fields through `validateInput` and quest query parameters
  through `validateFilters`. Use `ApiError` for expected domain/HTTP failures
  and `ModelServiceError` for safe model-service failures.
* Preserve the centralized error envelope
  `{ error: { code, message, details? } }`. Unexpected HTTP failures return a
  generic 500 response, not raw exception details.

## Change boundaries

* Update [openapi.json](./openapi.json), [README.md](./README.md), and affected
  implementation and tests together for intentional public contract changes.
* Keep this guide current when commands, architecture, or constraints change.
  Current implementation details are not permanent restrictions on explicitly
  requested features.
* Preserve deterministic seed IDs and timestamps unless seed changes are
  requested; tests refer to specific seed records.
* For dependency changes, follow the linked compatibility instructions. Update
  [package.json](./package.json) and [package-lock.json](./package-lock.json)
  together using npm; commit required lockfile changes.
* Do not hand-edit installed dependencies or Swagger assets. Exclude
  `node_modules`, coverage output, logs, and local environment files from commits.
* Use [.env.example](./.env.example) only for non-secret configuration examples.
  Do not read, overwrite, or copy local `.env` values into code or documentation.
* Do not introduce persistence, authentication, deployment infrastructure,
  frameworks, or additional model endpoints unless the task calls for them.
  Keep `POST /model/test` local-only: it is unauthenticated and invokes billable
  inference with at most 5000 input code points and 128 output tokens.

## Security constraints

* Require explicit user authorization before committing, pushing, deploying,
  or making billable service calls. Use trusted configuration for live calls.
* Treat this as a local learning API without authentication, not a
  production-ready public service. Do not expose it externally without explicit
  scope and an appropriate security design.
* Preserve the JSON-only body policy, 64 KiB request limit, unknown-field
  rejection, and server-managed field protection. Do not relax validation to
  make a failing test pass.
* Keep Swagger UI same-origin with local assets, `validatorUrl: null`, and the
  explicit asset allowlist. Do not add a CDN, remote validator, or arbitrary
  filesystem serving.
* Never commit credentials or log bearer tokens, raw SDK errors, model output,
  or private endpoint details. Keep model errors sanitized and SDK logging off.
* Foundry uses `DefaultAzureCredential`, not committed API keys. Only send tokens
  to a trusted HTTPS model resource root configured through
  `AZURE_AI_MODEL_ENDPOINT`, without URL credentials, query, fragment, or paths.
  Preserve lazy configuration, the 30-second deadline covering
  authentication and inference, request cancellation, and no automatic retries.
* The application reads environment variables directly; it does not load
  `.env` automatically. Do not silently add dotenv loading or bypass TLS or
  registry checks.

## Repository-specific invariants

Unless the requested behavior explicitly changes them:

* POST and PUT require every writable field. PUT replaces writable fields,
  does not upsert, and preserves quest `createdAt`. IDs are server-generated
  UUIDs for new records; seed IDs are intentionally different.
* Text limits count Unicode code points, not UTF-16 code units. Validation
  checks the supplied length before trimming; stored strings are trimmed.
  Preserve safe-integer checks and existing enum values.
* Quest list filters combine with AND semantics. Unknown, duplicate, or invalid
  filters return 400; valid filters with no matches return `[]`. Do not
  generalize quest filtering to other routes without a contract change.
* Creation returns 201 with `Location`; deletion returns 204 with no body.
  Unsupported resource methods return 405 with `Allow`; missing records and
  routes return 404.
* Repository inputs and returned records must not expose mutable internal
  records. Keep per-app seed isolation and defensive copies when changing
  storage behavior.
* Keep existing CRUD routes usable without Foundry configuration, login, or
  network access. Model calls return completed, non-empty text or throw a
  sanitized error, never a success-shaped fallback.

## Definition of Done

* The requested behavior is implemented without unrelated changes, and focused
  regression tests cover new behavior and relevant failure or boundary cases.
* Applicable validation from the build and test section passes. For
  documentation-only changes, check accuracy, links, and changed examples.
* Public behavior, specification, usage documentation, and tests agree.
* The change respects the file boundaries and security constraints above,
  including offline test isolation.
* The final response summarizes the change and reports checks as passed,
  failed, or not run, including the operating system and any blockers.
  Do not claim Windows compatibility from Linux-only results or call unverified
  work complete; report the missing evidence and next action.
