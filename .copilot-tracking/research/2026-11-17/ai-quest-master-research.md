<!-- markdownlint-disable-file -->
# Research: AI Quest Master (GitHub issue #2)

* Issue: <https://github.com/Master-Oliveira/quest-board-api/issues/2>
* Branch: `feature/2-ai-quest-master-research` (created from `origin/main` at `8b33942`, no upstream set)
* Date: 2026-11-17
* Difficulty: medium-hard (HTTP routing, domain rules, model service, persistence, observability, OpenAPI, README, AGENTS.md, and tests all change together)
* Status: research complete; planning and implementation not started

## Scope

Add `POST /quests/generate`. The endpoint takes an adventurer ID, theme, and difficulty, asks the configured Foundry model for a structured quest, enforces game rules in application code, persists the quest through the existing quest repository, and returns it. The quest must then behave like any other quest through the existing Quest API.

### Success criteria (from the issue)

* Request carries `adventurerId`, `theme`, `difficulty`; the adventurer record is loaded and used in the prompt
* Model output is structured (JSON Schema), parsed, and validated by the app
* Generated quest has title, description, difficulty, minimum level, gold reward, experience reward, and 3 to 5 objectives
* App enforces: level appropriate for adventurer, rewards appropriate for difficulty, 3 to 5 objectives, no negative rewards, `status: "open"`, marked AI generated
* Saved through the existing repository and visible through `GET /quests`, `GET /quests/{id}`, filters, `PUT`, and `DELETE`
* Foundry config only from environment; no secrets in source
* Temporary model failures produce a sanitized API error and persist nothing
* Logs: request/correlation ID, model invocation duration, success or failure; no credentials or full model response
* Unit and integration tests for success, invalid model output, model failure, unknown adventurer, invalid difficulty, and business rules; offline only
* OpenAPI and README updated; no breaking change to the existing Quest API

## Evidence log

