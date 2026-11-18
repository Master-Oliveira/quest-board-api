<!-- markdownlint-disable-file -->
# Changes: AI Quest Master (issue #2)

* Plan: `.copilot-tracking/plans/2026-11-17/ai-quest-master-plan.instructions.md`
* Date: 2026-11-17

## Added

* `src/domain/quest-generator.js`: prompt, strict JSON Schema, output parsing, guild rules, persistence, sanitized logs
* `test/quest-generator.test.js`: 8 unit tests

## Modified

* `src/foundry/model-service.js`: optional `instructions` and `jsonSchema` (strict `text.format`)
* `src/domain/validation.js`: `questGeneration` schema; exports `difficulties`, `isText`
* `src/domain/guild-service.js`: quest defaults, preserved server-managed fields, `createGenerated`
* `src/data/repository.js`: array-safe copies; `src/data/seeds.js`: `objectives`, `aiGenerated`
* `src/services.js`: `questGenerator`, injectable JSON `logger`
* `src/api/app.js`: shared `handleModelRequest`, `/quests/generate`, `X-Request-Id`
* `src/server.js`: warning covers both billable endpoints
* `test/api.test.js` (+6 tests, repository-copy extension), `test/foundry.test.js` (+1 test)
* `openapi.json`, `README.md`, `AGENTS.md`

## Validation

* `npm test` on Windows (Node 22.23.5, npm 10.9.9): 46/46 passed
* `npm ci --registry=https://packagefeedproxy.microsoft.io/npm/`: not run; access blocked by organization content policy (no dependency changes)
