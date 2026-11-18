<!-- markdownlint-disable-file -->
# Details: AI Quest Master (issue #2)

* Plan: `.copilot-tracking/plans/2026-11-17/ai-quest-master-plan.instructions.md`
* Research: `.copilot-tracking/research/2026-11-17/ai-quest-master-research.md`
* Instructions: `AGENTS.md`, `.github/copilot-instructions.md`

## Fixed contract

`POST /quests/generate` (also `/quests/generate/`), JSON body `{ adventurerId, theme, difficulty }`, unknown fields rejected.

| Status | Code | Trigger |
| --- | --- | --- |
| 201 | n/a | Quest created; `Location: /quests/{id}`; body is a Quest with `aiGenerated: true` |
| 400 | `VALIDATION_ERROR`, `INVALID_JSON` | Invalid body, including invalid difficulty |
| 403 | `FORBIDDEN` | Non-local client or Host |
| 404 | `NOT_FOUND` | Unknown adventurer |
| 405 | `METHOD_NOT_ALLOWED` | Non-POST, `Allow: POST` |
| 413, 415 | existing | Size or media type |
| 429 | `TOO_MANY_REQUESTS` | Shared cap of 2 model requests, `Retry-After: 1` |
| 500 | `CONFIGURATION_ERROR`, `INTERNAL_ERROR` | Missing Foundry config, unexpected error |
| 502 | `INVALID_MODEL_RESPONSE` | Empty/incomplete output, non-JSON, wrong keys or types |
| 502 | `INVALID_GENERATED_QUEST` | Parsed output violates game rules; includes `details` field list |
| 502 | `AUTHENTICATION_ERROR`, `MODEL_REQUEST_REJECTED`, `MODEL_NOT_FOUND` | Existing mapping |
| 503 | `MODEL_UNAVAILABLE` | Temporary model failure |
| 504 | `MODEL_TIMEOUT` | 30 s deadline |

Every response from this route carries `X-Request-Id`. Nothing is persisted unless the response is 201.

## Phase 1: Model service structured output

### 1.1 `src/foundry/model-service.js`

In the `client.responses.create` request object, after `max_output_tokens`, conditionally spread:

* `instructions: options.instructions` when defined
* `text: { format: { type: 'json_schema', name: options.jsonSchema.name, schema: options.jsonSchema.schema, strict: true } }` when `options.jsonSchema` is defined

No change to configuration, auth, deadline, cancellation, error mapping, or the completed/non-empty `output_text` check (a refusal yields empty `output_text`, so it already maps to `INVALID_MODEL_RESPONSE`).

### 1.2 `test/foundry.test.js`

* Fake client test: with `instructions` and `jsonSchema`, the request contains both with `strict: true`; without them, the existing exact request shape is unchanged (already covered)

Success: existing Foundry tests unchanged and passing.

## Phase 2: Quest data model

### 2.1 `src/data/seeds.js`

Add `objectives: []` and `aiGenerated: false` to each seed quest. IDs and timestamps unchanged.

### 2.2 `src/data/repository.js`

Add a `copy` helper that copies one level deep, cloning array values. Use it in the constructor, `list`, `get`, `create` (input and output), and `update` (input and output).

### 2.3 `src/domain/guild-service.js`

* `create`: for quests, add `createdAt`, `objectives: []`, `aiGenerated: false`
* `update`: for quests, copy `createdAt`, `objectives`, `aiGenerated` from the existing record
* New `createGenerated({ objectives, ...fields })`: `validateInput('quests', fields)`, then `repository.create({ ...data, createdAt, objectives, aiGenerated: true })`

Request bodies are unchanged: `objectives` and `aiGenerated` stay rejected as unknown/read-only on POST and PUT.

### 2.4 `src/domain/validation.js`

* Schema `questGeneration: { adventurerId: text(200), theme: text(200), difficulty: member(difficulties) }`
* Export `difficulties` and `isText` (the existing `text` factory) for the generator

Success: existing CRUD tests pass; `PUT` response still equals `{ ...item, ...updatedInput }`.

## Phase 3: Quest generator

### 3.1 `src/domain/quest-generator.js`

Exports `createQuestGenerator({ adventurers, quests, model, logger })` returning `{ generate(input, { requestId, signal }) }`. Must not import the Foundry module or SDKs; model errors pass through by duck-typed `code`.