| Area | Finding | Source |
| --- | --- | --- |
| Routing | All resource routes go through one regex `^\/(quests\|adventurers)(?:\/([^/]+))?\/?$`. `/quests/generate` currently matches as `id = "generate"`: `POST` returns 405 (`Allow: GET, PUT, DELETE`), `GET` returns 404. The new route must be dispatched before this regex, like `/model/test`. | `src/api/app.js` (router in `createApp`) |
| Model route pattern | `/model/test` already shows the pattern to copy: local-only guard (`isLocalRequest`), POST-only with `Allow`, `validateInput` on the body, a shared concurrency cap of 2 with 429 + `Retry-After`, `AbortController` cancelled on client disconnect, and `ModelServiceError` to HTTP mapping through `modelErrorStatus`. | `src/api/app.js` (`testModel`, `modelErrorStatus`) |
| Error mapping | `CONFIGURATION_ERROR` 500, `AUTHENTICATION_ERROR`/`MODEL_REQUEST_REJECTED`/`MODEL_NOT_FOUND`/`INVALID_MODEL_RESPONSE` 502, `MODEL_UNAVAILABLE` 503, `MODEL_TIMEOUT` 504. Unknown errors become a generic 500. | `src/api/app.js` |
| Model service | `complete(input, { maxOutputTokens, signal })` calls `client.responses.create({ model, input, max_output_tokens? })`, has a 30 s deadline over auth and inference, no retries, SDK logging off, sanitized errors, and returns `output_text` only when `status === 'completed'` and non-empty. No structured-output or `instructions` option exists yet. | `src/foundry/model-service.js` |
| SDK support | Installed `openai@7.55.0` types expose `text.format` with `ResponseFormatTextJSONSchemaConfig { type: 'json_schema', name, schema, strict? }`. No new dependency is needed. | `node_modules/openai/resources/responses/responses.d.ts` (around line 2786) |
| Foundry structured outputs | Responses API supports structured outputs through `text.format`; `output_text` contains the JSON. Strict mode requires every property in `required` and `additionalProperties: false`. It does not support `minimum`/`maximum`, `minLength`/`maxLength`/`pattern`, or `minItems`/`maxItems`, so range and count rules must be validated in app code. Works with the v1 GA API; supported on gpt-4o (2024-08-06+), gpt-4.1, gpt-5, and o-series models. | <https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs> |
| Validation | `validateInput(resource, input)` uses a per-resource schema map, rejects unknown fields, checks code-point lengths before trimming, safe integers, and enums (`difficulties = easy, medium, hard, legendary`). Adding a `questGeneration` schema fits this pattern. | `src/domain/validation.js` |
| Quest service | `GuildService.create` validates writable fields and adds `createdAt` for quests. `update` validates, then copies `createdAt` from the existing record; the repository replaces the whole record. Any new server-managed field must be preserved in `update` the same way or PUT will erase it. | `src/domain/guild-service.js`, `src/data/repository.js` |
| Repository | `InMemoryRepository` makes shallow copies (`{ ...item }`). An `objectives` array would be shared by reference between stored and returned records, breaking the "no mutable internal records" invariant. Copy arrays in the repository. | `src/data/repository.js`, `test/api.test.js` (`repository does not expose mutable internal records`) |
| Seeds | Seed reward bands by difficulty: easy L1, gold 20-30, XP 50-75; medium L3-5, gold 100-200, XP 200-400; hard L8-10, gold 500-800, XP 900-1400; legendary L15-20, gold 3000-5000, XP 5000-8000. Adventurers: levels 5, 10, 15, 1, and 8 (`adventurer-5` is `inactive`). | `src/data/seeds.js` |
| Composition | `createServices({ env, modelService })` returns `{ guild, model }`; tests inject `modelService`. A quest generator should be built here from `guild.adventurers`, `guild.quests`, and `model`. | `src/services.js` |
| Existing tests | CRUD test asserts the `PUT` response equals `{ ...item, ...updatedInput }`, so new read-only fields are compatible if `PUT` preserves them. The seed test only checks writable keys exist. OpenAPI test deep-equals the served spec and checks every `$ref` resolves. | `test/api.test.js` |
| Logging | No logger or request ID exists. `server.js` uses `console`. A Foundry test asserts the model service itself writes no console output. | `src/server.js`, `test/foundry.test.js` |
| Docs | `AGENTS.md` says the model service "does not generate quests or expose a model HTTP endpoint"; that sentence becomes stale. README has an Endpoints table, validation section, model-service section, and project structure to update. `.env.example` documents model variables. | `AGENTS.md`, `README.md`, `.env.example` |

## Evaluated alternatives

### A. Representing `objectives` and the AI-generated marker on Quest

| Option | Pros | Cons |
| --- | --- | --- |
| A1 (selected): add two server-managed, read-only fields to every quest: `objectives: string[]` (seed and manual quests get `[]`) and `aiGenerated: boolean` (`false` for seed and manual). `POST`/`PUT` bodies are unchanged and keep rejecting these fields as unknown/read-only; `PUT` preserves both like `createdAt`. | Zero change to request contracts; additive response fields; generated quests flow through the same repository, filters, PUT, and DELETE; existing CRUD tests still pass. | Manual quests cannot set objectives (not requested). Response schema grows (additive). |
| A2: make `objectives` an optional writable field | Lets clients edit objectives | Breaks the rule that POST/PUT require every writable field, or forces a breaking required field; needs a PUT rule for omitted objectives. |
| A3: store generated metadata in a separate store keyed by quest ID | No Quest schema change | Generated quest would not "behave exactly like" other quests; DELETE/PUT consistency becomes complex. |

### B. Structured output mechanism

| Option | Pros | Cons |
| --- | --- | --- |
| B1 (selected): extend `complete(input, options)` with optional `instructions` and `jsonSchema: { name, schema }`; when present, send `instructions` and `text: { format: { type: 'json_schema', name, schema, strict: true } }`. Still returns `output_text`; the domain parses JSON. | Keeps the SDK inside `model-service.js`; existing callers and the request-shape test are unchanged (keys only added when supplied); reuses timeout, cancellation, and sanitization. | Domain must handle `JSON.parse` and schema validation (required anyway, since Azure strict mode cannot enforce ranges or counts). |
| B2: new `completeJson` that parses and returns an object | Slightly simpler consumer | Duplicates the deadline/cancellation path or needs refactoring; parse errors would need a second error vocabulary. |
| B3: prompt-only JSON ("reply in JSON") | No service change | Does not satisfy "structured output that the application can validate and deserialize reliably". |

### C. Location of the generation logic

Selected: new domain module `src/domain/quest-generator.js` exporting `createQuestGenerator({ adventurers, quests, model, logger })` with `generate(input, { requestId, signal })`. It validates input, loads the adventurer (404 if missing), builds the prompt, calls `model.complete`, parses and validates output, applies game rules, sets server-controlled fields, and persists through a quest-service method. `src/services.js` wires it as `services.questGenerator`. HTTP stays in `src/api/app.js`. Rejected alternatives: logic inside `app.js` (mixes HTTP and business rules) or inside `GuildService` (generic CRUD class, not quest-specific).

Persistence: add `GuildService.createGenerated(data)` (quest-only) that validates writable fields with `validateInput('quests', ...)`, adds `createdAt`, `objectives`, and `aiGenerated: true`, and calls `repository.create`. `create` sets `objectives: []` and `aiGenerated: false` for quests; `update` copies both from the existing record.

### D. Handling out-of-range model output

| Option | Pros | Cons |
| --- | --- | --- |
| D1 (selected): server sets `status: "open"` and `aiGenerated: true`; the model's `difficulty` must equal the requested value; everything else is validated strictly and any violation returns 502 `INVALID_GENERATED_QUEST` with nothing persisted. | Rules are explicit and testable; no silent data repair; meets "app, not model, enforces rules". | Model mistakes surface as errors; the client retries. |
| D2: clamp rewards and levels into range | Fewer failures | Hides model errors; quests may not match the generated narrative. |
| D3: automatic retry on invalid output | Fewer failures | Conflicts with the "no automatic retries" model-service invariant and doubles cost. |

## Selected approach

### Endpoint contract

`POST /quests/generate`, `Content-Type: application/json`, 64 KiB limit, unknown fields rejected.

```json
{ "adventurerId": "adventurer-1", "theme": "haunted lighthouse", "difficulty": "medium" }
```

* `adventurerId`: non-empty string, up to 200 code points
* `theme`: non-empty string, up to 200 code points (trimmed; untrusted prompt input)
* `difficulty`: `easy | medium | hard | legendary`

Success: `201 Created`, `Location: /quests/{id}`, body = Quest (including `objectives` and `aiGenerated: true`), plus an `X-Request-Id` header.

```json
{
  "id": "6f1c...", "title": "The Lantern Wraith", "description": "...",
  "difficulty": "medium", "minimumLevel": 4, "goldReward": 150, "experienceReward": 300,
  "status": "open", "createdAt": "2026-11-17T22:40:00.000Z",
  "objectives": ["Reach the lighthouse", "Relight the lantern", "Banish the wraith"],
  "aiGenerated": true
}
```

Errors (standard envelope):