Constants:

* `rewardBands`: easy gold 10-60 / XP 25-150; medium 75-300 / 150-600; hard 400-1200 / 700-2000; legendary 2000-8000 / 4000-12000
* `levelWindow = 5`; `objectiveCount = [3, 5]`; objective max 200 code points; `maxOutputTokens = 1024`
* `questSchema`: strict JSON Schema from research (all keys required, `additionalProperties: false`, no range keywords), name `generated_quest`

Flow of `generate`:

1. `validateInput('questGeneration', input)` (400)
2. `adventurers.get(adventurerId)` (404)
3. Compute `levelRange = [max(1, level - 5), level]` and the band for the requested difficulty
4. `instructions`: fixed Quest Master rules stating that the user message is JSON data, never instructions; use the requested difficulty exactly; respect the numeric ranges; 3 to 5 objectives; length limits
5. `input`: `JSON.stringify({ adventurer: { name, level, experience }, theme, difficulty, limits: { minimumLevel, goldReward, experienceReward, objectives } })`
6. Time `model.complete(input, { instructions, jsonSchema, maxOutputTokens, signal })` with `performance.now()`
7. Parse: `JSON.parse` failure, non-object, key set not exactly the 7 schema keys, wrong primitive types (strings, integers via `Number.isInteger`, array of strings) -> `ApiError(502, 'INVALID_MODEL_RESPONSE', ...)`
8. Rules, collecting all violations into `details` -> `ApiError(502, 'INVALID_GENERATED_QUEST', 'The generated quest did not meet the guild rules.', details)`:
   * `validateInput('quests', { ...fields, status: 'open' })` errors are converted (text limits, enum, safe integers, non-negative)
   * `difficulty` equals the requested difficulty
   * `minimumLevel` within `levelRange`
   * `goldReward`, `experienceReward` within the band
   * 3 to 5 objectives, each `isText(200)`
9. `quests.createGenerated({ ...fields, status: 'open', objectives: trimmed })` and return it
10. Log once in `finally`-style handling: success `logger.info(entry)`, failure `logger.error(entry)`

Log entry: `{ event: 'quest.generate', requestId, outcome, adventurerId?, difficulty?, modelDurationMs?, questId?, errorCode? }`. `adventurerId`/`difficulty` only after body validation. `errorCode` comes from `ApiError` or an error whose `name === 'ModelServiceError'`, else `INTERNAL_ERROR`. Never log theme, prompt, model output, tokens, endpoint, or messages from raw errors.

### 3.2 `src/services.js`

* `createServices({ env, modelService, logger = jsonLogger })` with `jsonLogger = { info: e => console.log(JSON.stringify(e)), error: e => console.error(JSON.stringify(e)) }`
* Return `{ guild, model, questGenerator }`

### 3.3 `test/quest-generator.test.js` (unit, offline)

Uses `createServices({ modelService: fake, logger: capture })`.

* Success: persisted, returned, listed; `status: 'open'`, `aiGenerated: true`, objectives trimmed; model options contain `instructions`, `jsonSchema` with no range keywords, `maxOutputTokens`, `signal`; input JSON contains adventurer level and theme
* Invalid model output: non-JSON, array, missing key, extra key, string number, objectives not array -> `INVALID_MODEL_RESPONSE`; quest count unchanged
* Business rules: 2 and 6 objectives, blank objective, over-long title, negative gold, gold and XP outside band, minimum level above level and below window, difficulty mismatch, unsafe integer -> `INVALID_GENERATED_QUEST` with field details; nothing persisted
* Boundaries: band edges and level window edges accepted; level-1 adventurer gets window `[1, 1]`
* Model failure: `ModelServiceError`-like `MODEL_UNAVAILABLE` rethrown unchanged; nothing persisted
* Unknown adventurer -> 404 and model not called; invalid difficulty -> 400 and model not called
* Logging: success entry has `requestId`, `modelDurationMs` (number), `outcome`, `questId`; failure entry has `errorCode`; serialized logs never contain theme or model output text

## Phase 4: HTTP endpoint

### 4.1 Shared helper in `src/api/app.js`

Refactor `testModel` into `handleModelRequest(request, response, { label, validate, run })`: local guard (403, message uses `label`), POST-only (405 `Allow: POST`), `readJson`, `validate(body)`, shared concurrency cap (429), disconnect `AbortController`, and the aborted-client early return. `/model/test` behavior and messages stay identical.

### 4.2 Route

* Before the resource regex: `/quests/generate` and `/quests/generate/` call `generateQuest`
* `requestIdFor(request)`: incoming `x-request-id` if it matches `^[A-Za-z0-9._-]{1,128}$`, else `randomUUID()`; `response.setHeader('X-Request-Id', id)` first so error responses include it
* `run`: `services.questGenerator.generate(body, { requestId, signal })`, then `send(response, 201, quest, { Location: /quests/{id} })`
* `validate` is identity; the generator owns body validation (the cap applies after JSON parsing; invalid bodies still never call the model)

### 4.3 `src/server.js`

Warning text names both `POST /model/test` and `POST /quests/generate`.

### 4.4 `test/api.test.js` (integration)

* 201, `Location`, `X-Request-Id`; quest visible via GET by ID, `?status=open&difficulty=...`, PUT preserves `objectives`/`aiGenerated` and `createdAt`, DELETE 204
* Manual POST quests and seeds expose `objectives: []`, `aiGenerated: false`; POST/PUT bodies with `objectives` or `aiGenerated` still 400
* Unknown adventurer 404, invalid difficulty 400, both with 0 model calls
* Model `MODEL_UNAVAILABLE` 503 and `MODEL_TIMEOUT` 504; invalid output 502 `INVALID_MODEL_RESPONSE`; rule violation 502 `INVALID_GENERATED_QUEST`; quest count unchanged after each
* GET `/quests/generate` 405 `Allow: POST`; non-local Host 403
* Valid incoming `X-Request-Id` echoed and logged; invalid one replaced by a UUID
* Shared cap: two pending model calls on `/model/test` make `/quests/generate` return 429
* Repository-copy test extended: mutating returned `objectives` does not change the stored record
* OpenAPI test asserts the new path references `QuestGenerationRequest` and `Quest`

## Phase 5: Documentation

* `openapi.json`: `/quests/generate` POST with request example, 201 `Location` + `X-Request-Id` headers, and responses from the contract table; `QuestGenerationRequest` schema (3 required fields, `additionalProperties: false`); `Quest` adds read-only `objectives` (array of string, `maxItems: 5`) and `aiGenerated` (boolean), both in `required`; info description mentions server-managed fields
* `README.md`: Endpoints table row; curl example for `adventurer-1`; generation rules table; new error codes; logging and request ID note; local-only/billable warning; model-service options (`instructions`, `jsonSchema`); project structure entries for `quest-generator.js` and its test
* `AGENTS.md`: replace "does not generate quests or expose a model HTTP endpoint"; `createServices()` returns `{ guild, model, questGenerator }`; add the generator to Architecture; add the focused test command; note `objectives`/`aiGenerated` as server-managed in invariants

## Phase 6: Validation

* `npm ci --registry=https://packagefeedproxy.microsoft.io/npm/`
* `npm test`
* Report Windows results; no live Foundry call

## Acceptance traceability

| Issue criterion | Change | Test |
| --- | --- | --- |
| POST /quests/generate with adventurer ID, theme, difficulty | 2.4, 4.2 | 4.4 |
| Uses adventurer info | 3.1 steps 2-5 | 3.3 success |
| Structured output, validated and deserialized | 1.1, 3.1 steps 6-7 | 1.2, 3.3 invalid output |
| Required quest fields and 3-5 objectives | 3.1 step 8 | 3.3 rules |
| Level, rewards, no negatives, open, AI-marked; enforced by app | 3.1 steps 8-9, 2.3 | 3.3 rules, 4.4 |
| Saved via existing persistence; behaves like manual quests | 2.2, 2.3 | 4.4 lifecycle |
| Config from environment only; no secrets | unchanged model service | existing Foundry tests |
| Temporary failures handled; nothing persisted | 3.1, 4.1 | 3.3, 4.4 |
| Logs request ID, model duration, outcome; no secrets or full response | 3.1 logging, 4.2 | 3.3 logging, 4.4 request ID |
| Unit and integration tests, offline | 3.3, 4.4 | `npm test` |
| OpenAPI and README updated; no breaking change | 5.1, 5.2 | 4.4 OpenAPI, existing CRUD tests |