| Status | Code | When | Model called | Persisted |
| --- | --- | --- | --- | --- |
| 400 | `VALIDATION_ERROR` / `INVALID_JSON` | Missing or invalid fields, invalid difficulty, unknown fields | No | No |
| 403 | `FORBIDDEN` | Non-local client (if the local guard is kept, see open questions) | No | No |
| 404 | `NOT_FOUND` | Unknown `adventurerId` | No | No |
| 405 | `METHOD_NOT_ALLOWED` | Any method other than POST on `/quests/generate`, `Allow: POST` | No | No |
| 413 / 415 | existing | Body too large or wrong media type | No | No |
| 429 | `TOO_MANY_REQUESTS` | Shared model concurrency cap reached, `Retry-After: 1` | No | No |
| 500 | `CONFIGURATION_ERROR` | Foundry not configured | Attempted | No |
| 502 | `INVALID_MODEL_RESPONSE` | Empty, incomplete, refused, non-JSON, or schema-invalid output | Yes | No |
| 502 | `INVALID_GENERATED_QUEST` (new) | Parsed output violates game rules | Yes | No |
| 502 | `AUTHENTICATION_ERROR`, `MODEL_REQUEST_REJECTED`, `MODEL_NOT_FOUND` | Existing mapping | Yes | No |
| 503 | `MODEL_UNAVAILABLE` | Throttling, 5xx, or connection failure (temporary) | Yes | No |
| 504 | `MODEL_TIMEOUT` | 30 s deadline | Yes | No |

Check order: route and method, local guard, media type and JSON, body schema, adventurer lookup, concurrency slot, model call. Unknown adventurers and invalid difficulties therefore never spend a model call.

### Structured output schema (sent with `strict: true`)

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["title", "description", "difficulty", "minimumLevel", "goldReward", "experienceReward", "objectives"],
  "properties": {
    "title": { "type": "string" },
    "description": { "type": "string" },
    "difficulty": { "type": "string", "enum": ["easy", "medium", "hard", "legendary"] },
    "minimumLevel": { "type": "integer" },
    "goldReward": { "type": "integer" },
    "experienceReward": { "type": "integer" },
    "objectives": { "type": "array", "items": { "type": "string" } }
  }
}
```

The app re-validates everything after `JSON.parse`: exact key set, types, safe integers, text limits (title 200, description 5000, each objective 1 to 200 code points, trimmed and non-blank), 3 to 5 objectives, and the game rules below. Range keywords are omitted from the schema because Azure strict mode rejects them; the ranges go in the prompt instead.

### Game rules (application-enforced)

Reward bands contain every seed quest of the same difficulty (inclusive, tunable constants in the generator module):

| Difficulty | Gold reward | Experience reward |
| --- | --- | --- |
| easy | 10-60 | 25-150 |
| medium | 75-300 | 150-600 |
| hard | 400-1200 | 700-2000 |
| legendary | 2000-8000 | 4000-12000 |

* `minimumLevel` is a safe integer with `max(1, adventurer.level - 5) <= minimumLevel <= adventurer.level` (the adventurer qualifies, and the quest is not trivially low for them)
* Rewards are non-negative safe integers inside the requested difficulty band (non-negative follows from the bands)
* `objectives` has 3 to 5 non-blank entries
* `difficulty` equals the requested difficulty
* `status` is forced to `open`; `aiGenerated` is forced to `true`; `id` and `createdAt` are server-generated

`instructions` carries the fixed Quest Master rules, the band ranges, and the level range. The user `input` carries the adventurer's name, level, and experience plus the requested theme and difficulty as a JSON object, so the theme is treated as data rather than instructions. App-side validation remains the actual control against prompt injection.

### Model service changes (`src/foundry/model-service.js`)

* Accept optional `options.instructions` (string) and `options.jsonSchema` (`{ name, schema }`); add `instructions` and `text.format` to the request only when supplied
* Keep the existing contract: return non-empty `output_text` only for `status === 'completed'`; otherwise `INVALID_MODEL_RESPONSE`
* No new dependencies; no change to auth, deadline, cancellation, retries, or logging settings

### Observability

* Request ID: use the incoming `X-Request-Id` when it matches `^[A-Za-z0-9._-]{1,128}$`, otherwise `crypto.randomUUID()`; return it in the `X-Request-Id` response header on success and errors for this route
* One structured log line per generation attempt through an injectable logger (`createServices({ logger })`, default `console`): `{ event: "quest.generate", requestId, adventurerId, difficulty, outcome: "succeeded" | "failed", errorCode?, modelDurationMs?, questId? }`
* Measure `modelDurationMs` with `performance.now()` around `model.complete` only
* Never log theme text, prompt, model output, tokens, endpoint, or raw errors; the request ID pattern prevents log injection
* Tests inject a capturing logger so test output stays quiet and log content can be asserted

### HTTP integration (`src/api/app.js`)

* Dispatch `/quests/generate` and `/quests/generate/` before the resource regex; non-POST methods return 405 with `Allow: POST`
* Reuse the `/model/test` building blocks: `readJson`, the shared `activeModelRequests` cap, the disconnect `AbortController`, and `modelErrorStatus` (add `INVALID_GENERATED_QUEST: 502`)
* Output token cap: a fixed constant (for example 1024) is enough for one quest; no new environment variable

### Documentation and tests

* `openapi.json`: new `/quests/generate` POST path; `QuestGenerationRequest` schema; `Quest` gains read-only `objectives` (array of strings, 0 to 5 items) and `aiGenerated` (boolean), both required in responses; responses from the error table; `X-Request-Id` header
* `README.md`: Endpoints row, curl example for generation, rule summary, error codes, logging note, project structure entry
* `AGENTS.md`: replace the "does not generate quests" sentence; add the generator to the architecture list
* `src/server.js`: extend the billable-endpoint warning to mention `POST /quests/generate`
* Tests (all offline, fake `modelService` through `createServices({ modelService })`):
  * `test/quest-generator.test.js` (unit): success persists with `aiGenerated`, `open`, and objectives; invalid JSON; schema-invalid output (missing field, extra field, wrong type); 2 and 6 objectives; out-of-band gold and XP; negative reward; minimum level above the adventurer level and too far below; difficulty mismatch; model error passthrough; nothing persisted on any failure; prompt includes adventurer level and theme; log entry fields and absence of model output
  * `test/api.test.js` (integration): 201 + `Location` + quest visible through GET, filters, PUT (preserves `objectives` and `aiGenerated`), and DELETE; unknown adventurer 404 with the model not called; invalid difficulty 400 with the model not called; `MODEL_UNAVAILABLE` gives 503 and the quest count is unchanged; invalid model output 502; rule violation 502; 405 for GET; `X-Request-Id` echo; manual quests report `aiGenerated: false` and `objectives: []`
  * `test/foundry.test.js`: `instructions` and `text.format` are sent only when supplied, with `strict: true`
  * Existing repository-copy test extended to cover the `objectives` array

## Decisions (resolved 2026-11-17: user accepted every recommended default)

1. Local-only guard: apply the same `isLocalRequest` guard and the shared two-call concurrency cap as `/model/test`.
2. Inactive adventurers: allowed to generate quests.
3. Difficulty and level mismatch: allowed; `minimumLevel` stays within `max(1, level - 5)..level` and rewards use the requested difficulty band.
4. Reward bands and the 5-level window: adopted as proposed.
5. `theme` and `adventurerId` are not persisted on the quest.

Implementation note: the concurrency slot is checked after JSON parsing and before the generator runs, so body validation and adventurer lookup happen inside the slot. They still never call the model when invalid.

## Risks

* Prompt injection through `theme`: mitigated by the length limit, separating instructions from data, the strict schema, and app-side rule validation
* Model deployments without structured-output support return 400; the existing mapping yields `MODEL_REQUEST_REJECTED` with guidance
* Adding fields to every quest response changes the published schema; the change is additive but must be documented as a contract update
* Shared array references in the repository; `objectives` must be copied on every read and write

## Next steps

1. Confirm or adjust the open-question defaults
2. Create the implementation plan under `.copilot-tracking/plans/2026-11-17/`
3. Implement in order: model-service options, validation schema, quest-service fields, generator module, HTTP route and logging, docs, tests
4. Validate with `npm ci --registry=https://packagefeedproxy.microsoft.io/npm/` and `npm test` on Windows
